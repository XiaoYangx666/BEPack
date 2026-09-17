# AGENTS.md

BePack contributor guide — the single source of truth for AI coding-agent guidance in this repository.

## Commands

```bash
npm run build          # bundle JavaScript and declarations into dist/
npm run check          # tsc --noEmit
npm run test           # vitest run
npm run test:watch     # Vitest watch mode
npm run format         # format src/ with Prettier

# Development CLI
npx tsx src/cli.ts <command>
node dist/cli.js <command>
```

Run `npm run check` and `npm run test` for every code change. Run `npm run build` when public exports, bundling, or package output changes.

## Project

BePack builds Minecraft Bedrock Script API add-ons. It loads configuration, resolves npm and Script API dependencies, patches manifests, type-checks the source with `tsc`, builds TypeScript with Rolldown, copies packs to development folders, and packages `.mcpack` / `.mcaddon` files.

- **Type checking is on by default.** Any project with `packs.bp.compile` runs `tsc --noEmit` before Rolldown on `bepack build` / `bepack dev`, and fails with `TYPECHECK_FAILED` when it does not pass. Only `packs.bp.compile.typecheck: false` or `--skip-typecheck` skips it — custom Rolldown options (`compile.rolldown` / `compile.rolldownConfig`) do **not**. Never describe `bepack build` as bundle-only.
- TypeScript, Node.js >= 20, native ESM (`"type": "module"`).
- Public library entry: `src/index.ts`; CLI entry: `src/cli.ts`.
- Use `.js` file extensions in TypeScript imports.
- Prefer async filesystem APIs and preserve `ResolvedConfig` as read-only after normalization.

## Architecture

### Configuration and CLI

`UserConfig` is loaded by `loadConfig()` and normalized by `normalizeConfig()` into `ResolvedConfig`. Commands in `src/commands/` are wired by `src/cli.ts`.

Packs are configured in `packs.bp` / `packs.rp`; BP compilation options belong in `packs.bp.compile`, not top-level `build`.

### Dependencies

`DependencyService` uses `DependencyResolverRegistry`, then built-in resolvers, to convert configured specifiers into concrete npm versions. Catalog entries decide whether a package is written into `manifest.json` and externalized during build.

The built-in Minecraft packages are declared explicitly under `packs.bp.dependencies`. Do not introduce implicit manifest dependencies.

### Plugins

Plugins are configured with `plugins: [plugin()]` and can supply:

- `install.dependencyCatalog` and `install.dependencyResolvers`;
- lifecycle hooks and `configResolved`;
- dependency-resolution hooks;
- metadata and priority.

Plugin resolvers must not silently mutate user dependency declarations. `sapiPro()` is an experimental built-in example: it resolves `sapi-pro` as package-only while requiring explicit, channel-matched `@minecraft/server` and `@minecraft/server-ui` entries.

`satisfiesSemver()` is intentionally Minecraft Script API compatibility logic, not npm's standard semver-range implementation: matching majors accept newer API and beta MC targets.

### Build and manifests

The build pipeline is manifest patching, `beforeBuild`, typecheck, Rolldown, then `afterBuild`. Manifest code lives in `src/manifest/`; it must preserve user-owned fields and respect format-version-specific version formats.

Crafting custom Rolldown options goes through `src/build/rolldownOptions.ts`: BePack generates the base input/output options, user options are merged on top, and `input` plus the output location fields are validated and rejected with `CONFIG_INVALID` when a customization tries to move them.

## Conventions

- Use typed `BePackError` codes from `src/errors/codes.ts` for user-facing failures.
- Add focused Vitest coverage beside the relevant subsystem.
- Keep configuration merging and dependency resolution deterministic.
- Do not stage unrelated working-tree changes. In particular, treat untracked files as user-owned unless the task explicitly includes them.
