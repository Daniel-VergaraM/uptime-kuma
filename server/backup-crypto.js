const crypto = require("crypto");
const { ValidationError } = require("./errors");

/** Marks an encrypted backup file */
const ENVELOPE_FORMAT = "uptime-kuma-encrypted-backup";
const MIN_PASSPHRASE_LENGTH = 8;
// scrypt cost: 2^14 memory-hard rounds. Slow enough to make guessing expensive, fast enough for a backup.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Derive a 256-bit key from a passphrase
 * @param {string} passphrase Passphrase from the user
 * @param {Buffer} salt Random salt
 * @returns {Buffer} 32-byte key
 */
function deriveKey(passphrase, salt) {
    return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

/**
 * Check that a passphrase is usable
 * @param {string} passphrase Passphrase to check
 * @returns {void}
 * @throws {ValidationError} If the passphrase is missing or too short
 */
function checkPassphrase(passphrase) {
    if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
        throw new ValidationError(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
    }
}

/**
 * Encrypt a backup object with AES-256-GCM. The result is JSON that can be stored as a file.
 * @param {object} backup Backup object
 * @param {string} passphrase Passphrase
 * @returns {object} Envelope with base64 fields
 */
function encryptBackup(backup, passphrase) {
    checkPassphrase(passphrase);
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(backup), "utf8"), cipher.final()]);
    return {
        format: ENVELOPE_FORMAT,
        version: 1,
        kdf: "scrypt",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
    };
}

/**
 * Check whether a parsed file is an encrypted backup
 * @param {object} file Parsed JSON
 * @returns {boolean} True for an encrypted backup
 */
function isEncryptedBackup(file) {
    return !!file && file.format === ENVELOPE_FORMAT;
}

/**
 * Decrypt an envelope made by encryptBackup
 * @param {object} envelope Envelope from the file
 * @param {string} passphrase Passphrase
 * @returns {object} The backup object
 * @throws {ValidationError} If the passphrase is wrong or the file was changed
 */
function decryptBackup(envelope, passphrase) {
    checkPassphrase(passphrase);
    try {
        const salt = Buffer.from(envelope.salt, "base64");
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            deriveKey(passphrase, salt),
            Buffer.from(envelope.iv, "base64")
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
        return JSON.parse(plain.toString("utf8"));
    } catch {
        // GCM fails for a wrong passphrase and for any change to the file. Do not say which.
        throw new ValidationError("Wrong passphrase, or the backup file is damaged");
    }
}

module.exports = {
    encryptBackup,
    decryptBackup,
    isEncryptedBackup,
    checkPassphrase,
    ENVELOPE_FORMAT,
    MIN_PASSPHRASE_LENGTH,
};
