<template>
    <transition name="slide-fade" appear>
        <div v-if="monitor">
            <router-link :to="'/dashboard/' + monitor.id">&larr; {{ monitor.name }}</router-link>
            <h1>{{ $t("Analytics") }}</h1>

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

            <ExportButtons
                v-if="analytics"
                class="mb-3"
                :series="analytics.series"
                :incidents="analytics.incidents"
                :file-prefix="filePrefix"
                @export-checks="exportChecks"
            />

            <div v-if="analytics" class="kpi-grid mb-4">
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("Uptime") }}</div>
                    <div class="kpi-value">{{ formatPct(summary.uptimePct) }}</div>
                </div>
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("avgPing") }}</div>
                    <div class="kpi-value">{{ formatMs(summary.avgPing) }}</div>
                </div>
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("p95Ping") }}</div>
                    <div class="kpi-value">{{ formatMs(summary.p95Ping) }}</div>
                </div>
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("Incidents") }}</div>
                    <div class="kpi-value">{{ summary.incidentCount ?? "—" }}</div>
                </div>
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("Total downtime") }}</div>
                    <div class="kpi-value">{{ formatDuration(summary.totalDowntimeSec) }}</div>
                </div>
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("MTTR") }}</div>
                    <div class="kpi-value">{{ formatDuration(summary.mttrSec) }}</div>
                </div>
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("MTBF") }}</div>
                    <div class="kpi-value">{{ formatDuration(summary.mtbfSec) }}</div>
                </div>
                <div class="shadow-box kpi">
                    <div class="kpi-label">{{ $t("Error budget left") }}</div>
                    <div class="kpi-value" :class="{ 'text-danger': summary.errorBudgetLeftSec < 0 }">
                        {{ summary.sloTarget == null ? "—" : formatDuration(summary.errorBudgetLeftSec) }}
                    </div>
                    <div class="kpi-sub">
                        {{
                            summary.sloTarget == null
                                ? $t("No SLO target set")
                                : $t("sloBudgetOf", {
                                      target: summary.sloTarget,
                                      allowed: formatDuration(summary.errorBudgetSec),
                                  })
                        }}
                    </div>
                </div>
            </div>

            <div v-if="analytics" class="shadow-box big-padding mb-4">
                <h2 class="h4">{{ $t("SSL certificate") }}</h2>
                <CertificateCard :certificate="analytics.certificate" />
            </div>

            <div class="charts-grid mb-4">
                <div class="shadow-box big-padding">
                    <h2 class="h4">{{ $t("Response time") }}</h2>
                    <ResponseTimeChart v-if="analytics" :series="analytics.series" />
                </div>
                <div class="shadow-box big-padding">
                    <h2 class="h4">{{ $t("Status mix") }}</h2>
                    <StatusDonut v-if="analytics" :summary="summary" />
                </div>
            </div>

            <div class="shadow-box big-padding mb-4">
                <h2 class="h4">{{ $t("Uptime history") }}</h2>
                <UptimeBarChart v-if="analytics" :series="analytics.series" />
            </div>

            <div class="shadow-box big-padding">
                <h2 class="h4">{{ $t("Incidents") }}</h2>
                <p v-if="summary.daily" class="form-text">{{ $t("dailyPeriodNote") }}</p>
                <table class="table table-borderless">
                    <thead>
                        <tr>
                            <th>{{ $t("Status") }}</th>
                            <th>{{ $t("Started") }}</th>
                            <th>{{ $t("Ended") }}</th>
                            <th>{{ $t("Duration") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(incident, index) in incidents" :key="index">
                            <td><Status :status="DOWN" /></td>
                            <td><Datetime :value="incident.start" /></td>
                            <td>
                                <span v-if="incident.ongoing">{{ $t("Ongoing") }}</span>
                                <Datetime v-else :value="incident.end" />
                            </td>
                            <td>{{ formatDuration(incident.durationSec) }}</td>
                        </tr>
                        <tr v-if="incidents.length === 0">
                            <td colspan="4">{{ $t("No incidents in this period") }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </transition>
</template>

<script lang="js">
import Datetime from "../components/Datetime.vue";
import Status from "../components/Status.vue";
import ResponseTimeChart from "../components/analytics/ResponseTimeChart.vue";
import UptimeBarChart from "../components/analytics/UptimeBarChart.vue";
import StatusDonut from "../components/analytics/StatusDonut.vue";
import CertificateCard from "../components/analytics/CertificateCard.vue";
import ExportButtons from "../components/analytics/ExportButtons.vue";
import { DOWN } from "../util.ts";
import { downloadCsv, heartbeatsToCsv } from "../analytics-csv.ts";

const REFRESH_INTERVAL_MS = 60 * 1000;

export default {
    components: {
        Datetime,
        Status,
        ResponseTimeChart,
        UptimeBarChart,
        StatusDonut,
        CertificateCard,
        ExportButtons,
    },
    data() {
        return {
            DOWN,
            period: 24,
            periodOptions: {
                24: "24h",
                168: "7d",
                720: "30d",
                2160: "90d",
                8760: "365d",
            },
            analytics: null,
            refreshInterval: null,
        };
    },
    computed: {
        monitor() {
            return this.$root.monitorList[this.$route.params.id];
        },
        summary() {
            return this.analytics?.summary ?? {};
        },
        incidents() {
            return this.analytics?.incidents ?? [];
        },
        /**
         * File name prefix for CSV exports
         * @returns {string} e.g. "smoke-api-168h"
         */
        filePrefix() {
            const name = (this.monitor?.name ?? "monitor").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
            return `${name}-${this.period}h`;
        },
    },
    watch: {
        period() {
            this.load();
        },
        "$route.params.id"() {
            this.load();
        },
    },
    created() {
        this.load();
        this.refreshInterval = setInterval(() => this.load(), REFRESH_INTERVAL_MS);
    },
    beforeUnmount() {
        clearInterval(this.refreshInterval);
    },
    methods: {
        /**
         * Download the raw checks for the selected period as CSV
         * @returns {void}
         */
        exportChecks() {
            if (this.period > 720) {
                this.$root.toastError(this.$t("checksExportLimit"));
                return;
            }
            const id = Number(this.$route.params.id);
            this.$root.getMonitorChecks(id, this.period, (res) => {
                if (!res.ok) {
                    this.$root.toastError(res.msg);
                    return;
                }
                downloadCsv(`${this.filePrefix}-checks.csv`, heartbeatsToCsv(res.data.checks));
            });
        },
        load() {
            this.$root.getMonitorAnalytics(Number(this.$route.params.id), this.period, (res) => {
                if (!res.ok) {
                    this.$root.toastError(res.msg);
                    return;
                }
                this.analytics = res.data;
            });
        },
        formatPct(value) {
            return value == null ? "—" : `${value.toFixed(2)}%`;
        },
        formatMs(value) {
            return value == null ? "—" : `${Math.round(value)} ms`;
        },
        /**
         * Human-readable duration, e.g. "45s", "3m 10s", "2h 5m", "4d 3h"
         * @param {number|null} seconds Duration in seconds
         * @returns {string} Formatted duration
         */
        formatDuration(seconds) {
            if (seconds == null) {
                return "—";
            }
            if (seconds < 0) {
                return `-${this.formatDuration(-seconds)}`;
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

.kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1em;
}

.charts-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1em;

    @media (max-width: 991px) {
        grid-template-columns: 1fr;
    }
}

.kpi {
    padding: 1em;
    text-align: center;

    .kpi-label {
        font-size: 0.85em;
        opacity: 0.7;
    }

    .kpi-sub {
        font-size: 0.8em;
        opacity: 0.7;
    }

    .kpi-value {
        font-size: 1.6em;
        font-weight: 600;
    }
}
</style>
