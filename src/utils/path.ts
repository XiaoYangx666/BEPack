import path from "node:path";
import { statSync } from "node:fs";
import { platform } from "node:os";
import type { PackType, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { DEFAULT_BP_INCLUDES, DEFAULT_RP_INCLUDES } from "../constants/copyIncludes.js";

export function resolveFrom(cwd: string, value: string): string {
    return path.isAbsolute(value) ? value : path.join(cwd, value);
}

export function slash(value: string): string {
    return value.replace(/\\/g, "/");
}

export function projectRoot(cwd: string, config: ResolvedConfig): string {
    return resolveFrom(cwd, config.root);
}

// ---------------------------------------------------------------------------
// Generic pack root resolver
// ---------------------------------------------------------------------------

export function packRoot(
    projectRootDir: string,
    config: ResolvedConfig,
    packType: PackType
): string | undefined {
    if (packType === "bp") {
        return config.packs.bp ? resolveFrom(projectRootDir, config.packs.bp.root) : undefined;
    }
    return config.packs.rp ? resolveFrom(projectRootDir, config.packs.rp.root) : undefined;
}

// ---------------------------------------------------------------------------
// Pack root helpers (throw when not configured)
// ---------------------------------------------------------------------------

export function bpRoot(cwd: string, config: ResolvedConfig): string {
    const root = packRoot(projectRoot(cwd, config), config, "bp");
    if (!root) throw new Error("packs.bp is not configured");
    return root;
}

export function rpRoot(cwd: string, config: ResolvedConfig): string {
    const root = packRoot(projectRoot(cwd, config), config, "rp");
    if (!root) throw new Error("packs.rp is not configured");
    return root;
}

// ---------------------------------------------------------------------------
// Compile-related paths
// ---------------------------------------------------------------------------

export function hasBpCompile(config: ResolvedConfig): boolean {
    return !!config.packs.bp?.compile;
}

export function srcEntry(cwd: string, config: ResolvedConfig): string | undefined {
    if (!config.packs.bp?.compile) return undefined;
    return resolveFrom(projectRoot(cwd, config), config.packs.bp.compile.entry);
}

export function scriptOutDir(cwd: string, config: ResolvedConfig): string | undefined {
    if (!config.packs.bp) return undefined;
    const outputDir = config.packs.bp.compile?.scriptOutputDir ?? "scripts";
    return path.join(bpRoot(cwd, config), outputDir);
}

export function scriptOutFile(cwd: string, config: ResolvedConfig): string | undefined {
    const dir = scriptOutDir(cwd, config);
    if (!dir) return undefined;
    if (!config.packs.bp?.compile) return path.join(dir, "main.js");
    const basename = path.basename(
        config.packs.bp.compile.entry,
        path.extname(config.packs.bp.compile.entry)
    );
    return path.join(dir, `${basename}.js`);
}

// ---------------------------------------------------------------------------
// Path containment helper
// ---------------------------------------------------------------------------

/**
 * Check whether `parent` is equal to or a strict ancestor of `child`.
 * Both must be absolute, resolved paths.
 */
export function containsPath(parent: string, child: string): boolean {
    const rel = path.relative(parent, child);
    return (
        rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
    );
}

// ---------------------------------------------------------------------------
// Script output directory safety validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalize scriptOutputDir.
 *
 * - Normalizes backslash/forward-slash separators FIRST, then validates.
 * - Rejects empty, ".", "..", absolute paths, path escape, bp-root overlap.
 * - Checks that the output dir does not dangerously overlap with
 *   the source entry directory (srcEntryDir must be an absolute path).
 *
 * Returns the normalized relative POSIX path (forward slashes).
 */
export function validateScriptOutputDir(
    bpRootDir: string,
    scriptOutputDir: string,
    srcEntryDir?: string
): string {
    if (!scriptOutputDir || scriptOutputDir === ".") {
        throw new BePackError(
            "CONFIG_INVALID",
            `compile.scriptOutputDir must be a non-empty relative path strictly inside the BP root. ` +
                `Got: "${scriptOutputDir}". This directory will be emptied during build.`
        );
    }

    // Normalize separators FIRST, then validate — so validator sees the same
    // path that will actually be used at runtime.
    const portable = scriptOutputDir.replace(/\\/g, "/");

    // Cross-platform absolute path check
    if (path.posix.isAbsolute(portable) || path.win32.isAbsolute(portable)) {
        throw new BePackError(
            "CONFIG_INVALID",
            `compile.scriptOutputDir must be a relative path, not absolute. ` +
                `Got: "${scriptOutputDir}". This directory will be emptied during build.`
        );
    }

    // Normalize "foo/../bar" → "bar"
    const normalized = path.posix.normalize(portable);

    // Reject path escape via ".."
    if (normalized.split("/").includes("..")) {
        throw new BePackError(
            "CONFIG_INVALID",
            `compile.scriptOutputDir must not contain ".." (path escape). ` +
                `Got: "${scriptOutputDir}" resolves outside the BP root. ` +
                `This directory will be emptied during build.`
        );
    }

    // Use OS-native resolve for the final path
    const resolved = path.resolve(bpRootDir, normalized);
    const relative = path.relative(bpRootDir, resolved);

    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new BePackError(
            "CONFIG_INVALID",
            `compile.scriptOutputDir must be a directory strictly inside the BP root. ` +
                `Value: "${scriptOutputDir}", resolved: "${resolved}". ` +
                `This directory will be emptied during build and must not be the BP root ` +
                `or a path outside it.`
        );
    }

    // Check overlap with source entry directory (srcEntryDir is already absolute)
    if (srcEntryDir && containsPath(resolved, srcEntryDir)) {
        throw new BePackError(
            "CONFIG_INVALID",
            `compile.scriptOutputDir "${scriptOutputDir}" dangerously overlaps with ` +
                `the source entry directory. ` +
                `The output directory will be emptied during build and would delete source files.`
        );
    }

    // Return normalized relative POSIX path (forward slashes)
    return slash(relative);
}

