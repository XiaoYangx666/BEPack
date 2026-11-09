import { AddonError } from "./errors.js";
import type { Manifest } from "./manifest.js";
import {
    isManifestPath,
    manifestPathForRoot,
    normalizePackRoot,
    packRootOfManifest,
} from "./path.js";

export type PackKind = "bp" | "rp";

export interface PackRef {
    readonly kind: PackKind;
    readonly root: string;
    readonly manifestPath: string;
    readonly manifest: Manifest;
}

export interface AddonPacks {
    readonly bp?: PackRef;
    readonly rp?: PackRef;
}

export interface DiscoverPacksOptions {
    /** Explicit behavior pack root, e.g. `"bp"` or `"behavior_packs/my_bp"`. */
    readonly bpRoot?: string;
    /** Explicit resource pack root. */
    readonly rpRoot?: string;
    /** Skip missing explicit roots instead of throwing (used when refreshing). */
    readonly allowMissing?: boolean;
}

/**
 * Find the behavior/resource packs in an addon file map.
 *
 * Packs are classified by `modules[].type` first (`script` -> BP,
 * `resources` -> RP). Data-only packs without modules fall back to path
 * segments such as `bp`, `behavior_pack`, `rp`, `resource_pack`. Pass explicit
 * roots when the archive uses unusual folder names.
 */
export function discoverPacks(
    files: ReadonlyMap<string, Uint8Array>,
    options: DiscoverPacksOptions = {}
): AddonPacks {
    if (
        options.bpRoot !== undefined &&
        options.rpRoot !== undefined &&
        normalizePackRoot(options.bpRoot) === normalizePackRoot(options.rpRoot)
    ) {
        throw new AddonError("ADDON_PATH_INVALID", "bpRoot and rpRoot must be different folders.");
    }

    const found: { bp?: PackRef; rp?: PackRef } = {};
    const claimed = new Set<string>();

    for (const [kind, rootInput] of [
        ["bp", options.bpRoot],
        ["rp", options.rpRoot],
    ] as const) {
        if (rootInput === undefined) continue;
        const root = normalizePackRoot(rootInput);
        const manifestPath = manifestPathForRoot(root);
        claimed.add(manifestPath);
        const bytes = files.get(manifestPath);
        if (!bytes) {
            if (options.allowMissing) continue;
            throw new AddonError("ADDON_MANIFEST_MISSING", `Missing ${manifestPath}.`, {
                suggestions: ["Check bpRoot/rpRoot or the template archive."],
            });
        }
        found[kind] = {
            kind,
            root,
            manifestPath,
            manifest: parseManifest(bytes, manifestPath),
        };
    }

    const manifestPaths = [...files.keys()].filter(isManifestPath).sort();
    for (const manifestPath of manifestPaths) {
        if (claimed.has(manifestPath)) continue;
        const bytes = files.get(manifestPath);
        if (!bytes) continue;
        const manifest = parseManifest(bytes, manifestPath);
        const kind = classifyManifest(manifest, manifestPath);
        if (!kind) {
            throw new AddonError(
                "ADDON_PACK_KIND_UNKNOWN",
                `Cannot tell whether ${manifestPath} is a behavior or resource pack.`,
                {
                    suggestions: [
                        "Give the pack a script/resources module, or pass bpRoot/rpRoot explicitly.",
                    ],
                }
            );
        }
        if (found[kind]) {
            throw new AddonError(
                "ADDON_PACK_DUPLICATE",
                `The addon contains more than one ${kind === "bp" ? "behavior" : "resource"} pack.`,
                { details: { first: found[kind]!.manifestPath, second: manifestPath } }
            );
        }
        found[kind] = {
            kind,
            root: packRootOfManifest(manifestPath),
            manifestPath,
            manifest,
        };
    }

    if (!found.bp && !found.rp && !options.allowMissing) {
        throw new AddonError(
            "ADDON_MANIFEST_MISSING",
            "The addon archive does not contain a manifest.json."
        );
    }

    return {
        ...(found.bp ? { bp: found.bp } : {}),
        ...(found.rp ? { rp: found.rp } : {}),
    };
}

export function parseManifest(bytes: Uint8Array, manifestPath: string): Manifest {
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
        throw new AddonError(
            "ADDON_MANIFEST_INVALID",
            `${manifestPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`
        );
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new AddonError("ADDON_MANIFEST_INVALID", `${manifestPath} must be a JSON object.`);
    }
    const record = value as Record<string, unknown>;
    if (record.format_version !== undefined && typeof record.format_version !== "number") {
        throw new AddonError(
            "ADDON_MANIFEST_INVALID",
            `${manifestPath}.format_version must be a number.`
        );
    }
    return value as Manifest;
}

export function classifyManifest(manifest: Manifest, manifestPath: string): PackKind | undefined {
    if (manifest.modules !== undefined && !Array.isArray(manifest.modules)) {
        throw new AddonError("ADDON_MANIFEST_INVALID", `${manifestPath}.modules must be an array.`);
    }
    const modules = manifest.modules ?? [];
    const hasScript = modules.some((module) => module?.type === "script");
    const hasResources = modules.some((module) => module?.type === "resources");
    if (hasScript && !hasResources) return "bp";
    if (hasResources && !hasScript) return "rp";
    if (hasScript && hasResources) {
        throw new AddonError(
            "ADDON_PACK_KIND_UNKNOWN",
            `${manifestPath} contains both script and resources modules.`,
            { suggestions: ["Pass bpRoot/rpRoot explicitly."] }
        );
    }
    return classifyByPath(manifestPath);
}

const BP_SEGMENTS = new Set([
    "bp",
    "behavior",
    "behavior_pack",
    "behavior_packs",
    "behaviour",
    "behaviour_pack",
    "behaviour_packs",
]);
const RP_SEGMENTS = new Set(["rp", "resource", "resource_pack", "resource_packs", "resources"]);

function classifyByPath(manifestPath: string): PackKind | undefined {
    const segments = packRootOfManifest(manifestPath)
        .split("/")
        .filter(Boolean)
        .map((segment) => segment.toLowerCase());
    const isBp = segments.some((segment) => BP_SEGMENTS.has(segment));
    const isRp = segments.some((segment) => RP_SEGMENTS.has(segment));
    if (isBp && !isRp) return "bp";
    if (isRp && !isBp) return "rp";
    return undefined;
}
