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

        const manifest: Manifest = {
            ...existing,
            format_version: MANIFEST_FORMAT_VERSION,
            header: this.buildBpHeader(existing),
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

        const manifest: Manifest = {
            ...existing,
            format_version: MANIFEST_FORMAT_VERSION,
            header: this.buildRpHeader(existing, rp),
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

    private buildBpHeader(existing: Manifest): ManifestHeader {
        return {
            ...(existing.header ?? {}),
            name: this.config.packs.bp.name,
            ...(this.config.packs.bp.description !== undefined
                ? { description: this.config.packs.bp.description }
                : {}),
            uuid: this.config.packs.bp.uuid,
            version: this.version,
            min_engine_version: MIN_ENGINE_VERSION,
        };
    }

    private buildRpHeader(
        existing: Manifest,
        rp: NonNullable<ResolvedConfig["packs"]["rp"]>
    ): ManifestHeader {
        return {
            ...(existing.header ?? {}),
            name: rp.name,
            ...(rp.description !== undefined ? { description: rp.description } : {}),
            uuid: rp.uuid,
            version: this.version,
            min_engine_version: MIN_ENGINE_VERSION,
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
