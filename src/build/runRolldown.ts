import { rolldown } from "rolldown";
import path from "node:path";
import fs from "node:fs/promises";
import { lstatSync } from "node:fs";
import type { ResolvedConfig } from "../config/configTypes.js";
import type { Logger } from "../logger/logger.js";
import { BePackError } from "../errors/BePackError.js";
import { emptyDir } from "../utils/fs.js";
import {
    scriptOutDir,
    scriptOutFile,
    srcEntry,
    hasBpCompile,
    ensureSafeEmptyDir,
    bpRoot,
    packRoot,
    projectRoot,
    containsPath,
} from "../utils/path.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";
import { createReplacePlugin } from "./replace.js";

function buildExternal(config: ResolvedConfig): (string | RegExp)[] {
    if (!config.packs.bp?.compile) return [];
    const external = [...config.packs.bp.compile.external];
    const existingStrings = new Set(
        external.filter((item): item is string => typeof item === "string")
    );
    for (const [packageName, entry] of Object.entries(createDependencyCatalog(config))) {
        if (entry.manifest && !existingStrings.has(packageName)) {
            external.push(packageName);
            existingStrings.add(packageName);
        }
    }
    return external;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function assertNoSymlinkInOutputPath(bpRootDir: string, outDir: string): void {
    const resolvedRoot = path.resolve(bpRootDir);
    const resolvedOut = path.resolve(outDir);
    const relative = path.relative(resolvedRoot, resolvedOut);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;

    // Check BP root itself is not a symlink or junction. A symlink at the
    // root means emptyDir() would delete through it to the real target.
    try {
        if (lstatSync(resolvedRoot).isSymbolicLink()) {
            throw new BePackError(
                "BUILD_FAILED",
                `Safety check failed: BP root is a symbolic link or junction: "${resolvedRoot}". ` +
                    "Refusing to recursively delete through a symbolic link."
            );
        }
    } catch (error: unknown) {
        if (error instanceof BePackError) throw error;
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") return; // BP root not yet created — nothing to traverse
        throw error;
    }

    let current = resolvedRoot;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        try {
            if (lstatSync(current).isSymbolicLink()) {
                throw new BePackError(
                    "BUILD_FAILED",
                    `Safety check failed: script output path contains a symbolic link: "${current}". ` +
                        "Refusing to recursively delete through a symbolic link."
                );
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
            throw error;
        }
    }
}

function assertNoStrictPathOverlap(outDir: string, protectedPath: string, label: string): void {
    const resolvedOut = path.resolve(outDir);
    const resolvedProtected = path.resolve(protectedPath);
    if (
        containsPath(resolvedOut, resolvedProtected) ||
        containsPath(resolvedProtected, resolvedOut)
    ) {
        throw new BePackError(
            "BUILD_FAILED",
            `Safety check failed: script output directory "${outDir}" overlaps ${label} ` +
                `"${protectedPath}". Refusing to empty this directory.`
        );
    }
}

export function assertSafeScriptOutputPath(
    cwd: string,
    config: ResolvedConfig,
    entry: string,
    outDir: string
): void {
    const root = projectRoot(cwd, config);
    const bpRootDir = bpRoot(cwd, config);
    const manifestPath = path.join(bpRootDir, "manifest.json");
    const gitPaths = [path.join(root, ".git"), path.join(bpRootDir, ".git")];

    for (const gitPath of gitPaths) {
        assertNoStrictPathOverlap(outDir, gitPath, ".git metadata");
    }

    if (config.packs.rp) {
        const rpRootDir = packRoot(root, config, "rp")!;
        if (path.resolve(rpRootDir) !== path.resolve(bpRootDir)) {
            assertNoStrictPathOverlap(outDir, rpRootDir, "RP root");
        }
    }

    assertNoStrictPathOverlap(outDir, manifestPath, "BP manifest");

    const sourceDir = path.dirname(entry);
    const sourceRelative = path.relative(bpRootDir, sourceDir);
    const protectedPaths =
        sourceRelative && !sourceRelative.startsWith("..") && !path.isAbsolute(sourceRelative)
            ? [sourceDir]
            : [];

    ensureSafeEmptyDir(outDir, bpRootDir, "script output directory", protectedPaths);
    assertNoSymlinkInOutputPath(bpRootDir, outDir);
}

export async function runRolldown(
    cwd: string,
    config: ResolvedConfig,
    logger?: Logger
): Promise<void> {
    if (!hasBpCompile(config)) {
        throw new BePackError(
            "BUILD_FAILED",
            "rolldown requires packs.bp.compile to be configured."
        );
    }

    const entry = srcEntry(cwd, config);
    const outDir = scriptOutDir(cwd, config);
    const outFile = scriptOutFile(cwd, config);
    if (!entry || !outDir || !outFile) {
        throw new BePackError(
            "BUILD_FAILED",
            "rolldown requires a valid compile entry and output directory."
        );
    }

    try {
        assertSafeScriptOutputPath(cwd, config, entry, outDir);
        await emptyDir(outDir);
        const bundle = await rolldown({
            input: entry,
            external: buildExternal(config),
            plugins: [createReplacePlugin(config)],
            onwarn(warning, warn) {
                if (warning.code === "CIRCULAR_DEPENDENCY") return;
                warn(warning);
            },
            experimental: {
                attachDebugInfo: config.packs.bp!.compile!.preserveModules ? "none" : "simple",
            },
        });
        if (config.packs.bp!.compile!.preserveModules) {
            await bundle.write({
                dir: outDir,
                format: "esm",
                preserveModules: true,
                preserveModulesRoot: path.dirname(entry),
                entryFileNames: "[name].js",
                minify: config.packs.bp!.compile!.minify,
            });
        } else {
            await bundle.write({
                file: outFile,
                format: "esm",
                minify: config.packs.bp!.compile!.minify,
            });
        }
        await bundle.close();
        await printStats(outDir, logger);
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
