import type { NpmRegistryClient } from "../utils/npmRegistry.js";
import type { FIXED_PATHS } from "../constants/paths.js";

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
    /** Resolver used for this dependency, e.g. "minecraft-script-api" or "minecraft-vanilla-data". */
    resolver: string;
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
    target: string;
    config: ResolvedConfig;
    paths: typeof FIXED_PATHS;
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

    /** Module UUID written to manifest.json. */
    moduleUuid: string;

    /** Manifest header name. Defaults to top-level `name`. */
    name?: string;

    /** Manifest header description. Defaults to top-level `description`. */
    description?: string;
};

export type BpConfig = PackConfig & {
    /** Script API dependencies managed in both package.json and bp/manifest.json. */
    dependencies?: Record<string, DependencySpecifier>;

    /** Adds achievement-compatible metadata when every Script API dependency is stable. */
    achievement?: boolean;
};

export type RpConfig = PackConfig & {
    /** Adds `pbr` capability to the resource pack manifest. */
    pbr?: boolean;
};

export type UserConfig = {
    /** Project root directory. Other relative paths are resolved from here. */
    root?: string;

    /** Addon/package name used for manifest defaults and pack output names. */
    name: string;

    /** Addon version. Must be `x.y.z` when written to manifest.json. */
    version?: string;

    /** Addon description used as manifest default. */
    description?: string;

    /** Minecraft game target version, or `latest`. Do not use `stable`/`beta` here. */
    target?: string;

    /** Behavior/resource pack configuration. */
    packs?: {
        /** Behavior pack configuration. Required. */
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

    /** Build pipeline configuration. */
    build?: {
        /** Script entry file, relative to `root` unless absolute. */
        entry?: string;

        /** Whether to run `tsc --noEmit` before rolldown. */
        typecheck?: boolean;

        /** Copy after build: false, true for default target, or a target name. */
        copy?: CopySetting;

        /** Legacy alias for preserveModules. */
        preserveModule?: boolean;

        /** Whether rolldown should preserve module files. Defaults to true. */
        preserveModules?: boolean;

        /** Additional packages/modules that Rolldown should not bundle. */
        external?: BuildExternal[];

        /** Whether managed dependency catalog packages are externalized automatically. */
        externalDependencies?: boolean;

        /** Use `npx tsc --noEmit` instead of system `tsc --noEmit`. */
        useNpx?: boolean;

        /** Minify output. Passed through to rolldown. Defaults to false. */
        minify?: boolean;

        /** Show per-step timing in build/dev output. Defaults to false. */
        timing?: boolean;
    };

    /** Dev watcher behavior. */
    dev?: {
        /** Copy after dev updates: false, true for default target, or a target name. */
        copy?: CopySetting;
    };

    /** Copy targets for `bepack copy` and build/dev copy. */
    copy?: {
        /** Default copy target. Built-ins: `win`, `winold`. */
        defaultTarget?: string;

        /** Custom copy targets. */
        targets?: Record<string, { type: "custom"; bp?: string; rp?: string }>;
    };

    /** Pack output configuration. */
    pack?: {
        /** Output filename template without extension. Supports `{name}` and `{version}`. */
        name?: string;

        /** Output directory for .mcpack/.mcaddon, relative to `root` unless absolute. */
        outDir?: string;
    };

    /** Lifecycle hooks. */
    hooks?: Hooks;
};

export type ResolvedConfig = {
    root: string;
    configured: {
        root: boolean;
        buildEntry: boolean;
        bpRoot: boolean;
        rpRoot: boolean;
        packOutDir: boolean;
    };
    name: string;
    version: string;
    description?: string;
    target: string;
    hooks: Hooks;
    packs: {
        bp: Required<Omit<PackConfig, "name" | "description">> & {
            name: string;
            description?: string;
            dependencies: Record<string, DependencySpecifier>;
            achievement?: boolean;
        };
        rp?: Required<Omit<PackConfig, "name" | "description">> & {
            name: string;
            description?: string;
            pbr?: boolean;
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
        entry: string;
        typecheck: boolean;
        copy: CopySetting;
        preserveModules: boolean;
        external: BuildExternal[];
        externalDependencies: boolean;
        useNpx: boolean;
        minify: boolean;
        timing: boolean;
    };
    dev: {
        copy: CopySetting;
    };
    copy: {
        defaultTarget: string;
        targets: Record<string, { type: "custom"; bp?: string; rp?: string }>;
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
