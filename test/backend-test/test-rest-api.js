const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { startTestServer, socketCall } = require("../rest-harness");

describe("REST API v1 (real server)", { timeout: 180000 }, () => {
    let server;
    let base;
    let key;

    /**
     * Call the API
     * @param {string} method HTTP method
     * @param {string} path Path under /api/v1
     * @param {object} body JSON body, or undefined for none
     * @param {string} authKey API key to send, defaults to the test key. Pass "" for none.
     * @returns {Promise<{status: number, body: any, headers: Headers}>} Response
     */
    async function api(method, path, body, authKey = key) {
        const headers = {};
        if (authKey) {
            headers.authorization = `Bearer ${authKey}`;
        }
        if (body !== undefined) {
            headers["content-type"] = "application/json";
        }
        const res = await fetch(base + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let parsed = text;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            // CSV or other non-JSON body
        }
        return { status: res.status, body: parsed, headers: res.headers };
    }

    before(async () => {
        server = await startTestServer();
        base = `${server.baseURL}/api/v1`;
        key = server.apiKey;
    });

    after(async () => {
        await server?.stop();
    });

    describe("authentication", () => {
        it("serves the OpenAPI document without a key", async () => {
            const res = await api("GET", "/openapi.json", undefined, "");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.openapi, "3.0.3");
        });

        it("rejects a missing key with 401 and a challenge header", async () => {
            const res = await api("GET", "/monitors", undefined, "");
            assert.strictEqual(res.status, 401);
            assert.match(res.headers.get("www-authenticate"), /Basic/);
        });

        it("rejects a made-up key", async () => {
            const res = await api("GET", "/monitors", undefined, "uk1_wrong");
            assert.strictEqual(res.status, 401);
        });
    });

    describe("monitor lifecycle", () => {
        let id;

        it("creates a monitor with only a name and url", async () => {
            const res = await api("POST", "/monitors", { name: "Lifecycle", url: "http://127.0.0.1:9/" });
            assert.strictEqual(res.status, 201);
            assert.strictEqual(res.body.name, "Lifecycle");
            assert.strictEqual(res.body.interval, 60);
            id = res.body.id;
        });

        it("lists and gets the monitor", async () => {
            const list = await api("GET", "/monitors");
            assert.strictEqual(list.status, 200);
            assert.ok(list.body.some((m) => m.id === id));
            const one = await api("GET", `/monitors/${id}`);
            assert.strictEqual(one.body.id, id);
        });

        it("partially updates the monitor", async () => {
            const res = await api("PATCH", `/monitors/${id}`, { name: "Renamed", interval: 120 });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.name, "Renamed");
            assert.strictEqual(res.body.interval, 120);
        });

        it("pauses and resumes", async () => {
            assert.strictEqual((await api("POST", `/monitors/${id}/pause`)).status, 200);
            assert.strictEqual((await api("GET", `/monitors/${id}`)).body.active, false);
            assert.strictEqual((await api("POST", `/monitors/${id}/resume`)).status, 200);
            assert.strictEqual((await api("GET", `/monitors/${id}`)).body.active, true);
        });

        it("deletes the monitor and then reports 404", async () => {
            assert.strictEqual((await api("DELETE", `/monitors/${id}`)).status, 200);
            assert.strictEqual((await api("GET", `/monitors/${id}`)).status, 404);
        });
    });

    describe("validation", () => {
        it("requires a name when creating", async () => {
            const res = await api("POST", "/monitors", { url: "http://example.invalid/" });
            assert.strictEqual(res.status, 400);
            assert.match(res.body.msg, /name is required/);
        });

        it("rejects an SLO target above 100", async () => {
            const created = await api("POST", "/monitors", { name: "SLO bad", url: "http://127.0.0.1:9/" });
            const res = await api("PATCH", `/monitors/${created.body.id}`, { sloTarget: 150 });
            assert.strictEqual(res.status, 400);
            assert.match(res.body.msg, /between 0 and 100/);
            await api("DELETE", `/monitors/${created.body.id}`);
        });

        it("rejects a non-numeric monitor id", async () => {
            assert.strictEqual((await api("GET", "/monitors/abc")).status, 400);
        });
    });

    describe("bulk changes", () => {
        let a;
        let b;

        before(async () => {
            a = (await api("POST", "/monitors", { name: "Bulk A", url: "http://127.0.0.1:9/" })).body.id;
            b = (await api("POST", "/monitors", { name: "Bulk B", url: "http://127.0.0.1:9/" })).body.id;
        });

        it("applies an interval to several monitors", async () => {
            const res = await api("POST", "/monitors/bulk", { monitorIDs: [a, b], changes: { interval: 300 } });
            assert.strictEqual(res.status, 200);
            assert.deepStrictEqual(res.body.updated, [a, b]);
            assert.strictEqual((await api("GET", `/monitors/${b}`)).body.interval, 300);
        });

        it("refuses an interval below 20 and changes nothing", async () => {
            const res = await api("POST", "/monitors/bulk", { monitorIDs: [a], changes: { interval: 5 } });
            assert.strictEqual(res.status, 400);
            assert.strictEqual((await api("GET", `/monitors/${a}`)).body.interval, 300);
        });

        it("refuses unknown change keys", async () => {
            const res = await api("POST", "/monitors/bulk", { monitorIDs: [a], changes: { name: "x" } });
            assert.strictEqual(res.status, 400);
        });

        it("refuses monitors the key owner does not have", async () => {
            const res = await api("POST", "/monitors/bulk", { monitorIDs: [a, 999999], changes: { interval: 60 } });
            assert.strictEqual(res.status, 400);
        });
    });

    describe("checks and analytics", () => {
        let id;

        before(async () => {
            id = (await api("POST", "/monitors", { name: "Checks", url: "http://127.0.0.1:9/" })).body.id;
        });

        it("returns analytics with a summary and a certificate field", async () => {
            const res = await api("GET", `/monitors/${id}/analytics?period=24`);
            assert.strictEqual(res.status, 200);
            assert.ok("uptimePct" in res.body.summary);
            assert.ok("certificate" in res.body);
        });

        it("rejects an unsupported analytics period", async () => {
            assert.strictEqual((await api("GET", `/monitors/${id}/analytics?period=5`)).status, 400);
        });

        it("serves 365-day analytics from the daily statistics, without incident data", async () => {
            const res = await api("GET", `/monitors/${id}/analytics?period=8760`);
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.summary.daily, true);
            assert.strictEqual(res.body.summary.incidentCount, null);
            assert.deepStrictEqual(res.body.incidents, []);
        });

        it("returns raw checks as JSON", async () => {
            const res = await api("GET", `/monitors/${id}/heartbeats?hours=24`);
            assert.strictEqual(res.status, 200);
            assert.ok(Array.isArray(res.body.checks));
        });

        it("returns raw checks as CSV with a header row", async () => {
            const res = await api("GET", `/monitors/${id}/heartbeats?hours=24&format=csv`);
            assert.strictEqual(res.status, 200);
            assert.match(res.headers.get("content-type"), /text\/csv/);
            assert.match(res.body, /^time_utc,status,status_name,ping_ms,message/);
        });
    });

    describe("backup", () => {
        it("exports a backup with the current version", async () => {
            const res = await api("GET", "/backup");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.version, 1);
            assert.ok(Array.isArray(res.body.monitors));
        });

        it("restoring the same backup creates nothing and skips what exists", async () => {
            const backup = (await api("GET", "/backup")).body;
            const res = await api("POST", "/backup", backup);
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.created.monitors, 0);
            assert.strictEqual(res.body.skipped.monitors, backup.monitors.length);
        });

        it("restores a renamed copy as a new monitor", async () => {
            const backup = (await api("GET", "/backup")).body;
            const copy = structuredClone(backup.monitors[0]);
            copy.key = 9999;
            copy.parentKey = null;
            copy.config.name = "Restored from test";
            const res = await api("POST", "/backup", { ...backup, monitors: [copy] });
            assert.strictEqual(res.body.created.monitors, 1);
            assert.deepStrictEqual(res.body.errors, []);
        });
    });
});

