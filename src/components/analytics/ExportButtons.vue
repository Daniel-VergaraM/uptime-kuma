<template>
    <div class="export-buttons">
        <button type="button" class="btn btn-sm btn-normal" @click="exportSeries">
            {{ $t("Export series CSV") }}
        </button>
        <button type="button" class="btn btn-sm btn-normal" @click="exportIncidents">
            {{ $t("Export incidents CSV") }}
        </button>
        <button type="button" class="btn btn-sm btn-normal" @click="$emit('export-checks')">
            {{ $t("Export checks CSV") }}
        </button>
    </div>
</template>

<script lang="js">
import { downloadCsv, incidentsToCsv, seriesToCsv } from "../../analytics-csv.ts";

export default {
    props: {
        /** Buckets from the getMonitorAnalytics endpoint */
        series: {
            type: Array,
            required: true,
        },
        /** Incidents from the getMonitorAnalytics endpoint */
        incidents: {
            type: Array,
            required: true,
        },
        /** Used as the start of the file name, e.g. "my-api-24h" */
        filePrefix: {
            type: String,
            required: true,
        },
    },
    emits: ["export-checks"],
    methods: {
        exportSeries() {
            downloadCsv(`${this.filePrefix}-series.csv`, seriesToCsv(this.series));
        },
        exportIncidents() {
            downloadCsv(`${this.filePrefix}-incidents.csv`, incidentsToCsv(this.incidents));
        },
    },
};
</script>

<style lang="scss" scoped>
.export-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
}
</style>
