import { AddonError } from "./errors.js";
import {
    asRecord,
    coerceVersionForFormat,
    formatVersionOf,
    generateUuid,
    optionalString,
    parseUuid,
    parseVersion,
    requiredString,
    type ManifestModule,
    type ManifestVersion,
} from "./manifest.js";
import type { AddonPacks, PackKind, PackRef } from "./packs.js";

export interface PackIdentity {
    readonly kind: PackKind;
    readonly name: string;
    readonly description: string;
    readonly version: ManifestVersion;
    readonly headerUuid: string;
    readonly moduleUuids: readonly string[];
}

export interface AddonIdentity {
    readonly name: string;
    readonly description: string;
    readonly version: ManifestVersion;
    readonly behaviorPack?: PackIdentity;
    readonly resourcePack?: PackIdentity;
}

export interface UpdateIdentityOptions {
    /** Applies to both packs unless a pack-specific value is provided. */
    readonly name?: string;
    readonly description?: string;
    /** Applies to both packs; converted to each manifest's version format. */
    readonly version?: ManifestVersion;

    readonly behaviorName?: string;
    readonly behaviorDescription?: string;
    readonly resourceName?: string;
    readonly resourceDescription?: string;

    /** Replace header and managed module UUIDs with fresh values. */
    readonly randomizeUuids?: boolean;
    readonly behaviorHeaderUuid?: string;
    readonly behaviorModuleUuids?: readonly string[];
    readonly resourceHeaderUuid?: string;
    readonly resourceModuleUuids?: readonly string[];

    /** Also update managed module versions. Defaults to false to preserve templates. */
    readonly updateModuleVersions?: boolean;
}

export interface UpdateIdentityResult {
    readonly identity: AddonIdentity;
    /** Old UUID (lowercase) -> new UUID. Useful for patching generated script text. */
    readonly uuidMap: ReadonlyMap<string, string>;
}

/** Modules BePack considers managed for a pack kind (script for BP, resources for RP). */
export function managedModules(pack: PackRef): readonly ManifestModule[] {
    if (pack.manifest.modules === undefined) return [];
    if (!Array.isArray(pack.manifest.modules)) {
        throw new AddonError(
            "ADDON_MANIFEST_INVALID",
            `${pack.manifestPath}.modules must be an array.`
        );
    }
    const modules = pack.manifest.modules.map((module, index) => {
        if (!module || typeof module !== "object" || Array.isArray(module)) {
            throw new AddonError(
                "ADDON_MANIFEST_INVALID",
                `${pack.manifestPath}.modules[${index}] must be an object.`
            );
        }
        return module;
    });
    const preferred = pack.kind === "bp" ? "script" : "resources";
    const selected = modules.filter((module) => module.type === preferred);
    return selected.length > 0 ? selected : modules;
}

export function readPackIdentity(pack: PackRef): PackIdentity {
    const header = asRecord(pack.manifest.header, `${pack.manifestPath}.header`);
    if (pack.manifest.dependencies !== undefined && !Array.isArray(pack.manifest.dependencies)) {
        throw new AddonError(
            "ADDON_MANIFEST_INVALID",
            `${pack.manifestPath}.dependencies must be an array.`
        );
    }
    const formatVersion = formatVersionOf(pack.manifest);
    const name = requiredString(header.name, `${pack.manifestPath}.header.name`);
    const description = optionalString(
        header.description,
        `${pack.manifestPath}.header.description`
    );
    const version = parseVersion(
        header.version,
        formatVersion,
        `${pack.manifestPath}.header.version`
    );
    const headerUuid = parseUuid(header.uuid, `${pack.manifestPath}.header.uuid`);
    const moduleUuids = managedModules(pack).map((module, index) =>
        parseUuid(module.uuid, `${pack.manifestPath}.modules[${index}].uuid`)
    );
    const uuids = [headerUuid, ...moduleUuids];
    if (new Set(uuids).size !== uuids.length) {
        throw new AddonError(
            "ADDON_IDENTITY_INVALID",
            `${pack.manifestPath} reuses the same UUID for its header and modules.`
        );
    }
    return { kind: pack.kind, name, description, version, headerUuid, moduleUuids };
}

export function readIdentity(packs: AddonPacks): AddonIdentity {
    const bp = packs.bp ? readPackIdentity(packs.bp) : undefined;
    const rp = packs.rp ? readPackIdentity(packs.rp) : undefined;
    const primary = bp ?? rp;
    if (!primary) {
        throw new AddonError(
            "ADDON_MANIFEST_MISSING",
            "The addon has no behavior or resource pack manifest."
        );
    }
    return {
        name: primary.name,
        description: primary.description,
        version: primary.version,
        ...(bp ? { behaviorPack: bp } : {}),
        ...(rp ? { resourcePack: rp } : {}),
    };
}

/**
 * Apply a pack identity to the manifests in place.
 *
 * Names/descriptions/versions are written to both packs. When UUIDs change,
 * cross-pack dependency entries are updated too, and their versions are
 * converted to the dependent manifest's format.
 */
