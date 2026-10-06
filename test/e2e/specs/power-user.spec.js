const fs = require("node:fs");
import { expect, test } from "@playwright/test";
import { login, restoreSqliteSnapshot } from "../util-test";

const AXE_PATH = require.resolve("axe-core/axe.min.js");

/**
 * Run axe on the current page and return the findings with the given impact levels
 * @param {import("@playwright/test").Page} page Page
 * @param {string[]} impacts Impact levels to keep, e.g. ["serious", "critical"]
 * @param {string[]} tags axe rule tags to run, default the WCAG A and AA rules
 * @returns {Promise<{id: string, impact: string, nodes: number, help: string}[]>} Findings
 */
async function a11yProblems(page, impacts, tags = ["wcag2a", "wcag2aa"]) {
    await page.addScriptTag({ path: AXE_PATH });
    const results = await page.evaluate(
        (runTags) => window.axe.run(document, { runOnly: { type: "tag", values: runTags } }),
        tags
    );
    return results.violations
        .filter((v) => impacts.includes(v.impact))
        .map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
            help: v.help,
            targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        }));
}

/**
 * Add one monitor through the form. The monitor list only shows its search box when there is a monitor.
 * @param {import("@playwright/test").Page} page Page
 * @returns {Promise<void>}
 */
async function addMonitor(page) {
    // Navigate with a click, as a user does. Full page loads lose the session in some setups.
    await page.locator('a[href="/add"]').first().click();
    await page.locator("#name").fill("Power user check");
    await page.locator("#url").fill("http://127.0.0.1:9/");
    await page.locator("#monitor-submit-btn").click();
    await expect(page).toHaveURL(/\/dashboard\/\d+/);
}

test.describe("Power user features", () => {
    test.beforeEach(async ({ page }) => {
        await restoreSqliteSnapshot(page);
        await page.goto("./");
        await login(page);
        await addMonitor(page);
    });

    test("/ focuses the monitor search", async ({ page }) => {
        await page.goto("./dashboard");
        await page.locator("body").click({ position: { x: 5, y: 5 } });
        await page.keyboard.press("/");
        await expect(page.locator(".search-input")).toBeFocused();
    });

    test("g then s opens settings", async ({ page }) => {
        await page.goto("./dashboard");
        await page.locator("body").click({ position: { x: 5, y: 5 } });
        await page.keyboard.press("g");
        await page.keyboard.press("s");
        await expect(page).toHaveURL(/\/settings\//);
    });

    test("new API keys can be read-only", async ({ page }) => {
        await page.goto("./settings/api-keys");
        await page.getByRole("button", { name: "Add API Key" }).click();
        const access = page.locator("#api-key-scope");
        await expect(access).toBeVisible();
        await expect(access).toHaveValue("full");
        await access.selectOption("read");
        await expect(access).toHaveValue("read");
    });

    test("backup can be encrypted with an optional passphrase", async ({ page }) => {
        await page.goto("./settings/backup");
        const passphrase = page.locator("#backup-passphrase");
        await expect(passphrase).toBeVisible();
        await expect(passphrase).toHaveAttribute("type", "password");
    });

    test("compare explains how to pick monitors when none are given", async ({ page }) => {
        await page.goto("./compare");
        await expect(page.getByText("Select monitors in the list")).toBeVisible();
    });

    test("? opens the list of shortcuts", async ({ page }) => {
        await page.goto("./dashboard");
        await page.locator("body").click({ position: { x: 5, y: 5 } });
        await page.keyboard.press("?");
        await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    });

    test("power user pages have no serious accessibility problems", async ({ page }) => {
        const monitorId = new URL(page.url()).pathname.split("/").pop();
        const pages = {
            dashboard: "./dashboard",
            compare: "./compare",
            apiKeys: "./settings/api-keys",
            backup: "./settings/backup",
            generalSettings: "./settings/general",
            statusPages: "./manage-status-page",
            analytics: `./analytics/${monitorId}`,
            editMonitor: `./edit/${monitorId}`,
        };
        const problems = {};
        for (const [name, url] of Object.entries(pages)) {
            await page.goto(url);
            await page.waitForTimeout(1000);
            problems[name] = await a11yProblems(page, ["serious", "critical"]);
        }
        expect(problems).toEqual(Object.fromEntries(Object.keys(pages).map((n) => [n, []])));
    });
    // Report only: moderate and minor findings are printed, not failed, so they can be worked through over time
    test("report moderate and minor accessibility findings", async ({ page }) => {
        const monitorId = new URL(page.url()).pathname.split("/").pop();
        const pages = {
            dashboard: "./dashboard",
            compare: "./compare",
            apiKeys: "./settings/api-keys",
            backup: "./settings/backup",
            generalSettings: "./settings/general",
            statusPages: "./manage-status-page",
            analytics: `./analytics/${monitorId}`,
            editMonitor: `./edit/${monitorId}`,
        };
        const report = {};
        for (const [name, url] of Object.entries(pages)) {
            await page.goto(url);
            await page.waitForTimeout(1000);
            report[name] = await a11yProblems(page, ["moderate", "minor"]);
        }
        fs.mkdirSync("private", { recursive: true });
        fs.writeFileSync("private/a11y-report.json", JSON.stringify(report, null, 2));
    });
    // Report only: best-practice rules (landmarks, headings, regions and similar) are printed, not failed
    test("report best-practice accessibility findings", async ({ page }) => {
        const monitorId = new URL(page.url()).pathname.split("/").pop();
        const pages = {
            dashboard: "./dashboard",
            compare: "./compare",
            apiKeys: "./settings/api-keys",
            backup: "./settings/backup",
            generalSettings: "./settings/general",
            statusPages: "./manage-status-page",
            analytics: `./analytics/${monitorId}`,
            editMonitor: `./edit/${monitorId}`,
        };
        const report = {};
        for (const [name, url] of Object.entries(pages)) {
            await page.goto(url);
            await page.waitForTimeout(1000);
            report[name] = await a11yProblems(page, ["minor", "moderate", "serious", "critical"], ["best-practice"]);
        }
        fs.mkdirSync("private", { recursive: true });
        fs.writeFileSync("private/a11y-best-practice.json", JSON.stringify(report, null, 2));
    });
    // What a screen reader announces: roles and names, checked the way assistive technology finds them
    test("power user controls have roles and names a screen reader can announce", async ({ page }) => {
        await page.locator('a[href^="/analytics/"]').first().click();
        await expect(page.getByRole("button", { name: "24h" })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "false");
        await expect(page.getByRole("button", { name: "Export checks CSV" })).toBeVisible();
        await expect(page.getByRole("img", { name: "Response time" })).toBeVisible();

        const monitorId = new URL(page.url()).pathname.split("/").pop();
        await page.goto(`./edit/${monitorId}`);
        await expect(page.getByLabel("SLO target (%)")).toBeVisible();

        await page.goto("./settings/backup");
        await expect(page.getByLabel("Backup file")).toBeVisible();
        await expect(page.getByLabel("Passphrase (optional)")).toHaveAttribute("type", "password");
    });

    test("the shortcut list is a named dialog", async ({ page }) => {
        await page.locator("body").click({ position: { x: 5, y: 5 } });
        await page.keyboard.press("?");
        await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    });
});
