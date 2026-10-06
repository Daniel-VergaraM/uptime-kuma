const { checkLogin } = require("../util-server");
const { UptimeCalculator } = require("../uptime-calculator");
const { loadMonitorAnalytics, loadMonitorChecks } = require("../monitor-analytics");
const { R } = require("redbean-node");
const { log } = require("../../src/util");

module.exports.chartSocketHandler = (socket) => {
    socket.on("getMonitorAnalytics", async (monitorID, periodHours, callback) => {
        try {
            checkLogin(socket);

            log.debug(
                "monitor",
                `Get Monitor Analytics: ${monitorID} Period: ${periodHours}h User ID: ${socket.userID}`
            );

            const data = await loadMonitorAnalytics(monitorID, periodHours);

            callback({
                ok: true,
                data,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
    // Raw checks for CSV export. Limited to 720 hours (30 days) so the response stays small
    socket.on("getMonitorChecks", async (monitorID, hours, callback) => {
        try {
            checkLogin(socket);

            // Longer ranges are large, use the REST API for them (up to 8760 hours)
            if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
                throw new Error("hours must be a whole number between 1 and 720. Use the REST API for longer ranges.");
            }
            const owned = await R.findOne("monitor", " id = ? AND user_id = ? ", [monitorID, socket.userID]);
            if (!owned) {
                throw new Error("Monitor not found");
            }

            callback({
                ok: true,
                data: { checks: await loadMonitorChecks(monitorID, hours) },
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("getMonitorChartData", async (monitorID, period, callback) => {
        try {
            checkLogin(socket);

            log.debug("monitor", `Get Monitor Chart Data: ${monitorID} User ID: ${socket.userID}`);

            if (period == null) {
                throw new Error("Invalid period.");
            }

            let uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorID);

            let data;
            if (period <= 24) {
                data = uptimeCalculator.getDataArray(period * 60, "minute");
            } else if (period <= 720) {
                data = uptimeCalculator.getDataArray(period, "hour");
            } else {
                data = uptimeCalculator.getDataArray(period / 24, "day");
            }

            callback({
                ok: true,
                data,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
