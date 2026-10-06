<template>
    <div>
        <p v-if="!certificate" class="mb-0">{{ $t("No certificate information") }}</p>
        <div v-else class="cert-grid">
            <div>
                <div class="label">{{ $t("Certificate status") }}</div>
                <span class="badge" :class="certificate.valid ? 'bg-primary' : 'bg-danger'">
                    {{ certificate.valid ? $t("Valid") : $t("Invalid") }}
                </span>
            </div>
            <div>
                <div class="label">{{ $t("Days remaining") }}</div>
                <div class="value" :class="expiryClass">{{ certificate.daysRemaining ?? "—" }}</div>
            </div>
            <div>
                <div class="label">{{ $t("Valid until") }}</div>
                <div class="value-sm">
                    <Datetime v-if="certificate.validTo" :value="certificate.validTo" />
                    <span v-else>—</span>
                </div>
            </div>
            <div>
                <div class="label">{{ $t("Issuer") }}</div>
                <div class="value-sm">{{ certificate.issuer ?? "—" }}</div>
            </div>
        </div>
    </div>
</template>

<script lang="js">
import Datetime from "../Datetime.vue";

export default {
    components: { Datetime },
    props: {
        /**
         * Certificate summary from the getMonitorAnalytics endpoint, or null
         * @type {{valid: boolean, daysRemaining: number|null, validTo: string|null, issuer: string|null}|null}
         */
        certificate: {
            type: Object,
            default: null,
        },
    },
    computed: {
        expiryClass() {
            const days = this.certificate?.daysRemaining;
            if (days == null) {
                return "";
            }
            if (days < 14) {
                return "text-danger";
            }
            if (days < 30) {
                return "text-warning";
            }
            return "";
        },
    },
};
</script>

<style lang="scss" scoped>
.cert-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1em;
}

.label {
    font-size: 0.85em;
    opacity: 0.7;
}

.value {
    font-size: 1.6em;
    font-weight: 600;
}

.value-sm {
    font-size: 1em;
}
</style>
