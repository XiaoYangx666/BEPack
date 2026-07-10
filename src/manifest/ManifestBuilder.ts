import { BePackError } from "../errors/BePackError.js";
import {
    MANIFEST_FORMAT_VERSION,
    MIN_ENGINE_VERSION,
    MODULE_VERSION,
    SCRIPT_ENTRY,
} from "../constants/manifest.js";
import { parseVersionTuple } from "../utils/semver.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { normalizeManifest, asArray, removeEmptyObject } from "./ManifestFile.js";
import type { ManifestDepManager } from "./ManifestDepManager.js";
import type {
    Manifest,
    ManifestVersion,
    ManifestHeader,
    ManifestModule,
    ManifestScriptModule,
    ManifestResourcesModule,
} from "./types.js";

/**
 * ManifestBuilder 构建 manifest 的 header、modules、metadata 部分。
 *
 * 依赖相关的构建逻辑委托给 ManifestDepManager。
 *
 * 构造时预计算 version tuple，构建 BP/RP manifest 时无需再层层传递 config 参数。
 * 同一实例可同时用于 buildBp 和 buildRp。
 *
 * format_version 处理规则：
 * - 用户配置 manifestFormat 时，优先使用配置值
 * - 未配置时，保留 existing manifest 的 format_version
 * - 全新 manifest（无 existing）默认使用 2
 * - format 3 兼容 format 2：数组版本在两种格式下都合法
 * - format 2 不兼容 format 3：遇到字符串版本会自动转为数组
 */
export class ManifestBuilder {
    private readonly config: ResolvedConfig;
    private readonly version: ManifestVersion;
    private readonly depManager: ManifestDepManager;

    constructor(config: ResolvedConfig, depManager: ManifestDepManager) {
        this.config = config;
        this.version = parseVersionTuple(config.version);
        this.depManager = depManager;
    }

    // -----------------------------------------------------------------------
    // 公开方法
    // -----------------------------------------------------------------------

    /**
     * 构建（或重建）BP manifest。
     * 纯函数——不会修改传入的 existingValue。
     */
    buildBp(existingValue?: unknown): Manifest {
        const existing = normalizeManifest(existingValue);
        this.depManager.validateBpDependencies();

        const effectiveFormat = this.getWriteFormatVersion(existing);

        const manifest: Manifest = {
            ...existing,
            format_version: effectiveFormat,
            header: this.buildBpHeader(existing, effectiveFormat),
            modules: this.replaceManagedBpModules(existing.modules),
            dependencies: this.depManager.replaceBpDependencies(
                existing.dependencies,
                this.config.packs.rp?.uuid
            ),
        };

        this.applyAchievementMetadata(manifest);
        return manifest;
    }

    /**
     * 构建（或重建）RP manifest。
     * 纯函数——不会修改传入的 existingValue。
     */
    buildRp(existingValue?: unknown): Manifest {
        const rp = this.requireRp();
        const existing = normalizeManifest(existingValue);

        const effectiveFormat = this.getWriteFormatVersion(existing);

        const manifest: Manifest = {
            ...existing,
            format_version: effectiveFormat,
            header: this.buildRpHeader(existing, rp, effectiveFormat),
            modules: this.replaceManagedRpModules(existing.modules),
            dependencies: this.depManager.replaceRpDependencies(
                existing.dependencies,
                this.config.packs.bp.uuid
            ),
        };

        this.applyPbrCapability(manifest, rp);
        return manifest;
    }

    // -----------------------------------------------------------------------
    // Header 构建
    // -----------------------------------------------------------------------

    private buildBpHeader(existing: Manifest, formatVersion: number): ManifestHeader {
        return {
            ...(existing.header ?? {}),
            name: this.config.packs.bp.name,
            ...(this.config.packs.bp.description !== undefined
                ? { description: this.config.packs.bp.description }
                : {}),
            uuid: this.config.packs.bp.uuid,
            version: this.version,
            min_engine_version: this.normalizeMinEngineVersion(
                existing.header?.min_engine_version,
                formatVersion
            ),
        };
    }

    private buildRpHeader(
        existing: Manifest,
        rp: NonNullable<ResolvedConfig["packs"]["rp"]>,
        formatVersion: number
    ): ManifestHeader {
        return {
            ...(existing.header ?? {}),
            name: rp.name,
            ...(rp.description !== undefined ? { description: rp.description } : {}),
            uuid: rp.uuid,
            version: this.version,
            min_engine_version: this.normalizeMinEngineVersion(
                existing.header?.min_engine_version,
                formatVersion
            ),
        };
    }

    // -----------------------------------------------------------------------
    // Module 管理
    // -----------------------------------------------------------------------

