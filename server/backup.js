const dayjs = require("dayjs");
const { R } = require("redbean-node");
const { ValidationError } = require("./errors");
const Monitor = require("./model/monitor");
const { Notification } = require("./notification");
const { log } = require("../src/util");
const backupCrypto = require("./backup-crypto");

/** Bumped when the file layout changes. Import refuses other versions. */
const BACKUP_VERSION = 1;

/**
 * Fields that describe the running state, not the configuration.
 * Same list the UI drops when cloning a monitor.
 */
const RUNTIME_FIELDS = [
    "id",
    "tags",
    "notificationIDList",
    "parent",
    "forceInactive",
    "includeSensitiveData",
    "maintenance",
    "childrenIDs",
    "path",
    "pathName",
    "screenshot",
    "certExpiryDaysRemaining",
    "validCert",
];

/** Status page columns copied to the backup, with their names in the file. The password is never exported. */
const STATUS_PAGE_COLUMNS = [
    ["slug", "slug", null],
    ["title", "title", null],
    ["description", "description", null],
    ["icon", "icon", "/icon.svg"],
    ["theme", "theme", "auto"],
    ["published", "published", true],
    ["search_engine_index", "searchEngineIndex", true],
    ["show_tags", "showTags", false],
    ["footer_text", "footerText", null],
    ["custom_css", "customCss", null],
    ["show_powered_by", "showPoweredBy", true],
    ["analytics_id", "analyticsId", null],
    ["show_certificate_expiry", "showCertificateExpiry", false],
    ["auto_refresh_interval", "autoRefreshInterval", null],
    ["analytics_script_url", "analyticsScriptUrl", null],
    ["show_only_last_heartbeat", "showOnlyLastHeartbeat", false],
    ["rss_title", "rssTitle", null],
    ["analytics_type", "analyticsType", null],
];
const STATUS_PAGE_BOOLEAN_COLUMNS = [
    "published",
    "search_engine_index",
    "show_tags",
    "show_powered_by",
    "show_certificate_expiry",
    "show_only_last_heartbeat",
];

/**
 * Status pages with their groups. Only monitors owned by the user are included.
 * @param {number} userID Owner of the monitors
 * @returns {Promise<object[]>} Status pages in the backup format
 */
async function exportStatusPages(userID) {
    const pages = await R.getAll("SELECT * FROM status_page ORDER BY id");
    const result = [];
    for (const page of pages) {
        const entry = {};
        for (const [column, key] of STATUS_PAGE_COLUMNS) {
            entry[key] = STATUS_PAGE_BOOLEAN_COLUMNS.includes(column) ? !!page[column] : (page[column] ?? null);
        }
        const groups = await R.getAll("SELECT * FROM `group` WHERE status_page_id = ? ORDER BY weight, id", [page.id]);
        entry.groups = [];
        for (const group of groups) {
            const links = await R.getAll(
                "SELECT m.name AS monitorName, mg.weight AS weight, mg.send_url AS send_url, mg.custom_url AS custom_url FROM monitor_group mg JOIN monitor m ON m.id = mg.monitor_id WHERE mg.group_id = ? AND m.user_id = ? ORDER BY mg.weight, mg.id",
                [group.id, userID]
            );
            entry.groups.push({
                name: group.name,
                weight: group.weight,
                public: !!group.public,
                monitors: links.map((l) => ({
                    monitorName: l.monitorName,
                    weight: l.weight,
                    sendUrl: !!l.send_url,
                    customUrl: l.custom_url ?? null,
                })),
            });
        }
        result.push(entry);
    }
    return result;
}

/**
 * Create status pages from a backup. Pages whose slug exists are skipped.
 * Must run after the monitors are imported, because groups link to monitors by name.
 * @param {number} userID Owner of the monitors
 * @param {object[]} pages Status pages from the backup
 * @param {object} result Import result, updated in place
 * @returns {Promise<void>}
 */
