# BePack

[中文](./README.zh-CN.md) | English

BePack is a build tool for Minecraft Bedrock add-ons. It keeps behavior-pack and resource-pack manifests, Script API dependencies, TypeScript builds, local copying, and `.mcpack` / `.mcaddon` releases in one workflow.

## What you can do with it

- Create a BePack configuration from scratch or import it from existing manifests.
- Keep `manifest.json` in sync without overwriting fields that BePack does not own.
- Build a Behavior Pack's TypeScript Script API entry into its `scripts/` directory.
- Resolve supported `@minecraft/*` dependencies and write their concrete versions to your project.
- Copy packs into a Minecraft development folder and create release archives.

## Requirements

- Node.js 20 or later.
- A Minecraft Bedrock behavior pack, resource pack, or both.
- `package.json` when you use managed Script API dependencies.

## Create a new project

For a new behavior-pack project, start with [create-mcbe](https://www.npmjs.com/package/create-mcbe):

```bash
npm create mcbe
```

Use create-mcbe's documentation for its prompts and command-line options. In the generated project, install BePack:

```bash
npm install -D bepack
```

If you need a fresh BePack configuration, generate one and then edit the generated values to match your project:

```bash
npx bepack init
```

The starter config contains a BP, a TypeScript entry at `src/main.ts`, and generated UUIDs. Run the first build with dependency installation:

```bash
npx bepack build --install
```

## Add BePack to an existing project

When a project already has a pack manifest, import that manifest instead of re-entering UUIDs and versions by hand:

```bash
# Behavior pack only
npx bepack init --from-bp bp/manifest.json

# Behavior pack and resource pack
npx bepack init --from-bp bp/manifest.json --from-rp rp/manifest.json
```

This creates `bepack.config.ts` from the pack roots, names, UUIDs, versions, manifest format, and supported Script API dependencies it finds. A BP script module is also converted into a TypeScript build configuration when possible.

Useful variations:

```bash
# Generate JavaScript or ESM JavaScript config instead of TypeScript
npx bepack init --format js
npx bepack init --format mjs

# Run from outside the project directory
npx bepack init --cwd path/to/project --from-bp bp/manifest.json

# Replace an existing generated config deliberately
npx bepack init --from-bp bp/manifest.json --force
```

## Minimal configuration

BePack loads `bepack.config.ts`, `bepack.config.mjs`, or `bepack.config.js` from the project directory. This is a typical Script API behavior-pack setup:

```ts
import { defineConfig } from "bepack";

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

Generate new UUIDs for a new pack; do not reuse another add-on's UUIDs. For a data-only behavior pack, omit `moduleUuid` and `compile`. For a resource-pack-only project, configure `packs.rp` with its `root`, header `uuid`, and resources `moduleUuid` instead.

## Recommended project layout

The exact folder names are configurable. This layout matches the example above:

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

When using a resource pack too, add an `rp/` directory and a `packs.rp` entry. BePack maintains the BP/RP manifest relationship when both packs are configured.

## Everyday workflow

```bash
# Resolve configured Script API dependencies, update manifests, and build
npx bepack build --install

# Build once after dependencies are already installed
npx bepack build

# Watch files and rebuild during development
npx bepack dev

# Create a distributable archive
npx bepack pack

# Build and package in one command
npx bepack build --pack
```

Use `bepack install` on its own when you only want to update managed dependencies and manifests. Set `target` in the config, or temporarily override it while installing and building:

```bash
npx bepack install --target 1.21.120
npx bepack build --install --target 1.21.120
```

`stable`, `beta`, `preview`, and exact versions can be used for the supported `@minecraft/*` dependency entries. BePack resolves selectors such as `stable` to concrete package versions before updating `package.json` and the BP manifest.

## Run in Minecraft during development

Configure a copy target once, then add `--copy` to `dev` or `build`:

```ts
export default defineConfig({
    // name, version, and packs omitted
    copy: {
        defaultTarget: "minecraft",
        targets: {
            minecraft: {
                type: "gameRoot",
                path: "C:/Users/you/AppData/Local/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang",
            },
        },
    },
    dev: {
        copy: true,
    },
});
```

```bash
# Initial build, then rebuild and copy whenever a watched file changes
npx bepack dev

# Or copy a completed build once
npx bepack build --copy
npx bepack copy --target minecraft
```

`gameRoot` writes behavior packs to `development_behavior_packs` and resource packs to `development_resource_packs`. You can also use a custom target when your BP and RP need separate destination paths. See the reference guide for the full target syntax.

## Package releases

Set an output name and directory with `pack`. `{name}` and `{version}` are replaced from the top-level config:

```ts
export default defineConfig({
    // name: "my-addon", version: "1.0.0", packs: ...
    pack: {
        name: "{name}-{version}",
        outDir: "releases",
    },
});
```

```bash
npx bepack pack
npx bepack pack --name my-addon-preview
```

| Configured packs | Output |
| --- | --- |
| BP only | `.mcpack` |
| RP only | `.mcpack` |
| BP and RP | `.mcaddon` |

## Commands at a glance

| Command | Purpose |
| --- | --- |
| `bepack init` | Create a config, or import one with `--from-bp` / `--from-rp`. |
| `bepack install` | Resolve managed dependencies and update `package.json` and manifests. |
| `bepack manifest` | Update manifests without running dependency installation. |
| `bepack build` | Patch manifests and compile the configured BP source. |
| `bepack dev` | Build once, then watch and rebuild. |
| `bepack copy` | Copy configured packs to a development target. |
| `bepack pack` | Create a `.mcpack` or `.mcaddon`. |
| `bepack config --summary` | Inspect the resolved configuration. |

All commands accept `--cwd <project-dir>` and `--config <path>` when the current directory or config filename is different. Add `--dry-run` to preview file-writing commands, or `--json` for machine-readable output. Run `bepack <command> --help` for every command option.

## More documentation

This README covers the common path: create or import a project, configure packs, build, copy, and package. For complete configuration fields, custom copy targets, inclusion rules, dependency-resolution extensions, plugins, hooks, and replacement tokens, read [the reference guide](./reference.md).

## License

MIT
