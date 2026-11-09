import { AddonError } from "./errors.js";
import {
    asRecord,
    coerceVersionForFormat,
    formatVersionOf,
    isVersionTuple,
    optionalString,
    parseUuid,
    requiredString,
    type Manifest,
    type ManifestDependency,
    type ManifestHeader,
    type ManifestModule,
    type ManifestVersion,
} from "./manifest.js";

/** A string matches `module_name` or `uuid` case-insensitively. */
export type DependencyMatcher =
    | string
    | { readonly module_name?: string; readonly uuid?: string }
    | ((dependency: ManifestDependency) => boolean);

/** A string matches `uuid` or `type`. */
export type ModuleMatcher =
    | string
    | { readonly uuid?: string; readonly type?: string }
    | ((module: ManifestModule) => boolean);

export interface UpsertOptions {
    /** Keep the existing entry instead of replacing it. Defaults to false. */
    readonly keepExisting?: boolean;
}

export interface HeaderPatch {
    readonly name?: string;
    readonly description?: string;
    readonly version?: ManifestVersion;
    readonly min_engine_version?: ManifestVersion;
    readonly uuid?: string;
    readonly pack_scope?: string;
    readonly [key: string]: unknown;
}

/**
 * Declarative manifest edit. `header` and `metadata` are merged into the
 * existing values; `dependencies`, `modules`, and `capabilities` replace their
 * arrays. Versions are converted to the manifest's `format_version`.
 */
export interface ManifestPatch {
    readonly header?: HeaderPatch;
    readonly dependencies?: readonly ManifestDependency[];
    readonly modules?: readonly ManifestModule[];
    readonly capabilities?: readonly string[];
    readonly metadata?: Readonly<Record<string, unknown | null>>;
    readonly [key: string]: unknown;
}

/** Mutable dependency array; creates no array when the key is absent. */
export function dependencyList(manifest: Manifest): ManifestDependency[] {
    if (manifest.dependencies === undefined) return [];
    if (!Array.isArray(manifest.dependencies)) {
        throw new AddonError("ADDON_MANIFEST_INVALID", "manifest.dependencies must be an array.");
    }
    return manifest.dependencies;
}

/** Mutable module array; creates no array when the key is absent. */
export function moduleList(manifest: Manifest): ManifestModule[] {
    if (manifest.modules === undefined) return [];
    if (!Array.isArray(manifest.modules)) {
        throw new AddonError("ADDON_MANIFEST_INVALID", "manifest.modules must be an array.");
    }
    return manifest.modules;
}

export function findDependency(
    manifest: Manifest,
    matcher: DependencyMatcher
): ManifestDependency | undefined {
    return dependencyList(manifest).find((dependency) => matchesDependency(dependency, matcher));
}

export function findModule(manifest: Manifest, matcher: ModuleMatcher): ManifestModule | undefined {
    return moduleList(manifest).find((module) => matchesModule(module, matcher));
}

/**
 * Add or replace a dependency.
 *
 * `module_name` dependencies always carry a SemVer string, while `uuid`
 * dependencies use the manifest's version format.
 */
export function addDependency(
    manifest: Manifest,
    dependency: ManifestDependency,
    options: UpsertOptions = {}
): Manifest {
    const normalized = normalizeDependency(manifest, dependency);
    const list = dependencyList(manifest);
    const index = list.findIndex((entry) => sameDependency(entry, normalized));
    if (index === -1) list.push(normalized);
    else if (!options.keepExisting) list[index] = normalized;
    manifest.dependencies = list;
    return manifest;
}

/** Remove every dependency matching `matcher`; returns the removed count. */
export function removeDependency(manifest: Manifest, matcher: DependencyMatcher): number {
    const list = dependencyList(manifest);
    if (list.length === 0) return 0;
    const kept = list.filter((dependency) => !matchesDependency(dependency, matcher));
    const removed = list.length - kept.length;
    if (removed > 0) manifest.dependencies = kept;
    return removed;
}

/** Add or replace a module. Modules are matched by UUID. */
export function addModule(
    manifest: Manifest,
    module: ManifestModule,
    options: UpsertOptions = {}
): Manifest {
    const normalized = normalizeModule(manifest, module);
    const list = moduleList(manifest);
    const index = list.findIndex(
        (entry) => typeof entry.uuid === "string" && entry.uuid.toLowerCase() === normalized.uuid
    );

    if (index === -1) {
        const headerUuid = manifest.header?.uuid;
        if (typeof headerUuid === "string" && headerUuid.toLowerCase() === normalized.uuid) {
            throw new AddonError(
                "ADDON_IDENTITY_INVALID",
                `Module UUID ${normalized.uuid} is already used by the pack header.`
            );
        }
        list.push(normalized);
    } else if (!options.keepExisting) {
        list[index] = normalized;
    }

    manifest.modules = list;
    return manifest;
}

