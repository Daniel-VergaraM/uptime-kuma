#!/usr/bin/env node
/**
 * Command line client for the Uptime Kuma REST API (/api/v1).
 * No dependencies. Needs Node.js 18 or newer.
 *
 * Settings:
 *   UK_URL      Base URL of the server (default http://localhost:3001)
 *   UK_API_KEY  API key from Settings > API Keys (required)
 *
 * Examples:
 *   node extra/uptime-kuma-cli.mjs list
 *   node extra/uptime-kuma-cli.mjs get 3
 *   node extra/uptime-kuma-cli.mjs create --name "Blog" --url https://example.com
 *   node extra/uptime-kuma-cli.mjs update 3 interval=120 name="Blog (EU)"
 *   node extra/uptime-kuma-cli.mjs pause 3 | resume 3 | delete 3
 *   node extra/uptime-kuma-cli.mjs bulk --ids 1,2,3 --interval 60 --group 5 --tag 1 --value eu
 *   node extra/uptime-kuma-cli.mjs analytics 3 --period 168
 *   node extra/uptime-kuma-cli.mjs checks 3 --hours 24 --csv > checks.csv
 *   node extra/uptime-kuma-cli.mjs backup backup.json        (UK_BACKUP_PASSPHRASE set: encrypted file)
 *   node extra/uptime-kuma-cli.mjs restore backup.json       (UK_BACKUP_PASSPHRASE set: for an encrypted file)
 */
import fs from "node:fs/promises";

const USAGE = `Usage: uptime-kuma-cli <command> [options]

Commands:
  list                                  List monitors
  get <id>                              Show one monitor
  create --name <name> [--url <url>] [--type <type>] [--file <json>]
  update <id> key=value ...             Change fields (values are parsed as JSON when possible)
  pause <id> | resume <id>
  delete <id> [--children]              --children also deletes children of a group
  bulk --ids 1,2,3 [--interval <s>] [--group <id|none>] [--tag <id> [--value <text>]]
  analytics <id> [--period 24|168|720|2160]
  checks <id> [--hours 24] [--csv]      Raw checks, JSON or CSV
  backup <file>                         Save a backup to a file
  restore <file>                        Restore a backup file

Environment: UK_URL (default http://localhost:3001), UK_API_KEY (required)`;

/**
 * Split argv into positional arguments, --flag value pairs and key=value pairs
 * @param {string[]} argv Arguments after the command name
 * @returns {{positional: string[], flags: object, pairs: object}} Parsed arguments
 */
function parseArgs(argv) {
    const positional = [];
    const flags = {};
    const pairs = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("--")) {
            const name = arg.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith("--")) {
                flags[name] = true;
            } else {
                flags[name] = next;
                i++;
            }
        } else if (/^[A-Za-z_][\w-]*=/.test(arg)) {
            const idx = arg.indexOf("=");
            pairs[arg.slice(0, idx)] = parseValue(arg.slice(idx + 1));
        } else {
            positional.push(arg);
        }
    }
    return { positional, flags, pairs };
}

/**
 * Parse a value typed on the command line: numbers, booleans and null become typed values, JSON arrays and objects are parsed
 * @param {string} text Raw text
 * @returns {any} Parsed value, or the text itself
 */
function parseValue(text) {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * Call the REST API
 * @param {string} method HTTP method
 * @param {string} path Path under /api/v1, e.g. "/monitors/3"
 * @param {object} body JSON body
 * @param {object} headers Extra request headers
 * @returns {Promise<any>} Parsed JSON response
 * @throws {Error} If the server answers with an error
 */
async function api(method, path, body, headers = {}) {
    const base = (process.env.UK_URL || "http://localhost:3001").replace(/\/$/, "");
    const key = process.env.UK_API_KEY;
    if (!key) {
        throw new Error("Set UK_API_KEY to an API key from Settings > API Keys");
    }
    const response = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
        throw new Error(`${response.status} ${data.msg ?? text}`);
    }
    return data;
}

/**
 * Print JSON with two-space indentation
 * @param {any} value Value to print
 * @returns {void}
 */
function print(value) {
    console.log(JSON.stringify(value, null, 2));
}

/**
 * Summary table for the list command
 * @param {object[]} monitors Monitors from the API
 * @returns {void}
 */
