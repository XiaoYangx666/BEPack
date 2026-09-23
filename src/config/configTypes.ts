import type { RolldownOptions } from "rolldown";
import type { NpmRegistryClient } from "../utils/npmRegistry.js";

export type CommandName =
    "init" | "install" | "manifest" | "build" | "dev" | "copy" | "pack" | "config";
/**
 * Script API dependency selector.
 *
 * - `stable`: resolve a concrete stable npm version from registry.
 * - `beta`: resolve a concrete beta npm version from registry.
 * - exact version: use the version as-is.
 */
export type DependencySpecifier = "stable" | "beta" | string;

/** Where BePack writes managed npm dependencies in package.json. */
export type SaveTo = "dependencies" | "devDependencies";

/** Package manager used by `bepack install` after package.json is patched. */
export type PackageManager = "auto" | "npm" | "pnpm" | "yarn" | "bun";

/** Copy behavior used by build/dev. `true` means copy.defaultTarget. */
export type CopySetting = false | true | string;

/** Rolldown external dependency matcher. */
export type BuildExternal = string | RegExp;

/** A replacement value, resolved against the normalized BePack config. */
export type ReplaceValue = string | ((config: ResolvedConfig) => string);

export type ReplaceBuiltins = {
    VERSION?: boolean;
    NAME?: boolean;
    UUID?: boolean;
    DESCRIPTION?: boolean;
};

export type ReplaceOptions = {
    /** Replacement tokens and their literal or config-aware values. */
    values?: Record<string, ReplaceValue>;
    /** Enable replacement of BePack's built-in tokens. Disabled by default. */
    builtins?: ReplaceBuiltins;
};

export type LoggerLike = {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    verbose(message: string): void;
    clear(): void;
    install?(message: string): void;
};

