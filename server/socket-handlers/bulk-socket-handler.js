const { checkLogin } = require("../util-server");
const { bulkUpdateMonitors } = require("../bulk-monitors");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { log } = require("../../src/util");

/**
 * Bulk monitor changes over Socket.IO, used by the monitor list selection bar
 * @param {import("socket.io").Socket} socket Socket.IO socket
 * @param {object} deps Dependencies from server.js
 * @param {Function} deps.restartMonitor Restarts a running monitor
 * @returns {void}
 */
module.exports.bulkSocketHandler = (socket, deps) => {
    socket.on("bulkUpdateMonitors", async (monitorIDs, changes, callback) => {
        try {
            checkLogin(socket);
            log.info("manage", `Bulk update ${JSON.stringify(Object.keys(changes || {}))} User ID: ${socket.userID}`);

            const result = await bulkUpdateMonitors(socket.userID, monitorIDs, changes, deps.restartMonitor);
            const server = UptimeKumaServer.getInstance();
            for (const id of result.updated) {
                await server.sendUpdateMonitorIntoList(socket, id);
            }

            callback({
                ok: true,
                msg: "Updated",
                data: result,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
