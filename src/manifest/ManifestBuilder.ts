import path from "node:path";
import { BePackError } from "../errors/BePackError.js";
import {
    MANIFEST_FORMAT_VERSION,
    MIN_ENGINE_VERSION,
    MODULE_VERSION,
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
 */
export class ManifestBuilder {
    private readonly config: ResolvedConfig;
    private readonly version: ManifestVersion;
    private readonly versionStr: string;
    private readonly depManager: ManifestDepManager;

    constructor(config: ResolvedConfig, depManager: ManifestDepManager) {
        this.config = config;
        this.version = parseVersionTuple(config.version);
        this.versionStr = config.version;
        this.depManager = depManager;
    }

    // -----------------------------------------------------------------------
    // 公开方法
    // -----------------------------------------------------------------------

    /**
     * 构建（或重建）BP manifest。
     * 纯函数——不会修改传入的 existingValue。
     * 调用前应确保 config.packs.bp 已配置。
     */
    buildBp(existingValue?: unknown): Manifest {
        const bp = this.requireBp();
        const existing = normalizeManifest(existingValue);
        this.depManager.validateBpDependencies();

        const effectiveFormat = this.getWriteFormatVersion(existing);

        const manifest: Manifest = {
            ...existing,
            format_version: effectiveFormat,
            header: this.buildBpHeader(existing, bp, effectiveFormat),
            ...(bp.moduleUuid
                ? { modules: this.replaceManagedBpModules(existing.modules, bp, effectiveFormat) }
                : existing.modules
                  ? { modules: existing.modules }
                  : {}),
            dependencies: this.depManager.replaceBpDependencies(
                existing.dependencies,
                this.config.packs.rp?.uuid,
                effectiveFormat
            ),
        };

        this.applyAchievementMetadata(manifest, bp);
        return manifest;
    }

    /**
     * 构建（或重建）RP manifest。
     * 纯函数——不会修改传入的 existingValue。
     * 调用前应确保 config.packs.rp 已配置。
     */
    buildRp(existingValue?: unknown): Manifest {
        const rp = this.requireRp();
        const existing = normalizeManifest(existingValue);

        const effectiveFormat = this.getWriteFormatVersion(existing);

        const manifest: Manifest = {
            ...existing,
            format_version: effectiveFormat,
            header: this.buildRpHeader(existing, rp, effectiveFormat),
            modules: this.replaceManagedRpModules(existing.modules, rp, effectiveFormat),
            dependencies: this.depManager.replaceRpDependencies(
                existing.dependencies,
                this.config.packs.bp?.uuid ?? "",
                effectiveFormat
            ),
        };

        this.applyPbrCapability(manifest, rp);
        return manifest;
    }

    // -----------------------------------------------------------------------
    // Header 构建
    // -----------------------------------------------------------------------

    private buildBpHeader(
        existing: Manifest,
        bp: NonNullable<ResolvedConfig["packs"]["bp"]>,
        formatVersion: number
    ): ManifestHeader {
        return {
            ...(existing.header ?? {}),
            name: bp.name,
            ...(bp.description !== undefined
                ? { description: bp.description }
                : {}),
            uuid: bp.uuid,
            version: this.getVersionFor(formatVersion),
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
            version: this.getVersionFor(formatVersion),
            min_engine_version: this.normalizeMinEngineVersion(
                existing.header?.min_engine_version,
                formatVersion
            ),
        };
    }

    // -----------------------------------------------------------------------
    // Module 管理
    // -----------------------------------------------------------------------

    /** Compute the relative entry path for compiled scripts, e.g. "scripts/main.js". */
    private getScriptEntry(): string {
        const compile = this.config.packs.bp?.compile;
        if (!compile) return "scripts/main.js";
        const dir = compile.scriptOutputDir;
        const basename = path.basename(compile.entry, path.extname(compile.entry));
        return `${dir}/${basename}.js`;
    }

    private isManagedBpModule(
        module: ManifestModule,
        bp: NonNullable<ResolvedConfig["packs"]["bp"]>
    ): boolean {
        if (module.type !== "script" || module.language !== "javascript") return false;
        const scriptEntry = this.getScriptEntry();
        return module.uuid === bp.moduleUuid || module.entry === scriptEntry;
    }

    private isManagedRpModule(
        module: ManifestModule,
        rp: NonNullable<ResolvedConfig["packs"]["rp"]>
    ): boolean {
        if (module.type !== "resources") return false;
        return module.uuid === rp.moduleUuid;
    }

    private createScriptModule(
        bp: NonNullable<ResolvedConfig["packs"]["bp"]>,
        formatVersion: number
    ): ManifestScriptModule {
        return {
            type: "script",
            language: "javascript",
            uuid: bp.moduleUuid!,
            version: this.getModuleVersion(formatVersion),
            entry: this.getScriptEntry(),
        };
    }

    private createResourcesModule(
        rp: NonNullable<ResolvedConfig["packs"]["rp"]>,
        formatVersion: number
    ): ManifestResourcesModule {
        return {
            type: "resources",
            uuid: rp.moduleUuid,
            version: this.getModuleVersion(formatVersion),
        };
    }

    private replaceManagedBpModules(
        existingModules: ManifestModule[] | undefined,
        bp: NonNullable<ResolvedConfig["packs"]["bp"]>,
        formatVersion: number
    ): ManifestModule[] {
        const existing = asArray<ManifestModule>(existingModules);
        const userModules = existing.filter((m) => !this.isManagedBpModule(m, bp));
        return [...userModules, this.createScriptModule(bp, formatVersion)];
    }

    private replaceManagedRpModules(
        existingModules: ManifestModule[] | undefined,
        rp: NonNullable<ResolvedConfig["packs"]["rp"]>,
        formatVersion: number
    ): ManifestModule[] {
        const existing = asArray<ManifestModule>(existingModules);
        const userModules = existing.filter((m) => !this.isManagedRpModule(m, rp));
        return [...userModules, this.createResourcesModule(rp, formatVersion)];
    }

    // -----------------------------------------------------------------------
    // Achievement / PBR
    // -----------------------------------------------------------------------

    private applyAchievementMetadata(
        manifest: Manifest,
        bp: NonNullable<ResolvedConfig["packs"]["bp"]>
    ): void {
        if (bp.achievement === true) {
            manifest.metadata = { ...(manifest.metadata ?? {}), product_type: "addon" };
        } else if (bp.achievement === false && manifest.metadata) {
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

    /** 根据 format_version 返回正确的版本格式 */
    private getVersionFor(formatVersion: number): ManifestVersion {
        return formatVersion === 3 ? this.versionStr : this.version;
    }

    /** 根据 format_version 返回 module 的版本格式 */
    private getModuleVersion(formatVersion: number): ManifestVersion {
        return formatVersion === 3 ? "1.0.0" : MODULE_VERSION;
    }

    private getWriteFormatVersion(existing: Manifest): number {
        if (this.config.manifestFormat !== undefined) return this.config.manifestFormat;
        return existing.format_version ?? MANIFEST_FORMAT_VERSION;
    }

    private normalizeMinEngineVersion(
        existingValue: unknown,
        formatVersion: number
    ): ManifestVersion {
        if (existingValue === undefined || existingValue === null) {
            return formatVersion === 3 ? "1.21.0" : MIN_ENGINE_VERSION;
        }

        if (Array.isArray(existingValue)) {
            if (formatVersion === 3) {
                return existingValue.join(".");
            }
            return existingValue as [number, number, number];
        }

        if (typeof existingValue === "string") {
            if (formatVersion === 2) {
                const parts = existingValue.split(".").map(Number);
                if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
                    return parts as [number, number, number];
                }
            }
            return existingValue;
        }

        return formatVersion === 3 ? "1.21.0" : MIN_ENGINE_VERSION;
    }

    // -----------------------------------------------------------------------
    // 辅助
    // -----------------------------------------------------------------------

    private requireBp(): NonNullable<ResolvedConfig["packs"]["bp"]> {
        if (!this.config.packs.bp) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.bp is required to build the BP manifest."
            );
        }
        return this.config.packs.bp;
    }

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