/** Manifest fields for one concrete version in an npm package document. */
export type NpmPackageVersionMetadata = {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

/** npm registry package document fields exposed to dependency resolver plugins. */
export type NpmPackageMetadata = {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, NpmPackageVersionMetadata>;
};

export type DependencyCatalogEntry = {
    /** Resolver used for this dependency. Can be a resolver name string or a direct DependencyResolverRule reference. */
    resolver: string | DependencyResolverRule;
    /** Whether to write to bp manifest.json dependencies. When true, the dependency is also externalized during build. Defaults to false. */
    manifest?: boolean;
};

export type DependencyResolverResult = {
    /** Concrete npm version written to package.json. */
    packageVersion: string;

    /** Version written to manifest.json. Use null for package-only dependencies. */
    manifestVersion?: string | null;
};

export type DependencyResolveHookContext = {
    packageName: string;
    specifier: string;
    target: string;
    entry: DependencyCatalogEntry;
    config: ResolvedConfig;
};

export type DependencyResolvedHookContext = DependencyResolveHookContext & {
    result: DependencyResolverResult;
};

export type DependencyResolverContext = {
    packageName: string;
    specifier: string;
    target: string;
    entry: DependencyCatalogEntry;
    config: ResolvedConfig;
    npm: NpmRegistryClient;
    logger?: LoggerLike;
};

export type DependencyResolverRule = {
    /** Human-readable resolver name used for logs/debugging. */
    name: string;

    /** Optional resolver group. Package catalog entries can select this by name. */
    resolver?: string;

    /** Whether this rule can resolve the dependency. */
    match(ctx: DependencyResolverContext): boolean;

    /** Resolve package.json and optional manifest versions. */
    resolve(
        ctx: DependencyResolverContext
    ): DependencyResolverResult | Promise<DependencyResolverResult>;
};

export type HookContext = {
    command: CommandName;
    cwd: string;
    mode?: string;
    target: string;
    /** Whether the running command was started with `--dry-run` (no files are written). */
    dryRun: boolean;
    config: ResolvedConfig;
    /** Convenience resolved paths. Only includes paths for packs that are configured. */
    paths: {
        dist: string;
        /** BP root directory. Only present when packs.bp is configured. */
        bpRoot?: string;
        /** RP root directory. Only present when packs.rp is configured. */
        rpRoot?: string;
        /** BP manifest path. Only present when packs.bp is configured. */
        bpManifest?: string;
        /** RP manifest path. Only present when packs.rp is configured. */
        rpManifest?: string;
        /** Compilation entry. Only present when packs.bp?.compile is configured. */
        srcEntry?: string;
        /** Compiled script output. Only present when packs.bp?.compile is configured. */
        scriptOutFile?: string;
        /** Compiled script output directory. Only present when packs.bp?.compile is configured. */
        scriptOutDir?: string;
    };
    logger: LoggerLike;
};

export type HookResult = string | number | boolean | null | undefined | Record<string, unknown>;

export type Hooks = Partial<
    Record<
        | "beforeInstall"
        | "afterInstall"
        | "beforeManifest"
        | "afterManifest"
        | "beforeBuild"
        | "afterBuild"
        | "beforeCopy"
        | "afterCopy"
        | "beforePack"
        | "afterPack",
        (ctx: HookContext) => HookResult | Promise<HookResult>
    >
>;

export type ConfigResolvedHookContext = {
    cwd: string;
    config: ResolvedConfig;
};

export type PluginDependencyHooks = {
    beforeResolveDependency?: (
        ctx: DependencyResolveHookContext
    ) => HookResult | Promise<HookResult>;
    afterResolveDependency?: (
        ctx: DependencyResolvedHookContext
    ) => HookResult | Promise<HookResult>;
};

/**
 * Extends BePack through `plugins: [plugin()]` in the project config.
 *
 * Plugin dependency resolvers are registered before BePack's built-in resolvers.
 * Add a matching `dependencyCatalog` entry when the plugin manages a package that
 * is not already in BePack's built-in catalog.
 */
export type BePackPlugin = {
    /** Unique, human-readable plugin name used in diagnostics. */
    name: string;

    /** Optional plugin metadata for discovery and compatibility checks. */
    version?: string;
    description?: string;
    apiVersion?: 1;

    /** Higher priorities run/register first; ties preserve the plugins array order. */
    priority?: number;

    /** Runs after configuration has been normalized. */
    configResolved?: (ctx: ConfigResolvedHookContext) => void | Promise<void>;

    /** Dependency resolution additions supplied by the plugin. */
    install?: {
        dependencyCatalog?: Record<string, DependencyCatalogEntry>;
        dependencyResolvers?: DependencyResolverRule[];
        hooks?: PluginDependencyHooks;
    };

    /** Lifecycle hooks run with the same context as project-level hooks. */
    hooks?: Hooks;
};

export type PackConfig = {
    /** Pack root directory, relative to `root` unless absolute. Example: `bp` or `packs/bp`. */
    root?: string;

    /** Header UUID written to manifest.json. */
    uuid: string;

    /** Module UUID written to manifest.json.
     *  For BP: required only when compile is configured (to manage script module).
     *  For RP: always required (to manage resources module). */
    moduleUuid?: string;

    /** Manifest header name. Defaults to top-level `name`. */
    name?: string;

    /** Manifest header description. Defaults to top-level `description`. */
    description?: string;

    /** Manifest generation strategy and extra fields. */
    manifest?: PackManifestOptions;
};

/** User-facing manifest generation options (merged, not rewritten). */
export type PackManifestOptions = {
    /**
     * Manifest patch strategy.
     *
     * - `"preserve"` (default): keep user-owned fields from the existing manifest and
     *   overwrite only BePack-managed ones (incremental merge).
     * - `"clean"`: rebuild the manifest from config. Non-managed entries are dropped;
     *   declare them explicitly via the `extra*` fields below.
     *
     * Use `"clean"` when a pack's manifest should be fully generated from config
     * (e.g. dual-config projects) so another config's residue never survives.
     */
    merge?: "preserve" | "clean";

    /** `header.min_engine_version` written to the manifest. Accepts a SemVer string
     *  (e.g. `"1.21.0"`), converted to `[n, n, n]` for format 2 manifests.
     *
     *  When set it is authoritative in both merge modes: `preserve` overrides the
     *  value already stored in the manifest, `clean` uses it as the generated value.
     *  When omitted, `preserve` keeps the existing value and `clean` uses the default. */
    minEngineVersion?: string;

    /** Dependencies appended verbatim to manifest `dependencies` in clean mode. */
    extraDependencies?: Record<string, unknown>[];

    /** Modules appended verbatim to manifest `modules` in clean mode. */
    extraModules?: Record<string, unknown>[];

    /** Extra fields merged into manifest `header` in clean mode (e.g. `pack_scope`). */
    extraHeader?: Record<string, unknown>;
};

/** Resolved manifest generation options with defaults filled. */
export type PackManifestResolved = {
    merge: "preserve" | "clean";
    minEngineVersion?: string;
    extraDependencies: Record<string, unknown>[];
    extraModules: Record<string, unknown>[];
    extraHeader: Record<string, unknown>;
};

/** TypeScript incremental compilation cache settings. */
export type CacheOptions = {
    /** Use cache in dev mode. Default: true. */
    dev?: boolean;
    /** Use cache in build mode. Default: false. */
    build?: boolean;
    /** Path to .tsbuildinfo file (relative to project root). */
    file?: string;
};

export type CacheResolved = {
    dev: boolean;
    build: boolean;
    file: string;
};

/**
 * `pack.optimize` options. All fields are optional; omitted ones fall back to
 * Mojang-compatible defaults (see `PACK_OPTIMIZE_DEFAULTS`).
 */
export type PackOptimizeOptions = {
    /**
     * Also keep the original loose files inside the artifact. Default: `false`,
     * matching Minecraft's pack optimizer, which stores everything in `__brarchive/`.
     *
     * Useful when the pack should also load in clients that predate `__brarchive/`
     * support: those clients ignore the archives and read the loose files.
     */
    keepLooseFiles?: boolean;

    /**
     * Folders that keep a loose copy **in addition to** their archive, per pack type.
     *
     * Defaults mirror Minecraft's own packs, which keep path-addressed folders loose:
     * behavior packs `functions`, `loot_tables`, `structures`, `texts`; resource packs
     * `font`, `materials`, `sounds`, `texts`, `textures`. Entries are appended to that
     * list — pass `false` to keep nothing extra (smallest artifact).
     */
    keepLoose?: string[] | false;

    /** Extra top-level folders to leave as loose files, on top of the built-in list. */
    exclude?: string[];

    /** Minify JSON entries. Default: `true` (Mojang's optimizer always minifies). */
    minifyJson?: boolean;

    /**
     * Value written to `header.pack_optimization_version` in the packaged manifest —
     * this field is what makes the engine read content from `__brarchive/`.
     *
     * Default: `"0.1.0"` (verified working on 1.26.40+; game-version values such as
     * `"1.26.40"` are ignored by the engine). It is written to the artifact only, the
     * pack's own `manifest.json` on disk is left untouched.
     */
    packOptimizationVersion?: string;

    /**
     * Silence the warning emitted when `header.min_engine_version` is below 1.26.40.
     * Optimization still runs either way — the field does not block loading, but older
     * clients cannot read the archives. Default: `false`.
     */
    allowUnsupportedTarget?: boolean;
};

/** Resolved `pack.optimize` options with defaults filled. */
export type PackOptimizeResolved = {
    keepLooseFiles: boolean;
    keepLoose: string[] | false;
    exclude: string[];
    minifyJson: boolean;
    packOptimizationVersion: string;
    allowUnsupportedTarget: boolean;
};

/**
 * Context handed to a `compile.rolldown` customization function.
 *
 * All paths are absolute so custom options (alias, plugins, ...) can use them directly.
 */
export type RolldownCustomizeContext = {
    /** Command currently running: `"build"` (`bepack build`) or `"dev"` (`bepack dev`). */
    command: "build" | "dev";
    /** CLI `--mode` value, when provided. */
    mode?: string;
    /** Minecraft target version (`config.target`). */
    target: string;
    /** Absolute path of the compile entry file. */
    entry: string;
    /** Absolute path of the script output directory. */
    outDir: string;
    /** Absolute path of the single-file output (informational in preserve-modules mode). */
    outFile: string;
    /** Whether modules are preserved instead of being bundled into one file. */
    preserveModules: boolean;
};

/**
 * Function form of `compile.rolldown`: receives the fully merged options built by
 * BePack (plus context) and returns options that are merged on top of them.
 *
 * Returning `undefined` (or nothing) leaves the current options unchanged.
 */
export type RolldownCustomizeFunction = (
    options: RolldownOptions,
    context: RolldownCustomizeContext
) => RolldownOptions | undefined | void | Promise<RolldownOptions | undefined | void>;

/** User-supplied rolldown customization: an options object or a function. */
export type RolldownOverrides = RolldownOptions | RolldownCustomizeFunction;

/** BP compile configuration. Only available on behavior packs. */
export type BpCompileOptions = {
    /** Script entry file, relative to project root. Default: "src/main.ts". */
    entry: string;

    /**
     * Identifier reference replacement (rolldown `transform.define` semantics).
     *
     * Values are JavaScript expression strings, e.g. `{ __TARGET__: JSON.stringify("server") }`.
     * Only *references* to the key identifier are replaced — `declare` type declarations,
     * object keys, string literals, and comments are left untouched.
     * Prefer this over `replace` for feature flags and conditional compilation.
     */
    define?: Record<string, string>;

    /** Path to tsconfig.json relative to project root. Default: "tsconfig.json". */
    tsconfig?: string;

    /** Whether to run `tsc --noEmit` before rolldown. Default: true. */
    typecheck?: boolean;

    /** Whether rolldown should preserve module files. Default: true. */
    preserveModules?: boolean;

    /** Additional packages/modules that Rolldown should not bundle. */
    external?: BuildExternal[];

    /** Use `npx tsc --noEmit` instead of system `tsc --noEmit`. Default: false. */
    useNpx?: boolean;

    /** Minify output via rolldown. Default: false. */
    minify?: boolean;

    /** TypeScript incremental compilation cache settings.
     *  `dev` defaults to true, `build` defaults to false.
     *  `file` defaults to "node_modules/.cache/bepack/tsconfig.tsbuildinfo".
     *  CLI `--cache` / `--no-cache` overrides build mode. */
    cache?: CacheOptions;

    /** Output directory for compiled scripts, relative to BP root. Default: "scripts". */
    scriptOutputDir?: string;

    /**
     * Extra rolldown options (object) or a customization function, merged on top of the
     * options BePack generates.
     *
     * BePack-managed fields (`input`, `output.file` / `output.dir` / `output.format` /
     * `output.preserveModules` / `output.preserveModulesRoot` / `output.entryFileNames`)
     * cannot be overridden — configure `entry`, `scriptOutputDir` and `preserveModules`
     * instead.
     */
    rolldown?: RolldownOverrides;

    /**
     * Path to a rolldown config file (relative to the project root, or absolute).
     * The file is loaded with rolldown's own loader, so `.ts` / `.mts` / `.js` / `.mjs`
     * are all supported, and the default export may be an options object, a single-element
     * array, or a function.
     *
     * Takes precedence over the inline `rolldown` field. `bepack build --rolldown-config`
     * overrides this path.
     */
    rolldownConfig?: string;
};

export type BpConfig = PackConfig & {
    /** BP compile configuration (TypeScript entry, tsconfig, bundler options).
     *  When set, enables TypeScript compilation and rolldown bundling. */
    compile?: BpCompileOptions;

    /** Script API dependencies managed in both package.json and bp/manifest.json. */
    dependencies?: Record<string, DependencySpecifier>;

    /** Additional files/folders to include when copying/packing the behavior pack,
     * on top of built-in defaults (scripts/, manifest.json, animations/, etc.). */
    include?: string[];
};

/**
 * 资源包可应用范围（pack_scope），仅资源包可用。
 * - `world`: 仅可应用于特定存档（作为世界资源包）。
 * - `global`: 仅可应用于全局资源包。
 * - `any`: 可应用于任何地方。默认值。
 */
export type PackScope = "world" | "global" | "any";

/** 合法 pack_scope 取值，用于配置校验。 */
export const PACK_SCOPES: readonly PackScope[] = ["world", "global", "any"];

export type RpConfig = PackConfig & {
    /** Adds `pbr` capability to the resource pack manifest. */
    pbr?: boolean;

    /** 资源包可应用范围，写入 manifest header 的 `pack_scope`。默认 "any"。 */
    packScope?: PackScope;

    /** Additional files/folders to include when copying/packing the resource pack,
     * on top of built-in defaults. */
    include?: string[];
};

/** Copy target with explicit bp/rp paths. */
export type CopyTargetCustom = { type: "custom"; bp?: string; rp?: string };

/** Copy target derived from a Minecraft game root directory.
 *  BP is copied to `<path>/development_behavior_packs`,
 *  RP is copied to `<path>/development_resource_packs`. */
export type CopyTargetGameRoot = { type: "gameRoot"; path: string };

export type CopyTarget = CopyTargetCustom | CopyTargetGameRoot;

/** Per-target or global copy folder name overrides. Falls back to `packs.bp.name` / `packs.rp.name`. */
export type CopyTargetNames = {
    bp?: string;
    rp?: string;
};

/** Dev mode watch configuration. */
export type DevWatchConfig = {
    /** Additional files/directories to watch (relative to cwd), on top of copy include items. */
    include?: string[];
};

export type UserConfig = {
    /** Project root directory. Other relative paths are resolved from here. */
    root?: string;

    /** Addon/package name used for manifest defaults and pack output names. */
    name?: string;

    /** Addon version. Must be `x.y.z` when written to manifest.json. */
    version?: string;

    /** Addon description used as manifest default. */
    description?: string;

    /** String replacement performed by Rolldown while compiling BP scripts. */
    replace?: ReplaceOptions;

    /** Manifest format version used when writing manifest.json.
     * - `2`: array versions (e.g. `[1, 0, 0]`). Default for format_version 2 manifests.
     * - `3`: SemVer string versions (e.g. `"1.0.0"`). All version fields must be strings.
     * Format 3 does NOT accept array versions — every version must be a string.
     * When not set, the existing manifest's format_version is preserved.
     * Default: 2 for new manifests. */
    manifestFormat?: 2 | 3;
    target?: string;

    /** Plugins that add dependency resolution rules and/or lifecycle hooks. */
    plugins?: Array<BePackPlugin | string>;

    /** Behavior/resource pack configuration. At least one pack must be configured. */
    packs?: {
        /** Behavior pack configuration. Optional. */
        bp?: BpConfig;

        /** Resource pack configuration. Optional. */
        rp?: RpConfig;
    };

    /** Dependency install and package manager behavior. */
    install?: {
        /** npm registry used for resolving concrete @minecraft versions. */
        registry?: string;

        /** Where managed dependencies are written. Defaults to `dependencies`. */
        saveTo?: SaveTo;

        /** Package manager to run after patching package.json. */
        packageManager?: PackageManager;

        /** Whether to run the package manager after patching package.json. */
        runPackageManager?: boolean;

        /** Whether `bepack install` patches package.json. */
        updatePackageJson?: boolean;

        /** Whether `bepack install` patches manifest.json. */
        updateManifest?: boolean;

        /** Additional managed dependency package definitions. */
        dependencyCatalog?: Record<string, DependencyCatalogEntry>;

        /**
         * Custom dependency resolvers.
         *
         * Rules are tried before BePack built-ins, making this a future plugin hook.
         */
        dependencyResolvers?: DependencyResolverRule[];
    };

    /** Build pipeline configuration — post-build actions only.
     *  Compilation config (entry, typecheck, bundler options) goes under packs.bp.compile. */
    build?: {
        /** Copy after build: false, true for default target, or a target name. */
        copy?: CopySetting;

        /** Show per-step timing in build/dev output. Defaults to false. */
        timing?: boolean;
    };

    /** Dev watcher behavior. */
    dev?: {
        /** Copy after dev updates: false, true for default target, or a target name. */
        copy?: CopySetting;

        /** Watch configuration. Defaults to src entry dir + copy include items. */
        watch?: DevWatchConfig;
    };

    /** Copy targets for `bepack copy` and build/dev copy. */
    copy?: {
        /** Default copy target. Built-ins: `win`, `winold`. */
        defaultTarget?: string;

        /** Global folder name overrides for all targets. Per-target `name` takes precedence. */
        name?: string | CopyTargetNames;

        /** Additional RP files/folders to include when copying.
         *  @deprecated Use packs.rp.include instead. */
        include?: {
            rp?: string[];
        };

        /** Custom copy targets. */
        targets?: Record<string, CopyTarget & { name?: string | CopyTargetNames }>;

        /**
         * Optimize the copied development folder into `__brarchive/` archives, so the
         * exact shape that ships can be tested in-game. Off by default; requires the
         * same `header.min_engine_version >= 1.26.40` as `pack.optimize`.
         */
        optimize?: boolean | PackOptimizeOptions;
    };

    pack?: {
        /** Output filename template without extension. Supports `{name}` and `{version}`. */
        name?: string;

        /** Output directory for .mcpack/.mcaddon, relative to `root` unless absolute. */
        outDir?: string;

        /**
         * Bundle the packs' loose files into `__brarchive/` archives inside the produced
         * `.mcpack` / `.mcaddon`, the way Minecraft's pack optimizer does.
         *
         * Off by default: optimized packs require a `header.min_engine_version` of
         * 1.26.40 or later and do not load in older clients. Copying to a development
         * folder stays unoptimized unless `copy.optimize` is enabled.
         */
        optimize?: boolean | PackOptimizeOptions;
    };

    /** Lifecycle hooks. */
    hooks?: Hooks;
};

/** Resolved BP compile configuration (all fields filled with defaults). */
export type BpCompileResolved = {
    entry: string;
    define: Record<string, string>;
    tsconfig: string;
    typecheck: boolean;
    preserveModules: boolean;
    external: BuildExternal[];
    useNpx: boolean;
    minify: boolean;
    cache: CacheResolved;
    scriptOutputDir: string;
    rolldown?: RolldownOverrides;
    rolldownConfig?: string;
};

export type ResolvedConfig = {
    root: string;
    configured: {
        root: boolean;
        packOutDir: boolean;
    };
    name: string;
    version: string;
    description?: string;
    replace: {
        values: Record<string, ReplaceValue>;
        builtins: Required<ReplaceBuiltins>;
    };
    target: string;
    /** Plugins applied while resolving this config. */
    plugins?: BePackPlugin[];
    /** Plugin ordering and catalog override diagnostics. */
    pluginDiagnostics?: string[];
    manifestFormat?: 2 | 3;
    hooks: Hooks;
    packs: {
        bp?: {
            root: string;
            uuid: string;
            moduleUuid?: string;
            name: string;
            description?: string;
            compile?: BpCompileResolved;
            manifest: PackManifestResolved;
            dependencies: Record<string, DependencySpecifier>;
            include: string[];
        };
        rp?: {
            root: string;
            uuid: string;
            moduleUuid: string;
            name: string;
            description?: string;
            manifest: PackManifestResolved;
            pbr?: boolean;
            packScope?: PackScope;
            include: string[];
        };
    };
    install: {
        registry: string;
        saveTo: SaveTo;
        packageManager: PackageManager;
        runPackageManager: boolean;
        updatePackageJson: boolean;
        updateManifest: boolean;
        dependencyCatalog: Record<string, DependencyCatalogEntry>;
        dependencyResolvers: DependencyResolverRule[];
    };
    build: {
        copy: CopySetting;
        timing: boolean;
    };
    dev: {
        copy: CopySetting;
        watch?: DevWatchConfig;
    };
    copy: {
        defaultTarget: string;
        /** Global folder name overrides for all targets. Per-target `name` takes precedence. */
        name?: string | CopyTargetNames;
        /** @deprecated Use packs.rp.include instead. */
        include?: {
            rp?: string[];
        };
        targets: Record<string, CopyTarget & { name?: string | CopyTargetNames }>;
        /** Present only when `copy.optimize` is enabled. */
        optimize?: PackOptimizeResolved;
    };
    pack: {
        name: string;
        outDir: string;
        /** Present only when `pack.optimize` is enabled. */
        optimize?: PackOptimizeResolved;
    };
};

export type LoadConfigOptions = {
    cwd: string;
    configPath?: string;
    overrides?: Partial<UserConfig>;
};

// ---------------------------------------------------------------------------
// Internal Pack abstraction — iterate over configured packs uniformly
// ---------------------------------------------------------------------------

export type PackType = "bp" | "rp";

/** Unified pack info for generic operations (copy, watch, pack, paths). */
export type PackInfo = {
    type: PackType;
    root: string;
    uuid: string;
    moduleUuid?: string;
    name: string;
    include: string[];
};

/** Iterate over all configured packs, returning uniform PackInfo objects. */
export function getConfiguredPacks(config: ResolvedConfig): PackInfo[] {
    const packs: PackInfo[] = [];
    if (config.packs.bp) {
        packs.push({
            type: "bp",
            root: config.packs.bp.root,
            uuid: config.packs.bp.uuid,
            ...(config.packs.bp.moduleUuid !== undefined
                ? { moduleUuid: config.packs.bp.moduleUuid }
                : {}),
            name: config.packs.bp.name,
            include: config.packs.bp.include,
        });
    }
    if (config.packs.rp) {
        packs.push({
            type: "rp",
            root: config.packs.rp.root,
            uuid: config.packs.rp.uuid,
            moduleUuid: config.packs.rp.moduleUuid,
            name: config.packs.rp.name,
            include: config.packs.rp.include,
        });
    }
    return packs;
}

/** Resolve a pack root directory to an absolute path. */
export function packRoot(pack: PackInfo, projectRoot: string): string {
    return pack.root.startsWith("/") ? pack.root : `${projectRoot}/${pack.root}`;
}
