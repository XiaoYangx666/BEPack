import { BePackError } from "../errors/BePackError.js";
import { targetSupportsChannelDependency } from "../utils/semver.js";

/**
 * 检查依赖 specifier 的语法是否合法。
 */
export function isAllowedDependencySpecifier(value: string): boolean {
    return (
        value === "stable" ||
        value === "beta" ||
        value === "preview" ||
        /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(value)
    );
}

/**
 * 将依赖 specifier 解析为写入 manifest.json 的具体版本字符串。
 *
 * - `stable`: 需要已解析版本（来自 install）。
 * - `beta`:  现代 target 返回 "beta"，否则回退到已解析版本。
 * - `preview`: 需要已解析版本。
 * - 具体版本: 原样返回。
 */
export function resolveManifestDependencyVersion(options: {
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
 * achievement 模式只允许 stable 和具体版本，不允许 beta/preview。
 */
export function isAchievementCompatibleSpecifier(specifier: string): boolean {
    return specifier !== "beta" && specifier !== "preview";
}
