/**
 * Starts a real Uptime Kuma server in a child process with a fresh database,
 * creates an admin user and an API key. Used by the REST API integration tests.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { io } = require("socket.io-client");

const ROOT = path.resolve(__dirname, "..");

/**
 * Wait until a URL answers, or throw after the timeout
 * @param {string} url URL to poll
 * @param {number} timeoutMs Give up after this long
 * @returns {Promise<void>}
 */
async function waitFor(url, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.status < 500) {
                return;
            }
        } catch {
            // not listening yet
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Server did not answer at ${url}`);
}

/**
 * Pick a free-ish port in a high range. Good enough for sequential test runs.
 * @returns {number} Port number
 */
function pickPort() {
    return 3400 + Math.floor(Math.random() * 500);
}

/**
 * Send one Socket.IO event as a logged-in user and wait for its callback.
 * Emits right after connecting, so it also checks that early events are not dropped.
 * @param {string} baseURL Server base URL
 * @param {string} cookie Session cookie
 * @param {string} event Event name
 * @param {...any} args Arguments before the callback
 * @returns {Promise<object>} The callback payload
 */
function socketCall(baseURL, cookie, event, ...args) {
    return new Promise((resolve, reject) => {
        const socket = io(baseURL, { transports: ["websocket"], extraHeaders: { cookie } });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(event + " got no response"));
        }, 15000);
        socket.on("connect", () => {
            socket.emit(event, ...args, (res) => {
                clearTimeout(timer);
                socket.close();
                resolve(res);
            });
        });
        socket.on("connect_error", (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

/**
 * Start a server with a fresh database, an admin user and an API key
 * @param {object} [options] Options
 * @param {string} [options.dataDir] Directory for the database, default ./data/test-rest-<port>
 * @returns {Promise<{baseURL: string, apiKey: string, createKey: function(string): Promise<string>, stop: function(): Promise<void>, username: string, password: string}>} Running server info
 */
async function startTestServer(options = {}) {
    const port = pickPort();
    // A unique directory per run. A directory left over from an earlier run would start the server in normal mode, not setup mode.
    const dataDir = options.dataDir ?? path.join(ROOT, "data", `test-rest-${Date.now()}-${port}`);
    const username = "admin";
    const password = "RestTest!2026";

    // 1. Start from an empty data directory. The server then asks for a database, as on first run.
    fs.mkdirSync(dataDir, { recursive: true });

    // 2. Start the server
    const child = spawn(process.execPath, ["--import=tsx", "server/server.js"], {
        cwd: ROOT,
        env: { ...process.env, DATA_DIR: dataDir + path.sep, UPTIME_KUMA_PORT: String(port), NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));

    const baseURL = `http://localhost:${port}`;
    const stop = async () => {
        child.kill();
        await new Promise((r) => child.once("exit", r));
        if (!options.dataDir) {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    };

    try {
        await waitFor(`${baseURL}/setup-database`);

        // 2b. Choose SQLite, the same request the setup-database page sends. The server then starts normally.
        const dbSetup = await fetch(`${baseURL}/setup-database`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dbConfig: { type: "sqlite" } }),
        });
        if (!dbSetup.ok) {
            throw new Error(`Database setup failed: ${dbSetup.status} ${await dbSetup.text()}`);
        }
        await waitFor(`${baseURL}/setup`, 90000);

        // 3. Create the admin user through the same endpoint the setup page uses
        const setup = await fetch(`${baseURL}/api/setup`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password }),
        });
        if (!setup.ok) {
            throw new Error(`Setup failed: ${setup.status} ${await setup.text()}`);
        }

        // 4. Log in to get a session cookie
        const login = await fetch(`${baseURL}/api/auth/sign-in/username`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password, rememberMe: true }),
        });
        const cookie = login.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; ");

        // 5. Create API keys over the socket, as the Settings page does
        const createKey = (scope = "full") =>
            new Promise((resolve, reject) => {
                const socket = io(baseURL, { transports: ["websocket"], extraHeaders: { cookie } });
                const timer = setTimeout(() => reject(new Error("addAPIKey timed out")), 20000);
                socket.on("connect", () => {
                    // The server registers socket handlers after some async setup. Wait before the first event.
                    setTimeout(() => {
                        socket.emit(
                            "addAPIKey",
                            { name: "test", expires: "2030-01-01 00:00:00", active: true, scope },
                            (res) => {
                                clearTimeout(timer);
                                socket.close();
                                res.ok ? resolve(res.key) : reject(new Error(res.msg));
                            }
                        );
                    }, 1500);
                });
                socket.on("connect_error", (e) => {
                    clearTimeout(timer);
                    reject(e);
                });
            });
        const apiKey = await createKey("full");

        return { baseURL, apiKey, createKey, cookie, username, password, stop, output: () => output, dataDir };
    } catch (e) {
        await stop();
        throw new Error(`${e.message}\n--- server output ---\n${output.slice(-3000)}`);
    }
}

module.exports = { startTestServer, socketCall };
