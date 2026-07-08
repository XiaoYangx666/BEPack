import type { DependencyResolverRule } from "../../config/configTypes.js";
import { MinecraftPackageResolver } from "../MinecraftPackageResolver.js";
import {
    latestBetaFromAllVersions,
    latestPreviewVersion,
    previewVersionForTarget,
    resolveManifestVersion,
} from "./minecraftScriptApi.js";

// ---------------------------------------------------------------------------
// minecraft-script-api-bp resolver (beta/preview only, no stable)
// ---------------------------------------------------------------------------

export const minecraftScriptApiBpResolver: DependencyResolverRule = {
    name: "minecraft-script-api-bp",
    resolver: "minecraft-script-api-bp",

    match: (ctx) => ctx.specifier === "beta" || ctx.specifier === "preview",

    async resolve(ctx) {
        const metadata = await ctx.npm.metadata(ctx.packageName);
        const pkg = new MinecraftPackageResolver(ctx.npm, ctx.logger);

        if (ctx.specifier === "beta") {
            ctx.logger?.verbose(`Resolving ${ctx.packageName}@beta for target ${ctx.target}`);
            const packageVersion =
                ctx.target === "latest"
                    ? latestBetaFromAllVersions(
                          ctx.packageName,
                          ctx.npm.versions(metadata),
                          ctx.logger
                      )
                    : pkg.betaForTarget(ctx.packageName, ctx.target, metadata);
            return {
                packageVersion,
                manifestVersion: resolveManifestVersion(packageVersion, ctx.target),
            };
        }

        // specifier === "preview" — full version string written to manifest
        ctx.logger?.verbose(`Resolving ${ctx.packageName}@preview for target ${ctx.target}`);
        const packageVersion =
            ctx.target === "latest"
                ? latestPreviewVersion(ctx.packageName, ctx.npm.versions(metadata), ctx.logger)
                : previewVersionForTarget(
                      ctx.packageName,
                      ctx.npm.versions(metadata),
                      ctx.target,
                      ctx.logger
                  );
        return {
            packageVersion,
            manifestVersion: packageVersion,
        };
    },
};
