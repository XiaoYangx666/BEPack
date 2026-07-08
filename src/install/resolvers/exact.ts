import { isSpecificVersion } from "../../utils/semver.js";
import { packageVersionForSpecifier } from "../MinecraftPackageResolver.js";
import type {
    DependencyResolverContext,
    DependencyResolverResult,
    DependencyResolverRule,
} from "../../config/configTypes.js";

export const exactVersionResolver: DependencyResolverRule = {
    name: "exact-version",
    match: (ctx) => isSpecificVersion(ctx.specifier),
    resolve(ctx: DependencyResolverContext): DependencyResolverResult {
        ctx.logger?.verbose(`Using exact ${ctx.packageName}@${ctx.specifier}`);
        return {
            packageVersion: packageVersionForSpecifier(ctx.specifier),
            manifestVersion: ctx.specifier,
        };
    },
};
