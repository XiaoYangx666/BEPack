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
```

Useful examples:

```bash
bepack build --install
bepack build --copy
bepack build --pack
bepack dev --copy
bepack copy --target win
bepack pack --name release
```

## Config Notes

- `name` is required and is used for pack output names and manifest defaults.
- `description` is optional. If omitted, BePack will not overwrite existing manifest descriptions.
- `packs.bp` is required.
- `packs.rp` is optional. When present, `bepack pack` creates a `.mcaddon`.
- `build` clears `<packs.bp.root>/scripts` before writing new output.
- **All BP dependencies go in `packs.bp.dependencies`**, including both manifest dependencies (e.g. `@minecraft/server`) and code-only dependencies (e.g. `@minecraft/vanilla-data`). The catalog controls whether each package is written to manifest and/or package.json.
- Managed dependency catalog packages with `manifest: true` are externalized during build by default. Packages with `manifest: false` (e.g. `@minecraft/vanilla-data`) can be bundled. Use `build.external` and `build.externalDependencies` to customize bundling.
- Use `bepack install` or `bepack build --install` to resolve `stable`, `beta`, or `preview` specifiers to concrete npm versions.
- `manifestFormat: 2 | 3` controls manifest output format. `2` uses array versions `[1,0,0]`; `3` uses SemVer strings `"1.0.0"` (Minecraft 1.21.110+). Not set = auto-preserve from existing manifest, default 2 for new ones.
- `packs.bp.include` adds extra files/folders for copy and pack (replaces `copy.include.bp`). BP is always selective.
- `bepack dev --skip-typecheck` skips type checking on dev rebuilds.

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
