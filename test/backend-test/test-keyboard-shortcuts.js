const { describe, test } = require("node:test");
const assert = require("node:assert");
const { resolveShortcut } = require("../../src/keyboard-shortcuts");

describe("resolveShortcut", () => {
    test("/ focuses search and n opens the add page", () => {
        assert.deepStrictEqual(resolveShortcut("/", null).action, { type: "focus-search" });
        assert.deepStrictEqual(resolveShortcut("n", null).action, { type: "route", path: "/add" });
    });

    test("g then d goes to the dashboard, g then s to settings", () => {
        const first = resolveShortcut("g", null);
        assert.strictEqual(first.action, null);
        assert.strictEqual(first.pendingPrefix, "g");
        assert.deepStrictEqual(resolveShortcut("d", "g").action, { type: "route", path: "/dashboard" });
        assert.deepStrictEqual(resolveShortcut("s", "g").action, { type: "route", path: "/settings/general" });
    });

    test("g followed by an unknown key does nothing and clears the prefix", () => {
        const result = resolveShortcut("x", "g");
        assert.strictEqual(result.action, null);
        assert.strictEqual(result.pendingPrefix, null);
    });

    test("? shows help and other keys do nothing", () => {
        assert.deepStrictEqual(resolveShortcut("?", null).action, { type: "help" });
        assert.strictEqual(resolveShortcut("q", null).action, null);
    });
});
