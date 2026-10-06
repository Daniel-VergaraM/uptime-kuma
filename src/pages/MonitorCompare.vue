<template>
    <transition name="slide-fade" appear>
        <div>
            <h1>{{ $t("Compare") }}</h1>

            <div v-if="monitorIds.length === 0" class="shadow-box big-padding">
                {{ $t("Select monitors in the list, then choose Compare in the Actions menu.") }}
            </div>

            <template v-else>
                <div class="period-select mb-3">
                    <button
                        v-for="(label, hours) in periodOptions"
                        :key="hours"
                        type="button"
                        class="btn btn-sm"
                        :class="period == hours ? 'btn-primary' : 'btn-normal'"
                        :aria-pressed="period == hours ? 'true' : 'false'"
                        @click="period = Number(hours)"
                    >
                        {{ label }}
                    </button>
                </div>

                <div class="shadow-box big-padding mb-4 table-responsive">
                    <table class="table table-borderless">
                        <thead>
                            <tr>
                                <th>{{ $t("Monitor") }}</th>
                                <th>{{ $t("Uptime") }}</th>
                                <th>{{ $t("avgPing") }}</th>
                                <th>{{ $t("p95Ping") }}</th>
                                <th>{{ $t("Incidents") }}</th>
                                <th>{{ $t("Total downtime") }}</th>
                                <th>{{ $t("MTTR") }}</th>
                                <th>{{ $t("Days remaining") }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in rows" :key="row.id">
                                <td>
                                    <router-link :to="'/dashboard/' + row.id">{{ row.name }}</router-link>
                                </td>
                                <td>{{ formatPct(row.summary?.uptimePct) }}</td>
                                <td>{{ formatMs(row.summary?.avgPing) }}</td>
                                <td>{{ formatMs(row.summary?.p95Ping) }}</td>
                                <td>{{ row.summary?.incidentCount ?? "—" }}</td>
                                <td>{{ formatDuration(row.summary?.totalDowntimeSec) }}</td>
                                <td>{{ formatDuration(row.summary?.mttrSec) }}</td>
                                <td>{{ row.certificate?.daysRemaining ?? "—" }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="shadow-box big-padding">
                    <h2 class="h4">{{ $t("Response time") }}</h2>
                    <ComparisonChart v-if="chartDatasets.length" :datasets="chartDatasets" />
                </div>
            </template>
        </div>
    </transition>
</template>

<script lang="js">
import ComparisonChart from "../components/analytics/ComparisonChart.vue";

export default {
    components: { ComparisonChart },
    data() {
        return {
            period: 24,
            periodOptions: {
                24: "24h",
                168: "7d",
                720: "30d",
                2160: "90d",
            },
            results: {},
        };
    },
    computed: {
        /**
         * Monitor IDs from ?ids=1,2,3
         * @returns {number[]} Unique positive integers
         */
        monitorIds() {
            const raw = String(this.$route.query.ids ?? "");
            return [
                ...new Set(
                    raw
                        .split(",")
                        .map(Number)
                        .filter((id) => Number.isInteger(id) && id > 0)
                ),
            ];
        },
        rows() {
            return this.monitorIds.map((id) => ({
                id,
                name: this.$root.monitorList[id]?.name ?? `#${id}`,
                summary: this.results[id]?.summary ?? null,
                certificate: this.results[id]?.certificate ?? null,
            }));
        },
        chartDatasets() {
            return this.monitorIds
                .filter((id) => this.results[id])
                .map((id) => ({
                    label: this.$root.monitorList[id]?.name ?? `#${id}`,
                    series: this.results[id].series,
                }));
        },
    },
    watch: {
        period() {
            this.load();
        },
        "$route.query"() {
            this.load();
        },
    },
    created() {
        this.load();
    },
    methods: {
        load() {
            this.results = {};
            for (const id of this.monitorIds) {
                this.$root.getMonitorAnalytics(id, this.period, (res) => {
                    if (!res.ok) {
                        this.$root.toastError(res.msg);
                        return;
                    }
                    this.results = { ...this.results, [id]: res.data };
                });
            }
        },
        formatPct(value) {
            return value == null ? "—" : `${value.toFixed(2)}%`;
        },
        formatMs(value) {
            return value == null ? "—" : `${Math.round(value)} ms`;
        },
        formatDuration(seconds) {
            if (seconds == null) {
                return "—";
            }
            const s = Math.round(seconds);
            if (s < 60) {
                return `${s}s`;
            }
            if (s < 3600) {
                return `${Math.floor(s / 60)}m ${s % 60}s`;
            }
            if (s < 86400) {
                return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
            }
            return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
        },
    },
};
</script>

<style lang="scss" scoped>
.period-select {
    display: flex;
    gap: 0.5em;
}
</style>
