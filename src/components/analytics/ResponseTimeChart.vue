<template>
    <div class="chart-wrapper" role="img" :aria-label="$t('Response time')">
        <Line :data="chartData" :options="chartOptions" />
    </div>
</template>

<script lang="js">
import {
    Chart,
    Filler,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    TimeScale,
    Tooltip,
    Legend,
} from "chart.js";
import "chartjs-adapter-dayjs-4";
import { Line } from "vue-chartjs";

Chart.register(LineController, LineElement, PointElement, TimeScale, LinearScale, Tooltip, Filler, Legend);

export default {
    components: { Line },
    props: {
        /**
         * Buckets from the getMonitorAnalytics endpoint
         * @type {{t: number, avgPing: number|null, p95Ping: number|null}[]}
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
            return {
                datasets: [
                    {
                        label: this.$t("avgPing"),
                        data: this.series.map((p) => ({ x: p.t, y: p.avgPing })),
                        borderColor: "#5CDD8B",
                        backgroundColor: "#5CDD8B14",
                        fill: "origin",
                        tension: 0.2,
                        spanGaps: false,
                    },
                    {
                        label: this.$t("p95Ping"),
                        data: this.series.map((p) => ({ x: p.t, y: p.p95Ping })),
                        borderColor: "#f5b617",
                        borderDash: [5, 4],
                        fill: false,
                        tension: 0.2,
                        spanGaps: false,
                    },
                ],
            };
        },
        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", intersect: false },
                elements: {
                    point: { radius: 0, hitRadius: 20 },
                },
                scales: {
                    x: {
                        type: "time",
                        ticks: { maxRotation: 0, autoSkipPadding: 30 },
                        grid: { color: this.gridColor },
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: this.$t("respTime") },
                        grid: { color: this.gridColor },
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                        align: "start",
                        labels: {
                            color: this.$root.theme === "light" ? "rgba(12,12,18,1.0)" : "rgba(220,220,220,1.0)",
                        },
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) =>
                                `${context.dataset.label} ${new Intl.NumberFormat().format(context.parsed.y)} ms`,
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
    height: 250px;
    margin-bottom: 0.5em;
}
</style>
