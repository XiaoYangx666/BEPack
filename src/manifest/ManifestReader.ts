import { BePackError } from "../errors/BePackError.js";
import { BUILTIN_DEPENDENCY_CATALOG } from "../constants/dependencyCatalog.js";
import type { Manifest, ManifestModule } from "./types.js";

/**
 * ManifestReader 提供从已解析的 Manifest 对象中提取信息的纯方法。
 *
 * 所有方法均为静态，不依赖外部状态。
 * 同时提供类型守卫（isScriptModule / isResourcesModule），
 * 供 ManifestBuilder 等模块共用。
 */
export class ManifestReader {
    // -----------------------------------------------------------------------
    // Header 提取
    // -----------------------------------------------------------------------

    /**
     * 验证 manifest header 包含必需的 name 和 uuid，返回提取结果。
     * 用于 init --from-bp / --from-rp 的逆向工程。
     */
    static validateHeader(
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

    // -----------------------------------------------------------------------
    // Module 查找
    // -----------------------------------------------------------------------

    /** 查找 BP manifest 中的 script 模块 UUID。 */
    static findScriptModuleUuid(manifest: Manifest): string | undefined {
        for (const mod of manifest.modules ?? []) {
            if (mod && ManifestReader.isScriptModule(mod)) {
                return mod.uuid;
            }
        }
        return undefined;
    }

    /** 查找 RP manifest 中的 resources 模块 UUID。 */
    static findResourcesModuleUuid(manifest: Manifest): string | undefined {
        for (const mod of manifest.modules ?? []) {
            if (mod && ManifestReader.isResourcesModule(mod)) {
                return mod.uuid;
            }
        }
        return undefined;
    }

    // -----------------------------------------------------------------------
    // 依赖提取
    // -----------------------------------------------------------------------

    /**
     * 从 manifest 中提取 BePack 管理的 module_name 依赖
     *（在内置 catalog 中的那些）。
     */
    static matchDependencies(manifest: Manifest): Record<string, string> {
        const deps: Record<string, string> = {};
        for (const dep of manifest.dependencies ?? []) {
            if ("module_name" in dep && typeof dep.module_name === "string") {
                const name = dep.module_name;
                if (BUILTIN_DEPENDENCY_CATALOG[name]) {
                    deps[name] =
                        typeof dep.version === "string" ? dep.version : String(dep.version);
                }
            }
        }
        return deps;
    }

    // -----------------------------------------------------------------------
    // 类型守卫（供 ManifestBuilder 共用）
    // -----------------------------------------------------------------------

    /** 判断 module 是否为 BP script 模块。 */
    static isScriptModule(mod: ManifestModule): boolean {
        return mod?.type === "script" && mod?.language === "javascript";
    }

    /** 判断 module 是否为 RP resources 模块。 */
    static isResourcesModule(mod: ManifestModule): boolean {
        return mod?.type === "resources";
    }
}
