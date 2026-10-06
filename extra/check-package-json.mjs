import { readFileSync } from "node:fs";

// Read as text: JSON import attributes need a newer Node and a newer ESLint parser
const packageJSON = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

let hasError = false;

for (const dep in packageJSON.dependencies) {
    const semver = packageJSON.dependencies[dep];
    if (semver.startsWith("^")) {
        console.error(`Dependency ${dep} has a caret (^) in its version. Please change it to (~)`);
        hasError = true;
    }
}

if (hasError) {
    process.exit(1);
} else {
    console.log("All dependencies are valid.");
}
