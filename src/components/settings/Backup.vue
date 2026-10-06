<template>
    <div>
        <h2 class="h4">{{ $t("Download backup") }}</h2>
        <p class="form-text">{{ $t("backupSecretsWarning") }}</p>
        <div class="mb-2">
            <label for="backup-passphrase" class="form-label">{{ $t("Passphrase (optional)") }}</label>
            <input
                id="backup-passphrase"
                v-model="passphrase"
                type="password"
                class="form-control"
                autocomplete="new-password"
                :placeholder="$t('Leave empty for a plain file')"
            />
            <div class="form-text">{{ $t("backupPassphraseHelp") }}</div>
        </div>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="download">
            <font-awesome-icon icon="download" />
            {{ $t("Download backup") }}
        </button>

        <h2 class="h4 mt-4">{{ $t("Restore backup") }}</h2>
        <p class="form-text">{{ $t("restoreBackupHelp") }}</p>
        <input
            ref="file"
            type="file"
            accept="application/json,.json"
            :aria-label="$t('Backup file')"
            class="form-control"
            :disabled="busy"
            @change="loadFile"
        />

        <div v-if="loaded" class="mt-3">
            <div v-if="loaded.format === encryptedFormat" class="mb-2">
                <label for="restore-passphrase" class="form-label">
                    {{ $t("This backup is encrypted. Enter its passphrase.") }}
                </label>
                <input
                    id="restore-passphrase"
                    v-model="restorePassphrase"
                    type="password"
                    class="form-control"
                    autocomplete="off"
                />
            </div>
            <button class="btn btn-primary" type="button" :disabled="busy" @click="restore">
                {{ $t("Restore backup") }}
            </button>
        </div>

        <div v-if="result" class="mt-3">
            <p>
                {{
                    $t("restoreSummary", {
                        monitors: result.created.monitors,
                        notifications: result.created.notifications,
                        tags: result.created.tags,
                        statusPages: result.created.statusPages,
                        skipped:
                            result.skipped.monitors +
                            result.skipped.notifications +
                            result.skipped.tags +
                            result.skipped.statusPages,
                    })
                }}
            </p>
            <ul v-if="result.errors.length" class="text-danger">
                <li v-for="(error, index) in result.errors" :key="index">
                    {{ error.type }} "{{ error.name }}": {{ error.error }}
                </li>
            </ul>
        </div>
    </div>
</template>

<script lang="js">
/** Set by the server on encrypted backups. Must match ENVELOPE_FORMAT in server/backup-crypto.js */
const ENCRYPTED_FORMAT = "uptime-kuma-encrypted-backup";

export default {
    data() {
        return {
            busy: false,
            passphrase: "",
            loaded: null,
            restorePassphrase: "",
            result: null,
            encryptedFormat: ENCRYPTED_FORMAT,
        };
    },
    methods: {
        download() {
            this.busy = true;
            this.$root.exportBackup(this.passphrase || null, (res) => {
                this.busy = false;
                if (!res.ok) {
                    this.$root.toastError(res.msg);
                    return;
                }
                const name = this.passphrase ? "uptime-kuma-backup.encrypted.json" : "uptime-kuma-backup.json";
                const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = name;
                link.click();
                URL.revokeObjectURL(url);
            });
        },
        /**
         * Read the chosen file. Nothing is restored until the Restore button is pressed,
         * so an encrypted file can ask for its passphrase first.
         * @param {Event} event Change event of the file input
         * @returns {Promise<void>}
         */
        async loadFile(event) {
            const file = event.target.files[0];
            this.result = null;
            this.loaded = null;
            if (!file) {
                return;
            }
            try {
                this.loaded = JSON.parse(await file.text());
            } catch {
                this.$root.toastError(this.$t("Invalid backup file"));
            }
        },
        restore() {
            this.busy = true;
            this.result = null;
            const passphrase = this.loaded.format === ENCRYPTED_FORMAT ? this.restorePassphrase : null;
            this.$root.importBackup(this.loaded, passphrase, (res) => {
                this.busy = false;
                if (!res.ok) {
                    this.$root.toastError(res.msg);
                    return;
                }
                this.result = res.data;
                this.loaded = null;
                this.restorePassphrase = "";
                this.$refs.file.value = "";
            });
        },
    },
};
</script>
