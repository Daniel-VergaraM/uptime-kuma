/**
 * What a key press should do
 */
export type ShortcutAction = { type: "route"; path: string } | { type: "focus-search" } | { type: "help" };

/** Second key of a "g" prefix shortcut, e.g. "g" then "d" goes to the dashboard */
const GO_TO: Record<string, string> = {
    d: "/dashboard",
    l: "/list",
    s: "/settings/general",
    c: "/compare",
};

/**
 * Work out what a key press means, given the key pressed before it.
 * "g" waits for a second key. Other keys act at once.
 * @param key The key from the keydown event
 * @param pendingPrefix "g" if the previous key was "g", otherwise null
 * @returns The action to run (or null) and the prefix to remember for the next key
 */
export function resolveShortcut(
    key: string,
    pendingPrefix: string | null
): { action: ShortcutAction | null; pendingPrefix: string | null } {
    if (pendingPrefix === "g") {
        const path = GO_TO[key];
        return { action: path ? { type: "route", path } : null, pendingPrefix: null };
    }
    if (key === "g") {
        return { action: null, pendingPrefix: "g" };
    }
    if (key === "/") {
        return { action: { type: "focus-search" }, pendingPrefix: null };
    }
    if (key === "n") {
        return { action: { type: "route", path: "/add" }, pendingPrefix: null };
    }
    if (key === "?") {
        return { action: { type: "help" }, pendingPrefix: null };
    }
    return { action: null, pendingPrefix: null };
}
