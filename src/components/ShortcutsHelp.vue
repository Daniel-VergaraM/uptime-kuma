<template>
    <div ref="modal" class="modal fade" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="shortcuts-title" class="modal-title">{{ $t("Keyboard shortcuts") }}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" :aria-label="$t('Close')" />
                </div>
                <div class="modal-body">
                    <table class="table table-borderless">
                        <tbody>
                            <tr v-for="item in shortcuts" :key="item.keys">
                                <td class="keys">
                                    <kbd v-for="key in item.keys.split(' ')" :key="key">{{ key }}</kbd>
                                </td>
                                <td>{{ $t(item.label) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="js">
import { Modal } from "bootstrap";

/** Mirrors the keys handled in src/keyboard-shortcuts.ts */
const SHORTCUTS = [
    { keys: "/", label: "shortcutSearch" },
    { keys: "n", label: "shortcutNewMonitor" },
    { keys: "g d", label: "shortcutDashboard" },
    { keys: "g l", label: "shortcutList" },
    { keys: "g c", label: "shortcutCompare" },
    { keys: "g s", label: "shortcutSettings" },
    { keys: "?", label: "shortcutHelp" },
];

export default {
    data() {
        return {
            shortcuts: SHORTCUTS,
            modal: null,
        };
    },
    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },
    beforeUnmount() {
        this.modal?.dispose();
    },
    methods: {
        show() {
            this.modal.show();
        },
    },
};
</script>

<style lang="scss" scoped>
.keys kbd {
    margin-right: 0.25em;
}
</style>
