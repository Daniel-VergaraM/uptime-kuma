<template>
    <div class="container-fluid">
        <ShortcutsHelp ref="shortcutsHelp" />
        <div class="row">
            <div v-if="!$root.isMobile" class="col-12 col-md-5 col-xl-4 ps-0">
                <div>
                    <router-link to="/add" class="btn btn-primary mb-3">
                        <font-awesome-icon icon="plus" />
                        {{ $t("Add New Monitor") }}
                    </router-link>
                </div>
                <MonitorList :scrollbar="true" />
            </div>

            <div ref="container" class="col-12 col-md-7 col-xl-8 mb-3 gx-0">
                <!-- Add :key to disable vue router re-use the same component -->
                <router-view :key="$route.fullPath" :calculatedHeight="height" />
            </div>
        </div>
    </div>
</template>

<script>
import MonitorList from "../components/MonitorList.vue";
import ShortcutsHelp from "../components/ShortcutsHelp.vue";
import { resolveShortcut } from "../keyboard-shortcuts.ts";

export default {
    components: {
        ShortcutsHelp,
        MonitorList,
    },
    data() {
        return {
            height: 0,
            // "g" waiting for its second key
            shortcutPrefix: null,
        };
    },
    mounted() {
        this.height = this.$refs.container.offsetHeight;
        window.addEventListener("keydown", this.onShortcutKey);
    },
    beforeUnmount() {
        window.removeEventListener("keydown", this.onShortcutKey);
    },
    methods: {
        /**
         * Keyboard shortcuts: / search, n new monitor, g then d / l / s / c to go to a page, ? help
         * Ignored while typing in a field.
         * @param {KeyboardEvent} event Keydown event
         * @returns {void}
         */
        onShortcutKey(event) {
            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }
            const target = event.target;
            if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
                return;
            }

            const { action, pendingPrefix } = resolveShortcut(event.key, this.shortcutPrefix);
            this.shortcutPrefix = pendingPrefix;
            if (!action) {
                return;
            }
            event.preventDefault();

            if (action.type === "route") {
                this.$router.push(action.path);
            } else if (action.type === "focus-search") {
                document.querySelector(".search-input")?.focus();
            } else if (action.type === "help") {
                this.$refs.shortcutsHelp.show();
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.container-fluid {
    width: 98%;
}
</style>