function printTable(monitors) {
    console.table(
        monitors.map((m) => ({
            id: m.id,
            name: m.name,
            type: m.type,
            active: m.active,
            interval: m.interval,
            parent: m.parent,
        }))
    );
}

const commands = {
    async list() {
        printTable(await api("GET", "/monitors"));
    },

    async get([id]) {
        print(await api("GET", `/monitors/${id}`));
    },

    async create(_, { flags }) {
        let body = {};
        if (flags.file) {
            body = JSON.parse(await fs.readFile(flags.file, "utf8"));
        }
        if (flags.name) {
            body.name = flags.name;
        }
        if (flags.url) {
            body.url = flags.url;
        }
        if (flags.type) {
            body.type = flags.type;
        }
        print(await api("POST", "/monitors", body));
    },

    async update([id], { pairs }) {
        if (Object.keys(pairs).length === 0) {
            throw new Error("Give at least one key=value, e.g. interval=120");
        }
        print(await api("PATCH", `/monitors/${id}`, pairs));
    },

    async pause([id]) {
        print(await api("POST", `/monitors/${id}/pause`));
    },

    async resume([id]) {
        print(await api("POST", `/monitors/${id}/resume`));
    },

    async delete([id], { flags }) {
        print(await api("DELETE", `/monitors/${id}?deleteChildren=${flags.children ? "true" : "false"}`));
    },

    async bulk(_, { flags }) {
        if (!flags.ids) {
            throw new Error("--ids is required, e.g. --ids 1,2,3");
        }
        const monitorIDs = flags.ids.split(",").map((id) => Number(id.trim()));
        const changes = {};
        if (flags.interval) {
            changes.interval = Number(flags.interval);
        }
        if (flags.group) {
            changes.parent = flags.group === "none" ? null : Number(flags.group);
        }
        if (flags.tag) {
            changes.addTag = { tagID: Number(flags.tag), value: flags.value ?? "" };
        }
        print(await api("POST", "/monitors/bulk", { monitorIDs, changes }));
    },

    async analytics([id], { flags }) {
        print(await api("GET", `/monitors/${id}/analytics?period=${flags.period ?? 24}`));
    },

    async checks([id], { flags }) {
        const hours = flags.hours ?? 24;
        if (flags.csv) {
            const base = (process.env.UK_URL || "http://localhost:3001").replace(/\/$/, "");
            const response = await fetch(`${base}/api/v1/monitors/${id}/heartbeats?hours=${hours}&format=csv`, {
                headers: { authorization: `Bearer ${process.env.UK_API_KEY}` },
            });
            if (!response.ok) {
                throw new Error(`${response.status} ${await response.text()}`);
            }
            process.stdout.write(await response.text());
            return;
        }
        print(await api("GET", `/monitors/${id}/heartbeats?hours=${hours}`));
    },

    async backup([file]) {
        if (!file) {
            throw new Error("Give a file name, e.g. backup backup.json");
        }
        // UK_BACKUP_PASSPHRASE makes the file encrypted. The passphrase is read from the environment, not the command line.
        const passphrase = process.env.UK_BACKUP_PASSPHRASE;
        const data = passphrase ? await api("POST", "/backup/export", { passphrase }) : await api("GET", "/backup");
        await fs.writeFile(file, JSON.stringify(data, null, 2));
        console.log(
            `Saved ${data.monitors.length} monitors, ${data.notifications.length} notifications and ${data.tags.length} tags to ${file}`
        );
    },

    async restore([file]) {
        if (!file) {
            throw new Error("Give a file name, e.g. restore backup.json");
        }
        const headers = process.env.UK_BACKUP_PASSPHRASE
            ? { "x-backup-passphrase": process.env.UK_BACKUP_PASSPHRASE }
            : {};
        print(await api("POST", "/backup", JSON.parse(await fs.readFile(file, "utf8")), headers));
    },
};

/**
 *
 */
/**
 * Run the command named on the command line
 * @returns {Promise<void>}
 */
async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || command === "help" || command === "--help") {
        console.log(USAGE);
        return;
    }
    const handler = commands[command];
    if (!handler) {
        console.error(`Unknown command: ${command}\n\n${USAGE}`);
        process.exit(2);
    }
    const parsed = parseArgs(rest);
    await handler(parsed.positional, parsed);
}

main().catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
});
