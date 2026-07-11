import { BePackError } from "../errors/BePackError.js";
import { parseVersionTuple, targetSupportsChannelDependency } from "../utils/semver.js";
import { asArray } from "./ManifestFile.js";
import type { ResolvedConfig, DependencyCatalogEntry } from "../config/configTypes.js";
import type { ManifestDependency, ManifestVersion } from "./types.js";

/**
 * ManifestDepManager 统一管理 manifest 依赖的：
 * - 校验（语法 + 政策）
 * - 识别（哪些 dep 是 BePack 管理的）
 * - 构建（将 config 中的依赖 specifier 转为 manifest 格式）
 * - 替换（合并用户手写依赖与 BePack 管理依赖）
 */
export class ManifestDepManager {
    private readonly config: ResolvedConfig;
    private readonly catalog: Record<string, DependencyCatalogEntry>;
    private readonly resolvedDeps: Record<string, string>;
    private readonly version: ManifestVersion;

    constructor(
        config: ResolvedConfig,
        catalog: Record<string, DependencyCatalogEntry>,
        resolvedDeps?: Record<string, string>
    ) {
        this.config = config;
        this.catalog = catalog;
        this.resolvedDeps = resolvedDeps ?? {};
        this.version = parseVersionTuple(config.version);
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
    }): string {
        const { specifier, target, resolvedVersion } = options;

        if (specifier === "stable") {
            if (resolvedVersion) return resolvedVersion;
            throw new BePackError(
                "DEPENDENCY_REQUIRES_INSTALL",
                "Run `bepack install` to resolve stable manifest dependencies.",
                { details: { specifier, target } }
            );
        }

        if (specifier === "beta") {
            if (targetSupportsChannelDependency(target)) return "beta";
            if (resolvedVersion) return resolvedVersion;
            throw new BePackError(
                "DEPENDENCY_REQUIRES_INSTALL",
                `Run \`bepack install\` to resolve manifest dependencies for target ${target}.`,
                { details: { target } }
            );
        }

        if (specifier === "preview") {
            if (resolvedVersion) return resolvedVersion;
            throw new BePackError(
                "DEPENDENCY_REQUIRES_INSTALL",
                `Run \`bepack install\` to resolve preview manifest dependencies for target ${target}.`,
                { details: { specifier, target } }
            );
        }

        // 具体版本号，原样返回
        return specifier;
    }

    /**
     * 检查 specifier 是否与 achievement 模式兼容。
     */
    static isAchievementCompatible(specifier: string): boolean {
        return specifier !== "beta" && specifier !== "preview";
    }

    // -----------------------------------------------------------------------
    // 依赖校验
    // -----------------------------------------------------------------------

    /** 校验 config 中声明的 BP 依赖是否合法。 */
    validateBpDependencies(): void {
        if (!this.config.packs.bp) return;

        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            if (!this.catalog[name]) {
                throw new BePackError(
                    "UNSUPPORTED_DEPENDENCY",
                    `${name} is not a managed dependency. Add it to install.dependencyCatalog or remove it from packs.bp.dependencies.`,
                    { details: { package: name } }
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

        if (this.config.packs.bp.achievement) {
            for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
                if (!ManifestDepManager.isAchievementCompatible(specifier)) {
                    throw new BePackError(
                        "ACHIEVEMENT_REQUIRES_STABLE_API",
                        `${name}: achievement requires stable Script API dependencies (${specifier} is not allowed).`
                    );
                }
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
    isManagedRpDependency(dep: ManifestDependency, bpUuid: string): boolean {
        return (
            "uuid" in dep && typeof dep.uuid === "string" && dep.uuid === bpUuid
        );
    }

    // -----------------------------------------------------------------------
    // 依赖构建
    // -----------------------------------------------------------------------

    /** 构建 catalog 中 manifest=true 的 module_name 依赖列表。 */
    private buildManagedDependencies(): ManifestDependency[] {
        if (!this.config.packs.bp) return [];

        const deps: ManifestDependency[] = [];

        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            const entry = this.catalog[name];
            if (!entry?.manifest) continue;

            deps.push({
                module_name: name,
                version: ManifestDepManager.resolveVersion({
                    specifier,
                    target: this.config.target,
                    resolvedVersion: this.resolvedDeps[name],
                }),
            });
        }

        return deps;
    }

    // -----------------------------------------------------------------------
    // 依赖替换
    // -----------------------------------------------------------------------

    /**
     * 替换 BP 依赖：保留用户手写依赖 + 插入管理依赖 + RP UUID 交叉引用。
     */
    replaceBpDependencies(
        existingDeps: ManifestDependency[] | undefined,
        rpUuid: string | undefined
    ): ManifestDependency[] {
        const existing = asArray<ManifestDependency>(existingDeps);

        // 保留用户手写依赖，删除 BePack 管理依赖
        const userDeps = existing.filter((dep) => !this.isManagedBpDependency(dep));

        // 构建新管理依赖
        const nextManaged = this.buildManagedDependencies();
        if (rpUuid) {
            nextManaged.push({
                uuid: rpUuid,
                version: this.version,
            });
        }

        return [...userDeps, ...nextManaged];
    }

    /**
     * 替换 RP 依赖：保留用户手写依赖 + BP UUID 交叉引用。
     */
    replaceRpDependencies(
        existingDeps: ManifestDependency[] | undefined,
        bpUuid: string
    ): ManifestDependency[] {
        const existing = asArray<ManifestDependency>(existingDeps);

        // 保留用户手写依赖，删除旧的 BP UUID 依赖
        const userDeps = existing.filter((dep) => !this.isManagedRpDependency(dep, bpUuid));

        return [
            ...userDeps,
            {
                uuid: bpUuid,
                version: this.version,
            },
        ];
    }
}
