import { BePackError } from "../errors/BePackError.js";
import type { Manifest } from "./types.js";

// ---------------------------------------------------------------------------
// 规则类型
// ---------------------------------------------------------------------------

type ValidationRule = (
    manifest: Manifest,
    kind: "bp" | "rp"
) => string | string[] | null;

// ---------------------------------------------------------------------------
// 版本格式校验工具
// ---------------------------------------------------------------------------

function isStrict(value: unknown): value is [number, number, number] {
    return (
        Array.isArray(value) &&
        value.length === 3 &&
        typeof value[0] === "number" &&
        typeof value[1] === "number" &&
        typeof value[2] === "number"
    );
}

function isLenient(value: unknown): boolean {
    return isStrict(value) || (typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value));
}

/**
 * 根据 format_version 选择校验函数：
 * - format 2 → 严格模式（仅数组）
 * - format 3 → 宽松模式（数组或 SemVer 字符串）
 * - 未知时按严格模式处理
 */
function versionChecker(fv: number | undefined): typeof isLenient {
    return fv === 3 ? isLenient : isStrict;
}

function versionError(fv: number | undefined, field: string): string {
    return fv === 3
        ? `${field} must be [number, number, number] or SemVer string (format 3)`
        : `${field} must be [number, number, number] (format 2)`;
}

// ---------------------------------------------------------------------------
// 规则定义
// ---------------------------------------------------------------------------

const RULES: ValidationRule[] = [
    // 根级别
    (m) => (m.format_version === undefined ? "format_version is required" : null),

    // Header
    (m) => (m.header ? null : "header is required"),

    (m) => (m.header && !m.header.name ? "header.name is required" : null),
    (m) => (m.header && !m.header.uuid ? "header.uuid is required" : null),

    // header.version 格式
    (m) => {
        if (!m.header) return null;
        const check = versionChecker(m.format_version);
        return check(m.header.version) ? null : versionError(m.format_version, "header.version");
    },

    // header.min_engine_version 格式
    (m) => {
        if (!m.header) return null;
        const check = versionChecker(m.format_version);
        return check(m.header.min_engine_version)
            ? null
            : versionError(m.format_version, "header.min_engine_version");
    },

    // Modules
    (m) => (!Array.isArray(m.modules) ? "modules must be an array" : null),

    (m, kind) => {
        if (!Array.isArray(m.modules)) return null;
        const hasScript = m.modules.some(
            (mod) => mod?.type === "script" && mod?.language === "javascript"
        );
        const hasResources = m.modules.some((mod) => mod?.type === "resources");
        const errs: string[] = [];
        if (kind === "bp" && !hasScript) errs.push("BP manifest must have a script module");
        if (kind === "rp" && !hasResources) errs.push("RP manifest must have a resources module");
        return errs.length > 0 ? errs : null;
    },

    // Dependencies 整体类型
    (m) =>
        m.dependencies !== undefined && !Array.isArray(m.dependencies)
            ? "dependencies must be an array"
            : null,

    // 单个依赖校验
    (m) => {
        if (!Array.isArray(m.dependencies)) return null;
        const check = versionChecker(m.format_version);
        const errs: string[] = [];
        for (let i = 0; i < m.dependencies.length; i++) {
            const dep = m.dependencies[i];
            if (!dep) {
                errs.push(`dependencies[${i}] is invalid`);
                continue;
            }
            if ("uuid" in dep && dep.uuid && !check(dep.version)) {
                errs.push(
                    `dependencies[${i}] (uuid: ${dep.uuid}): ${versionError(m.format_version, "version")}`
                );
            }
            if ("module_name" in dep && dep.module_name && typeof dep.version !== "string") {
                errs.push(
                    `dependencies[${i}] (module_name: ${dep.module_name}): version must be a string`
                );
            }
        }
        return errs.length > 0 ? errs : null;
    },

    // Capabilities
    (m) => {
        if (m.capabilities === undefined) return null;
        if (!Array.isArray(m.capabilities)) return "capabilities must be an array";
        if (!m.capabilities.every((c) => typeof c === "string"))
            return "capabilities must be an array of strings";
        return null;
    },

    // Metadata
    (m) =>
        m.metadata !== undefined &&
        (typeof m.metadata !== "object" || m.metadata === null)
            ? "metadata must be an object"
            : null,
];

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 校验 manifest 是否包含所有必须的字段。
 * 校验失败时抛出 MANIFEST_INVALID 错误。
 *
 * format_version-aware:
 * - format 2: 所有版本字段必须为 [number, number, number] 数组
 * - format 3: 所有版本字段可以是数组或 SemVer 字符串 "x.y.z"
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
        throw new BePackError(
            "MANIFEST_INVALID",
            `Manifest validation failed: ${errors.join("; ")}`
        );
    }
}
