import { BUILTIN_DEPENDENCY_CATALOG } from "../constants/dependencyCatalog.js";
import { BePackError } from "../errors/BePackError.js";
import { DependencyResolverRegistry } from "../install/resolvers/registry.js";
import { compareLooseSemver, satisfiesSemver } from "../utils/semver.js";
import type {
    BePackPlugin,
    DependencyResolverContext,
    DependencyResolverRule,
    NpmPackageVersionMetadata,
} from "../config/configTypes.js";

const SAPI_PRO = "sapi-pro";
const REQUIRED_SCRIPT_API_PACKAGES = ["@minecraft/server", "@minecraft/server-ui"];

function isChannelVersion(version: string): boolean {
    return /(?:beta|preview|alpha|rc)/i.test(version);
}

function dependencyChannel(version: string): "stable" | "beta" {
    return isChannelVersion(version) ? "beta" : "stable";
}

function minecraftRequirements(manifest: NpmPackageVersionMetadata): Record<string, string> {
    return {
        ...(manifest.dependencies ?? {}),
        ...(manifest.peerDependencies ?? {}),
    };
}

async function satisfiesMinecraftRequirements(
    ctx: DependencyResolverContext,
    requirements: Record<string, string>
): Promise<boolean> {
    const declared = ctx.config.packs.bp?.dependencies ?? {};
    const registry = DependencyResolverRegistry.fromConfig([]);
    for (const [packageName, requiredVersion] of Object.entries(requirements)) {
        if (!packageName.startsWith("@minecraft/")) continue;
        const specifier = declared[packageName];
        const entry = BUILTIN_DEPENDENCY_CATALOG[packageName];
        if (!specifier || !entry) return false;
        const actual = await registry.resolve({
            packageName,
            specifier,
            target: ctx.target,
            entry,
            config: ctx.config,
            npm: ctx.npm,
            ...(ctx.logger ? { logger: ctx.logger } : {}),
        });
        if (
            REQUIRED_SCRIPT_API_PACKAGES.includes(packageName) &&
            isChannelVersion(requiredVersion) !== isChannelVersion(actual.packageVersion)
        ) {
            return false;
        }
        if (!satisfiesSemver(actual.packageVersion, requiredVersion)) return false;
    }
    return true;
}

function candidateVersions(
    versions: Record<string, NpmPackageVersionMetadata>,
    specifier: string
): Array<[string, NpmPackageVersionMetadata]> {
    if (specifier !== "stable" && specifier !== "beta") {
        const manifest = versions[specifier];
        return manifest ? [[specifier, manifest]] : [];
    }
    return Object.entries(versions)
        .filter(([version, manifest]) => {
            const requirements = minecraftRequirements(manifest);
            if (Object.keys(requirements).length === 0) return false;
            return specifier === "stable"
                ? /-stable(?:\.\d+)?$/i.test(version)
                : /^\d+\.\d+\.\d+$/.test(version);
        })
        .sort(([left], [right]) => compareLooseSemver(left, right))
        .reverse();
}

const sapiProResolver: DependencyResolverRule = {
    name: "sapi-pro",
    resolver: "sapi-pro",
    match: (ctx) =>
        ctx.specifier === "stable" ||
        ctx.specifier === "beta" ||
        /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(ctx.specifier),
    async resolve(ctx) {
        const metadata = await ctx.npm.metadata(SAPI_PRO);
        for (const [version, manifest] of candidateVersions(
            metadata.versions ?? {},
            ctx.specifier
        )) {
            if (!(await satisfiesMinecraftRequirements(ctx, minecraftRequirements(manifest)))) {
                continue;
            }
            if (/^0\.3\./.test(version)) {
                ctx.logger?.warn(
                    `sapi-pro@${version} uses legacy metadata; compatibility is best-effort only.`
                );
            }
            return { packageVersion: version, manifestVersion: null };
        }
        throw new BePackError(
            "SAPI_VERSION_NOT_FOUND",
            `Cannot find a compatible ${SAPI_PRO}@${ctx.specifier} for target ${ctx.target}.`,
            {
                details: { package: SAPI_PRO, specifier: ctx.specifier, target: ctx.target },
                suggestions: [
                    "Explicitly declare the @minecraft packages required by sapi-pro.",
                    "Use a compatible target or specify an exact sapi-pro version.",
                ],
            }
        );
    },
};

/**
 * Resolves sapi-pro against explicitly declared Minecraft Script API packages.
 * sapi-pro itself is package-only and is never written to manifest.json.
 */
export function sapiPro(): BePackPlugin {
    return {
        name: "sapi-pro",
        apiVersion: 1,
        description: "Resolve sapi-pro versions compatible with BePack Script API dependencies.",
        configResolved: ({ config }) => {
            const dependencies = config.packs.bp?.dependencies ?? {};
            const sapiProSpecifier = dependencies[SAPI_PRO];
            if (!sapiProSpecifier) return;
            const missing = REQUIRED_SCRIPT_API_PACKAGES.filter(
                (packageName) => !dependencies[packageName]
            );
            if (missing.length > 0) {
                throw new Error(`sapi-pro requires explicit dependencies: ${missing.join(", ")}.`);
            }
            if (sapiProSpecifier === "stable" || sapiProSpecifier === "beta") {
                for (const packageName of REQUIRED_SCRIPT_API_PACKAGES) {
                    const specifier = dependencies[packageName]!;
                    if (dependencyChannel(specifier) !== sapiProSpecifier) {
                        throw new Error(
                            `sapi-pro ${sapiProSpecifier} requires ${packageName} to use ${sapiProSpecifier}, received ${specifier}.`
                        );
                    }
                }
            }
        },
        install: {
            dependencyCatalog: { [SAPI_PRO]: { resolver: "sapi-pro", manifest: false } },
            dependencyResolvers: [sapiProResolver],
        },
    };
}
