import type { Manifest } from "./types.js";

/**
 * 将未知值安全转换为 Manifest 对象。
 * 如果传入 null 或非对象，返回空 Manifest。
 * 通过浅拷贝确保不修改原对象。
 */
export function normalizeManifest(value: unknown): Manifest {
    if (typeof value !== "object" || value === null) return {};
    return { ...(value as Record<string, unknown>) } as Manifest;
}

/**
 * 将未知值安全转换为 T[]。
 * 如果传入的不是数组，返回空数组。
 */
export function asArray<T>(value: unknown): T[] {
    if (!Array.isArray(value)) return [];
    return value as T[];
}

/**
 * 将未知值安全转换为 Record<string, unknown>。
 * 如果传入 null 或非对象，返回空对象。
 */
export function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null) return {};
    return value as Record<string, unknown>;
}

/**
 * 如果对象没有任何自身可枚举属性，返回 undefined，否则返回对象本身。
 * 用于清理 manifest 中应被移除的空对象。
 */
export function removeEmptyObject<T extends Record<string, unknown>>(value: T): T | undefined {
    return Object.keys(value).length === 0 ? undefined : value;
}
