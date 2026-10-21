<p align="center">
  <img src="./assets/bepack-logo-horizontal.png" alt="BePack" width="400" />
</p>

<p align="center">
  A modern build and release toolchain for Minecraft Bedrock add-ons.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bepack/cli"><img src="https://img.shields.io/npm/v/@bepack/cli.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bepack/cli"><img src="https://img.shields.io/npm/dm/@bepack/cli.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/XiaoYangx666/BEPack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/XiaoYangx666/BEPack.svg?style=flat-square" alt="license" /></a>
  <a href="https://github.com/XiaoYangx666/BEPack"><img src="https://img.shields.io/github/stars/XiaoYangx666/BEPack.svg?style=flat-square" alt="GitHub stars" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@bepack/cli.svg?style=flat-square" alt="Node.js version" /></a>
</p>

# BEPack

[中文](./README.zh-CN.md) | English

BePack keeps an add-on project in one workflow: pack manifests, Script API dependencies, TypeScript builds, copying into Minecraft, and `.mcpack` / `.mcaddon` releases.

## Features

- Create a config from scratch or import an existing BP/RP manifest.
- Keep `manifest.json` in sync without overwriting fields BePack does not own.
- Choose a `preserve` (incremental) or `clean` (config-generated) manifest merge.
- Type-check and bundle Script API TypeScript into the pack's `scripts/` folder.
- Inject build-time flags with `compile.define` or `replace` tokens.
- Resolve `@minecraft/*` dependencies and write concrete versions.
- Copy packs into a development folder and build release archives.
- Inspect Bedrock `.cpuprofile` captures, ignoring idle tick gaps.

## Requirements

- Node.js 20 or later.
- A behavior pack, a resource pack, or both.
- `package.json` when you use managed Script API dependencies.

## Create a project

```bash
npm create mcbe
```

