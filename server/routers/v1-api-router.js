const express = require("express");
const { R } = require("redbean-node");
const Monitor = require("../model/monitor");
const { getAPIKeyDetails } = require("../auth");
const { apiRateLimiter } = require("../rate-limiter");
const { RateLimiter } = require("limiter");
const { ValidationError } = require("../errors");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { loadMonitorAnalytics, loadMonitorChecks } = require("../monitor-analytics");
const { bulkUpdateMonitors } = require("../bulk-monitors");
const { openApiSpec } = require("../api-openapi");
const { heartbeatsToCsv } = require("../../src/analytics-csv");
const { log } = require("../../src/util");

/**
 * Values used for fields a REST client leaves out when creating a monitor.
 * The UI form has more defaults; these are the ones the server needs.
 */
const MONITOR_DEFAULTS = {
    type: "http",
    url: "https://",
    method: "GET",
    interval: 60,
    retryInterval: 60,
    resendInterval: 0,
    maxretries: 0,
    timeout: 48,
    parent: null,
    active: true,
    notificationIDList: {},
    accepted_statuscodes: ["200-299"],
    ignoreTls: false,
    upsideDown: false,
    maxredirects: 10,
    saveResponse: false,
    saveErrorResponse: true,
    responseMaxLength: 1024,
    kafkaProducerBrokers: [],
    kafkaProducerSaslOptions: { mechanism: "None" },
    conditions: [],
    rabbitmqNodes: [],
};

class HttpError extends Error {
    /**
     * @param {number} status HTTP status to send
     * @param {string} message Message for the response body
     */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * Send an error as JSON. Errors from bad input are 400, errors the caller
 * asked for by id are 404 (HttpError), anything else is a server error (500).
 * @param {express.Response} res Response
 * @param {Error} e Error to send
 * @returns {void}
 */
function sendError(res, e) {
    let status = 500;
    if (e instanceof HttpError) {
        status = e.status;
    } else if (e instanceof ValidationError) {
        status = 400;
    }
    if (status >= 500) {
        log.error("api", e);
    }
    res.status(status).json({ ok: false, msg: status >= 500 ? "Internal server error" : e.message });
}

/**
 * Wrap a route so thrown errors become JSON responses
 * @param {Function} fn Route body. Returns the JSON body, or sends its own response.
 * @returns {Function} Express handler
 */
function route(fn) {
    return async (req, res) => {
        try {
            const result = await fn(req, res);
            if (!res.headersSent) {
                res.json(result ?? { ok: true });
            }
        } catch (e) {
            sendError(res, e);
        }
    };
}

/**
 * Read the API key from "Authorization: Bearer <key>" or "Authorization: Basic <base64 user:key>".
 * The user name in Basic auth is ignored.
 * @param {express.Request} req Request
 * @returns {string|null} The key, or null if none was sent
 */
function extractAPIKey(req) {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
        return header.slice(7).trim();
    }
    if (header.startsWith("Basic ")) {
        const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
        return decoded.slice(decoded.indexOf(":") + 1);
    }
    return null;
}

/** Requests per minute allowed for each API key. Set UK_API_RATE_LIMIT to change it. */
const PER_KEY_LIMIT = Number(process.env.UK_API_RATE_LIMIT) || 60;

/** One token bucket per key ID, created when the key is first used */
const keyBuckets = new Map();

/**
 * Get the token bucket for an API key
 * @param {string} keyID Key ID from uk<id>_<secret>
 * @returns {RateLimiter} Bucket
 */
function bucketFor(keyID) {
    if (!keyBuckets.has(keyID)) {
        keyBuckets.set(keyID, new RateLimiter({ tokensPerInterval: PER_KEY_LIMIT, interval: "minute" }));
    }
    return keyBuckets.get(keyID);
}

/**
 * Middleware: require a valid API key, apply its rate limit, and enforce read-only keys
 * @param {express.Request} req Request
 * @param {express.Response} res Response
 * @param {express.NextFunction} next Next handler
 * @returns {Promise<void>}
 */
async function requireAPIKey(req, res, next) {
    try {
        const key = extractAPIKey(req);
        const details = await getAPIKeyDetails(key);

        if (details === null) {
            // Failed guesses share one global limit, so trying keys one after another is slow
            if (!(await apiRateLimiter.pass(null, 1))) {
                throw new HttpError(429, "Too many failed attempts. Try again later.");
            }
            res.set("WWW-Authenticate", 'Basic realm="Uptime Kuma API"');
            throw new HttpError(401, "Missing or invalid API key");
        }

        const keyID = key.substring(2, key.indexOf("_"));
        if (!(await bucketFor(keyID).tryRemoveTokens(1))) {
            res.set("Retry-After", "60");
            throw new HttpError(429, `Rate limit of ${PER_KEY_LIMIT} requests per minute reached for this key`);
        }

        if (details.scope === "read" && req.method !== "GET") {
            throw new HttpError(403, "This API key is read-only");
        }

        req.userID = details.userID;
        next();
    } catch (e) {
        sendError(res, e);
    }
}

