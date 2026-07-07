import path from "node:path";
import { pathExists, readJsonFile } from "../utils/fs.js";
import type { PackageManager } from "../config/configTypes.js";

export async function detectPackageManager(cwd: string, configured: PackageManager): Promise<Exclude<PackageManager, "auto">> {
    if (configured !== "auto") return configured;
    const pkgPath = path.join(cwd, "package.json");
    if (await pathExists(pkgPath)) {
        const pkg = await readJsonFile<{ packageManager?: string }>(pkgPath);
        const name = pkg.packageManager?.split("@")[0];
        if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") return name;
    }
    if (await pathExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (await pathExists(path.join(cwd, "yarn.lock"))) return "yarn";
    if (await pathExists(path.join(cwd, "bun.lock"))) return "bun";
    if (await pathExists(path.join(cwd, "bun.lockb"))) return "bun";
    return "npm";
}