/** Remove every module matching `matcher`; returns the removed count. */
export function removeModule(manifest: Manifest, matcher: ModuleMatcher): number {
    const list = moduleList(manifest);
    if (list.length === 0) return 0;
    const kept = list.filter((module) => !matchesModule(module, matcher));
    const removed = list.length - kept.length;
    if (removed > 0) manifest.modules = kept;
    return removed;
}

/**
 * Add or remove one capability. Removing the last capability deletes the key,
 * matching manifests that omit `capabilities` entirely.
 */
export function setCapability(manifest: Manifest, capability: string, enabled = true): Manifest {
    const name = requiredString(capability, "capability");
    const current = manifest.capabilities;
    if (current !== undefined && !Array.isArray(current)) {
        throw new AddonError("ADDON_MANIFEST_INVALID", "manifest.capabilities must be an array.");
    }
    const list = (current ?? []).filter((entry): entry is string => typeof entry === "string");
    const index = list.indexOf(name);
    if (enabled) {
        if (index === -1) list.push(name);
    } else if (index !== -1) {
        list.splice(index, 1);
    }
    if (list.length > 0) manifest.capabilities = list;
    else delete manifest.capabilities;
    return manifest;
}

/** Set one metadata key; `null` or `undefined` deletes it. */
export function setMetadata(manifest: Manifest, key: string, value: unknown): Manifest {
    const name = requiredString(key, "metadata key");
    const current =
        manifest.metadata === undefined ? {} : { ...asRecord(manifest.metadata, "metadata") };
    if (value === undefined || value === null) delete current[name];
    else current[name] = value;
    manifest.metadata = current;
    return manifest;
}

/** Merge fields into `header`, validating and converting versions. */
export function patchHeader(manifest: Manifest, patch: HeaderPatch): Manifest {
    const formatVersion = formatVersionOf(manifest);
    const header: Record<string, unknown> = manifest.header
        ? { ...(manifest.header as Record<string, unknown>) }
        : {};

    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) header[key] = value;
    }
    if (patch.name !== undefined) header.name = requiredString(patch.name, "header.name");
    if (patch.description !== undefined) {
        header.description = optionalString(patch.description, "header.description");
    }
    if (patch.uuid !== undefined) header.uuid = parseUuid(patch.uuid, "header.uuid");
    if (patch.version !== undefined) {
        header.version = coerceVersionForFormat(patch.version, formatVersion, "header.version");
    }
    if (patch.min_engine_version !== undefined) {
        header.min_engine_version = coerceVersionForFormat(
            patch.min_engine_version,
            formatVersion,
            "header.min_engine_version"
        );
    }

    manifest.header = header as ManifestHeader;
    return manifest;
}

/** Rewrite every version field to the requested `format_version`. */
export function setFormatVersion(manifest: Manifest, formatVersion: 2 | 3): Manifest {
    if (manifest.format_version === formatVersion) return manifest;
    manifest.format_version = formatVersion;

    const header = manifest.header;
    if (header) {
        if (header.version !== undefined && header.version !== null) {
            header.version = coerceVersionForFormat(
                header.version,
                formatVersion,
                "header.version"
            );
        }
        if (header.min_engine_version !== undefined && header.min_engine_version !== null) {
            header.min_engine_version = coerceVersionForFormat(
                header.min_engine_version,
                formatVersion,
                "header.min_engine_version"
            );
        }
    }

    for (const module of moduleList(manifest)) {
        if (module.version !== undefined && module.version !== null) {
            module.version = coerceVersionForFormat(
                module.version as ManifestVersion,
                formatVersion,
                `module ${module.uuid ?? "unknown"} version`
            );
        }
    }

    for (const dependency of dependencyList(manifest)) {
        const record = dependency as Record<string, unknown>;
        // `module_name` dependencies always use SemVer strings.
        if (record.module_name !== undefined) continue;
        if (record.version === undefined || record.version === null) continue;
        record.version = coerceVersionForFormat(
            record.version as ManifestVersion,
            formatVersion,
            `dependency ${String(record.uuid ?? "unknown")} version`
        );
    }

    return manifest;
}

/** Apply a structured patch in place and return the same manifest. */
export function patchManifest(manifest: Manifest, patch: ManifestPatch): Manifest {
    const { header, dependencies, modules, capabilities, metadata, ...rest } = patch;

    for (const [key, value] of Object.entries(rest)) {
        if (value === undefined) continue;
        if (key === "format_version" && typeof value === "number") {
            if (value === 2 || value === 3) setFormatVersion(manifest, value);
            else {
                throw new AddonError(
                    "ADDON_MANIFEST_INVALID",
                    "manifest.format_version must be 2 or 3."
                );
            }
            continue;
        }
        manifest[key] = value;
    }

    if (header) patchHeader(manifest, header);
    if (dependencies) {
        manifest.dependencies = dependencies.map((dependency) =>
            normalizeDependency(manifest, dependency)
        );
    }
    if (modules) {
        manifest.modules = modules.map((module) => normalizeModule(manifest, module));
    }
    if (capabilities) {
        manifest.capabilities = normalizeCapabilities(capabilities);
    }
    if (metadata) {
        for (const [key, value] of Object.entries(metadata)) {
            setMetadata(manifest, key, value);
        }
    }

    return manifest;
}

