import { rolldown } from "rolldown";
import path from "node:path";
import fs from "node:fs/promises";
import type { ResolvedConfig } from "../config/configTypes.js";
import type { Logger } from "../logger/logger.js";
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
            if (entry.manifest && !existingStrings.has(packageName)) {
                external.push(packageName);
                existingStrings.add(packageName);
            }
        }
    }
    return external;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function runRolldown(
    cwd: string,
    config: ResolvedConfig,
    logger?: Logger
): Promise<void> {
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
                minify: config.build.minify,
            });
        } else {
            await bundle.write({
                file: scriptOutFile(cwd, config),
                format: "esm",
                minify: config.build.minify,
            });
        }
        await bundle.close();
        await printStats(scriptOutDir(cwd, config), logger);
    } catch (cause) {
        throw new BePackError(
            "BUILD_FAILED",
            `rolldown failed: ${cause instanceof Error ? cause.message : String(cause)}`
        );
    }
}

async function printStats(dir: string, logger?: Logger): Promise<void> {
    const entries: { path: string; size: number }[] = [];
    async function walk(current: string) {
        const items = await fs.readdir(current, { withFileTypes: true });
        for (const item of items) {
            const full = path.join(current, item.name);
            if (item.isDirectory()) await walk(full);
            else if (item.isFile() && item.name.endsWith(".js")) {
                const stat = await fs.stat(full);
                entries.push({ path: path.relative(dir, full), size: stat.size });
            }
        }
    }
    await walk(dir);
    if (entries.length === 0) return;
    entries.sort((a, b) => b.size - a.size);
    const total = entries.reduce((sum, e) => sum + e.size, 0);
    logger?.rolldown(
        entries.length === 1
            ? `${entries[0]!.path} (${formatSize(entries[0]!.size)})`
            : `${entries.length} files, total ${formatSize(total)}`
    );
}
