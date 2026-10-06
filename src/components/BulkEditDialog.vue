<template>
    <div ref="modal" class="modal fade" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="bulk-edit-title">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 id="bulk-edit-title" class="modal-title">{{ $t("Bulk edit") }} ({{ monitorIds.length }})</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" :aria-label="$t('Close')" />
                </div>
                <div class="modal-body">
                    <div class="mb-3">
                        <label class="form-label" for="bulk-interval">
                            {{ $t("Check interval") }} ({{ $t("seconds") }})
                        </label>
                        <input
                            id="bulk-interval"
                            v-model="interval"
                            type="number"
                            min="20"
                            class="form-control"
                            :placeholder="$t('No change')"
                        />
                    </div>

                    <div class="mb-3">
                        <label class="form-label" for="bulk-group">{{ $t("Group") }}</label>
                        <select id="bulk-group" v-model="parentChoice" class="form-select">
                            <option value="">{{ $t("No change") }}</option>
                            <option value="none">{{ $t("None") }}</option>
                            <option v-for="group in groups" :key="group.id" :value="String(group.id)">
                                {{ group.pathName || group.name }}
                            </option>
                        </select>
                    </div>

                    <div class="mb-3">
                        <label class="form-label" for="bulk-tag">{{ $t("Add tag") }}</label>
                        <div class="d-flex gap-2">
                            <select id="bulk-tag" v-model="tagID" class="form-select">
                                <option value="">{{ $t("No change") }}</option>
                                <option v-for="tag in tags" :key="tag.id" :value="String(tag.id)">
                                    {{ tag.name }}
                                </option>
                            </select>
                            <input
                                v-model="tagValue"
                                type="text"
                                class="form-control"
                                :placeholder="$t('Value (optional)')"
                                :disabled="!tagID"
                            />
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" :disabled="!hasChanges || busy" @click="submit">
                        {{ $t("Apply") }}
                    </button>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                        {{ $t("Cancel") }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="js">
import { Modal } from "bootstrap";

export default {
    props: {
        /** IDs of the selected monitors */
        monitorIds: {
            type: Array,
            required: true,
        },
    },
    emits: ["applied"],
    data() {
        return {
            interval: "",
            parentChoice: "",
            tagID: "",
            tagValue: "",
            tags: [],
            busy: false,
            modal: null,
        };
    },
    computed: {
        /**
         * Groups that can be a parent: not one of the selected monitors
         * @returns {object[]} Monitor objects
         */
        groups() {
            return Object.values(this.$root.monitorList).filter(
                (m) => m.type === "group" && !this.monitorIds.includes(m.id)
            );
        },
        hasChanges() {
            return this.interval !== "" || this.parentChoice !== "" || this.tagID !== "";
        },
    },
    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },
    beforeUnmount() {
        this.modal?.dispose();
    },
    methods: {
        show() {
            this.interval = "";
            this.parentChoice = "";
            this.tagID = "";
            this.tagValue = "";
            this.$root.getSocket().emit("getTags", (res) => {
                if (res.ok) {
                    this.tags = res.tags;
                }
            });
            this.modal.show();
        },
        submit() {
            const changes = {};
            if (this.interval !== "") {
                changes.interval = Number(this.interval);
            }
            if (this.parentChoice === "none") {
                changes.parent = null;
            } else if (this.parentChoice !== "") {
                changes.parent = Number(this.parentChoice);
            }
            if (this.tagID !== "") {
                changes.addTag = { tagID: Number(this.tagID), value: this.tagValue };
            }

            this.busy = true;
            this.$root.getSocket().emit("bulkUpdateMonitors", this.monitorIds, changes, (res) => {
                this.busy = false;
                if (!res.ok) {
                    this.$root.toastError(res.msg);
                    return;
                }
                this.$root.toastSuccess(this.$t("Saved."));
                this.modal.hide();
                this.$emit("applied");
            });
        },
    },
};
</script>