export function applyIdentity(
    packs: AddonPacks,
    options: UpdateIdentityOptions = {}
): UpdateIdentityResult {
    const selected = packEntries(packs);
    if (selected.length === 0) {
        throw new AddonError(
            "ADDON_MANIFEST_MISSING",
            "The addon has no behavior or resource pack manifest."
        );
    }

    const targets = new Map<
        PackKind,
        {
            name: string;
            description: string;
            version: ManifestVersion;
            formatVersion: number;
            modules: readonly ManifestModule[];
        }
    >();

    for (const { kind, pack } of selected) {
        const current = readPackIdentity(pack);
        const name = resolveName(kind, options, current.name).trim();
        if (!name) {
            throw new AddonError(
                "ADDON_IDENTITY_INVALID",
                `${kind === "bp" ? "Behavior" : "Resource"} pack name must not be empty.`
            );
        }
        const description = resolveDescription(kind, options, current.description).trim();
        const formatVersion = formatVersionOf(pack.manifest);
        const version =
            options.version === undefined
                ? current.version
                : coerceVersionForFormat(options.version, formatVersion, `${kind} pack version`);
        targets.set(kind, {
            name,
            description,
            version,
            formatVersion,
            modules: managedModules(pack),
        });
    }

    const updates = new Map<PackKind, { header: string; modules: readonly string[] }>();

    for (const { kind, pack } of selected) {
        const current = readPackIdentity(pack);
        const target = targets.get(kind)!;
        const explicitHeader =
            kind === "bp" ? options.behaviorHeaderUuid : options.resourceHeaderUuid;
        const explicitModules =
            kind === "bp" ? options.behaviorModuleUuids : options.resourceModuleUuids;

        if (explicitModules && explicitModules.length !== target.modules.length) {
            throw new AddonError(
                "ADDON_IDENTITY_INVALID",
                `${kind} module UUID count must be ${target.modules.length}, got ${explicitModules.length}.`
            );
        }

        const header =
            explicitHeader === undefined
                ? options.randomizeUuids
                    ? generateUuid()
                    : current.headerUuid
                : parseUuid(explicitHeader, `${kind} header UUID`);

        const modules = target.modules.map((module, index) => {
            const explicit = explicitModules?.[index];
            if (explicit !== undefined) {
                return parseUuid(explicit, `${kind} module UUID ${index + 1}`);
            }
            if (options.randomizeUuids) return generateUuid();
            return current.moduleUuids[index]!;
        });

        updates.set(kind, { header, modules });
    }

    const allNewUuids = [...updates.values()].flatMap(({ header, modules }) => [
        header,
        ...modules,
    ]);
    if (new Set(allNewUuids).size !== allNewUuids.length) {
        throw new AddonError(
            "ADDON_IDENTITY_INVALID",
            "Pack header and module UUIDs must be unique across the addon."
        );
    }

    const uuidMap = new Map<string, string>();
    const ownerVersions = new Map<string, ManifestVersion>();

    for (const { kind, pack } of selected) {
        const current = readPackIdentity(pack);
        const target = targets.get(kind)!;
        const update = updates.get(kind)!;

        uuidMap.set(current.headerUuid, update.header);
        ownerVersions.set(current.headerUuid, target.version);
        for (let index = 0; index < current.moduleUuids.length; index += 1) {
            const oldUuid = current.moduleUuids[index]!;
            uuidMap.set(oldUuid, update.modules[index]!);
            ownerVersions.set(oldUuid, target.version);
        }
    }

    for (const { kind, pack } of selected) {
        const target = targets.get(kind)!;
        const update = updates.get(kind)!;
        const header = asRecord(pack.manifest.header, `${pack.manifestPath}.header`);

        header.name = target.name;
        header.description = target.description;
        header.uuid = update.header;
        header.version = target.version;

        target.modules.forEach((module, index) => {
            module.uuid = update.modules[index]!;
            if (options.updateModuleVersions) {
                module.version = target.version;
            }
        });

        if (Array.isArray(pack.manifest.dependencies)) {
            for (const dependency of pack.manifest.dependencies) {
                if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
                    continue;
                }
                const record = dependency as Record<string, unknown>;
                if (typeof record.uuid !== "string") continue;
                const oldUuid = record.uuid.toLowerCase();
                const newUuid = uuidMap.get(oldUuid);
                if (!newUuid) continue;

                record.uuid = newUuid;
                const ownerVersion = ownerVersions.get(oldUuid);
                if (ownerVersion !== undefined) {
                    record.version = coerceVersionForFormat(
                        ownerVersion,
                        target.formatVersion,
                        `${kind} dependency version`
                    );
                }
            }
        }
    }

    return { identity: readIdentity(packs), uuidMap };
}

function packEntries(packs: AddonPacks): Array<{ kind: PackKind; pack: PackRef }> {
    const result: Array<{ kind: PackKind; pack: PackRef }> = [];
    if (packs.bp) result.push({ kind: "bp", pack: packs.bp });
    if (packs.rp) result.push({ kind: "rp", pack: packs.rp });
    return result;
}

function resolveName(kind: PackKind, options: UpdateIdentityOptions, current: string): string {
    return kind === "bp"
        ? (options.behaviorName ?? options.name ?? current)
        : (options.resourceName ?? options.name ?? current);
}

function resolveDescription(
    kind: PackKind,
    options: UpdateIdentityOptions,
    current: string
): string {
    return kind === "bp"
        ? (options.behaviorDescription ?? options.description ?? current)
        : (options.resourceDescription ?? options.description ?? current);
}
