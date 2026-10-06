const { describe, test } = require("node:test");
const assert = require("node:assert");
const { csvCell, toCsv, seriesToCsv, incidentsToCsv } = require("../../src/analytics-csv");

describe("csvCell", () => {
    test("plain values pass through, null becomes empty", () => {
        assert.strictEqual(csvCell(42), "42");
        assert.strictEqual(csvCell(null), "");
        assert.strictEqual(csvCell(undefined), "");
    });

    test("values with commas, quotes or newlines are quoted and quotes doubled", () => {
        assert.strictEqual(csvCell("a,b"), '"a,b"');
        assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
        assert.strictEqual(csvCell("line1\nline2"), '"line1\nline2"');
    });
});

describe("toCsv", () => {
    test("writes header and rows with CRLF endings", () => {
        assert.strictEqual(
            toCsv(
                ["a", "b"],
                [
                    [1, "x"],
                    [2, null],
                ]
            ),
            "a,b\r\n1,x\r\n2,\r\n"
        );
    });
});

describe("seriesToCsv", () => {
    test("one row per bucket with UTC time and fixed decimals", () => {
        const csv = seriesToCsv([
            {
                t: Date.UTC(2026, 0, 1, 0, 0),
                up: 3,
                down: 1,
                pending: 0,
                maintenance: 0,
                upPct: 75,
                avgPing: 200,
                p95Ping: 300,
            },
            {
                t: Date.UTC(2026, 0, 1, 0, 15),
                up: 0,
                down: 2,
                pending: 0,
                maintenance: 0,
                upPct: 0,
                avgPing: null,
                p95Ping: null,
            },
        ]);
        assert.strictEqual(
            csv,
            [
                "time_utc,up,down,pending,maintenance,uptime_pct,avg_ping_ms,p95_ping_ms",
                "2026-01-01T00:00:00.000Z,3,1,0,0,75.00,200.0,300.0",
                "2026-01-01T00:15:00.000Z,0,2,0,0,0.00,,",
                "",
            ].join("\r\n")
        );
    });
});

describe("incidentsToCsv", () => {
    test("open incident has empty end and ongoing yes", () => {
        const start = Date.UTC(2026, 0, 1, 0, 0);
        const csv = incidentsToCsv([{ start, end: null, durationSec: 300.4, ongoing: true }]);
        assert.strictEqual(csv, "started_utc,ended_utc,duration_sec,ongoing\r\n2026-01-01T00:00:00.000Z,,300,yes\r\n");
    });
});
