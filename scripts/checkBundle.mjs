// `@bepack/addon` is a devDependency that must be inlined into the published
// CLI bundle. If rolldown ever externalizes it, installed users would get
// "Cannot find package '@bepack/addon'" at runtime, so fail the build instead.
import { readFileSync } from "node:fs";

const bundles = ["dist/index.js", "dist/cli.js"];
const specifier = /["']@bepack\/addon(?:\/[^"']*)?["']/;

let failed = false;
for (const file of bundles) {
    const source = readFileSync(file, "utf8");
    if (specifier.test(source)) {
        console.error(
            `${file} still references @bepack/addon as an external module. ` +
                "It must stay bundled because it is a devDependency."
        );
        failed = true;
    }
}

if (failed) process.exit(1);
console.log(`✓ ${bundles.join(", ")} bundle @bepack/addon`);
