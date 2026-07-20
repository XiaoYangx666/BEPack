# BePack

BePack is a lightweight build tool for Minecraft Bedrock Edition Script API packs.

It helps Bedrock addon projects keep the boring parts tidy: config loading, manifest patching, Script API dependency resolution, TypeScript checks, Rolldown builds, copy targets, and `.mcpack` / `.mcaddon` packaging.

## Features

- Build TypeScript Script API entry files into `bp/scripts`.
- Patch behavior/resource pack manifests without discarding user-owned fields.
- Resolve managed `@minecraft/*` dependencies from npm.
- Extend dependency resolution with a configurable package catalog and custom resolvers.
- Copy packs to Minecraft Bedrock folders or custom targets.
- Package BP-only projects as `.mcpack`.
- Package BP + RP projects as one `.mcaddon`.
- Run lifecycle hooks for install, manifest, build, copy, and pack.

## Install

```bash
npm install -D bepack
```

## Quick Start

```bash
npx bepack init
npx bepack install
npx bepack build --pack
```

Example `bepack.config.ts`:

```ts
import { defineConfig } from "bepack";

export default defineConfig({
    name: "my-addon",
    version: "1.0.0",
    target: "latest",
    packs: {
        bp: {
            root: "bp",
            uuid: "00000000-0000-0000-0000-000000000001",
            moduleUuid: "00000000-0000-0000-0000-000000000002",
            compile: {
                entry: "src/main.ts",
            },
            dependencies: {
                "@minecraft/server": "stable",
            },
        },
        rp: {
            root: "rp",
            uuid: "00000000-0000-0000-0000-000000000003",
            moduleUuid: "00000000-0000-0000-0000-000000000004",
        },
    },
    pack: {
        outDir: "dist",
    },
});
```

## Commands

```bash
bepack init
bepack install
bepack manifest
bepack build
bepack dev
bepack copy
bepack pack
bepack config
```

Useful examples:

```bash
bepack build --install
bepack build --copy
bepack build --pack
bepack build --mode project
bepack dev --copy
bepack dev --mode project
bepack copy --target win
bepack pack --name release
```

## Config Notes

- `name` is required and is used for pack output names and manifest defaults.
- `description` is optional. If omitted, BePack will not overwrite existing manifest descriptions.
- At least one pack (`packs.bp` or `packs.rp`) is required. BP-only, RP-only, and BP+RP projects are all supported.
- BP compilation config (entry, typecheck, bundler options) goes in `packs.bp.compile`. Without it, `build` and `dev` skip TypeScript compilation.
- `packs.bp.moduleUuid` is optional — only needed when `compile` is configured (to manage the script module). Data-only BPs can omit it.
- `packs.rp.moduleUuid` is required (always needs a resources module).
- `build` clears `<packs.bp.root>/scripts` before writing new output (only when compile is configured).
- **All BP dependencies go in `packs.bp.dependencies`**, including both manifest dependencies (e.g. `@minecraft/server`) and code-only dependencies (e.g. `@minecraft/vanilla-data`). The catalog controls whether each package is written to manifest and/or package.json.
- Managed dependency catalog packages with `manifest: true` are externalized during build by default. Packages with `manifest: false` (e.g. `@minecraft/vanilla-data`) can be bundled. Use `packs.bp.compile.external` and `packs.bp.compile.externalDependencies` to customize bundling.
- Use `bepack install` or `bepack build --install` to resolve `stable`, `beta`, or `preview` specifiers to concrete npm versions.
- `manifestFormat: 2 | 3` controls manifest output format. `2` uses array versions `[1,0,0]`; `3` uses SemVer strings `"1.0.0"` (all version fields must be strings, arrays rejected). Not set = auto-preserve from existing manifest, default 2 for new ones.
- `packs.bp.include` / `packs.rp.include` adds extra files/folders for copy and pack. BP is always selective; RP is selective when include items are configured, otherwise full directory.
- `packs.bp.compile.cache` configures TypeScript incremental compilation caching. `cache.dev` (default `true`) enables cache in dev mode; `cache.build` (default `false`) enables cache in build mode. Use `bepack build --cache` / `--no-cache` to override per-run.
- `packs.bp.compile.scriptOutputDir` sets the compiled script output directory (relative to BP root). Default: `"scripts"`. Manifest script module entry and `HookContext.paths.scriptOutDir` reflect this value.
- `bepack dev --skip-typecheck` skips type checking on dev rebuilds.

### Plugins

Use `plugins: [plugin()]` to add third-party package resolution and lifecycle hooks. Plugins run by descending `priority` (ties preserve array order); resolvers are tried before BePack built-ins, while plugin lifecycle hooks run before the project hook. A plugin must have a unique `name` and may declare metadata (`version`, `description`, `apiVersion: 1`).

```ts
import { defineConfig, type BePackPlugin } from "bepack";

function addonApi(): BePackPlugin {
    return {
        name: "addon-api",
        version: "1.0.0",
        apiVersion: 1,
        priority: 10,
        configResolved: ({ config }) => {
            // Inspect the complete normalized configuration here.
            if (!config.packs.bp) throw new Error("addon-api requires a behavior pack");
        },
        install: {
            dependencyCatalog: {
                "@example/addon-api": { resolver: "addon-api" },
            },
            dependencyResolvers: [
                {
                    name: "addon-api-by-minecraft-version",
                    resolver: "addon-api",
                    match: (ctx) => ctx.specifier === "stable",
                    resolve: (ctx) => ({
                        packageVersion: ctx.target === "1.21.0" ? "3.4.0" : "4.0.0",
                    }),
                },
            ],
            hooks: {
                beforeResolveDependency: ({ packageName, target }) => {
                    console.log(`Resolving ${packageName} for Minecraft ${target}`);
                },
                afterResolveDependency: ({ packageName, result }) => {
                    console.log(`${packageName} resolved to ${result.packageVersion}`);
                },
            },
        },
        hooks: {
            afterBuild: (ctx) => ctx.logger.info(`Built ${ctx.config.name}`),
        },
    };
}

export default defineConfig({
    plugins: [addonApi()],
    // ...
});
```

Run `bepack config --summary` to see the resolved plugin order and catalog conflicts. Plugin callback and resolver failures include the plugin name in the resulting error.

### SAPI Pro

BePack includes an experimental `sapiPro()` plugin. It resolves `sapi-pro` as a package-only dependency while checking it against the Minecraft packages you explicitly manage. It never adds dependencies to the manifest for you.

```ts
import { defineConfig, sapiPro } from "bepack";

export default defineConfig({
    target: "latest",
    plugins: [sapiPro()],
    packs: {
        bp: {
            // ...
            dependencies: {
                "sapi-pro": "stable",
                "@minecraft/server": "stable",
                "@minecraft/server-ui": "stable",
            },
        },
    },
});
```

`sapi-pro: "stable"` requires both `@minecraft/server` and `@minecraft/server-ui` to be stable; `sapi-pro: "beta"` requires both to be beta/preview. When the selected SAPI Pro release requires it, declare `@minecraft/vanilla-data` explicitly as well. Releases from `0.4` onward are supported; older SAPI Pro metadata is resolved on a best-effort basis.

For the full configuration reference and implementation notes, see [README.reference.md](./README.reference.md).

## Package Output

BP-only projects create:

```txt
dist/{name}-{version}.mcpack
```

BP + RP projects create:

```txt
dist/{name}-{version}.mcaddon
```

The `.mcaddon` archive contains the BP and RP folders together, for example:

```txt
bp/manifest.json
rp/manifest.json
```

## License

MIT
