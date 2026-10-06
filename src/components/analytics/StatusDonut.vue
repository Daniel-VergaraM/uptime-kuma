<template>
    <div class="chart-wrapper" role="img" :aria-label="$t('Status mix')">
        <Doughnut :data="chartData" :options="chartOptions" />
    </div>
</template>

<script lang="js">
import { ArcElement, Chart, DoughnutController, Legend, Tooltip } from "chart.js";
import { Doughnut } from "vue-chartjs";

Chart.register(DoughnutController, ArcElement, Legend, Tooltip);

export default {
    components: { Doughnut },
    props: {
        /**
         * Check counts from the getMonitorAnalytics summary
         * @type {{up: number, down: number, pending: number, maintenance: number}}
         */
        summary: {
            type: Object,
            required: true,
        },
    },
    computed: {
        chartData() {
            return {
                labels: [this.$t("Up"), this.$t("Down"), this.$t("Pending"), this.$t("Maintenance")],
                datasets: [
                    {
                        data: [this.summary.up, this.summary.down, this.summary.pending, this.summary.maintenance],
                        backgroundColor: ["#5CDD8B", "#dc3545", "#f5b617", "#1747f5"],
                        borderWidth: 0,
                    },
                ],
            };
        },
        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "65%",
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color: this.$root.theme === "light" ? "rgba(12,12,18,1.0)" : "rgba(220,220,220,1.0)",
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
