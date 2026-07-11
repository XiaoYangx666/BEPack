import path from "node:path";
import type { PackType, ResolvedConfig } from "../config/configTypes.js";

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
// Generic pack root resolver (the new canonical API)
// ---------------------------------------------------------------------------

/** Resolve root directory for a given pack type. Returns undefined if pack not configured. */
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
// Legacy helpers (kept for callers that know BP exists)
// These throw when the respective pack is not configured.
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
// Compile-related paths (only valid when BP has compile)
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
    return path.join(bpRoot(cwd, config), "scripts");
}

export function scriptOutFile(cwd: string, config: ResolvedConfig): string | undefined {
    const dir = scriptOutDir(cwd, config);
    if (!dir) return undefined;
    return path.join(dir, "main.js");
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
