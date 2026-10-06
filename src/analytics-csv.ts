/**
 * Escape one CSV cell: quote it when it has a comma, quote or line break
 * @param value Any value; null and undefined become an empty cell
 * @returns Escaped text
 */
export function csvCell(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Build a CSV document
 * @param headers Column names
 * @param rows Rows of values, same order as headers
 * @returns CSV text with CRLF line endings
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
    return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Format a number with fixed decimals, or empty when there is no value
 * @param value Number or null
 * @param digits Decimal places
 * @returns Formatted number or empty string
 */
function fixed(value: number | null | undefined, digits: number): string {
    return value == null ? "" : value.toFixed(digits);
}

/**
 * CSV of the time series, one row per bucket. Times are UTC ISO strings.
 * @param series Buckets from getMonitorAnalytics
 * @returns CSV text
 */
export function seriesToCsv(series: Array<Record<string, number | null>>): string {
    return toCsv(
        ["time_utc", "up", "down", "pending", "maintenance", "uptime_pct", "avg_ping_ms", "p95_ping_ms"],
        series.map((p) => [
            new Date(p.t as number).toISOString(),
            p.up,
            p.down,
            p.pending,
            p.maintenance,
            fixed(p.upPct, 2),
            fixed(p.avgPing, 1),
            fixed(p.p95Ping, 1),
        ])
    );
}

/**
 * CSV of incidents, newest first as delivered by the API
 * @param incidents Incidents from getMonitorAnalytics
 * @returns CSV text
 */
export function incidentsToCsv(
    incidents: Array<{ start: number; end: number | null; durationSec: number; ongoing: boolean }>
): string {
    return toCsv(
        ["started_utc", "ended_utc", "duration_sec", "ongoing"],
        incidents.map((i) => [
            new Date(i.start).toISOString(),
            i.end == null ? "" : new Date(i.end).toISOString(),
            Math.round(i.durationSec),
            i.ongoing ? "yes" : "no",
        ])
    );
}

const STATUS_NAMES = ["down", "up", "pending", "maintenance"];

/**
 * CSV of raw checks, one row per heartbeat. Times are UTC ISO strings.
 * @param checks Checks from GET /api/v1/monitors/:id/heartbeats
 * @returns CSV text
 */
export function heartbeatsToCsv(
    checks: Array<{ time: string; status: number; ping: number | null; msg: string }>
): string {
    return toCsv(
        ["time_utc", "status", "status_name", "ping_ms", "message"],
        checks.map((c) => [c.time, c.status, STATUS_NAMES[c.status] ?? "", c.ping, c.msg])
    );
}

/**
 * Save text as a CSV file through a temporary link
 * @param filename File name to suggest
 * @param text File contents
 */
export function downloadCsv(filename: string, text: string): void {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
