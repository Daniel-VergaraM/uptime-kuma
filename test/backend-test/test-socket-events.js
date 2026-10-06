const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const { startTestServer, socketCall } = require("../rest-harness");

describe("socket events (real server)", { timeout: 180000 }, () => {
    let server;

    before(async () => {
        server = await startTestServer();
    });

    after(async () => {
        await server?.stop();
    });

    it("answers the first event sent right after connecting", async () => {
        // Before the fix this event was dropped, because it arrived before the handlers were registered
        const res = await socketCall(server.baseURL, server.cookie, "getTags");
        assert.strictEqual(res.ok, true);
    });

    it("answers events that need the database", async () => {
        const res = await socketCall(server.baseURL, server.cookie, "getSettings");
        assert.strictEqual(res.ok, true);
    });
});