/**
 * Parse an integer route parameter
 * @param {string} value Raw value
 * @param {string} name Name for the error message
 * @returns {number} Parsed integer
 * @throws {HttpError} If the value is not an integer
 */
function parseID(value, name) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw new HttpError(400, `Invalid ${name}`);
    }
    return id;
}

/**
 * Create the REST API router, mounted under /api/v1.
 * The monitor commands are the same functions the UI uses over Socket.IO.
 * @param {object} deps Dependencies from server.js
 * @param {Function} deps.addMonitor Socket "add" command
 * @param {Function} deps.editMonitor Socket "editMonitor" command
 * @param {Function} deps.deleteMonitor Socket "deleteMonitor" command
 * @param {Function} deps.startMonitor Start a monitor
 * @param {Function} deps.pauseMonitor Pause a monitor
 * @param {{exportBackup: Function, importBackup: Function}} deps.backup Backup functions
 * @param {Function} deps.restartMonitor Restarts a running monitor
 * @returns {express.Router} Router
 */
function createV1ApiRouter(deps) {
    const router = express.Router();
    const server = UptimeKumaServer.getInstance();

    router.use("/api/v1", express.json({ limit: "20mb" }));
    router.use("/api/v1", (req, res, next) => {
        if (req.path === "/openapi.json") {
            return next();
        }
        return requireAPIKey(req, res, next);
    });

    /**
     * Load a monitor the API key's owner can see, or throw 404
     * @param {number} userID Owner
     * @param {number} monitorID Monitor ID
     * @returns {Promise<object>} Monitor bean
     */
    async function ownMonitor(userID, monitorID) {
        const bean = await R.findOne("monitor", " id = ? AND user_id = ? ", [monitorID, userID]);
        if (!bean) {
            throw new HttpError(404, "Monitor not found");
        }
        return bean;
    }

    /**
     * Same JSON the UI gets for a monitor
     * @param {object[]} beans Monitor beans
     * @returns {Promise<object[]>} JSON objects
     */
    async function monitorsToJSON(beans) {
        const preloadData = await Monitor.preparePreloadData(
            beans.map((bean) => ({ id: bean.id, active: bean.active }))
        );
        return beans.map((bean) => bean.toJSON(preloadData));
    }

    /**
     * Run a socket command and turn its callback into a promise
     * @param {Function} command Command from deps
     * @param {number} userID Acting user
     * @param {...any} args Command arguments before the callback
     * @returns {Promise<object>} Callback payload when ok
     */
    function runCommand(command, userID, ...args) {
        return new Promise((resolve, reject) => {
            // checkLogin() needs a session. The API key already proved who the caller is.
            command({ userID, session: { user: { id: userID } } }, ...args, (result) => {
                if (result.ok) {
                    resolve(result);
                } else {
                    reject(new HttpError(400, result.msg));
                }
            });
        });
    }

    // List monitors. Optional filters: q (name contains), type, active=true|false.
    // Optional paging: limit (1 to 500) and offset. Without limit all matches are returned.
    // The total number of matches is in the X-Total-Count header.
    router.get(
        "/api/v1/monitors",
        route(async (req, res) => {
            const where = ["user_id = ?"];
            const params = [req.userID];
            if (req.query.q) {
                where.push("LOWER(name) LIKE ?");
                params.push(`%${String(req.query.q).toLowerCase()}%`);
            }
            if (req.query.type) {
                where.push("type = ?");
                params.push(String(req.query.type));
            }
            if (req.query.active !== undefined) {
                if (req.query.active !== "true" && req.query.active !== "false") {
                    throw new ValidationError("active must be true or false");
                }
                where.push("active = ?");
                params.push(req.query.active === "true" ? 1 : 0);
            }
            const whereSQL = where.join(" AND ");

            let limit = null;
            let offset = 0;
            if (req.query.limit !== undefined) {
                limit = Number(req.query.limit);
                if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
                    throw new ValidationError("limit must be a whole number from 1 to 500");
                }
                offset = Number(req.query.offset ?? 0);
                if (!Number.isInteger(offset) || offset < 0) {
                    throw new ValidationError("offset must be a whole number, 0 or more");
                }
            }

            const total = await R.getCell(`SELECT COUNT(*) FROM monitor WHERE ${whereSQL}`, params);
            const beans = await R.find(
                "monitor",
                `${whereSQL} ORDER BY id ${limit === null ? "" : "LIMIT ? OFFSET ?"}`,
                limit === null ? params : [...params, limit, offset]
            );
            res.set("X-Total-Count", String(total));
            return await monitorsToJSON(beans);
        })
    );

    router.post(
        "/api/v1/monitors",
        route(async (req, res) => {
            const body = { ...MONITOR_DEFAULTS, ...req.body };
            if (!body.name || typeof body.name !== "string") {
                throw new ValidationError("name is required");
            }
            const result = await runCommand(deps.addMonitor, req.userID, body);
            const bean = await ownMonitor(req.userID, result.monitorID);
            res.status(201);
            return (await monitorsToJSON([bean]))[0];
        })
    );

    // Change many monitors at once: { monitorIDs: [...], changes: { interval?, parent?, addTag? } }
    router.post(
        "/api/v1/monitors/bulk",
        route(async (req) => {
            const { monitorIDs, changes } = req.body || {};
            return await bulkUpdateMonitors(req.userID, monitorIDs, changes, deps.restartMonitor);
        })
    );

    router.get(
        "/api/v1/monitors/:id",
        route(async (req) => {
            const bean = await ownMonitor(req.userID, parseID(req.params.id, "monitor id"));
            return (await monitorsToJSON([bean]))[0];
        })
    );

    // Partial update: fields in the body replace the stored values, other fields stay as they are
    router.patch(
        "/api/v1/monitors/:id",
        route(async (req) => {
            const id = parseID(req.params.id, "monitor id");
            const bean = await ownMonitor(req.userID, id);
            const current = (await monitorsToJSON([bean]))[0];
            const merged = { ...current, ...req.body, id };
            await runCommand(deps.editMonitor, req.userID, merged);
            const updated = await ownMonitor(req.userID, id);
            return (await monitorsToJSON([updated]))[0];
        })
    );

    router.delete(
        "/api/v1/monitors/:id",
        route(async (req) => {
            const id = parseID(req.params.id, "monitor id");
            await ownMonitor(req.userID, id);
            const deleteChildren = req.query.deleteChildren === "true";
            await runCommand(deps.deleteMonitor, req.userID, id, deleteChildren);
            return { ok: true, msg: "Deleted" };
        })
    );

    router.post(
        "/api/v1/monitors/:id/pause",
        route(async (req) => {
            const id = parseID(req.params.id, "monitor id");
            await ownMonitor(req.userID, id);
            await deps.pauseMonitor(req.userID, id);
            await server.sendUpdateMonitorIntoList({ userID: req.userID }, id);
            return { ok: true, msg: "Paused" };
        })
    );

    router.post(
        "/api/v1/monitors/:id/resume",
        route(async (req) => {
            const id = parseID(req.params.id, "monitor id");
            await ownMonitor(req.userID, id);
            await deps.startMonitor(req.userID, id);
            await server.sendUpdateMonitorIntoList({ userID: req.userID }, id);
            return { ok: true, msg: "Resumed" };
        })
    );

    router.get(
        "/api/v1/monitors/:id/analytics",
        route(async (req) => {
            const id = parseID(req.params.id, "monitor id");
            await ownMonitor(req.userID, id);
            const period = Number(req.query.period ?? 24);
            return await loadMonitorAnalytics(id, period);
        })
    );

    // Raw checks. hours defaults to 24, format is "json" or "csv"
    router.get(
        "/api/v1/monitors/:id/heartbeats",
        route(async (req, res) => {
            const id = parseID(req.params.id, "monitor id");
            await ownMonitor(req.userID, id);
            const hours = Number(req.query.hours ?? 24);
            if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
                throw new HttpError(400, "hours must be between 1 and 8760");
            }
            const checks = await loadMonitorChecks(id, hours);

            if (req.query.format === "csv") {
                res.type("text/csv").attachment(`monitor-${id}-checks.csv`);
                res.send(heartbeatsToCsv(checks));
                return;
            }
            return { checks };
        })
    );

    router.get(
        "/api/v1/backup",
        route(async (req, res) => {
            const backup = await deps.backup.exportBackup(req.userID);
            res.attachment("uptime-kuma-backup.json");
            return backup;
        })
    );

    router.post(
        "/api/v1/backup",
        route(async (req) => {
            // The passphrase goes in a header so it does not end up in URLs or access logs
            return await deps.backup.importBackup(
                req.userID,
                req.body,
                deps.addMonitor,
                req.get("x-backup-passphrase") ?? null
            );
        })
    );

    // Export a backup encrypted with a passphrase: { "passphrase": "at least 8 characters" }
    router.post(
        "/api/v1/backup/export",
        route(async (req, res) => {
            const passphrase = req.body?.passphrase ?? null;
            const backup = await deps.backup.exportBackup(req.userID, passphrase);
            res.attachment(passphrase ? "uptime-kuma-backup.encrypted.json" : "uptime-kuma-backup.json");
            return backup;
        })
    );

    router.get("/api/v1/openapi.json", (req, res) => {
        res.json(openApiSpec);
    });

    return router;
}

module.exports = { createV1ApiRouter, extractAPIKey };
