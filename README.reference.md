# BePack

BePack is a lightweight build tool for Minecraft Bedrock Edition Script API projects.

It manages common BP/RP project tasks: config loading, manifest patching, Minecraft package version resolution, TypeScript typecheck, Rolldown build, copy to game directories, and mcpack/mcaddon packaging.

## Implemented Features

### CLI

Implemented commands:

```bash
bepack init
bepack install
bepack manifest
bepack build
bepack dev
bepack copy
bepack pack
```

Common command options:

```bash
--cwd <path>
--config <path>
--json
--dry-run
--silent
--verbose
```

JSON mode suppresses normal logs and returns machine-readable success/error output.

### Config Loading

Supported config files:

```txt
bepack.config.ts
bepack.config.mjs
bepack.config.js
```

Supported exports:

```ts
export default {
    // config
};

export default (ctx) => {
    return {
        // config
    };
};
```

`defineConfig` is exported and typed for editor completion:

```ts
import { defineConfig } from "bepack";

export default defineConfig({
    root: ".",
    target: "latest",

    build: {
        entry: "src/main.ts",
    },

    packs: {
        bp: {
            root: "bp",
            uuid: "00000000-0000-0000-0000-000000000001",
            moduleUuid: "00000000-0000-0000-0000-000000000002",
            dependencies: {
                "@minecraft/server": "stable",
            },
        },
    },

    pack: {
        outDir: "dist",
    },
});
```

Generated package types are available through:

```json
{
    "types": "dist/index.d.ts"
}
```

### Current Config Shape

Important fields:

```ts
type UserConfig = {
    root?: string;
    name: string;
    version?: string;
    description?: string;
    target?: string;

    build?: {
        entry?: string;
        typecheck?: boolean;
        useNpx?: boolean;
        preserveModules?: boolean;
        copy?: false | true | string;
    };

    packs?: {
        bp?: {
            root?: string;
            uuid: string;
            moduleUuid: string;
            dependencies?: Record<string, "stable" | "beta" | string>;
            achievement?: boolean;
        };

        rp?: {
            root?: string;
            uuid: string;
            moduleUuid: string;
            pbr?: boolean;
        };
    };

    install?: {
        registry?: string;
        saveTo?: "dependencies" | "devDependencies";
        packageManager?: "auto" | "npm" | "pnpm" | "yarn" | "bun";
        runPackageManager?: boolean;
        updatePackageJson?: boolean;
        updateManifest?: boolean;
        dependencies?: Record<string, "stable" | "beta" | string>;
        dependencyResolvers?: DependencyResolverRule[];
    };

    copy?: {
        defaultTarget?: string;
        targets?: Record<string, { type: "custom"; bp?: string; rp?: string }>;
    };

    pack?: {
        name?: string;
        outDir?: string;
    };
};
```

Path conventions:

- `root` is the project root.
- `build.entry` is the Script API TypeScript entry.
- `packs.bp.root` is the behavior pack root.
- `packs.rp.root` is the resource pack root.
- `pack.outDir` is the output directory for `.mcpack` / `.mcaddon`.

For `bepack pack`, these fields must be explicitly configured and input paths must exist:

```txt
build.entry
packs.bp.root
packs.rp.root, if RP is configured
pack.outDir
```

## Dependency Install And Resolution

`bepack install` resolves managed dependencies, patches `package.json`, optionally patches `manifest.json`, and optionally runs a package manager.

Default install behavior:

- Managed packages are written to `dependencies`.
- Registry defaults to `https://registry.npmjs.org/`.
- Package manager defaults to `auto`.
- Package manager install runs by default.
- If `install.registry` is configured, package manager install receives `--registry <registry>`.

Supported manifest dependencies:

```txt
@minecraft/server
@minecraft/server-ui
@minecraft/server-net
@minecraft/server-admin
```

Supported package-only dependencies:

```txt
@minecraft/vanilla-data
```

### Version Resolution

Config values:

