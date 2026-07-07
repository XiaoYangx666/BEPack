import path from "node:path";
import type { ResolvedConfig } from "../config/configTypes.js";

export function resolveFrom(cwd: string, value: string): string {
    return path.isAbsolute(value) ? value : path.join(cwd, value);
}

export function slash(value: string): string {
    return value.replace(/\\/g, "/");
}

export function projectRoot(cwd: string, config: ResolvedConfig): string {
    return resolveFrom(cwd, config.root);
}

export function srcEntry(cwd: string, config: ResolvedConfig): string {
    return resolveFrom(projectRoot(cwd, config), config.build.entry);
}

export function bpRoot(cwd: string, config: ResolvedConfig): string {
    return resolveFrom(projectRoot(cwd, config), config.packs.bp.root);
}

export function rpRoot(cwd: string, config: ResolvedConfig): string {
    return resolveFrom(projectRoot(cwd, config), config.packs.rp?.root ?? "rp");
}

export function distRoot(cwd: string, config: ResolvedConfig): string {
    return resolveFrom(projectRoot(cwd, config), config.pack.outDir);
}

export function scriptOutDir(cwd: string, config: ResolvedConfig): string {
    return path.join(bpRoot(cwd, config), "scripts");
}

export function scriptOutFile(cwd: string, config: ResolvedConfig): string {
    return path.join(scriptOutDir(cwd, config), "main.js");
}

export function bpManifest(cwd: string, config: ResolvedConfig): string {
    return path.join(bpRoot(cwd, config), "manifest.json");
}

export function rpManifest(cwd: string, config: ResolvedConfig): string {
    return path.join(rpRoot(cwd, config), "manifest.json");
}