describe("API key scopes, paging and errors (real server)", { timeout: 180000 }, () => {
    let server;
    let base;
    let fullKey;
    let readKey;

    /**
     * Call the API with a given key
     * @param {string} method HTTP method
     * @param {string} path Path under /api/v1
     * @param {object} body JSON body, or undefined for none
     * @param {string} key API key to send
     * @returns {Promise<{status: number, body: any, headers: Headers}>} Response
     */
    async function call(method, path, body, key) {
        const headers = { authorization: `Bearer ${key}` };
        if (body !== undefined) {
            headers["content-type"] = "application/json";
        }
        const res = await fetch(base + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let parsed = text;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            // not JSON
        }
        return { status: res.status, body: parsed, headers: res.headers };
    }

    before(async () => {
        server = await startTestServer();
        base = `${server.baseURL}/api/v1`;
        fullKey = server.apiKey;
        readKey = await server.createKey("read");
    });

    after(async () => {
        await server?.stop();
    });

    it("a read-only key can read", async () => {
        assert.strictEqual((await call("GET", "/monitors", undefined, readKey)).status, 200);
    });

    it("a read-only key cannot write", async () => {
        const res = await call("POST", "/monitors", { name: "Nope", url: "http://127.0.0.1:9/" }, readKey);
        assert.strictEqual(res.status, 403);
        assert.match(res.body.msg, /read-only/);
    });

    it("a read-only key cannot delete, even a monitor that exists", async () => {
        const created = await call("POST", "/monitors", { name: "Keep me", url: "http://127.0.0.1:9/" }, fullKey);
        const res = await call("DELETE", `/monitors/${created.body.id}`, undefined, readKey);
        assert.strictEqual(res.status, 403);
        assert.strictEqual((await call("GET", `/monitors/${created.body.id}`, undefined, fullKey)).status, 200);
    });

    it("pages and filters the monitor list", async () => {
        for (const name of ["PgTest one", "PgTest two", "PgTest three"]) {
            await call("POST", "/monitors", { name, url: "http://127.0.0.1:9/" }, fullKey);
        }
        const page = await call("GET", "/monitors?q=pgtest&limit=2&offset=0", undefined, fullKey);
        assert.strictEqual(page.status, 200);
        assert.strictEqual(page.body.length, 2);
        assert.ok(Number(page.headers.get("x-total-count")) >= 3);

        const second = await call("GET", "/monitors?q=pgtest&limit=2&offset=2", undefined, fullKey);
        assert.strictEqual(second.body.length, 1);
    });

    it("filters by active state", async () => {
        const active = await call("GET", "/monitors?active=true", undefined, fullKey);
        assert.ok(active.body.every((m) => m.active === true));
    });

    it("rejects bad paging values", async () => {
        assert.strictEqual((await call("GET", "/monitors?limit=0", undefined, fullKey)).status, 400);
        assert.strictEqual((await call("GET", "/monitors?limit=501", undefined, fullKey)).status, 400);
        assert.strictEqual((await call("GET", "/monitors?limit=5&offset=-1", undefined, fullKey)).status, 400);
        assert.strictEqual((await call("GET", "/monitors?active=maybe", undefined, fullKey)).status, 400);
    });

    it("answers unknown monitors with 404, not 500", async () => {
        const res = await call("GET", "/monitors/987654", undefined, fullKey);
        assert.strictEqual(res.status, 404);
    });
});