    private isManagedBpModule(module: ManifestModule): boolean {
        if (module.type !== "script" || module.language !== "javascript") return false;
        return module.uuid === this.config.packs.bp.moduleUuid || module.entry === SCRIPT_ENTRY;
    }

    private isManagedRpModule(module: ManifestModule): boolean {
        if (module.type !== "resources") return false;
        if (!this.config.packs.rp) return false;
        return module.uuid === this.config.packs.rp.moduleUuid;
    }

    private createScriptModule(): ManifestScriptModule {
        return {
            type: "script",
            language: "javascript",
            uuid: this.config.packs.bp.moduleUuid,
            version: MODULE_VERSION,
            entry: SCRIPT_ENTRY,
        };
    }

    private createResourcesModule(): ManifestResourcesModule {
        return {
            type: "resources",
            uuid: this.requireRp().moduleUuid,
            version: MODULE_VERSION,
        };
    }

    private replaceManagedBpModules(
        existingModules: ManifestModule[] | undefined
    ): ManifestModule[] {
        const existing = asArray<ManifestModule>(existingModules);
        const userModules = existing.filter((m) => !this.isManagedBpModule(m));
        return [...userModules, this.createScriptModule()];
    }

    private replaceManagedRpModules(
        existingModules: ManifestModule[] | undefined
    ): ManifestModule[] {
        const existing = asArray<ManifestModule>(existingModules);
        const userModules = existing.filter((m) => !this.isManagedRpModule(m));
        return [...userModules, this.createResourcesModule()];
    }

    // -----------------------------------------------------------------------
    // Achievement / PBR
    // -----------------------------------------------------------------------

    private applyAchievementMetadata(manifest: Manifest): void {
        if (this.config.packs.bp.achievement === true) {
            manifest.metadata = { ...(manifest.metadata ?? {}), product_type: "addon" };
        } else if (this.config.packs.bp.achievement === false && manifest.metadata) {
            const meta = { ...manifest.metadata };
            delete meta.product_type;
            const cleaned = removeEmptyObject(meta);
            if (cleaned) manifest.metadata = cleaned;
            else delete manifest.metadata;
        }
    }

    private applyPbrCapability(
        manifest: Manifest,
        rp: NonNullable<ResolvedConfig["packs"]["rp"]>
    ): void {
        if (rp.pbr === true) {
            const caps = asArray<string>(manifest.capabilities);
            manifest.capabilities = caps.includes("pbr") ? caps : [...caps, "pbr"];
        } else if (rp.pbr === false) {
            const caps = asArray<string>(manifest.capabilities);
            const filtered = caps.filter((c) => c !== "pbr");
            if (filtered.length > 0) manifest.capabilities = filtered;
            else delete manifest.capabilities;
        }
        // rp.pbr === undefined: 保留现有 capabilities，不做修改
    }

    // -----------------------------------------------------------------------
    // Format version 处理
    // -----------------------------------------------------------------------

    /**
     * 确定写入 manifest 时使用的 format_version。
     * 优先级：配置 > existing > 默认值 2
     */
    private getWriteFormatVersion(existing: Manifest): number {
        if (this.config.manifestFormat !== undefined) return this.config.manifestFormat;
        return existing.format_version ?? MANIFEST_FORMAT_VERSION;
    }

    /**
     * 处理 min_engine_version：
     * - 优先保留 existing 的值
     * - existing 无值时使用默认值 MIN_ENGINE_VERSION
     *
     * format 兼容：
     * - format 2：字符串版本 "x.y.z" 自动转为 [x, y, z] 数组
     * - format 3：保留字符串版本不变（同时数组也可接受）
     */
    private normalizeMinEngineVersion(
        existingValue: unknown,
        formatVersion: number
    ): ManifestVersion {
        // 无 existing 值 → 使用默认值
        if (existingValue === undefined || existingValue === null) {
            return MIN_ENGINE_VERSION;
        }

        // existing 值是数组 → 直接保留（两种格式都兼容）
        if (Array.isArray(existingValue)) {
            return existingValue as [number, number, number];
        }

        // existing 值是字符串
        if (typeof existingValue === "string") {
            if (formatVersion === 2) {
                // format 2 要求数组 → 自动转 "x.y.z" -> [x, y, z]
                const parts = existingValue.split(".").map(Number);
                if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
                    return parts as [number, number, number];
                }
            }
            // format 3 保留字符串
            return existingValue;
        }

        // 兜底
        return MIN_ENGINE_VERSION;
    }

    // -----------------------------------------------------------------------
    // 辅助
    // -----------------------------------------------------------------------

    private requireRp(): NonNullable<ResolvedConfig["packs"]["rp"]> {
        if (!this.config.packs.rp) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.rp is required to build the RP manifest."
            );
        }
        return this.config.packs.rp;
    }
}
