const { R } = require("redbean-node");
const Monitor = require("./model/monitor");
const { ValidationError } = require("./errors");

/** Lowest check interval the UI allows, in seconds */
const MIN_INTERVAL = 20;
/** Upper bound on monitors per request */
const MAX_MONITORS = 500;
const ALLOWED_CHANGES = ["interval", "parent", "addTag"];

/**
 * Apply one change to many monitors in a single request.
 * Every monitor must belong to the user. Nothing is changed if any check fails.
 * @param {number} userID Owner of the monitors
 * @param {number[]} monitorIDs Monitors to change
 * @param {object} changes Any of: interval (seconds), parent (group ID or null), addTag ({tagID, value})
 * @param {function(number, number): Promise<void>} restartMonitor Restarts a running monitor so a new interval applies
 * @returns {Promise<{updated: number[]}>} IDs of the monitors that were changed
 * @throws {Error} If the input is invalid or a monitor is not found
 */
async function bulkUpdateMonitors(userID, monitorIDs, changes, restartMonitor) {
    if (!Array.isArray(monitorIDs) || monitorIDs.length === 0) {
        throw new ValidationError("monitorIDs must be a non-empty list");
    }
    if (monitorIDs.length > MAX_MONITORS) {
        throw new ValidationError(`At most ${MAX_MONITORS} monitors per request`);
    }
    const ids = [...new Set(monitorIDs.map(Number))];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        throw new ValidationError("Invalid monitor id in monitorIDs");
    }

    const unknownKeys = Object.keys(changes || {}).filter((key) => !ALLOWED_CHANGES.includes(key));
    if (unknownKeys.length > 0) {
        throw new ValidationError(`Unknown change: ${unknownKeys.join(", ")}`);
    }
    if (Object.keys(changes || {}).length === 0) {
        throw new ValidationError("No changes given");
    }

    const placeholders = ids.map(() => "?").join(",");
    const beans = await R.getAll(`SELECT id, active, type FROM monitor WHERE user_id = ? AND id IN (${placeholders})`, [
        userID,
        ...ids,
    ]);
    if (beans.length !== ids.length) {
        throw new ValidationError("One or more monitors were not found");
    }

    // Validate everything before writing anything
    if (changes.interval !== undefined) {
        const interval = changes.interval;
        if (!Number.isInteger(interval) || interval < MIN_INTERVAL) {
            throw new ValidationError(`interval must be a whole number of seconds, at least ${MIN_INTERVAL}`);
        }
    }

    if (changes.parent !== undefined && changes.parent !== null) {
        const parent = await R.findOne("monitor", " id = ? AND user_id = ? AND type = 'group' ", [
            changes.parent,
            userID,
        ]);
        if (!parent) {
            throw new ValidationError("parent must be a group monitor you own");
        }
        for (const id of ids) {
            if (id === parent.id) {
                throw new ValidationError("A monitor cannot be its own parent");
            }
            const childIDs = await Monitor.getAllChildrenIDs(id);
            if (childIDs.includes(parent.id)) {
                throw new ValidationError("Invalid Monitor Group: the group is a child of one of the monitors");
            }
        }
    }

    if (changes.addTag !== undefined) {
        const tag = await R.findOne("tag", " id = ? ", [changes.addTag.tagID]);
        if (!tag) {
            throw new ValidationError("Tag not found");
        }
    }

    // Apply
    if (changes.interval !== undefined) {
        await R.exec(`UPDATE monitor SET interval = ? WHERE user_id = ? AND id IN (${placeholders})`, [
            changes.interval,
            userID,
            ...ids,
        ]);
    }

    if (changes.parent !== undefined) {
        await R.exec(`UPDATE monitor SET parent = ? WHERE user_id = ? AND id IN (${placeholders})`, [
            changes.parent,
            userID,
            ...ids,
        ]);
    }

    if (changes.addTag !== undefined) {
        for (const id of ids) {
            const exists = await R.getRow("SELECT id FROM monitor_tag WHERE tag_id = ? AND monitor_id = ?", [
                changes.addTag.tagID,
                id,
            ]);
            if (!exists) {
                await R.exec("INSERT INTO monitor_tag (tag_id, monitor_id, value) VALUES (?, ?, ?)", [
                    changes.addTag.tagID,
                    id,
                    changes.addTag.value ?? "",
                ]);
            }
        }
    }

    // Running monitors pick up a new interval only after a restart
    if (changes.interval !== undefined) {
        for (const bean of beans) {
            if (bean.active) {
                await restartMonitor(userID, bean.id);
            }
        }
    }

    return { updated: ids };
}

module.exports = { bulkUpdateMonitors, MIN_INTERVAL, MAX_MONITORS };
