<template>
    <div class="chart-wrapper" role="img" :aria-label="$t('Uptime history')">
        <Bar :data="chartData" :options="chartOptions" />
    </div>
</template>

<script lang="js">
import { BarController, BarElement, Chart, LinearScale, TimeScale, Tooltip } from "chart.js";
import "chartjs-adapter-dayjs-4";
import { Bar } from "vue-chartjs";

Chart.register(BarController, BarElement, LinearScale, TimeScale, Tooltip);

/**
 * Bar color for an uptime percentage
 * @param {number} pct Uptime in percent
 * @returns {string} CSS color
 */
function colorForUptime(pct) {
    if (pct >= 99.9) {
        return "rgba(92, 221, 139, 0.6)";
    }
    if (pct >= 95) {
        return "rgba(245, 182, 23, 0.6)";
    }
    return "rgba(220, 53, 69, 0.6)";
}

export default {
    components: { Bar },
    props: {
        /**
         * Buckets from the getMonitorAnalytics endpoint
         * @type {{t: number, upPct: number|null, up: number, down: number}[]}
         */
        series: {
            type: Array,
            required: true,
        },
    },
    computed: {
        gridColor() {
            return this.$root.theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)";
        },
        chartData() {
            // Buckets with no up or down checks have no uptime value and are left out
            const points = this.series.filter((p) => p.upPct !== null);
            return {
                datasets: [
                    {
                        label: this.$t("Uptime"),
                        data: points.map((p) => ({ x: p.t, y: p.upPct })),
                        backgroundColor: points.map((p) => colorForUptime(p.upPct)),
                        borderWidth: 0,
                        barPercentage: 0.8,
                        categoryPercentage: 1,
                    },
                ],
            };
        },
        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: "time",
                        ticks: { maxRotation: 0, autoSkipPadding: 30 },
                        grid: { color: this.gridColor },
                    },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: { callback: (value) => `${value}%` },
                        grid: { color: this.gridColor },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const point = this.series.find((p) => p.t === context.raw.x);
                                const pct = context.parsed.y.toFixed(2);
                                return point ? `${pct}% (${point.up} up / ${point.down} down)` : `${pct}%`;
                            },
                        },
                    },
                },
            };
        },
    },
};
</script>

<style lang="scss" scoped>
.chart-wrapper {
    position: relative;
    height: 220px;
    margin-bottom: 0.5em;
}
</style>