[create-mcbe](https://www.npmjs.com/package/create-mcbe) scaffolds a project and documents its prompts. To set up BePack by hand:

```bash
npm install -D @bepack/cli
npx bepack init                                              # fresh config
npx bepack init --from-bp bp/manifest.json                   # import a BP
npx bepack init --from-bp bp/manifest.json --from-rp rp/manifest.json
npx bepack build --install                                   # first build
```

`--from-bp` / `--from-rp` read names, UUIDs, versions, manifest format, and supported Script API dependencies from the manifests, and enable compilation only when a matching source file exists. Add `--dry-run` to preview and `--format js|mjs` for a JavaScript config. A global install (`npm i -g @bepack/cli`) drops the `npx`.

## Configuration

BePack loads `bepack.config.ts`, `bepack.config.mjs`, or `bepack.config.js` from the project root:

```ts
import { defineConfig } from "@bepack/cli";

export default defineConfig({
    name: "my-addon",
    version: "1.0.0",
    target: "latest",

    packs: {
        bp: {
            root: "bp",
            uuid: "<behavior-pack-header-uuid>",
            moduleUuid: "<script-module-uuid>",
            compile: {
                entry: "src/main.ts",
            },
            dependencies: {
                "@minecraft/server": "stable",
                "@minecraft/server-ui": "stable",
            },
        },
    },

    pack: {
        outDir: "dist",
    },
});
```

Generate new UUIDs for a new pack instead of reusing another add-on's. A data-only behavior pack omits `moduleUuid` and `compile`; a resource-pack-only project configures `packs.rp` with its `root`, header `uuid`, and resources `moduleUuid`.

The folder names are configurable. The example above expects:

```text
my-addon/
├── bepack.config.ts
├── package.json
├── tsconfig.json
├── src/
│   └── main.ts             # TypeScript source entry
├── bp/
│   ├── manifest.json
│   └── scripts/            # generated JavaScript output
└── dist/                   # .mcpack / .mcaddon output
```

## Everyday workflow

```bash
bepack build --install   # resolve dependencies, update manifests, build
bepack build             # build with dependencies already installed
bepack dev               # watch and rebuild
bepack pack              # build, then create an archive
bepack build --pack      # build and package in one command
```

`bepack pack` builds first so it cannot ship stale `scripts/*.js`; use `--no-build` to zip the pack folders as they are. Run `bepack install` alone to only refresh dependencies and manifests, and `--target` to override the Minecraft version for a single run:

```bash
bepack install --target 1.21.120
```

## Type checking

`bepack build` and `bepack dev` run `tsc --noEmit` before Rolldown and stop with `TYPECHECK_FAILED` instead of emitting a broken pack. Skip it with `--skip-typecheck` or `compile.typecheck: false`; custom Rolldown options do not disable it.

The checker is any command line you supply:

```ts
compile: {
    entry: "src/main.ts",
    typecheckCommand: "bun check",   // default: "tsc --noEmit"
}
```

```bash
bepack build --typecheck-command "tsc-rs --noEmit"
```

BePack adds `--project` and cache flags only to its own default; a custom command runs exactly as written. The object form (`typecheck: { command, args }`), precedence, and the deprecated `useNpx` settings are in [the reference guide](./reference.md).

## Script API dependencies

Supported `@minecraft/*` entries accept `stable`, `beta`, `preview`, or an exact version. Online commands (`install`, `build --install`) resolve selectors to concrete versions and write them to `package.json` and the BP manifest; offline commands keep the manifest value, and an exact config version always wins.

## Customize the build

For Rolldown plugins, aliases, sourcemaps, and the rest, pass options inline (or as a function), or point at your own config file:

```ts
compile: {
    entry: "src/main.ts",
    rolldown: {
        resolve: { alias: { "@lib": "./src/lib" } },
        output: { sourcemap: true },
    },
    // rolldownConfig: "rolldown.bp.config.ts",
}
```

```bash
bepack build --rolldown-config rolldown.staging.mjs
```

Your options are merged on top of BePack's: plugins are appended, `external` is unioned, and `resolve` / `output` / `transform` merge one level deep. `input` and the output location stay under BePack's control. See the reference guide for the full merge table.

## Run in Minecraft

```ts
copy: {
    defaultTarget: "minecraft",
    targets: {
        minecraft: {
            type: "gameRoot",
            path: "C:/Users/you/AppData/Local/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang",
        },
    },
},
dev: { copy: true },
```

```bash
bepack dev            # build, then rebuild and copy on change
bepack build --copy   # copy a finished build once
bepack copy --target minecraft
```

`gameRoot` writes behavior packs to `development_behavior_packs` and resource packs to `development_resource_packs`. Custom targets and include rules are covered in the reference guide.

## Inspect CPU profiles

Bedrock does not sample idle time, so the tick gap arrives as a large `timeDeltas` value on the next sample. `bepack profile` drops deltas above `--gap` (default `5` ms) and ranks functions by real accumulated time:

```bash
bepack profile summary bedrock.cpuprofile
bepack profile bursts  bedrock.cpuprofile
bepack profile top     bedrock.cpuprofile --from 2900 --to 2950 --by total
bepack profile diff    before.cpuprofile after.cpuprofile
```

Use `--json` for machine-readable output and `--root <dir>` to shorten paths. No `bepack.config` is required.

## Package releases

```ts
pack: {
    name: "{name}-{version}",
    outDir: "releases",
}
```

```bash
bepack pack
bepack pack --name my-addon-preview
bepack pack --no-build
```

| Configured packs | Output     |
| ---------------- | ---------- |
| BP only          | `.mcpack`  |
| RP only          | `.mcpack`  |
| BP and RP        | `.mcaddon` |

When the include list leaves files out, BePack lists them and points at `packs.bp.include` / `packs.rp.include` instead of dropping them silently.

### Pack optimization (`__brarchive`)

Bedrock 1.26.40+ can read a pack's loose files from `__brarchive/` archives, the same layout Mojang ships. Turn it on for packaging:

```ts
pack: { outDir: "dist", optimize: true }
```

```bash
bepack pack --optimize            # --no-optimize turns it back off
```

BePack writes `header.pack_optimization_version: "0.1.0"` (the field that enables archives), archives registry folders such as `entities/` and `items/`, and keeps path-addressed files such as `functions/` and `textures/` loose with name stubs. Pack folders on disk are never modified.

> Only 1.26.40+ clients see archived content; older clients see just the loose files. `copy.optimize` gives the dev folder the same shape.

## Commands at a glance

| Command                   | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `bepack init`             | Create a config, or import one with `--from-bp` / `--from-rp`.        |
| `bepack install`          | Resolve managed dependencies and update `package.json` and manifests. |
| `bepack manifest`         | Update manifests without running dependency installation.             |
| `bepack build`            | Patch manifests, type-check, then compile the configured BP source.   |
| `bepack dev`              | Build once, then watch and rebuild.                                   |
| `bepack copy`             | Copy configured packs to a development target.                        |
| `bepack pack`             | Build, then create a `.mcpack` or `.mcaddon` (`--no-build` to skip).  |
| `bepack profile summary`  | Inspect `.cpuprofile` captures and locate slow ticks.                 |
| `bepack config --summary` | Inspect the resolved configuration.                                   |

All project commands accept `--cwd <dir>`, `--config <path>`, `--dry-run`, and `--json`. `bepack <command> --help` lists every option.

## Documentation

For complete configuration fields, custom copy targets, inclusion rules, dependency resolvers, plugins, hooks, and replacement tokens, read [the reference guide](./reference.md).

## License

MIT
