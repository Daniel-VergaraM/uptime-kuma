const dayjs = require("dayjs");
const { R } = require("redbean-node");
const { ValidationError } = require("./errors");
const { UP, DOWN, PENDING, MAINTENANCE } = require("../src/util");

/** Max incidents returned to the client, newest first */
const MAX_INCIDENTS = 50;

/** The 365-day period. It uses the daily statistics, because raw checks are kept for less time. */
const DAILY_PERIOD_HOURS = 8760;

/**
 * Bucket width in seconds for each supported period (hours).
 * Keeps every series around 100-200 points regardless of period.
 */
const BUCKET_SECONDS = {
    24: 15 * 60,
    168: 60 * 60,
    720: 4 * 60 * 60,
    2160: 24 * 60 * 60,
    // 365 days, one bucket per day. Served from the daily statistics, see loadDailyAnalytics.
    [DAILY_PERIOD_HOURS]: 24 * 60 * 60,
};

/**
 * Nearest-rank percentile
 * @param {number[]} sorted Values sorted ascending
 * @param {number} p Percentile between 0 and 100
 * @returns {number|null} Value at the percentile, or null when empty
 */
function percentile(sorted, p) {
    if (sorted.length === 0) {
        return null;
    }
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Pair important DOWN -> UP heartbeats into incidents.
 * PENDING and MAINTENANCE beats do not open or close an incident.
 * @param {{time: number, status: number}[]} importantBeats Ascending by time (ms)
 * @param {number} now Current time in ms, used as end for an ongoing incident
 * @returns {{start: number, end: number|null, durationSec: number, ongoing: boolean}[]} Incidents, oldest first
 */
function buildIncidents(importantBeats, now) {
    const incidents = [];
    let open = null;

    for (const beat of importantBeats) {
        if (beat.status === DOWN && open === null) {
            open = { start: beat.time };
        } else if (beat.status === UP && open !== null) {
            incidents.push({ start: open.start, end: beat.time });
            open = null;
        }
    }
    if (open !== null) {
        incidents.push({ start: open.start, end: null });
    }

    return incidents.map((incident) => {
        const endOrNow = incident.end ?? now;
        return {
            ...incident,
            durationSec: (endOrNow - incident.start) / 1000,
            ongoing: incident.end === null,
        };
    });
}

/**
 * Build analytics for one monitor over a period.
 * @param {{time: number, status: number, ping: number|null}[]} beats Heartbeats in period, ascending by time (ms)
 * @param {{time: number, status: number}[]} importantBeats Status-change heartbeats, ascending by time (ms).
 *        Include the last one before the period so an incident that started earlier is still counted.
 * @param {number} periodHours One of the keys of BUCKET_SECONDS
 * @param {number} now Current time in ms
 * @param {number|null} sloTarget Availability target in percent, e.g. 99.9, or null for none
 * @returns {{summary: object, series: object[], incidents: object[]}} Analytics data
 * @throws {Error} If periodHours is not a supported period
 */
function buildAnalytics(beats, importantBeats, periodHours, now, sloTarget = null) {
    const bucketSeconds = BUCKET_SECONDS[periodHours];
    if (!bucketSeconds) {
        throw new ValidationError("Invalid period.");
    }

    const counts = { up: 0, down: 0, pending: 0, maintenance: 0 };
    const pings = [];
    const buckets = new Map();

    for (const beat of beats) {
        const key = Math.floor(beat.time / (bucketSeconds * 1000)) * bucketSeconds * 1000;
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { t: key, up: 0, down: 0, pending: 0, maintenance: 0, pings: [] };
            buckets.set(key, bucket);
        }

        if (beat.status === UP) {
            counts.up++;
            bucket.up++;
            if (beat.ping != null) {
                pings.push(beat.ping);
                bucket.pings.push(beat.ping);
            }
        } else if (beat.status === DOWN) {
            counts.down++;
            bucket.down++;
        } else if (beat.status === PENDING) {
            counts.pending++;
            bucket.pending++;
        } else if (beat.status === MAINTENANCE) {
            counts.maintenance++;
            bucket.maintenance++;
        }
    }

    pings.sort((a, b) => a - b);
    const incidents = buildIncidents(importantBeats, now);
    const resolved = incidents.filter((incident) => !incident.ongoing);
    const totalDowntimeSec = incidents.reduce((sum, incident) => sum + incident.durationSec, 0);
    const periodSec = periodHours * 3600;

    const summary = {
        checks: counts.up + counts.down + counts.pending + counts.maintenance,
        ...counts,
        uptimePct: counts.up + counts.down > 0 ? (counts.up / (counts.up + counts.down)) * 100 : null,
        avgPing: pings.length > 0 ? pings.reduce((sum, ping) => sum + ping, 0) / pings.length : null,
        p50Ping: percentile(pings, 50),
        p95Ping: percentile(pings, 95),
        p99Ping: percentile(pings, 99),
        incidentCount: incidents.length,
        totalDowntimeSec,
        // Mean time to recovery: average length of incidents that have ended
        mttrSec:
            resolved.length > 0
                ? resolved.reduce((sum, incident) => sum + incident.durationSec, 0) / resolved.length
                : null,
        // Mean time between failures: uptime in the period divided by number of incidents
        mtbfSec: incidents.length > 0 ? Math.max(periodSec - totalDowntimeSec, 0) / incidents.length : null,
        // Error budget: downtime allowed by the SLO target in this period, and how much of it is left (negative when overspent)
        sloTarget,
        errorBudgetSec: sloTarget != null ? (1 - sloTarget / 100) * periodSec : null,
        errorBudgetLeftSec: sloTarget != null ? (1 - sloTarget / 100) * periodSec - totalDowntimeSec : null,
    };

    const series = [...buckets.values()]
        .sort((a, b) => a.t - b.t)
        .map((bucket) => {
            const sorted = bucket.pings.sort((a, b) => a - b);
            const total = bucket.up + bucket.down;
            return {
                t: bucket.t,
                up: bucket.up,
                down: bucket.down,
                pending: bucket.pending,
                maintenance: bucket.maintenance,
                upPct: total > 0 ? (bucket.up / total) * 100 : null,
                avgPing: sorted.length > 0 ? sorted.reduce((sum, ping) => sum + ping, 0) / sorted.length : null,
                p95Ping: percentile(sorted, 95),
            };
        });

    return {
        summary,
        series,
        incidents: incidents.slice(-MAX_INCIDENTS).reverse(),
    };
}

