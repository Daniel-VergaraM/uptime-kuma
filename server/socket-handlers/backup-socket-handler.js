const { checkLogin } = require("../util-server");
const { exportBackup, importBackup } = require("../backup");
const { log } = require("../../src/util");

/**
 * Backup and restore over Socket.IO, used by Settings > Backup.
 * Both events take an optional passphrase before the callback. A passphrase
 * encrypts the export, and decrypts an encrypted file on import.
 * @param {import("socket.io").Socket} socket Socket.IO socket
 * @param {object} deps Dependencies from server.js
 * @param {Function} deps.addMonitor Monitor "add" command
 * @returns {void}
 */
module.exports.backupSocketHandler = (socket, deps) => {
    socket.on("exportBackup", async (...args) => {
        const callback = args.pop();
        const passphrase = args[0] ?? null;
        try {
            checkLogin(socket);
            log.info("backup", `Export backup User ID: ${socket.userID} encrypted: ${!!passphrase}`);
            callback({
                ok: true,
                data: await exportBackup(socket.userID, passphrase),
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

    socket.on("importBackup", async (...args) => {
        const callback = args.pop();
        const [backup, passphrase = null] = args;
        try {
            checkLogin(socket);
            log.info("backup", `Import backup User ID: ${socket.userID}`);
            callback({
                ok: true,
                data: await importBackup(socket.userID, backup, deps.addMonitor, passphrase),
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
