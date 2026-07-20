import { BePackError } from "../../errors/BePackError.js";
import type {
    DependencyResolverContext,
    DependencyResolverResult,
    DependencyResolverRule,
    BePackPlugin,
} from "../../config/configTypes.js";
import { exactVersionResolver } from "./exact.js";
import { minecraftScriptApiResolver } from "./minecraftScriptApi.js";
import { minecraftScriptApiBpResolver } from "./minecraftScriptApiBp.js";
import { minecraftVanillaDataResolver } from "./minecraftVanillaData.js";

export const BUILTIN_DEPENDENCY_RESOLVERS: DependencyResolverRule[] = [
    minecraftScriptApiResolver,
    minecraftScriptApiBpResolver,
    minecraftVanillaDataResolver,
    exactVersionResolver,
];

export class DependencyResolverRegistry {
    private readonly pluginNames = new Map<DependencyResolverRule, string>();

    constructor(
        private readonly resolvers: DependencyResolverRule[],
        plugins: BePackPlugin[] = []
    ) {
        for (const plugin of plugins) {
            for (const resolver of plugin.install?.dependencyResolvers ?? []) {
                this.pluginNames.set(resolver, plugin.name);
            }
        }
    }

    static fromConfig(
        customResolvers: DependencyResolverRule[],
        plugins: BePackPlugin[] = []
    ): DependencyResolverRegistry {
        return new DependencyResolverRegistry(
            [...customResolvers, ...BUILTIN_DEPENDENCY_RESOLVERS],
            plugins
        );
    }

    private resolverMatchesCatalog(
        ctx: DependencyResolverContext,
        rule: DependencyResolverRule
    ): boolean {
        const selected = ctx.entry.resolver;
        if (!selected) return true;

        // Normalize: direct object reference → use its .name as the group key
        const selectedName = typeof selected === "string" ? selected : selected.name;

        return rule.resolver === undefined || rule.resolver === selectedName;
    }

    find(ctx: DependencyResolverContext): DependencyResolverRule {
        let rule: DependencyResolverRule | undefined;
        for (const candidate of this.resolvers) {
            if (!this.resolverMatchesCatalog(ctx, candidate)) continue;
            try {
                if (candidate.match(ctx)) {
                    rule = candidate;
                    break;
                }
            } catch (cause) {
                const pluginName = this.pluginNames.get(candidate);
                if (!pluginName) throw cause;
                throw new BePackError(
                    "PLUGIN_FAILED",
                    `Plugin ${pluginName} resolver ${candidate.name} match failed: ${cause instanceof Error ? cause.message : String(cause)}`
                );
            }
        }
        if (!rule) {
            throw new BePackError(
                "DEPENDENCY_VERSION_INVALID",
                `${ctx.packageName} dependency version is invalid: ${ctx.specifier}`,
                {
                    details: {
                        package: ctx.packageName,
                        specifier: ctx.specifier,
                        resolver: ctx.entry.resolver,
                    },
                }
            );
        }
        ctx.logger?.verbose(`Resolving ${ctx.packageName}@${ctx.specifier} with ${rule.name}`);
        return rule;
    }

    async resolve(ctx: DependencyResolverContext): Promise<DependencyResolverResult> {
        const rule = this.find(ctx);
        try {
            return await rule.resolve(ctx);
        } catch (cause) {
            const pluginName = this.pluginNames.get(rule);
            if (!pluginName) throw cause;
            throw new BePackError(
                "PLUGIN_FAILED",
                `Plugin ${pluginName} resolver ${rule.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`
            );
        }
    }
}
