import { BePackError } from "../errors/BePackError.js";
import type { Manifest } from "./types.js";

/**
 * 校验 manifest 是否包含所有必须的字段。
 * 校验失败时抛出 MANIFEST_INVALID 错误。
 */
export function validateManifest(manifest: Manifest, kind: "bp" | "rp"): void {
    const errors: string[] = [];

    // 根级别
    if (manifest.format_version === undefined) {
        errors.push("format_version is required");
    }

    // Header
    if (!manifest.header) {
        errors.push("header is required");
    } else {
        if (!manifest.header.name) errors.push("header.name is required");
        if (!manifest.header.uuid) errors.push("header.uuid is required");
        if (!isManifestVersion(manifest.header.version)) {
            errors.push("header.version must be [number, number, number]");
        }
        if (!isManifestVersion(manifest.header.min_engine_version)) {
            errors.push("header.min_engine_version must be [number, number, number]");
        }
    }

    // Modules
    if (!Array.isArray(manifest.modules)) {
        errors.push("modules must be an array");
    } else {
        const hasScript = manifest.modules.some(
            (m) => m?.type === "script" && m?.language === "javascript"
        );
        const hasResources = manifest.modules.some((m) => m?.type === "resources");

        if (kind === "bp" && !hasScript) {
            errors.push("BP manifest must have a script module");
        }
        if (kind === "rp" && !hasResources) {
            errors.push("RP manifest must have a resources module");
        }
    }

    // Dependencies
    if (manifest.dependencies !== undefined && !Array.isArray(manifest.dependencies)) {
        errors.push("dependencies must be an array");
    }

    // 校验单个依赖的版本格式
    if (Array.isArray(manifest.dependencies)) {
        for (let i = 0; i < manifest.dependencies.length; i++) {
            const dep = manifest.dependencies[i];
            if (!dep) {
                errors.push(`dependencies[${i}] is invalid`);
                continue;
            }
            if ("uuid" in dep && dep.uuid && !isManifestVersion(dep.version)) {
                errors.push(
                    `dependencies[${i}] (uuid: ${dep.uuid}): version must be [number, number, number]`
                );
            }
            if ("module_name" in dep && dep.module_name && typeof dep.version !== "string") {
                errors.push(
                    `dependencies[${i}] (module_name: ${dep.module_name}): version must be a string`
                );
            }
        }
    }

    // Capabilities
    if (manifest.capabilities !== undefined) {
        if (!Array.isArray(manifest.capabilities)) {
            errors.push("capabilities must be an array");
        } else if (!manifest.capabilities.every((c) => typeof c === "string")) {
            errors.push("capabilities must be an array of strings");
        }
    }

    // Metadata
    if (manifest.metadata !== undefined) {
        if (typeof manifest.metadata !== "object" || manifest.metadata === null) {
            errors.push("metadata must be an object");
        }
    }

    if (errors.length > 0) {
        throw new BePackError(
            "MANIFEST_INVALID",
            `Manifest validation failed: ${errors.join("; ")}`
        );
    }
}

/** 判断值是否为 [number, number, number] 格式的版本元组 */
function isManifestVersion(value: unknown): value is [number, number, number] {
    return (
        Array.isArray(value) &&
        value.length === 3 &&
        typeof value[0] === "number" &&
        typeof value[1] === "number" &&
        typeof value[2] === "number"
    );
}
