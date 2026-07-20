import type {
    ResolvedConfig,
    UserConfig,
    BpCompileResolved,
    CacheResolved,
} from "./configTypes.js";

export const DEFAULT_CONFIG: Omit<ResolvedConfig, "packs"> = {
    root: ".",
    configured: {
        root: false,
        packOutDir: false,
    },
    name: "minecraft-addon",
    version: "1.0.0",
    description: "",
    replace: {
        values: {},
        builtins: {
            VERSION: false,
            NAME: false,
            UUID: false,
            DESCRIPTION: false,
        },
    },
    target: "latest",
    plugins: [],
    install: {
        registry: "https://registry.npmjs.org/",
        saveTo: "dependencies",
        packageManager: "auto",
        runPackageManager: true,
        updatePackageJson: true,
        updateManifest: true,
        dependencyCatalog: {},
        dependencyResolvers: [],
    },
    build: {
        copy: false,
        timing: false,
    },
    dev: {
        copy: false,
    },
    copy: {
        defaultTarget: "",
        targets: {},
    },
    pack: {
        name: "{name}-{version}",
        outDir: "dist",
    },
    hooks: {},
};

/** Default cache settings. */
export const CACHE_DEFAULTS: CacheResolved = {
    dev: true,
    build: false,
    file: "node_modules/.cache/bepack/tsconfig.tsbuildinfo",
};

/** Defaults applied when packs.bp.compile is configured but a field is omitted. */
export const BP_COMPILE_DEFAULTS: BpCompileResolved = {
    entry: "src/main.ts",
    tsconfig: "tsconfig.json",
    typecheck: true,
    preserveModules: true,
    external: [/^@minecraft\/server.*/],
    useNpx: false,
    minify: false,
    cache: CACHE_DEFAULTS,
    scriptOutputDir: "scripts",
};

export function defineConfig(config: UserConfig): UserConfig {
    return config;
}
