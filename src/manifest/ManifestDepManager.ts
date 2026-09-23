import { BePackError } from "../errors/BePackError.js";
import { parseVersionTuple, targetSupportsChannelDependency } from "../utils/semver.js";
import { asArray } from "./ManifestFile.js";
import type { ResolvedConfig, DependencyCatalogEntry } from "../config/configTypes.js";
import type { ManifestDependency, ManifestVersion } from "./types.js";

/** 依赖版本来自哪一层，用于诊断输出。 */
export type DependencyVersionSource = "config" | "install" | "manifest";

/** 一条受管依赖最终写入 manifest 的版本及其来源。 */
export type ResolvedManifestDependency = {
    name: string;
    specifier: string;
    version: string;
    source: DependencyVersionSource;
};

/**
 * 具体版本的两个来源：
 * - `install`：`bepack install` / `build --install` 从 registry 解析出的版本。
 * - `manifest`：现有 manifest 中已经写入的版本（离线构建时复用）。
 */
export type DependencyVersionSources = {
    install?: Record<string, string>;
    manifest?: Record<string, string>;
};

/**
 * ManifestDepManager 统一管理 manifest 依赖的：
 * - 校验（语法 + 政策）
 * - 识别（哪些 dep 是 BePack 管理的）
 * - 构建（将 config 中的依赖 specifier 转为 manifest 格式）
 * - 替换（合并用户手写依赖与 BePack 管理依赖）
 *
 * 版本优先级（高 → 低）：config 中的具体版本 > install 解析结果 > 现有 manifest 值。
 * 也就是说，配置里写死 `"2.10.0"` 时任何解析结果都不会覆盖它。
 */
export class ManifestDepManager {
    private readonly config: ResolvedConfig;
    private readonly catalog: Record<string, DependencyCatalogEntry>;
    private readonly installVersions: Record<string, string>;
    private readonly manifestVersions: Record<string, string>;
    private readonly version: ManifestVersion;
    private readonly versionStr: string;
    private readonly dependencyDiagnostics: ResolvedManifestDependency[] = [];

    constructor(
        config: ResolvedConfig,
        catalog: Record<string, DependencyCatalogEntry>,
        sources: DependencyVersionSources = {}
    ) {
        this.config = config;
        this.catalog = catalog;
        this.installVersions = sources.install ?? {};
        this.manifestVersions = sources.manifest ?? {};
        this.version = parseVersionTuple(config.version);
        this.versionStr = config.version;
    }

    // -----------------------------------------------------------------------
    // 纯函数（静态）
    // -----------------------------------------------------------------------

    /**
     * 检查依赖 specifier 的语法是否合法。
     */
    static isAllowedSpecifier(value: string): boolean {
        return (
            value === "stable" ||
            value === "beta" ||
            value === "preview" ||
            /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(value)
        );
    }

    /**
     * 将依赖 specifier 解析为写入 manifest.json 的具体版本字符串。
     */
    static resolveVersion(options: {
        specifier: string;
        target: string;
        resolvedVersion?: string | undefined;
        manifestVersion?: string | undefined;
    }): string {
        return ManifestDepManager.resolveVersionDetail(options).version;
    }

    /**
     * 同 `resolveVersion`，但同时返回版本来源，便于构建日志说明
     * 「这个版本是谁写的」（config / install / 现有 manifest）。
     */
    static resolveVersionDetail(options: {
        specifier: string;
        target: string;
        resolvedVersion?: string | undefined;
        manifestVersion?: string | undefined;
    }): { version: string; source: DependencyVersionSource } {
        const { specifier, target, resolvedVersion, manifestVersion } = options;

        if (specifier === "stable") {
            if (resolvedVersion) return { version: resolvedVersion, source: "install" };
            if (manifestVersion) return { version: manifestVersion, source: "manifest" };
            throw new BePackError(
                "DEPENDENCY_REQUIRES_INSTALL",
                "Run `bepack install` to resolve stable manifest dependencies.",
                { details: { specifier, target } }
            );
        }

        if (specifier === "beta") {
            if (targetSupportsChannelDependency(target))
                return { version: "beta", source: "config" };
            if (resolvedVersion) return { version: resolvedVersion, source: "install" };
            if (manifestVersion) return { version: manifestVersion, source: "manifest" };
            throw new BePackError(
                "DEPENDENCY_REQUIRES_INSTALL",
                `Run \`bepack install\` to resolve manifest dependencies for target ${target}.`,
                { details: { target } }
            );
        }

        if (specifier === "preview") {
            if (resolvedVersion) return { version: resolvedVersion, source: "install" };
            if (manifestVersion) return { version: manifestVersion, source: "manifest" };
            throw new BePackError(
                "DEPENDENCY_REQUIRES_INSTALL",
                `Run \`bepack install\` to resolve preview manifest dependencies for target ${target}.`,
                { details: { specifier, target } }
            );
        }

        // 具体版本号：config 是权威来源，任何解析结果都不会覆盖它
        return { version: specifier, source: "config" };
    }

    // -----------------------------------------------------------------------
    // 依赖校验
    // -----------------------------------------------------------------------

