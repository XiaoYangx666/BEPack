import path from "node:path";
import { promises as fs } from "node:fs";
import { pathExists } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";
import { normalizeManifest } from "../manifest/normalize.js";
import type { Manifest } from "../manifest/types.js";
import { BUILTIN_DEPENDENCY_CATALOG } from "../constants/dependencyCatalog.js";

/** Read and parse a manifest.json file. */
export async function readManifest(filePath: string): Promise<Manifest> {
    if (!(await pathExists(filePath))) {
        throw new BePackError("CONFIG_NOT_FOUND", `Manifest not found: ${filePath}`, {
            details: { path: filePath },
        });
    }
    const raw = await fs.readFile(filePath, "utf8");
    try {
        return normalizeManifest(JSON.parse(raw));
    } catch {
        throw new BePackError("MANIFEST_INVALID", `Invalid JSON in manifest: ${filePath}`);
    }
}

/** Validate manifest has the required fields for reverse-engineering. */
export function validateManifestHeader(
    manifest: Manifest,
    label: string
): { name: string; uuid: string; description?: string } {
    if (!manifest.header?.name || !manifest.header?.uuid) {
        throw new BePackError(
            "MANIFEST_INVALID",
            `${label} manifest is missing header.name or header.uuid`
        );
    }
    return {
        name: manifest.header.name,
        uuid: manifest.header.uuid,
        ...(manifest.header.description ? { description: manifest.header.description } : {}),
    };
}

/** Find the script module UUID from a BP manifest. */
export function findScriptModuleUuid(manifest: Manifest): string | undefined {
    for (const mod of manifest.modules ?? []) {
        if (mod?.type === "script" && mod?.language === "javascript") {
            return mod.uuid;
        }
    }
    return undefined;
}

/** Find the resources module UUID from an RP manifest. */
export function findResourcesModuleUuid(manifest: Manifest): string | undefined {
    for (const mod of manifest.modules ?? []) {
        if (mod?.type === "resources") return mod.uuid;
    }
    return undefined;
}

/**
 * Derive pack root from a manifest path, relative to cwd.
 * Throws if the path is outside cwd.
 */
export function derivePackRoot(cwd: string, manifestPath: string): string {
    const abs = path.resolve(cwd, manifestPath);
    const dir = path.dirname(abs);
    if (!dir.startsWith(cwd)) {
        throw new BePackError(
            "CONFIG_INVALID",
            `Manifest path is outside the project directory: ${manifestPath}`
        );
    }
    const rel = path.relative(cwd, dir);
    return rel || ".";
}

/** Extract BePack-managed dependencies (module_name deps in the built-in catalog). */
export function matchDependencies(manifest: Manifest): Record<string, string> {
    const deps: Record<string, string> = {};
    for (const dep of manifest.dependencies ?? []) {
        if ("module_name" in dep && typeof dep.module_name === "string") {
            const name = dep.module_name;
            if (BUILTIN_DEPENDENCY_CATALOG[name]) {
                deps[name] = typeof dep.version === "string" ? dep.version : String(dep.version);
            }
        }
    }
    return deps;
}
