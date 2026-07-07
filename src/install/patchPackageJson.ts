import path from "node:path";
import { FIXED_PATHS } from "../constants/paths.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { pathExists, readJsonFile, writeJsonFile } from "../utils/fs.js";
import type { ResolvedDependency } from "./DependencyService.js";

type PackageJson = Record<string, any>;

export async function patchPackageJson(
    cwd: string,
    config: ResolvedConfig,
    deps: Record<string, ResolvedDependency>,
    dryRun = false
) {
    const file = path.join(cwd, "package.json");
    if (!(await pathExists(file)))
        throw new BePackError("PACKAGE_JSON_NOT_FOUND", "package.json not found.", {
            details: { cwd },
        });
    const pkg = await readJsonFile<PackageJson>(file);
    const saveTo = config.install.saveTo;
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.devDependencies = pkg.devDependencies ?? {};
    for (const name of Object.keys(deps)) {
        delete pkg.dependencies[name];
        delete pkg.devDependencies[name];
    }
    pkg[saveTo] = pkg[saveTo] ?? {};
    for (const [name, dep] of Object.entries(deps)) {
        pkg[saveTo][name] = dep.packageVersion;
    }
    if (!Object.keys(pkg.dependencies).length) delete pkg.dependencies;
    if (!Object.keys(pkg.devDependencies).length) delete pkg.devDependencies;
    if (!dryRun) await writeJsonFile(file, pkg);
    return { updated: true, path: "package.json", scriptOutFile: FIXED_PATHS.scriptOutFile };
}
