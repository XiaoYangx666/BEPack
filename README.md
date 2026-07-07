# BePack

BePack is a lightweight build tool for Minecraft Bedrock Edition Script API packs.

It helps Bedrock addon projects keep the boring parts tidy: config loading, manifest patching, Script API dependency resolution, TypeScript checks, Rolldown builds, copy targets, and `.mcpack` / `.mcaddon` packaging.

## Features

- Build TypeScript Script API entry files into `bp/scripts`.
- Patch behavior/resource pack manifests without discarding user-owned fields.
- Resolve managed `@minecraft/*` dependencies from npm.
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
- Use `bepack install` or `bepack build --install` when manifest dependencies use `stable` or target-specific `beta`.

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
