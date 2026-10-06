const { describe, test } = require("node:test");
const assert = require("node:assert");
const {
    percentile,
    buildIncidents,
    buildAnalytics,
    buildCertificateSummary,
    parseSloTarget,
} = require("../../server/monitor-analytics");
const { UP, DOWN, PENDING, MAINTENANCE } = require("../../src/util");

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

describe("percentile", () => {
    test("nearest-rank on sorted values", () => {
        const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        assert.strictEqual(percentile(values, 50), 50);
        assert.strictEqual(percentile(values, 95), 100);
        assert.strictEqual(percentile(values, 10), 10);
    });

    test("empty input returns null", () => {
        assert.strictEqual(percentile([], 95), null);
    });
});

describe("buildIncidents", () => {
    test("pairs DOWN with the next UP and ignores PENDING and MAINTENANCE", () => {
        const beats = [
            { time: T0, status: UP },
            { time: T0 + 1 * MIN, status: DOWN },
            { time: T0 + 2 * MIN, status: PENDING },
            { time: T0 + 4 * MIN, status: UP },
            { time: T0 + 10 * MIN, status: MAINTENANCE },
        ];
        const incidents = buildIncidents(beats, T0 + 20 * MIN);
        assert.strictEqual(incidents.length, 1);
        assert.strictEqual(incidents[0].durationSec, 3 * 60);
        assert.strictEqual(incidents[0].ongoing, false);
    });

    test("an unresolved DOWN is ongoing and measured up to now", () => {
        const beats = [{ time: T0, status: DOWN }];
        const incidents = buildIncidents(beats, T0 + 5 * MIN);
        assert.strictEqual(incidents.length, 1);
        assert.strictEqual(incidents[0].ongoing, true);
        assert.strictEqual(incidents[0].durationSec, 5 * 60);
    });

    test("repeated DOWN beats do not open a second incident", () => {
        const beats = [
            { time: T0, status: DOWN },
            { time: T0 + MIN, status: DOWN },
            { time: T0 + 2 * MIN, status: UP },
        ];
        assert.strictEqual(buildIncidents(beats, T0 + 3 * MIN).length, 1);
    });
});

describe("buildAnalytics summary", () => {
    test("uptime, ping percentiles, MTTR and MTBF", () => {
        // 1 beat per minute for 10 minutes: 8 UP (pings 10,20,30,60,70,80,90,100), 2 DOWN (minutes 3 and 4)
        const beats = [];
        const importantBeats = [];
        for (let i = 0; i < 10; i++) {
            const time = T0 + i * MIN;
            const isDown = i === 3 || i === 4;
            beats.push({ time, status: isDown ? DOWN : UP, ping: isDown ? null : (i + 1) * 10 });
        }
        importantBeats.push({ time: T0 + 3 * MIN, status: DOWN });
        importantBeats.push({ time: T0 + 5 * MIN, status: UP });

        const { summary } = buildAnalytics(beats, importantBeats, 24, T0 + 10 * MIN);

        assert.strictEqual(summary.checks, 10);
        assert.strictEqual(summary.up, 8);
        assert.strictEqual(summary.down, 2);
        assert.strictEqual(summary.uptimePct, 80);
        assert.strictEqual(summary.p50Ping, 60);
        assert.strictEqual(summary.p95Ping, 100);
        assert.strictEqual(summary.incidentCount, 1);
        assert.strictEqual(summary.totalDowntimeSec, 120);
        assert.strictEqual(summary.mttrSec, 120);
        // period 24h: (86400 - 120) / 1 incident
        assert.strictEqual(summary.mtbfSec, 86280);
    });

    test("no heartbeats gives null rates instead of NaN", () => {
        const { summary, series, incidents } = buildAnalytics([], [], 168, T0);
        assert.strictEqual(summary.uptimePct, null);
        assert.strictEqual(summary.avgPing, null);
        assert.strictEqual(summary.mttrSec, null);
        assert.strictEqual(summary.mtbfSec, null);
        assert.deepStrictEqual(series, []);
        assert.deepStrictEqual(incidents, []);
    });

    test("invalid period throws", () => {
        assert.throws(() => buildAnalytics([], [], 5, T0), /Invalid period/);
    });
});