/**
 * Runtime safety guard: verify that `dir` is a subdirectory of `bpRoot` before emptying.
 *
 * Checks that:
 * 1. The resolved dir is not equal to or a parent of any protected path.
 * 2. The resolved dir is strictly inside the BP root.
 * 3. If the dir exists, it is a directory (not a file).
 *
 * This catches hooks that modify config, or any code path calling emptyDir()
 * with an uncontrolled value.
 *
 * Uses containsPath() for containment checks — rejecting when the dir
 * IS or CONTAINS a protected path.
 */
export function ensureSafeEmptyDir(
    dir: string,
    bpRootDir: string,
    label: string,
    extraProtected: string[] = []
): void {
    const resolvedDir = path.resolve(dir);
    const resolvedBpRoot = path.resolve(bpRootDir);

    // Collect all protected absolute paths (resolved)
    const protectedPaths = [resolvedBpRoot, ...extraProtected.map((p) => path.resolve(p))];

    // Use containsPath to check if output dir equals or is a parent of any protected path.
    // If output dir CONTAINS a protected path (e.g. output=bp/generated, protected=bp/generated/src),
    // emptying the output dir would destroy the protected path.
    for (const protectedPath of protectedPaths) {
        if (containsPath(resolvedDir, protectedPath)) {
            throw new BePackError(
                "BUILD_FAILED",
                `Safety check failed: ${label} "${dir}" would overwrite a protected path ` +
                    `("${protectedPath}"). Refusing to empty this directory.`
            );
        }
    }

    // Refuse if dir exists but is not a directory
    try {
        const st = statSync(resolvedDir);
        if (!st.isDirectory()) {
            throw new BePackError(
                "BUILD_FAILED",
                `Safety check failed: ${label} "${dir}" is not a directory. ` +
                    `Refusing to empty a non-directory path.`
            );
        }
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
            throw err;
        }
    }

    // Verify dir is inside BP root
    const rel = path.relative(resolvedBpRoot, resolvedDir);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new BePackError(
            "BUILD_FAILED",
            `Safety check failed: ${label} "${dir}" is not inside the BP root "${bpRootDir}". ` +
                `Refusing to empty this directory.`
        );
    }
}

// ---------------------------------------------------------------------------
// Unified BP include items
// ---------------------------------------------------------------------------

export function getBpIncludeItems(config: ResolvedConfig): string[] {
    const scriptDir = config.packs.bp?.compile?.scriptOutputDir ?? "scripts";
    const defaults = [scriptDir, ...DEFAULT_BP_INCLUDES.filter((item) => item !== "scripts")];
    const userItems = config.packs.bp?.include ?? [];
    const all = [...defaults, ...userItems];
    const seen = new Set<string>();
    return all.filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
    });
}

// ---------------------------------------------------------------------------
// Manifest paths
// ---------------------------------------------------------------------------

export function bpManifest(cwd: string, config: ResolvedConfig): string | undefined {
    if (!config.packs.bp) return undefined;
    return path.join(bpRoot(cwd, config), "manifest.json");
}

export function rpManifest(cwd: string, config: ResolvedConfig): string | undefined {
    if (!config.packs.rp) return undefined;
    return path.join(rpRoot(cwd, config), "manifest.json");
}

// ---------------------------------------------------------------------------
// Output paths
// ---------------------------------------------------------------------------

export function distRoot(cwd: string, config: ResolvedConfig): string {
    return resolveFrom(projectRoot(cwd, config), config.pack.outDir);
}

// ---------------------------------------------------------------------------
// Platform-aware path deduplication
// ---------------------------------------------------------------------------

const _isCaseSensitive = platform() !== "win32";

export function deduplicatePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    return paths.filter((p) => {
        const key = slash(path.resolve(p));
        const normalized = _isCaseSensitive ? key : key.toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}