async function importStatusPages(userID, pages, result) {
    const monitorIDs = new Map(
        (await R.getAll("SELECT id, name FROM monitor WHERE user_id = ?", [userID])).map((m) => [m.name, m.id])
    );
    for (const page of pages) {
        if (await R.findOne("status_page", " slug = ? ", [page.slug])) {
            result.skipped.statusPages++;
            continue;
        }
        try {
            const bean = R.dispense("status_page");
            for (const [column, key, fallback] of STATUS_PAGE_COLUMNS) {
                let value = page[key] ?? fallback;
                if (STATUS_PAGE_BOOLEAN_COLUMNS.includes(column)) {
                    value = value ? 1 : 0;
                }
                bean[column] = value;
            }
            bean.password = null;
            bean.created_date = R.isoDateTime();
            bean.modified_date = R.isoDateTime();
            await R.store(bean);

            for (const group of page.groups ?? []) {
                const groupBean = R.dispense("group");
                groupBean.name = group.name;
                groupBean.status_page_id = bean.id;
                groupBean.public = group.public === false ? 0 : 1;
                groupBean.active = 1;
                groupBean.weight = group.weight ?? 1;
                groupBean.created_date = R.isoDateTime();
                await R.store(groupBean);

                for (const link of group.monitors ?? []) {
                    const monitorID = monitorIDs.get(link.monitorName);
                    if (monitorID === undefined) {
                        continue;
                    }
                    const linkBean = R.dispense("monitor_group");
                    linkBean.monitor_id = monitorID;
                    linkBean.group_id = groupBean.id;
                    linkBean.weight = link.weight ?? 1;
                    linkBean.send_url = link.sendUrl ? 1 : 0;
                    linkBean.custom_url = link.customUrl ?? null;
                    await R.store(linkBean);
                }
            }
            result.created.statusPages++;
        } catch (e) {
            result.errors.push({ type: "status page", name: page.slug, error: e.message.split("\n")[0].slice(0, 200) });
        }
    }
}

/**
 * Build a backup of one user's monitors, notifications and tags.
 * Monitors reference notifications and parents by name / key, so the file stays valid across databases.
 * @param {number} userID Owner of the data
 * @param {string|null} passphrase When set, the backup is encrypted with this passphrase
 * @returns {Promise<object>} Backup object, ready to be written as JSON
 */
async function exportBackup(userID, passphrase) {
    const beans = await R.find("monitor", " user_id = ? ORDER BY id ", [userID]);
    const preloadData = await Monitor.preparePreloadData(beans.map((bean) => ({ id: bean.id, active: bean.active })));
    const notifications = await R.find("notification", " user_id = ? ", [userID]);
    const notificationNames = new Map(notifications.map((n) => [n.id, n.name]));

    const monitors = [];
    for (const bean of beans) {
        const json = bean.toJSON(preloadData);
        const config = {};
        for (const [key, value] of Object.entries(json)) {
            if (!RUNTIME_FIELDS.includes(key)) {
                config[key] = value;
            }
        }

        const tagRows = await R.getAll(
            "SELECT t.name AS name, mt.value AS value FROM monitor_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.monitor_id = ?",
            [bean.id]
        );

        monitors.push({
            key: bean.id,
            parentKey: bean.parent ?? null,
            notificationNames: Object.keys(json.notificationIDList || {})
                .filter((id) => json.notificationIDList[id])
                .map((id) => notificationNames.get(Number(id)))
                .filter((name) => name !== undefined),
            tags: tagRows.map((row) => ({ name: row.name, value: row.value ?? "" })),
            config,
        });
    }

    const tags = await R.getAll(
        "SELECT DISTINCT t.name AS name, t.color AS color FROM tag t JOIN monitor_tag mt ON mt.tag_id = t.id JOIN monitor m ON m.id = mt.monitor_id WHERE m.user_id = ?",
        [userID]
    );

    const plain = {
        version: BACKUP_VERSION,
        exportedAt: dayjs.utc().toISOString(),
        notifications: notifications.map((n) => ({
            name: n.name,
            isDefault: !!n.is_default,
            config: JSON.parse(n.config),
        })),
        tags: tags.map((t) => ({ name: t.name, color: t.color })),
        monitors,
        statusPages: await exportStatusPages(userID),
    };
    // With a passphrase the whole backup is encrypted, so the file can be stored safely
    return passphrase ? backupCrypto.encryptBackup(plain, passphrase) : plain;
}

/**
 * Restore a backup. Items whose name already exists are skipped, so re-importing is safe.
 * Parents are created before children. Errors are collected per item and do not stop the import.
 * @param {number} userID Owner of the imported data
 * @param {object} file Parsed backup file, plain or encrypted
 * @param {Function} addMonitor Monitor "add" command from server.js
 * @param {string|null} passphrase Needed when the file is encrypted
 * @returns {Promise<object>} Counts of created and skipped items, and the errors
 * @throws {ValidationError} If the file is not a backup this version understands, or the passphrase is missing or wrong
 */
