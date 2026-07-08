# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (rolldown + dts-bundle-generator)
npm run build          # clean + build:js + build:types
npm run build:js       # rolldown -c (bundles src/ to dist/)
npm run build:types    # dts-bundle-generator for dist/index.d.ts
npm run clean          # rm -rf dist

# Type check (tsc --noEmit)
npm run check

# Test (vitest) — 15s timeout configured in vitest.config.ts
npm run test           # vitest run
npm run test:watch     # vitest (watch mode)

# Format
npm run format         # npx prettier ./src --write

# Run the CLI directly during development
node dist/cli.js <command>

# Or use tsx for quick runs without building
npx tsx src/cli.ts <command>
```

## Project Overview

**BePack** is a build tool for **Minecraft Bedrock Edition Script API addons**. It streamlines the dev loop: TypeScript build via rolldown, manifest patching, dependency resolution (npm registry), Minecraft dev-folder copying, and .mcpack/.mcaddon packaging.

- **Language:** TypeScript, ESM (`"type": "module"`)
- **Runtime:** Node.js >= 20
- **Package manager:** npm
- **Entry points:** `src/cli.ts` (binary), `src/index.ts` (library API)

## Code Architecture

### CLI Layer

`src/cli.ts` — uses the `cac` library for argument parsing. Seven commands share common options (`--cwd`, `--config`, `--json`, `--dry-run`, `--silent`, `--verbose`). Each delegates to a command handler in `src/commands/`. Global error handling wraps every command action.

### Config Pipeline

Config files (`bepack.config.ts` / `.mjs` / `.js`) export a default function or object.

```
UserConfig → loadConfig() → normalizeConfig() → ResolvedConfig
```

- **`src/config/configTypes.ts`** — all TypeScript types: `UserConfig`, `ResolvedConfig`, `DependencyResolverRule`, `HookContext`, etc.
- **`src/config/defaultConfig.ts`** — defaults (entry: `src/main.ts`, preserveModules: true, etc.)
- **`src/config/loadConfig.ts`** — finds config file, imports it (strips TS syntax with regex fallback), calls normalizer
- **`src/config/normalizeConfig.ts`** — merges user config with defaults and CLI overrides

### Commands

Each file in `src/commands/` exports a `command<Name>` async function:

| Command | File | Description |
|---------|------|-------------|
| `init` | `init.ts` | Scaffold `bepack.config.ts` with random UUIDs |
| `install` | `install.ts` | Resolve deps, patch package.json, run package manager |
| `manifest` | `manifest.ts` | Patch BP/RP `manifest.json` |
| `build` | `build.ts` | Manifest → typecheck → rolldown → (optional install/copy/pack) |
| `dev` | `dev.ts` | Watch sources via chokidar, rebuild + copy on change |
| `copy` | `copy.ts` | Copy pack dirs to Minecraft dev folders (or custom targets) |
| `pack` | `pack.ts` | Package BP (+ RP) as `.mcpack` / `.mcaddon` |

### Build Pipeline (`src/build/`)

```
patchManifest() → runHook("beforeBuild") → runTypecheck() → runRolldown() → runHook("afterBuild")
```

- **`runBuild.ts`** — orchestrates the full build, supports `--timing` for per-step timing
- **`runRolldown.ts`** — clears `bp/scripts/`, bundles with rolldown (preserveModules or single file), computes file stats. Externalizes `@minecraft/*` packages that are in the manifest dependency catalog
- **`runTypecheck.ts`** — runs `tsc --noEmit`, optionally via `npx tsc`

### Dependency Resolution (`src/install/`)

Pluggable resolver architecture:

```
DependencyService
  → DependencyResolverRegistry (custom resolvers tried first, then built-in)
    → Individual DependencyResolverRules (match + resolve)
      → MinecraftPackageResolver (npm registry queries)
```

**Built-in resolvers:**
- `minecraft-script-api` — `@minecraft/server`, `@minecraft/server-ui` (stable/beta/preview)
- `minecraft-script-api-bp` — `@minecraft/server-net`, `@minecraft/server-admin`, `@minecraft/server-gametest` (beta/preview only, no stable)
- `minecraft-vanilla-data` — `@minecraft/vanilla-data`, `@minecraft/debug-utilities` (stable/preview only)
- `exact-version` — catches any valid semver as-is

**Key types:** `DependencySpecifier` = `"stable"` | `"beta"` | `"preview"` | exact semver. The `target` config controls which Minecraft game version to resolve against.

**Catalog:** `src/install/dependencyCatalog.ts` — built-in catalog maps package names to resolvers. Users can override/extend via `install.dependencyCatalog`.

### Manifest Patching (`src/manifest/`)

- **`ManifestBuilder.ts`** — class that encapsulates a build session. Constructor pre-computes `version` tuple and `dependencyCatalog`, so `buildBp()` / `buildRp()` don't need config passed around.
- **`dependencyVersion.ts`** — stateless pure functions: `isAllowedDependencySpecifier()`, `resolveManifestDependencyVersion()`, `isAchievementCompatibleSpecifier()`
- **`types.ts`** — typed Manifest interfaces (replaces old `Record<string, any>`)
- **`normalize.ts`** — safe coercion helpers (`normalizeManifest`, `asArray`, `removeEmptyObject`)
- **`validate.ts`** — `validateManifest()` checks required fields, module types, dependency formats
- **`patchManifest.ts`** — IO orchestrator (reads, calls `ManifestBuilder`, validates, writes). Creates one `ManifestBuilder` instance and reuses it for both BP and RP.

### Copy (`src/copy/`)

- **`copyPacks.ts`** — copies BP/RP directories to target paths
- **`resolveCopyTarget.ts`** — resolves target name (built-in `win`/`winold` or custom targets)
- **`winTarget.ts`** — detects Minecraft Bedrock dev folder path on Windows

### Pack (`src/pack/`)

- Zips BP (and optional RP) as `.mcpack` or `.mcaddon` using `fflate`
- Validates that all pack inputs exist and output is not inside pack roots
- Output: `dist/{name}-{version}.mcpack` or `.mcaddon`

### Hooks (`src/hooks/`)

Lifecycle hooks: `beforeInstall`, `afterInstall`, `beforeManifest`, `afterManifest`, `beforeBuild`, `afterBuild`, `beforeCopy`, `afterCopy`, `beforePack`, `afterPack`. Each receives a `HookContext` with command, cwd, config, paths, logger.

### Logger (`src/logger/`)

Structured step logger with labeled sections (`bepack`, `manifest`, `TS`, `rolldown`, `install`, `copy`, `pack`, `hook`, `timing`). Supports `--silent`, `--verbose`, `--json` modes.

### Error Handling (`src/errors/`)

Typed error codes in `codes.ts` (24 codes). `BePackError` carries code, message, details, and suggestions. `formatError` formats for CLI output.

### Utilities (`src/utils/`)

- **`path.ts`** — path resolution helpers (projectRoot, bpRoot, rpRoot, etc.)
- **`fs.ts`** — async file I/O (read/write JSON, copy/empty dirs)
- **`npmRegistry.ts`** — npm registry fetch with in-memory cache
- **`semver.ts`** — loose semver comparison, channel support detection
- **`packageManager.ts`** — auto-detect npm/pnpm/yarn/bun, run install
- **`atomicWrite.ts`** — atomic file writes via temp file + rename

## Conventions

- All imports use `.js` extensions (ESM, `verbatimModuleSyntax`)
- Config is read-only after normalization; resolved as `ResolvedConfig`
- Async always, no sync I/O
- Error codes are exported from `src/errors/codes.ts`
- Tests use vitest with `describe`/`it`/`expect`; no test runners other than vitest
- The project exports `.mjs` (tsx), `.cjs`, and `.js`/`.mjs` files — the same
