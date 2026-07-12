import type { NpmRegistryClient } from "../utils/npmRegistry.js";

export type CommandName = "init" | "install" | "manifest" | "build" | "dev" | "copy" | "pack";
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

export type ConfigContext = {
    command: CommandName;
    cwd: string;
    mode?: string;
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
};

export type LoggerLike = {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    verbose(message: string): void;
    clear(): void;
    install?(message: string): void;
};

export type NpmPackageMetadata = {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, unknown>;
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

/** BP compile configuration. Only available on behavior packs. */
export type BpCompileOptions = {
    /** Script entry file, relative to project root. Default: "src/main.ts". */
    entry: string;

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
};

export type BpConfig = PackConfig & {
    /** BP compile configuration (TypeScript entry, tsconfig, bundler options).
     *  When set, enables TypeScript compilation and rolldown bundling. */
    compile?: BpCompileOptions;

    /** Script API dependencies managed in both package.json and bp/manifest.json. */
    dependencies?: Record<string, DependencySpecifier>;

    /** Adds achievement-compatible metadata when every Script API dependency is stable. */
    achievement?: boolean;

    /** Additional files/folders to include when copying/packing the behavior pack,
     * on top of built-in defaults (scripts/, manifest.json, animations/, etc.). */
    include?: string[];
};

export type RpConfig = PackConfig & {
    /** Adds `pbr` capability to the resource pack manifest. */
    pbr?: boolean;

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

    /** Manifest format version used when writing manifest.json.
     * - `2`: array versions (e.g. `[1, 0, 0]`). Default for format_version 2 manifests.
     * - `3`: SemVer string versions (e.g. `"1.0.0"`). All version fields must be strings.
     * Format 3 does NOT accept array versions — every version must be a string.
     * When not set, the existing manifest's format_version is preserved.
     * Default: 2 for new manifests. */
    manifestFormat?: 2 | 3;
    target?: string;

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
    };

    pack?: {
        /** Output filename template without extension. Supports `{name}` and `{version}`. */
        name?: string;

        /** Output directory for .mcpack/.mcaddon, relative to `root` unless absolute. */
        outDir?: string;
    };

    /** Lifecycle hooks. */
    hooks?: Hooks;
};

/** Resolved BP compile configuration (all fields filled with defaults). */
export type BpCompileResolved = {
    entry: string;
    tsconfig: string;
    typecheck: boolean;
    preserveModules: boolean;
    external: BuildExternal[];
    useNpx: boolean;
    minify: boolean;
    cache: CacheResolved;
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
    target: string;
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
            dependencies: Record<string, DependencySpecifier>;
            achievement?: boolean;
            include: string[];
        };
        rp?: {
            root: string;
            uuid: string;
            moduleUuid: string;
            name: string;
            description?: string;
            pbr?: boolean;
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
    };
    pack: {
        name: string;
        outDir: string;
    };
};

export type LoadConfigOptions = {
    command: CommandName;
    cwd: string;
    configPath?: string;
    mode?: string;
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
