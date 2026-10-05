import { promises as fs } from "node:fs";
import { pathExists, writeJsonFile } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";
import { validateManifest } from "./validate.js";
import type { Manifest } from "./types.js";

// ---------------------------------------------------------------------------
// Normalize utilities (formerly normalize.ts)
// ---------------------------------------------------------------------------

/** Safe coercion: cast unknown to Manifest, return {} for null/non-object. */
export function normalizeManifest(value: unknown): Manifest {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return { ...(value as Record<string, unknown>) } as Manifest;
}

/** Safe coercion: cast unknown to T[], return [] for non-arrays. */
export function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

/** Safe coercion: cast unknown to Record, return {} for null/non-object. */
export function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return { ...(value as Record<string, unknown>) };
}

/** Return undefined if the object has no own enumerable keys. */
export function removeEmptyObject<T extends Record<string, unknown>>(
    value: T | undefined
): T | undefined {
    if (value && Object.keys(value).length === 0) return undefined;
    return value;
}

// ---------------------------------------------------------------------------
// ManifestFile — file I/O with normalization and validation
// ---------------------------------------------------------------------------

/**
 * ManifestFile 负责 manifest 文件的读取、写入和校验。
 *
 * - read:  读取 JSON 文件 → normalize → 返回 Manifest（文件不存在返回 undefined）
 * - write: validate → 写入 JSON 文件
 *
 * normalize 系列工具函数也放在此文件，供 Builder 等模块使用。
 */
export class ManifestFile {
    /** Read and normalize a manifest JSON file. Returns undefined if not found. */
    static async read(path: string): Promise<Manifest | undefined> {
        if (!(await pathExists(path))) return undefined;
        const raw = await fs.readFile(path, "utf8");
        try {
            return normalizeManifest(JSON.parse(raw));
        } catch {
            throw new BePackError("MANIFEST_INVALID", `Invalid JSON in manifest: ${path}`);
        }
    }

    /** Validate and write a manifest JSON file. */
    static async write(path: string, manifest: Manifest, kind: "bp" | "rp"): Promise<void> {
        validateManifest(manifest, kind);
        await writeJsonFile(path, manifest);
    }
}
