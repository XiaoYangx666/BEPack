import { BePackError } from "../errors/BePackError.js";
import {
    MANIFEST_FORMAT_VERSION,
    MIN_ENGINE_VERSION,
    MODULE_VERSION,
    SCRIPT_ENTRY,
} from "../constants/manifest.js";
import { parseVersionTuple } from "../utils/semver.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";
import type { ResolvedConfig, DependencyCatalogEntry } from "../config/configTypes.js";
import { normalizeManifest, asArray, removeEmptyObject } from "./normalize.js";
import {
    isAllowedDependencySpecifier,
    resolveManifestDependencyVersion,
    isAchievementCompatibleSpecifier,
} from "./dependencyVersion.js";
import type {
    Manifest,
    ManifestVersion,
    ManifestHeader,
    ManifestModule,
    ManifestDependency,
    ManifestScriptModule,
    ManifestResourcesModule,
} from "./types.js";

/**
 * ManifestBuilder 封装一次 manifest 构建过程的共享状态。
 *
 * 构造时预计算 version tuple 和 dependency catalog，
 * 构建 BP/RP manifest 时无需再层层传递 config 参数。
 */
export class ManifestBuilder {
    private readonly config: ResolvedConfig;
    private readonly version: ManifestVersion;
    private readonly catalog: Record<string, DependencyCatalogEntry>;
    private readonly resolvedDeps: Record<string, string>;

    constructor(config: ResolvedConfig, resolvedDeps?: Record<string, string>) {
        this.config = config;
        this.version = parseVersionTuple(config.version);
        this.catalog = createDependencyCatalog(config);
        this.resolvedDeps = resolvedDeps ?? {};
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
        this.validateBpDependencies();

        const manifest: Manifest = {
            ...existing,
            format_version: MANIFEST_FORMAT_VERSION,
            header: this.buildBpHeader(existing),
            modules: this.replaceManagedBpModules(existing.modules),
            dependencies: this.replaceManagedBpDependencies(existing.dependencies),
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
            dependencies: this.replaceManagedRpDependencies(existing.dependencies),
        };

        this.applyPbrCapability(manifest, rp);
        return manifest;
    }

    // -----------------------------------------------------------------------
    // 依赖校验
    // -----------------------------------------------------------------------

    private validateBpDependencies(): void {
        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            if (!this.catalog[name]) {
                throw new BePackError(
                    "UNSUPPORTED_DEPENDENCY",
                    `${name} is not a managed dependency. Add it to install.dependencyCatalog or remove it from packs.bp.dependencies.`,
                    { details: { package: name } }
                );
            }
            if (!isAllowedDependencySpecifier(specifier)) {
                throw new BePackError(
                    "DEPENDENCY_VERSION_INVALID",
                    `${name} dependency version is invalid: ${specifier}`,
                    { details: { package: name, specifier } }
                );
            }
        }

        if (this.config.packs.bp.achievement) {
            for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
                if (!isAchievementCompatibleSpecifier(specifier)) {
                    throw new BePackError(
                        "ACHIEVEMENT_REQUIRES_STABLE_API",
                        `${name}: achievement requires stable Script API dependencies (${specifier} is not allowed).`
                    );
                }
            }
        }
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
    // Dependency 管理
    // -----------------------------------------------------------------------

    /**
     * 判断 dependency 是否为 BePack 管理的 BP 依赖。
     * 包括 catalog 中 manifest=true 的 module_name 依赖和 RP UUID 依赖。
     */
    private isManagedBpDependency(dep: ManifestDependency): boolean {
        if (
            "module_name" in dep &&
            typeof dep.module_name === "string" &&
            this.catalog[dep.module_name]?.manifest
        ) {
            return true;
        }
        if (
            "uuid" in dep &&
            typeof dep.uuid === "string" &&
            this.config.packs.rp?.uuid === dep.uuid
        ) {
            return true;
        }
        return false;
    }

    /**
     * 判断 dependency 是否为 BePack 管理的 RP 依赖（BP UUID 依赖）。
     */
    private isManagedRpDependency(dep: ManifestDependency): boolean {
        return (
            "uuid" in dep && typeof dep.uuid === "string" && dep.uuid === this.config.packs.bp.uuid
        );
    }

    /** 构建 catalog 中 manifest=true 的 module_name 依赖列表。 */
    private buildBpManagedDependencies(): ManifestDependency[] {
        const deps: ManifestDependency[] = [];

        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            const entry = this.catalog[name];
            if (!entry?.manifest) continue;

            deps.push({
                module_name: name,
                version: resolveManifestDependencyVersion({
                    specifier,
                    target: this.config.target,
                    resolvedVersion: this.resolvedDeps[name],
                }),
            });
        }

        return deps;
    }

    private replaceManagedBpDependencies(
        existingDeps: ManifestDependency[] | undefined
    ): ManifestDependency[] {
        const existing = asArray<ManifestDependency>(existingDeps);

        // 保留用户手写依赖，删除 BePack 管理依赖
        const userDeps = existing.filter((dep) => !this.isManagedBpDependency(dep));

        // 构建新管理依赖
        const nextManaged = this.buildBpManagedDependencies();
        if (this.config.packs.rp) {
            nextManaged.push({
                uuid: this.config.packs.rp.uuid,
                version: this.version,
            });
        }

        return [...userDeps, ...nextManaged];
    }

    private replaceManagedRpDependencies(
        existingDeps: ManifestDependency[] | undefined
    ): ManifestDependency[] {
        const existing = asArray<ManifestDependency>(existingDeps);

        // 保留用户手写依赖，删除旧的 BP UUID 依赖
        const userDeps = existing.filter((dep) => !this.isManagedRpDependency(dep));

        return [...userDeps, { uuid: this.config.packs.bp.uuid, version: this.version }];
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