```ts
dependencies: {
    "@minecraft/server": "stable",
    "@minecraft/server-ui": "beta",
}
```

Package.json never receives `stable`, `beta`, or `latest` for managed Minecraft packages. BePack resolves concrete npm versions from the configured registry.

Rules:

- `target: "latest"` + `stable`
  - package.json: latest concrete stable version from registry
  - manifest.json: same concrete stable version
- `target: "latest"` + `beta`
  - package.json: latest concrete beta version from registry
  - manifest.json: `beta`
- concrete target + `beta`
  - package.json: matching `*-beta.*<target>-stable` or `*-beta-*<target>-stable`
  - manifest.json: `beta` when the target supports channel dependencies; otherwise concrete beta version
- concrete target + `stable`
  - first finds the matching beta version for the target
  - infers stable as `betaMajor.(betaMinor - 1).betaPatch`
  - verifies the inferred stable version exists in npm versions

Example:

```txt
2.7.0-beta.1.26.10-stable -> 2.6.0
2.4.0-beta.1.21.120-stable -> 2.3.0
2.1.0-beta.1.26.21-stable -> 2.0.0
```

`target: "stable"` and `target: "beta"` are rejected because target means Minecraft game version, not Script API channel.

Other target strings are passed to registry resolution. If no matching version exists, install fails with `SAPI_VERSION_NOT_FOUND`.

### Install Logs

Normal install logs show concise progress:

```txt
[Install] resolving dependencies for target 1.26.10
[Install] fetching @minecraft/server metadata from https://registry.npmjs.org/
[Install] @minecraft/server: stable -> package 2.6.0, manifest 2.6.0
```

Use `--verbose` for lower-level details such as cache hits, version counts, and inference traces.

### Resolver Extension Point

The install resolver is rule-based and has an extension point for future plugin support.

Custom resolvers can be provided in config:

```ts
export default defineConfig({
    install: {
        dependencyResolvers: [
            {
                name: "custom-package-resolver",
                match(ctx) {
                    return ctx.packageName === "my-package";
                },
                async resolve(ctx) {
                    return {
                        packageVersion: "1.0.0",
                        manifestVersion: ctx.kind === "manifest" ? "1.0.0" : null,
                    };
                },
            },
        ],
    },
});
```

Resolver order:

1. Custom `install.dependencyResolvers`
2. Built-in stable resolver
3. Built-in beta resolver
4. Exact version resolver

## Manifest Management

`bepack manifest` and `bepack install` can create and patch manifests.

BP manifest controlled fields:

- `format_version`
- `header.name`
- `header.description`, only when configured
- `header.uuid`
- `header.version`
- `header.min_engine_version`
- script module
- BePack-managed `@minecraft/*` dependencies
- BP/RP mutual dependency
- `metadata.product_type`, only when `achievement: true`

RP manifest controlled fields:

- `format_version`
- `header.name`
- `header.description`, only when configured
- `header.uuid`
- `header.version`
- `header.min_engine_version`
- resources module
- RP/BP mutual dependency
- `capabilities: ["pbr"]`, when `pbr: true`

User-defined manifest fields are preserved.

When BP and RP are both configured, BePack maintains mutual dependencies between their header UUIDs.

Achievement metadata:

- `packs.bp.achievement: true` adds `metadata.product_type = "addon"`.
- Every managed Script API dependency must be stable.
- If beta/prerelease dependencies are used with achievement enabled, BePack throws `ACHIEVEMENT_REQUIRES_STABLE_API`.

## Build

`bepack build` performs:

```txt
manifest patch
hooks.beforeBuild
typecheck
rolldown build
hooks.afterBuild
optional copy
optional pack
```

Typecheck behavior:

- Default: system `tsc --noEmit`.
- `build.useNpx: true` or `--use-npx`: `npx tsc --noEmit`.
- Missing `tsconfig.json` fails early with `TYPECHECK_FAILED`.

Rolldown behavior:

