import { rolldown } from "rolldown";
import path from "node:path";
import type { ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { emptyDir } from "../utils/fs.js";
import { scriptOutDir, scriptOutFile, srcEntry } from "../utils/path.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";

function buildExternal(config: ResolvedConfig): (string | RegExp)[] {
    const external = [...config.build.external];
    if (config.build.externalDependencies) {
        const existingStrings = new Set(
            external.filter((item): item is string => typeof item === "string")
        );
        for (const [packageName, entry] of Object.entries(createDependencyCatalog(config))) {
            if (entry.kind === "manifest" && !existingStrings.has(packageName)) {
                external.push(packageName);
                existingStrings.add(packageName);
            }
        }
    }
    return external;
}

export async function runRolldown(cwd: string, config: ResolvedConfig): Promise<void> {
    try {
        await emptyDir(scriptOutDir(cwd, config));
        const bundle = await rolldown({
            input: srcEntry(cwd, config),
            external: buildExternal(config),
            onwarn(warning, warn) {
                if (warning.code === "CIRCULAR_DEPENDENCY") return;
                warn(warning);
            },
            experimental: {
                attachDebugInfo: config.build.preserveModules ? "none" : "simple",
            },
        });
        if (config.build.preserveModules) {
            await bundle.write({
                dir: scriptOutDir(cwd, config),
                format: "esm",
                preserveModules: true,
                preserveModulesRoot: path.dirname(srcEntry(cwd, config)),
                entryFileNames: "[name].js",
            });
        } else {
            await bundle.write({
                file: scriptOutFile(cwd, config),
                format: "esm",
            });
        }
        await bundle.close();
    } catch (cause) {
        throw new BePackError(
            "BUILD_FAILED",
            `rolldown failed: ${cause instanceof Error ? cause.message : String(cause)}`
        );
    }
}