/**
 * Summarize the TLS info stored for a monitor (monitor_tls_info.info_json)
 * @param {string|null|undefined} infoJson Raw JSON from the database
 * @returns {{valid: boolean, daysRemaining: number|null, validTo: string|null, issuer: string|null, certType: string|null}|null}
 *          Null when there is no certificate data or it cannot be parsed
 */
function buildCertificateSummary(infoJson) {
    if (!infoJson) {
        return null;
    }

    let info;
    try {
        info = JSON.parse(infoJson);
    } catch (e) {
        return null;
    }

    const cert = info?.certInfo;
    if (!cert) {
        return null;
    }

    return {
        valid: info.valid === true,
        daysRemaining: cert.daysRemaining ?? null,
        validTo: cert.validTo ?? null,
        issuer: cert.issuer?.O || cert.issuer?.CN || null,
        certType: cert.certType ?? null,
    };
}

/**
 * Read an SLO target sent by a client. Empty or missing means no target.
 * @param {number|string|null|undefined} value Target in percent, e.g. 99.9
 * @returns {number|null} The target, or null for none
 * @throws {Error} If the value is not a number above 0 and at most 100
 */
function parseSloTarget(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const target = Number(value);
    if (!Number.isFinite(target) || target <= 0 || target > 100) {
        throw new ValidationError("sloTarget must be between 0 and 100");
    }
    return target;
}

/**
 * Analytics for 365 days from the daily statistics kept by UptimeCalculator.
 * Those keep counts and ping per day, not individual incidents, so incident
 * figures and exact downtime are null for this period.
 * @param {number} monitorID ID of the monitor
 * @returns {Promise<{summary: object, series: object[], incidents: object[], certificate: object|null}>} Analytics data
 */
