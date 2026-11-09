import { AddonError } from "./errors.js";

/** manifest.json version format:
 * - format_version 2: `[major, minor, patch]`
 * - format_version 3: `"major.minor.patch"` (SemVer string, no array)
 */
export type ManifestVersion = [number, number, number] | string;

/** Loose but constrained manifest.json shape. Unknown fields are preserved. */
export interface Manifest {
    format_version?: number;
    header?: ManifestHeader;
    modules?: ManifestModule[];
    dependencies?: ManifestDependency[];
    capabilities?: string[];
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface ManifestHeader {
    name?: string;
    description?: string;
    uuid?: string;
    version?: ManifestVersion;
    min_engine_version?: ManifestVersion;
    /** Resource pack scope: `world` | `global` | `any`. */
    pack_scope?: string;
    [key: string]: unknown;
}

export interface ManifestScriptModule {
    type: "script";
    language?: string;
    uuid: string;
    version?: ManifestVersion;
    entry?: string;
    [key: string]: unknown;
}

export interface ManifestResourcesModule {
    type: "resources";
    uuid: string;
    version?: ManifestVersion;
    [key: string]: unknown;
}

export interface ManifestUnknownModule {
    type?: string;
    uuid?: string;
    version?: unknown;
    [key: string]: unknown;
}

export type ManifestModule = ManifestScriptModule | ManifestResourcesModule | ManifestUnknownModule;

export type ManifestDependency =
    | {
          module_name: string;
          version: string;
      }
    | {
          uuid: string;
          version: ManifestVersion;
      }
    | {
          [key: string]: unknown;
      };

const VERSION_STRING = /^\d+\.\d+\.\d+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * format_version 3 uses string versions; format 2 (and an omitted value)
 * uses `[major, minor, patch]` tuples.
 */
export function formatVersionOf(manifest: Manifest): number {
    return manifest.format_version === 3 ? 3 : 2;
}

export function isVersionTuple(value: unknown): value is [number, number, number] {
    return (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every(
            (part) =>
                typeof part === "number" &&
                Number.isSafeInteger(part) &&
                part >= 0 &&
                part <= 65_535
        )
    );
}

export function isVersionString(value: unknown): value is string {
    return typeof value === "string" && VERSION_STRING.test(value);
}

export function isValidVersion(value: unknown, formatVersion: number | undefined): boolean {
    return formatVersion === 3 ? isVersionString(value) : isVersionTuple(value);
}

export function parseVersion(
    value: unknown,
    formatVersion: number | undefined,
    field: string
): ManifestVersion {
    if (formatVersion === 3) {
        if (!isVersionString(value)) throw invalidVersion(field, formatVersion);
        return value;
    }
    if (!isVersionTuple(value)) throw invalidVersion(field, formatVersion);
    return [value[0], value[1], value[2]];
}

export function versionToString(value: ManifestVersion): string {
    return typeof value === "string" ? value : value.join(".");
}

export function versionToTuple(value: ManifestVersion): [number, number, number] | undefined {
    if (isVersionTuple(value)) return [value[0], value[1], value[2]];
    if (!isVersionString(value)) return undefined;
    const parts = value.split(".").map(Number);
    if (!isVersionTuple(parts)) return undefined;
    return [parts[0], parts[1], parts[2]];
}

/** Convert a version to the representation required by `format_version`. */
export function coerceVersionForFormat(
    value: ManifestVersion | readonly [number, number, number],
    formatVersion: number | undefined,
    field = "version"
): ManifestVersion {
    if (formatVersion === 3) {
        if (isVersionString(value)) return value;
        if (isVersionTuple(value)) return value.join(".");
        throw invalidVersion(field, formatVersion);
    }
    if (isVersionTuple(value)) return [value[0], value[1], value[2]];
    if (isVersionString(value)) {
        const parts = value.split(".").map(Number);
        if (isVersionTuple(parts)) return [parts[0], parts[1], parts[2]];
    }
    throw invalidVersion(field, formatVersion);
}

export function isUuid(value: unknown): value is string {
    return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseUuid(value: unknown, field: string): string {
    if (!isUuid(value)) {
        throw new AddonError(
            "ADDON_IDENTITY_INVALID",
            `${field} is not a valid UUID: ${String(value)}.`
        );
    }
    return value.toLowerCase();
}

/** Generate a v4 UUID using the platform's secure random source. */
export function generateUuid(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID().toLowerCase();
    }
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
        throw new AddonError(
            "ADDON_IDENTITY_INVALID",
            "No secure random source is available to generate pack UUIDs."
        );
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join("-");
}

export function generateUniqueUuids(count: number): string[] {
    if (!Number.isSafeInteger(count) || count < 0) {
        throw new AddonError(
            "ADDON_IDENTITY_INVALID",
            `UUID count must be a non-negative integer.`
        );
    }
    const values = new Set<string>();
    let attempts = 0;
    while (values.size < count) {
        attempts += 1;
        if (attempts > count * 32 + 32) {
            throw new AddonError(
                "ADDON_IDENTITY_INVALID",
                "Unable to generate enough unique UUIDs."
            );
        }
        values.add(generateUuid());
    }
    return [...values];
}

/** Cast to a plain object without copying, so callers can mutate in place. */
export function asRecord(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new AddonError("ADDON_MANIFEST_INVALID", `${field} must be an object.`);
    }
    return value as Record<string, unknown>;
}

export function asArray(value: unknown, field: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new AddonError("ADDON_MANIFEST_INVALID", `${field} must be an array.`);
    }
    return value;
}

export function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new AddonError("ADDON_MANIFEST_INVALID", `${field} must be a non-empty string.`);
    }
    return value.trim();
}

export function optionalString(value: unknown, field: string): string {
    if (value === undefined) return "";
    if (typeof value !== "string") {
        throw new AddonError("ADDON_MANIFEST_INVALID", `${field} must be a string.`);
    }
    return value;
}

function invalidVersion(field: string, formatVersion: number | undefined): AddonError {
    return new AddonError(
        "ADDON_MANIFEST_INVALID",
        formatVersion === 3
            ? `${field} must be a SemVer string such as "1.0.0" for format_version 3.`
            : `${field} must be a [major, minor, patch] array for format_version 2.`
    );
}
