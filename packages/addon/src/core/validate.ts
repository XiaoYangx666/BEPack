import { AddonError } from "./errors.js";
import { isVersionString, isVersionTuple, type Manifest } from "./manifest.js";

type ValidationRule = (manifest: Manifest, kind: "bp" | "rp") => string | string[] | null;

function versionChecker(formatVersion: number | undefined): (value: unknown) => boolean {
    return formatVersion === 3 ? isVersionString : isVersionTuple;
}

function versionError(formatVersion: number | undefined, field: string): string {
    return formatVersion === 3
        ? `${field} must be SemVer string like "x.y.z" (format 3)`
        : `${field} must be [number, number, number] (format 2)`;
}

const RULES: ValidationRule[] = [
    (m) => (m.format_version === undefined ? "format_version is required" : null),
    (m) => (m.header ? null : "header is required"),
    (m) => (m.header && !m.header.name ? "header.name is required" : null),
    (m) => (m.header && !m.header.uuid ? "header.uuid is required" : null),

    (m) => {
        if (!m.header) return null;
        const check = versionChecker(m.format_version);
        return check(m.header.version) ? null : versionError(m.format_version, "header.version");
    },
    (m) => {
        if (!m.header) return null;
        const check = versionChecker(m.format_version);
        return check(m.header.min_engine_version)
            ? null
            : versionError(m.format_version, "header.min_engine_version");
    },

    (m) =>
        m.modules !== undefined && !Array.isArray(m.modules) ? "modules must be an array" : null,

    (m, kind) => {
        if (!Array.isArray(m.modules)) return null;
        const hasResources = m.modules.some((mod) => mod?.type === "resources");
        const errors: string[] = [];
        if (kind === "rp" && !hasResources) errors.push("RP manifest must have a resources module");
        return errors.length > 0 ? errors : null;
    },

    (m) => {
        if (!Array.isArray(m.modules)) return null;
        const check = versionChecker(m.format_version);
        const errors: string[] = [];
        for (let index = 0; index < m.modules.length; index += 1) {
            const mod = m.modules[index];
            if (mod && mod.version !== undefined && mod.version !== null && !check(mod.version)) {
                errors.push(
                    `modules[${index}] (uuid: ${mod.uuid ?? "unknown"}): ${versionError(
                        m.format_version,
                        "version"
                    )}`
                );
            }
        }
        return errors.length > 0 ? errors : null;
    },

    (m) =>
        m.dependencies !== undefined && !Array.isArray(m.dependencies)
            ? "dependencies must be an array"
            : null,

    (m) => {
        if (!Array.isArray(m.dependencies)) return null;
        const check = versionChecker(m.format_version);
        const errors: string[] = [];
        for (let index = 0; index < m.dependencies.length; index += 1) {
            const dep = m.dependencies[index];
            if (!dep) {
                errors.push(`dependencies[${index}] is invalid`);
                continue;
            }
            const record = dep as Record<string, unknown>;
            if ("uuid" in record && record.uuid && !check(record.version)) {
                errors.push(
                    `dependencies[${index}] (uuid: ${String(record.uuid)}): ${versionError(
                        m.format_version,
                        "version"
                    )}`
                );
            }
            if (
                "module_name" in record &&
                record.module_name &&
                typeof record.version !== "string"
            ) {
                errors.push(
                    `dependencies[${index}] (module_name: ${String(
                        record.module_name
                    )}): version must be a string`
                );
            }
        }
        return errors.length > 0 ? errors : null;
    },

    (m) => {
        if (m.capabilities === undefined) return null;
        if (!Array.isArray(m.capabilities)) return "capabilities must be an array";
        if (!m.capabilities.every((capability) => typeof capability === "string")) {
            return "capabilities must be an array of strings";
        }
        return null;
    },

    (m) =>
        m.metadata !== undefined && (typeof m.metadata !== "object" || m.metadata === null)
            ? "metadata must be an object"
            : null,
];

/**
 * Validate a generated or loaded manifest against BePack's required shape.
 *
 * Throws `AddonError` with code `ADDON_MANIFEST_INVALID`. The CLI wraps this
 * into `BePackError("MANIFEST_INVALID")` so both sides share one rule set.
 */
export function validateManifest(manifest: Manifest, kind: "bp" | "rp"): void {
    const errors: string[] = [];

    for (const rule of RULES) {
        const result = rule(manifest, kind);
        if (result === null) continue;
        if (Array.isArray(result)) errors.push(...result);
        else errors.push(result);
    }

    if (errors.length > 0) {
        throw new AddonError(
            "ADDON_MANIFEST_INVALID",
            `Manifest validation failed: ${errors.join("; ")}`
        );
    }
}