    /** 校验 config 中声明的 BP 依赖是否合法。 */
    validateBpDependencies(): void {
        if (!this.config.packs.bp) return;

        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            if (!this.catalog[name]) {
                const available = Object.keys(this.catalog);
                const suggestion =
                    available.length > 0
                        ? [
                              `Managed packages: ${available.join(", ")}.`,
                              "Add a missing package to install.dependencyCatalog, or remove it from packs.bp.dependencies.",
                          ]
                        : [
                              "No managed packages are available. Extend install.dependencyCatalog to add one.",
                          ];
                throw new BePackError(
                    "UNSUPPORTED_DEPENDENCY",
                    `${name} is not a managed dependency.`,
                    {
                        details: { package: name },
                        suggestions: suggestion,
                    }
                );
            }
            if (!ManifestDepManager.isAllowedSpecifier(specifier)) {
                throw new BePackError(
                    "DEPENDENCY_VERSION_INVALID",
                    `${name} dependency version is invalid: ${specifier}`,
                    { details: { package: name, specifier } }
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // 依赖识别
    // -----------------------------------------------------------------------

    /**
     * 判断 dependency 是否为 BePack 管理的 BP 依赖。
     */
    isManagedBpDependency(dep: ManifestDependency): boolean {
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
    isManagedRpDependency(dep: ManifestDependency, bpUuid: string | undefined): boolean {
        return (
            bpUuid !== undefined &&
            "uuid" in dep &&
            typeof dep.uuid === "string" &&
            dep.uuid === bpUuid
        );
    }

    // -----------------------------------------------------------------------
    // 依赖构建
    // -----------------------------------------------------------------------

    /** 构建 catalog 中 manifest=true 的 module_name 依赖列表。 */
    private buildManagedDependencies(): ManifestDependency[] {
        // Rebuilt from scratch on every call (buildBp + buildRp), so reset diagnostics.
        this.dependencyDiagnostics.length = 0;
        if (!this.config.packs.bp) return [];

        const deps: ManifestDependency[] = [];

        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            const entry = this.catalog[name];
            if (!entry?.manifest) continue;

            const detail = ManifestDepManager.resolveVersionDetail({
                specifier,
                target: this.config.target,
                resolvedVersion: this.installVersions[name],
                manifestVersion: this.manifestVersions[name],
            });
            deps.push({
                module_name: name,
                version: detail.version,
            });
            this.dependencyDiagnostics.push({
                name,
                specifier,
                version: detail.version,
                source: detail.source,
            });
        }

        return deps;
    }

    /** 最近一次构建中每条受管依赖最终写入的版本及其来源。 */
    getDependencyDiagnostics(): readonly ResolvedManifestDependency[] {
        return this.dependencyDiagnostics;
    }

    // -----------------------------------------------------------------------
    // 依赖替换
    // -----------------------------------------------------------------------

    /** 根据 formatVersion 返回 uuid 依赖的正确版本格式 */
    private getFormatAwareVersion(formatVersion?: number): ManifestVersion {
        const fv = formatVersion ?? this.config.manifestFormat ?? 2;
        return fv === 3 ? this.versionStr : this.version;
    }

    /**
     * 替换 BP 依赖：保留用户手写依赖 + 插入管理依赖 + RP UUID 交叉引用。
     */
    replaceBpDependencies(
        existingDeps: ManifestDependency[] | undefined,
        rpUuid: string | undefined,
        formatVersion?: number
    ): ManifestDependency[] {
        const existing = asArray<ManifestDependency>(existingDeps);

        // 保留用户手写依赖，删除 BePack 管理依赖
        const userDeps = existing.filter((dep) => !this.isManagedBpDependency(dep));

        // 构建新管理依赖
        const nextManaged = this.buildManagedDependencies();
        if (rpUuid) {
            nextManaged.push({
                uuid: rpUuid,
                version: this.getFormatAwareVersion(formatVersion),
            });
        }

        return [...userDeps, ...nextManaged];
    }

    /**
     * 替换 RP 依赖：保留用户手写依赖 + BP UUID 交叉引用。
     */
    replaceRpDependencies(
        existingDeps: ManifestDependency[] | undefined,
        bpUuid: string | undefined,
        formatVersion?: number
    ): ManifestDependency[] {
        const existing = asArray<ManifestDependency>(existingDeps);

        // 保留用户手写依赖，删除旧的 BP UUID 依赖
        const userDeps = existing.filter((dep) => !this.isManagedRpDependency(dep, bpUuid));

        if (!bpUuid) return userDeps;
        return [
            ...userDeps,
            {
                uuid: bpUuid,
                version: this.getFormatAwareVersion(formatVersion),
            },
        ];
    }

    // -----------------------------------------------------------------------
    // Clean 模式依赖构建（丢弃非 managed 条目）
    // -----------------------------------------------------------------------

    /** clean 模式 BP 依赖：管理依赖 + RP 交叉引用 + extra 依赖。 */
    buildBpDependenciesClean(
        formatVersion: number,
        rpUuid: string | undefined,
        extra: Record<string, unknown>[]
    ): ManifestDependency[] {
        const deps = this.buildManagedDependencies();
        if (rpUuid) {
            deps.push({ uuid: rpUuid, version: this.getFormatAwareVersion(formatVersion) });
        }
        return [...deps, ...(extra as ManifestDependency[])];
    }

    /** clean 模式 RP 依赖：BP 交叉引用 + extra 依赖。 */
    buildRpDependenciesClean(
        formatVersion: number,
        bpUuid: string | undefined,
        extra: Record<string, unknown>[]
    ): ManifestDependency[] {
        const deps: ManifestDependency[] = [];
        if (bpUuid) {
            deps.push({ uuid: bpUuid, version: this.getFormatAwareVersion(formatVersion) });
        }
        return [...deps, ...(extra as ManifestDependency[])];
    }
}