/** Normalize one dependency for `manifest`'s version format. */
export function normalizeDependency(
    manifest: Manifest,
    dependency: ManifestDependency
): ManifestDependency {
    const formatVersion = formatVersionOf(manifest);
    const record = asRecord(dependency, "dependency");
    const hasName = record.module_name !== undefined;
    const hasUuid = record.uuid !== undefined;

    if (hasName && hasUuid) {
        throw new AddonError(
            "ADDON_MANIFEST_INVALID",
            "A dependency must use either module_name or uuid, not both."
        );
    }
    if (hasName) {
        const moduleName = requiredString(record.module_name, "dependency.module_name");
        return {
            ...record,
            module_name: moduleName,
            version: moduleVersion(record.version, `dependency ${moduleName} version`),
        };
    }
    if (hasUuid) {
        const uuid = parseUuid(record.uuid, "dependency.uuid");
        return {
            ...record,
            uuid,
            version: toVersion(record.version, formatVersion, `dependency ${uuid} version`),
        };
    }
    throw new AddonError("ADDON_MANIFEST_INVALID", "A dependency needs a module_name or a uuid.");
}

/** Normalize one module for `manifest`'s version format. */
export function normalizeModule(manifest: Manifest, module: ManifestModule): ManifestModule {
    const formatVersion = formatVersionOf(manifest);
    const record = asRecord(module, "module");
    const type = requiredString(record.type, "module.type");
    const uuid = parseUuid(record.uuid, "module.uuid");
    const hasVersion = record.version !== undefined && record.version !== null;
    return {
        ...record,
        type,
        uuid,
        ...(hasVersion
            ? { version: toVersion(record.version, formatVersion, `module ${uuid} version`) }
            : {}),
    } as ManifestModule;
}

function toVersion(value: unknown, formatVersion: number, field: string): ManifestVersion {
    if (typeof value === "string" || isVersionTuple(value)) {
        return coerceVersionForFormat(value, formatVersion, field);
    }
    throw new AddonError("ADDON_MANIFEST_INVALID", `${field} must be a version.`);
}

function moduleVersion(value: unknown, field: string): string {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (isVersionTuple(value)) return value.join(".");
    throw new AddonError(
        "ADDON_MANIFEST_INVALID",
        `${field} must be a version string such as "1.0.0".`
    );
}

function normalizeCapabilities(values: readonly string[]): string[] {
    const result: string[] = [];
    for (const value of values) {
        const capability = requiredString(value, "capability");
        if (!result.includes(capability)) result.push(capability);
    }
    return result;
}

function sameDependency(left: ManifestDependency, right: ManifestDependency): boolean {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    if (typeof leftRecord.module_name === "string" && typeof rightRecord.module_name === "string") {
        return leftRecord.module_name === rightRecord.module_name;
    }
    return (
        typeof leftRecord.uuid === "string" &&
        typeof rightRecord.uuid === "string" &&
        leftRecord.uuid.toLowerCase() === rightRecord.uuid.toLowerCase()
    );
}

function matchesDependency(dependency: ManifestDependency, matcher: DependencyMatcher): boolean {
    if (typeof matcher === "function") return matcher(dependency);
    const record = dependency as Record<string, unknown>;
    if (typeof matcher === "string") {
        const needle = matcher.toLowerCase();
        return (
            (typeof record.module_name === "string" &&
                record.module_name.toLowerCase() === needle) ||
            (typeof record.uuid === "string" && record.uuid.toLowerCase() === needle)
        );
    }
    if (matcher.module_name === undefined && matcher.uuid === undefined) {
        throw new AddonError(
            "ADDON_MANIFEST_INVALID",
            "A dependency matcher needs a module_name or a uuid."
        );
    }
    if (matcher.module_name !== undefined && record.module_name !== matcher.module_name) {
        return false;
    }
    if (
        matcher.uuid !== undefined &&
        (typeof record.uuid !== "string" ||
            record.uuid.toLowerCase() !== matcher.uuid.toLowerCase())
    ) {
        return false;
    }
    return true;
}

function matchesModule(module: ManifestModule, matcher: ModuleMatcher): boolean {
    if (typeof matcher === "function") return matcher(module);
    const record = module as Record<string, unknown>;
    if (typeof matcher === "string") {
        const needle = matcher.toLowerCase();
        return (
            (typeof record.uuid === "string" && record.uuid.toLowerCase() === needle) ||
            record.type === matcher
        );
    }
    if (matcher.uuid === undefined && matcher.type === undefined) {
        throw new AddonError("ADDON_MANIFEST_INVALID", "A module matcher needs a uuid or a type.");
    }
    if (
        matcher.uuid !== undefined &&
        (typeof record.uuid !== "string" ||
            record.uuid.toLowerCase() !== matcher.uuid.toLowerCase())
    ) {
        return false;
    }
    if (matcher.type !== undefined && record.type !== matcher.type) return false;
    return true;
}
