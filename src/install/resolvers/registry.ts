import { BePackError } from "../../errors/BePackError.js";
import type {
    DependencyResolverContext,
    DependencyResolverResult,
    DependencyResolverRule,
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
    constructor(private readonly resolvers: DependencyResolverRule[]) {}

    static fromConfig(customResolvers: DependencyResolverRule[]): DependencyResolverRegistry {
        return new DependencyResolverRegistry([
            ...customResolvers,
            ...BUILTIN_DEPENDENCY_RESOLVERS,
        ]);
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
        const rule = this.resolvers.find(
            (candidate) => this.resolverMatchesCatalog(ctx, candidate) && candidate.match(ctx)
        );
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
        return await this.find(ctx).resolve(ctx);
    }
}
