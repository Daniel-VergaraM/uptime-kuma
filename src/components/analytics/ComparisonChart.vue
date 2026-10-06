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

/** One colour per monitor, repeats after the list ends */
const PALETTE = ["#5CDD8B", "#4aa3ff", "#f5b617", "#dc3545", "#b07cff", "#20c9c0", "#ff7f50", "#8a8a8a"];

export default {
    components: { Line },
    props: {
        /**
         * One entry per monitor. series comes from getMonitorAnalytics.
         * @type {{label: string, series: {t: number, avgPing: number|null}[]}[]}
         */
        datasets: {
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
                datasets: this.datasets.map((item, index) => ({
                    label: item.label,
                    data: item.series.map((p) => ({ x: p.t, y: p.avgPing })),
                    borderColor: PALETTE[index % PALETTE.length],
                    backgroundColor: "transparent",
                    tension: 0.2,
                    spanGaps: false,
                })),
            };
        },
        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "nearest", intersect: false },
                elements: { point: { radius: 0, hitRadius: 20 } },
                scales: {
                    x: {
                        type: "time",
                        ticks: { maxRotation: 0, autoSkipPadding: 30 },
                        grid: { color: this.gridColor },
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: this.$t("avgPing") },
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
    height: 300px;
    margin-bottom: 0.5em;
}
</style>