async function loadDailyAnalytics(monitorID) {
    const { UptimeCalculator } = require("./uptime-calculator");
    const calculator = await UptimeCalculator.getUptimeCalculator(monitorID);
    // getDataArray returns newest first. The chart wants oldest first.
    const days = calculator
        .getDataArray(DAILY_PERIOD_HOURS / 24, "day")
        .slice()
        .reverse();

    const totals = { up: 0, down: 0, maintenance: 0, pingWeighted: 0 };
    const series = days.map((day) => {
        totals.up += day.up;
        totals.down += day.down;
        totals.maintenance += day.maintenance ?? 0;
        if (day.avgPing != null) {
            totals.pingWeighted += day.avgPing * day.up;
        }
        return {
            t: day.timestamp * 1000,
            up: day.up,
            down: day.down,
            pending: 0,
            maintenance: day.maintenance ?? 0,
            upPct: day.up + day.down > 0 ? (day.up / (day.up + day.down)) * 100 : null,
            avgPing: day.avgPing ?? null,
            p95Ping: null,
        };
    });

    const monitorRow = await R.findOne("monitor", " id = ? ", [monitorID]);
    const sloTarget = monitorRow?.slo_target ?? null;
    const tlsInfoBean = await R.findOne("monitor_tls_info", "monitor_id = ?", [monitorID]);

    return {
        summary: {
            daily: true,
            checks: totals.up + totals.down + totals.maintenance,
            up: totals.up,
            down: totals.down,
            pending: 0,
            maintenance: totals.maintenance,
            uptimePct: totals.up + totals.down > 0 ? (totals.up / (totals.up + totals.down)) * 100 : null,
            avgPing: totals.up > 0 ? totals.pingWeighted / totals.up : null,
            p50Ping: null,
            p95Ping: null,
            p99Ping: null,
            incidentCount: null,
            totalDowntimeSec: null,
            mttrSec: null,
            mtbfSec: null,
            sloTarget,
            errorBudgetSec: null,
            errorBudgetLeftSec: null,
        },
        series,
        incidents: [],
        certificate: buildCertificateSummary(tlsInfoBean?.info_json),
    };
}

/**
 * Load heartbeats for a monitor from the database and build its analytics,
 * including the latest certificate summary. Shared by the socket handler and the REST API.
 * @param {number} monitorID ID of the monitor
 * @param {number} periodHours One of the keys of BUCKET_SECONDS
 * @param {number} now Current time in ms (Date.now() when called from the API)
 * @returns {Promise<{summary: object, series: object[], incidents: object[], certificate: object|null}>} Analytics data
 * @throws {Error} If periodHours is not a supported period
 */
async function loadMonitorAnalytics(monitorID, periodHours, now = Date.now()) {
    if (!Object.prototype.hasOwnProperty.call(BUCKET_SECONDS, periodHours)) {
        throw new ValidationError("Invalid period.");
    }

    if (periodHours === DAILY_PERIOD_HOURS) {
        return loadDailyAnalytics(monitorID);
    }

    const since = R.isoDateTimeMillis(dayjs.utc().subtract(periodHours, "hour"));

    const beanRows = await R.getAll(
        `SELECT time, status, ping FROM heartbeat
        WHERE monitor_id = ? AND time >= ?
        ORDER BY time ASC`,
        [monitorID, since]
    );

    // Include the last status change before the period so an incident that began earlier is still shown
    const importantRows = await R.getAll(
        `SELECT time, status FROM (
            SELECT time, status FROM heartbeat
            WHERE monitor_id = ? AND important = 1 AND time < ?
            ORDER BY time DESC LIMIT 1
        ) AS prev
        UNION ALL
        SELECT time, status FROM heartbeat
        WHERE monitor_id = ? AND important = 1 AND time >= ?
        ORDER BY time ASC`,
        [monitorID, since, monitorID, since]
    );

    const toMs = (row) => dayjs.utc(row.time).valueOf();

    const monitorRow = await R.findOne("monitor", " id = ? ", [monitorID]);
    const sloTarget = monitorRow?.slo_target ?? null;

    const data = buildAnalytics(
        beanRows.map((row) => ({ time: toMs(row), status: row.status, ping: row.ping })),
        importantRows.map((row) => ({ time: toMs(row), status: row.status })),
        periodHours,
        now,
        sloTarget
    );

    // Latest TLS check result, null for monitors without a certificate
    const tlsInfoBean = await R.findOne("monitor_tls_info", "monitor_id = ?", [monitorID]);
    data.certificate = buildCertificateSummary(tlsInfoBean?.info_json);

    return data;
}

/**
 * Raw checks of a monitor within the last `hours`, oldest first
 * @param {number} monitorID ID of the monitor
 * @param {number} hours Look back this many hours
 * @returns {Promise<{time: string, status: number, ping: number|null, msg: string}[]>} Checks with UTC ISO times
 */
async function loadMonitorChecks(monitorID, hours) {
    const since = R.isoDateTimeMillis(dayjs.utc().subtract(hours, "hour"));
    const rows = await R.getAll(
        "SELECT time, status, ping, msg FROM heartbeat WHERE monitor_id = ? AND time >= ? ORDER BY time ASC",
        [monitorID, since]
    );
    return rows.map((row) => ({
        time: dayjs.utc(row.time).toISOString(),
        status: row.status,
        ping: row.ping,
        msg: row.msg,
    }));
}

module.exports = {
    BUCKET_SECONDS,
    loadMonitorChecks,
    parseSloTarget,
    percentile,
    buildIncidents,
    buildAnalytics,
    buildCertificateSummary,
    loadMonitorAnalytics,
};