- Default `preserveModules: true`.
- Output goes to `<packs.bp.root>/scripts`.
- `<packs.bp.root>/scripts` is cleared before each build.
- `build.entry` controls input.
- External packages follow the current Script API external list:

```txt
/^@minecraft\/server.*/
@minecraft/common
@minecraft/debug-utilities
@minecraft/diagnostics
```

Not all `@minecraft/*` packages are excluded. For example, `@minecraft/vanilla-data` is allowed to be bundled.

## Dev

`bepack dev`:

- Runs an initial build before watching.
- Watches configured paths:
  - `build.entry` directory
  - `packs.bp.root`
  - `packs.rp.root`, when RP is configured
- Clears terminal output on each change.
- Shows per-update duration.
- Ignores:
  - `node_modules`
  - `.git`
  - `pack.outDir`
  - `<packs.bp.root>/scripts`
  - generated BP/RP `manifest.json`

This avoids loops caused by BePack patching manifests or writing build output.

## Copy

`bepack copy` copies BP/RP to a configured target.

Built-in targets:

- `win`
  - new Windows Minecraft Bedrock path:
  - `%USERPROFILE%\AppData\Roaming\Minecraft Bedrock\Users\Shared\games\com.mojang`
- `winold`
  - old UWP Minecraft path under `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe`

Custom targets:

```ts
copy: {
    defaultTarget: "win",
    targets: {
        server: {
            type: "custom",
            bp: "/server/world/behavior_packs",
            rp: "/server/world/resource_packs",
        },
    },
}
```

## Pack

`bepack pack` creates:

- `.mcpack` when only BP is configured. The BP directory contents are written at the archive root.
- `.mcaddon` when both BP and RP are configured. The BP and RP folders are written into one archive.

Output filename defaults to:

```txt
{name}-{version}
```

Output directory is configured by:

```ts
pack: {
    outDir: "dist",
}
```

Pack input config must be explicit and input paths must exist. This prevents accidentally packaging guessed default directories.

## Hooks

Supported hooks:

```ts
hooks: {
    beforeInstall(ctx) {},
    afterInstall(ctx) {},
    beforeManifest(ctx) {},
    afterManifest(ctx) {},
    beforeBuild(ctx) {},
    afterBuild(ctx) {},
    beforeCopy(ctx) {},
    afterCopy(ctx) {},
    beforePack(ctx) {},
    afterPack(ctx) {},
}
```

Hooks can be sync or async. Throwing from a hook fails the command with `HOOK_FAILED`.

## Output And Errors

CLI output uses colored stage labels and timestamps in normal mode.

Examples:

```txt
[17:30:02] [Install] resolving dependencies for target 1.26.10
[17:30:05] [Manifest] manifest.json updated
[17:30:05] [TypeScript] typecheck complete
[17:30:06] [Rolldown] preserve modules build complete
```

`--json` mode returns JSON and suppresses normal logs.

Errors use stable codes such as:

```txt
CONFIG_NOT_FOUND
CONFIG_INVALID
TARGET_INVALID
UNSUPPORTED_MANIFEST_DEPENDENCY
UNSUPPORTED_PACKAGE_DEPENDENCY
DEPENDENCY_VERSION_INVALID
DEPENDENCY_REQUIRES_INSTALL
SAPI_VERSION_NOT_FOUND
ACHIEVEMENT_REQUIRES_STABLE_API
TYPECHECK_FAILED
BUILD_FAILED
COPY_TARGET_NOT_FOUND
PACK_FAILED
HOOK_FAILED
CLI_ARGUMENT_CONFLICT
```

## Init

`bepack init` creates only the config file. It does not create project directories.

Generated config uses the current config shape:

```ts
export default {
    root: ".",
    name: "example-addon",
    version: "1.0.0",
    target: "latest",
    build: {
        entry: "src/main.ts",
    },
    packs: {
        bp: {
            root: "bp",
            uuid: "...",
            moduleUuid: "...",
            dependencies: {
                "@minecraft/server": "stable",
            },
        },
    },
    pack: {
        outDir: "dist",
    },
};
```