async function importBackup(userID, file, addMonitor, passphrase) {
    let backup = file;
    if (backupCrypto.isEncryptedBackup(file)) {
        if (!passphrase) {
            throw new ValidationError("This backup is encrypted. Enter its passphrase.");
        }
        backup = backupCrypto.decryptBackup(file, passphrase);
    }
    if (!backup || backup.version !== BACKUP_VERSION || !Array.isArray(backup.monitors)) {
        throw new ValidationError(`Unsupported backup file. Expected version ${BACKUP_VERSION}.`);
    }

    const result = {
        created: { notifications: 0, tags: 0, monitors: 0, statusPages: 0 },
        skipped: { notifications: 0, tags: 0, monitors: 0, statusPages: 0 },
        errors: [],
    };

    // Notifications
    const notificationIDs = new Map();
    const existingNotifications = await R.find("notification", " user_id = ? ", [userID]);
    for (const existing of existingNotifications) {
        notificationIDs.set(existing.name, existing.id);
    }
    for (const item of backup.notifications || []) {
        if (notificationIDs.has(item.name)) {
            result.skipped.notifications++;
            continue;
        }
        try {
            await Notification.save({ ...item.config, name: item.name, isDefault: item.isDefault }, null, userID);
            const bean = await R.findOne("notification", " user_id = ? AND name = ? ", [userID, item.name]);
            notificationIDs.set(item.name, bean.id);
            result.created.notifications++;
        } catch (e) {
            result.errors.push({ type: "notification", name: item.name, error: e.message });
        }
    }

    // Tags are global, so match on name only
    const tagIDs = new Map();
    for (const tag of await R.find("tag")) {
        tagIDs.set(tag.name, tag.id);
    }
    for (const item of backup.tags || []) {
        if (tagIDs.has(item.name)) {
            result.skipped.tags++;
            continue;
        }
        const bean = R.dispense("tag");
        bean.name = item.name;
        bean.color = item.color;
        await R.store(bean);
        tagIDs.set(item.name, bean.id);
        result.created.tags++;
    }

    // Monitors, parents first
    const existingMonitorNames = new Set(
        (await R.getCol("SELECT name FROM monitor WHERE user_id = ?", [userID])).map(String)
    );
    const createdIDs = new Map(); // backup key -> new monitor id
    let pending = backup.monitors.filter((m) => !existingMonitorNames.has(m.config?.name));
    result.skipped.monitors = backup.monitors.length - pending.length;

    while (pending.length > 0) {
        const ready = pending.filter(
            (m) =>
                m.parentKey == null ||
                createdIDs.has(m.parentKey) ||
                !backup.monitors.some((p) => p.key === m.parentKey)
        );
        if (ready.length === 0) {
            for (const m of pending) {
                result.errors.push({
                    type: "monitor",
                    name: m.config?.name,
                    error: "Parent monitor was not imported",
                });
            }
            break;
        }
        pending = pending.filter((m) => !ready.includes(m));

        for (const item of ready) {
            const body = { ...item.config };
            delete body.id;
            body.parent =
                item.parentKey != null && createdIDs.has(item.parentKey) ? createdIDs.get(item.parentKey) : null;
            body.notificationIDList = {};
            for (const name of item.notificationNames || []) {
                if (notificationIDs.has(name)) {
                    body.notificationIDList[notificationIDs.get(name)] = true;
                }
            }

            try {
                const monitorID = await new Promise((resolve, reject) => {
                    addMonitor({ userID, session: { user: { id: userID } } }, body, (res) =>
                        res.ok ? resolve(res.monitorID) : reject(new Error(res.msg))
                    );
                });
                createdIDs.set(item.key, monitorID);
                for (const tag of item.tags || []) {
                    const tagID = tagIDs.get(tag.name);
                    if (tagID !== undefined) {
                        await R.exec("INSERT INTO monitor_tag (tag_id, monitor_id, value) VALUES (?, ?, ?)", [
                            tagID,
                            monitorID,
                            tag.value,
                        ]);
                    }
                }
                result.created.monitors++;
            } catch (e) {
                log.warn("backup", `Could not import monitor ${item.config?.name}: ${e.message}`);
                // First line only, the database error can be a very long SQL statement
                const firstLine = e.message.split("\n")[0].slice(0, 200);
                result.errors.push({ type: "monitor", name: item.config?.name, error: firstLine });
            }
        }
    }

    await importStatusPages(userID, backup.statusPages ?? [], result);

    return result;
}

module.exports = { exportBackup, importBackup, BACKUP_VERSION };