describe("per-key rate limit (real server)", { timeout: 180000 }, () => {
    let server;
    let base;

    before(async () => {
        process.env.UK_API_RATE_LIMIT = "3";
        server = await startTestServer();
        delete process.env.UK_API_RATE_LIMIT;
        base = `${server.baseURL}/api/v1`;
    });

    after(async () => {
        await server?.stop();
    });

    it("answers 429 with Retry-After after the key's requests are used up", async () => {
        const statuses = [];
        for (let i = 0; i < 5; i++) {
            const res = await fetch(`${base}/monitors`, { headers: { authorization: `Bearer ${server.apiKey}` } });
            statuses.push(res.status);
            if (res.status === 429) {
                assert.ok(res.headers.get("retry-after"));
            }
        }
        assert.deepStrictEqual(statuses.slice(0, 3), [200, 200, 200]);
        assert.strictEqual(statuses[3], 429);
    });
});

describe("encrypted backups and status pages (real server)", { timeout: 180000 }, () => {
    let server;
    let base;

    /**
     * Call the API with the test key
     * @param {string} method HTTP method
     * @param {string} path Path under /api/v1
     * @param {object} body JSON body, or undefined for none
     * @param {object} headers Extra headers
     * @returns {Promise<{status: number, body: any}>} Response
     */
    async function api(method, path, body, headers = {}) {
        const res = await fetch(base + path, {
            method,
            headers: {
                authorization: `Bearer ${server.apiKey}`,
                ...(body === undefined ? {} : { "content-type": "application/json" }),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
    }

    before(async () => {
        server = await startTestServer();
        base = `${server.baseURL}/api/v1`;
        const created = await socketCall(
            server.baseURL,
            server.cookie,
            "addStatusPage",
            "Public status",
            "public-status-test"
        );
        assert.strictEqual(created.ok, true, created.msg);
    });

    after(async () => {
        await server?.stop();
    });

    it("includes status pages in a plain backup, without their password", async () => {
        const backup = (await api("GET", "/backup")).body;
        const page = backup.statusPages.find((p) => p.slug === "public-status-test");
        assert.ok(page, "status page is in the backup");
        assert.ok(!("password" in page));
    });

    it("exports an encrypted backup that holds no readable monitor data", async () => {
        const res = await api("POST", "/backup/export", { passphrase: "correct horse" });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.format, "uptime-kuma-encrypted-backup");
        assert.ok(!JSON.stringify(res.body).includes("public-status-test"));
    });

    it("refuses an encrypted file without a passphrase", async () => {
        const encrypted = (await api("POST", "/backup/export", { passphrase: "correct horse" })).body;
        const res = await api("POST", "/backup", encrypted);
        assert.strictEqual(res.status, 400);
        assert.match(res.body.msg, /encrypted/);
    });

    it("refuses a wrong passphrase", async () => {
        const encrypted = (await api("POST", "/backup/export", { passphrase: "correct horse" })).body;
        const res = await api("POST", "/backup", encrypted, { "x-backup-passphrase": "wrong horse" });
        assert.strictEqual(res.status, 400);
        assert.match(res.body.msg, /Wrong passphrase/);
    });

    it("refuses a short passphrase when exporting", async () => {
        const res = await api("POST", "/backup/export", { passphrase: "short" });
        assert.strictEqual(res.status, 400);
    });

    it("restores an encrypted backup and recreates a deleted status page", async () => {
        const encrypted = (await api("POST", "/backup/export", { passphrase: "correct horse" })).body;
        const deleted = await socketCall(server.baseURL, server.cookie, "deleteStatusPage", "public-status-test");
        assert.strictEqual(deleted.ok, true, deleted.msg);

        const res = await api("POST", "/backup", encrypted, { "x-backup-passphrase": "correct horse" });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.created.statusPages, 1);
        assert.deepStrictEqual(res.body.errors, []);

        const again = await api("POST", "/backup", encrypted, { "x-backup-passphrase": "correct horse" });
        assert.strictEqual(again.body.skipped.statusPages, 1);
    });
});
