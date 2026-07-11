import type {
    ConfigContext,
    ResolvedConfig,
    UserConfig,
    BpCompileResolved,
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
    target: "latest",
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

/** Defaults applied when packs.bp.compile is configured but a field is omitted. */
export const BP_COMPILE_DEFAULTS: BpCompileResolved = {
    entry: "src/main.ts",
    tsconfig: "tsconfig.json",
    typecheck: true,
    preserveModules: true,
    external: [/^@minecraft\/server.*/],
    useNpx: false,
    minify: false,
};

export function defineConfig(config: UserConfig): UserConfig;
export function defineConfig<T extends (ctx: ConfigContext) => UserConfig | Promise<UserConfig>>(
    config: T
): T;
export function defineConfig(
    config: UserConfig | ((ctx: ConfigContext) => UserConfig | Promise<UserConfig>)
): UserConfig | ((ctx: ConfigContext) => UserConfig | Promise<UserConfig>) {
    return config;
}