describe("buildAnalytics series", () => {
    test("beats are grouped into buckets with per-bucket uptime", () => {
        // 24h period uses 15 minute buckets. Put 3 UP and 1 DOWN in the first bucket.
        const beats = [
            { time: T0, status: UP, ping: 100 },
            { time: T0 + MIN, status: UP, ping: 200 },
            { time: T0 + 2 * MIN, status: UP, ping: 300 },
            { time: T0 + 3 * MIN, status: DOWN, ping: null },
            // Second bucket, all UP
            { time: T0 + 15 * MIN, status: UP, ping: 50 },
        ];
        const { series } = buildAnalytics(beats, [], 24, T0 + 20 * MIN);

        assert.strictEqual(series.length, 2);
        assert.strictEqual(series[0].t, T0);
        assert.strictEqual(series[0].upPct, 75);
        assert.strictEqual(series[0].avgPing, 200);
        assert.strictEqual(series[1].t, T0 + 15 * MIN);
        assert.strictEqual(series[1].upPct, 100);
    });
});

describe("buildCertificateSummary", () => {
    test("reads days remaining, expiry, issuer and cert type", () => {
        const infoJson = JSON.stringify({
            valid: true,
            certInfo: {
                daysRemaining: 42,
                validTo: "2026-11-14T00:00:00.000Z",
                issuer: { O: "Let's Encrypt", CN: "R3" },
                certType: "server",
            },
        });
        assert.deepStrictEqual(buildCertificateSummary(infoJson), {
            valid: true,
            daysRemaining: 42,
            validTo: "2026-11-14T00:00:00.000Z",
            issuer: "Let's Encrypt",
            certType: "server",
        });
    });

    test("falls back to issuer CN when O is missing and marks invalid certs", () => {
        const infoJson = JSON.stringify({ valid: false, certInfo: { daysRemaining: -3, issuer: { CN: "Self" } } });
        const summary = buildCertificateSummary(infoJson);
        assert.strictEqual(summary.valid, false);
        assert.strictEqual(summary.issuer, "Self");
        assert.strictEqual(summary.daysRemaining, -3);
    });

    test("no data, malformed JSON or no certInfo returns null", () => {
        assert.strictEqual(buildCertificateSummary(null), null);
        assert.strictEqual(buildCertificateSummary(undefined), null);
        assert.strictEqual(buildCertificateSummary("{not json"), null);
        assert.strictEqual(buildCertificateSummary(JSON.stringify({ valid: true })), null);
    });
});

describe("error budget", () => {
    test("budget and what is left for a 99.9% target over 24h", () => {
        // 24h = 86400 s, 0.1% allowed = 86.4 s. 30 s of downtime leaves 56.4 s.
        const beats = [];
        const importantBeats = [
            { time: T0 + 1 * MIN, status: DOWN },
            { time: T0 + 1 * MIN + 30 * 1000, status: UP },
        ];
        for (let i = 0; i < 3; i++) {
            beats.push({ time: T0 + i * MIN, status: UP, ping: 10 });
        }
        const { summary } = buildAnalytics(beats, importantBeats, 24, T0 + 5 * MIN, 99.9);
        assert.strictEqual(summary.sloTarget, 99.9);
        assert.ok(Math.abs(summary.errorBudgetSec - 86.4) < 1e-9);
        assert.ok(Math.abs(summary.errorBudgetLeftSec - 56.4) < 1e-9);
    });

    test("no target gives null budget", () => {
        const { summary } = buildAnalytics([], [], 24, T0);
        assert.strictEqual(summary.sloTarget, null);
        assert.strictEqual(summary.errorBudgetSec, null);
        assert.strictEqual(summary.errorBudgetLeftSec, null);
    });

    test("overspent budget is negative", () => {
        const importantBeats = [
            { time: T0, status: DOWN },
            { time: T0 + 10 * MIN, status: UP },
        ];
        const { summary } = buildAnalytics(
            [{ time: T0, status: UP, ping: 1 }],
            importantBeats,
            24,
            T0 + 20 * MIN,
            99.9
        );
        assert.ok(summary.errorBudgetLeftSec < 0);
    });
});

describe("parseSloTarget", () => {
    test("accepts numbers and numeric strings, empty means none", () => {
        assert.strictEqual(parseSloTarget(99.9), 99.9);
        assert.strictEqual(parseSloTarget("99.5"), 99.5);
        assert.strictEqual(parseSloTarget(100), 100);
        assert.strictEqual(parseSloTarget(""), null);
        assert.strictEqual(parseSloTarget(null), null);
        assert.strictEqual(parseSloTarget(undefined), null);
    });

    test("rejects zero, negatives, above 100 and text", () => {
        assert.throws(() => parseSloTarget(0), /between 0 and 100/);
        assert.throws(() => parseSloTarget(-1), /between 0 and 100/);
        assert.throws(() => parseSloTarget(100.1), /between 0 and 100/);
        assert.throws(() => parseSloTarget("abc"), /between 0 and 100/);
    });
});
