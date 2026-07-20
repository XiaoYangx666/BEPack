import path from "node:path";
import { DEFAULT_CONFIG, BP_COMPILE_DEFAULTS, CACHE_DEFAULTS } from "./defaultConfig.js";
import type {
    BpCompileResolved,
    CacheOptions,
    CacheResolved,
    ResolvedConfig,
    UserConfig,
    BpConfig,
    RpConfig,
    BePackPlugin,
    DependencyCatalogEntry,
    HookResult,
    Hooks,
} from "./configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { validateScriptOutputDir, slash } from "../utils/path.js";
import { normalizeReplace } from "../build/replace.js";
import { BUILTIN_PLUGINS } from "../plugins/builtins.js";

function stripUndefined<T extends Record<string, unknown>>(value: T | undefined): Partial<T> {
    if (!value) return {};
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined)
    ) as Partial<T>;
}

function mergeUserConfig(config: UserConfig, overrides: Partial<UserConfig>): UserConfig {
    const packs: UserConfig["packs"] = {};
    if (config.packs?.bp || overrides.packs?.bp) {
        packs.bp = {
            ...(config.packs?.bp ?? ({} as BpConfig)),
            ...stripUndefined(overrides.packs?.bp),
        } as BpConfig;
    }
    if (config.packs?.rp || overrides.packs?.rp) {
        packs.rp = {
            ...(config.packs?.rp ?? ({} as RpConfig)),
            ...stripUndefined(overrides.packs?.rp),
        } as RpConfig;
    }
    const copyTargets: NonNullable<NonNullable<UserConfig["copy"]>["targets"]> = {
        ...(config.copy?.targets ?? {}),
        ...(stripUndefined(overrides.copy?.targets) as NonNullable<
            NonNullable<UserConfig["copy"]>["targets"]
        >),
    };
    const cleanOverrides = stripUndefined(overrides);
    return {
        ...config,
        ...cleanOverrides,
        ...(overrides.plugins !== undefined || config.plugins !== undefined
            ? { plugins: overrides.plugins ?? config.plugins }
            : {}),
        packs,
        install: { ...config.install, ...stripUndefined(overrides.install) },
        build: { ...config.build, ...stripUndefined(overrides.build) },
        dev: { ...config.dev, ...stripUndefined(overrides.dev) },
        copy: {
            ...config.copy,
            ...stripUndefined(overrides.copy),
            targets: copyTargets,
        },
        pack: { ...config.pack, ...stripUndefined(overrides.pack) },
        hooks: { ...config.hooks, ...stripUndefined(overrides.hooks) },
    };
}

function normalizePlugins(plugins: Array<BePackPlugin | string> | undefined): BePackPlugin[] {
    const resolved = (plugins ?? []).map((plugin) => {
        if (typeof plugin !== "string") return plugin;
        const factory = BUILTIN_PLUGINS[plugin];
        if (!factory) {
            throw new BePackError("CONFIG_INVALID", `Unknown built-in plugin: ${plugin}.`);
        }
        return factory();
    });
    const names = new Set<string>();
    for (const plugin of resolved) {
        if (!plugin?.name || plugin.name.trim() === "") {
            throw new BePackError("CONFIG_INVALID", "Every plugin must have a non-empty name.");
        }
        if (names.has(plugin.name)) {
            throw new BePackError("CONFIG_INVALID", `Plugin name is duplicated: ${plugin.name}.`);
        }
        if (plugin.apiVersion !== undefined && plugin.apiVersion !== 1) {
            throw new BePackError(
                "CONFIG_INVALID",
                `Plugin ${plugin.name} requires unsupported BePack plugin API version ${plugin.apiVersion}.`
            );
        }
        if (plugin.priority !== undefined && !Number.isFinite(plugin.priority)) {
            throw new BePackError(
                "CONFIG_INVALID",
                `Plugin ${plugin.name} priority must be a finite number.`
            );
        }
        names.add(plugin.name);
    }
    return resolved.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** Combine hooks without changing the context passed to plugin or user callbacks. */
function mergeHooks(plugins: BePackPlugin[], projectHooks: Hooks | undefined): Hooks {
    const names = new Set<keyof Hooks>();
    for (const hooks of [...plugins.map((plugin) => plugin.hooks), projectHooks]) {
        for (const name of Object.keys(hooks ?? {}) as Array<keyof Hooks>) names.add(name);
    }

    return Object.fromEntries(
        [...names].map((name) => {
            const callbacks = [
                ...plugins
                    .map((plugin) => ({ plugin, hook: plugin.hooks?.[name] }))
                    .filter(
                        (
                            item
                        ): item is {
                            plugin: BePackPlugin;
                            hook: NonNullable<Hooks[typeof name]>;
                        } => item.hook !== undefined
                    ),
                ...(projectHooks?.[name] ? [{ hook: projectHooks[name] }] : []),
            ];
            return [
                name,
                async (
                    ...args: Parameters<NonNullable<Hooks[typeof name]>>
                ): Promise<HookResult> => {
                    let result: HookResult;
                    for (const callback of callbacks) {
                        try {
                            result = await callback.hook(...args);
                        } catch (cause) {
                            const plugin = "plugin" in callback ? callback.plugin : undefined;
                            if (!plugin) throw cause;
                            throw new BePackError(
                                "PLUGIN_FAILED",
                                `Plugin ${plugin.name} ${String(name)} hook failed: ${cause instanceof Error ? cause.message : String(cause)}`
                            );
                        }
                    }
                    return result;
                },
            ];
        })
    ) as Hooks;
}

function resolvePluginCatalog(
    plugins: BePackPlugin[],
    projectCatalog: Record<string, DependencyCatalogEntry>
) {
    const catalog: Record<string, DependencyCatalogEntry> = {};
    const owners = new Map<string, string>();
    const diagnostics: string[] = [];
    for (const plugin of plugins) {
        for (const [packageName, entry] of Object.entries(
            plugin.install?.dependencyCatalog ?? {}
        )) {
            const previous = owners.get(packageName);
            if (previous) {
                diagnostics.push(
                    `dependency catalog ${packageName}: plugin ${previous} takes precedence over plugin ${plugin.name}`
                );
                continue;
            }
            catalog[packageName] = entry;
            owners.set(packageName, plugin.name);
        }
    }
    for (const [packageName, entry] of Object.entries(projectCatalog)) {
        const previous = owners.get(packageName);
        if (previous) {
            diagnostics.push(
                `dependency catalog ${packageName}: project config overrides plugin ${previous}`
            );
        }
        catalog[packageName] = entry;
    }
    return { catalog, diagnostics };
}

/**
 * Normalize compile options into a fully-resolved BpCompileResolved.
 * Falls back to BP_COMPILE_DEFAULTS for any missing field.
 */
function normalizeCompile(
    compile: NonNullable<NonNullable<UserConfig["packs"]>["bp"]>["compile"],
    bpRootDir: string,
    projectRootDir: string
): BpCompileResolved {
    const defs = BP_COMPILE_DEFAULTS;
    const rawDir = compile?.scriptOutputDir ?? defs.scriptOutputDir;
    // Resolve source entry dir relative to project root (where entry lives), NOT bp root
    const resolvedEntry = path.resolve(projectRootDir, compile?.entry ?? defs.entry);
    const resolvedSrcDir = path.dirname(resolvedEntry);
    const normalizedDir = validateScriptOutputDir(bpRootDir, rawDir, resolvedSrcDir);
    return {
        entry: compile?.entry ?? defs.entry,
        tsconfig: compile?.tsconfig ?? defs.tsconfig,
        typecheck: compile?.typecheck ?? defs.typecheck,
        preserveModules: compile?.preserveModules ?? defs.preserveModules,
        external: compile?.external ?? defs.external,
        useNpx: compile?.useNpx ?? defs.useNpx,
        minify: compile?.minify ?? defs.minify,
        cache: normalizeCache(compile?.cache),
        scriptOutputDir: normalizedDir,
    };

    function normalizeCache(cache: CacheOptions | undefined): CacheResolved {
        const defs = CACHE_DEFAULTS;
        return {
            dev: cache?.dev ?? defs.dev,
            build: cache?.build ?? defs.build,
            file: cache?.file ?? defs.file,
        };
    }
}

export function normalizeConfig(
    config: UserConfig,
    overrides: Partial<UserConfig> = {},
    cwd: string = process.cwd()
): ResolvedConfig {
    const raw = mergeUserConfig(config, overrides);
    const plugins = normalizePlugins(raw.plugins);
    const target = raw.target ?? DEFAULT_CONFIG.target;
    if (target === "stable" || target === "beta") {
        throw new BePackError(
            "TARGET_INVALID",
            "target must be a Minecraft game version or latest, not a Script API channel.",
            { details: { target } }
        );
    }

    const hasBp = !!raw.packs?.bp;
    const hasRp = !!raw.packs?.rp;
    if (!hasBp && !hasRp) {
        throw new BePackError(
            "CONFIG_INVALID",
            "At least one pack (packs.bp or packs.rp) is required."
        );
    }

    if (!raw.name || raw.name.trim() === "") {
        throw new BePackError("CONFIG_INVALID", "name is required.");
    }
    const name = raw.name;
    const version = raw.version ?? DEFAULT_CONFIG.version;
    const description = raw.description;

    const packs = raw.packs!;
    let compile = packs.bp?.compile;
    const bp = packs.bp;
    const rp = packs.rp;

    if (bp) {
        if (!bp.uuid) {
            throw new BePackError("CONFIG_INVALID", "packs.bp.uuid is required.");
        }
        if (bp.compile && !bp.moduleUuid) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.bp.moduleUuid is required when packs.bp.compile is configured."
            );
        }
        if (bp.root === undefined) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.bp.root is required. Set the behavior pack directory in bepack.config.ts."
            );
        }
    }

    // Compute bpRootDir and projectRootDir for compile normalization
    const projectRootDir = path.resolve(cwd, raw.root ?? ".");
    const bpRootDir = bp ? path.resolve(projectRootDir, bp.root!) : undefined;

    if (rp) {
        if (!rp.uuid || !rp.moduleUuid) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.rp.uuid and packs.rp.moduleUuid are required."
            );
        }
        if (rp.root === undefined) {
            throw new BePackError(
                "CONFIG_INVALID",
                "packs.rp.root is required when packs.rp is configured."
            );
        }
    }

    const bpDescription = bp?.description ?? description;
    const rpDescription = rp?.description ?? description;
    const { catalog: pluginCatalog, diagnostics: pluginDiagnostics } = resolvePluginCatalog(
        plugins,
        raw.install?.dependencyCatalog ?? {}
    );
    const pluginResolvers = plugins.flatMap((plugin) => plugin.install?.dependencyResolvers ?? []);

    return {
        root: raw.root ?? DEFAULT_CONFIG.root,
        configured: {
            root: raw.root !== undefined,
            packOutDir: raw.pack?.outDir !== undefined,
        },
        name,
        version,
        ...(description !== undefined ? { description } : {}),
        replace: normalizeReplace(raw.replace),
        target,
        plugins,
        ...(pluginDiagnostics.length > 0 ? { pluginDiagnostics } : {}),
        ...(raw.manifestFormat !== undefined ? { manifestFormat: raw.manifestFormat } : {}),
        packs: {
            ...(bp
                ? {
                      bp: {
                          root: bp.root!,
                          uuid: bp.uuid,
                          ...(bp.moduleUuid !== undefined ? { moduleUuid: bp.moduleUuid } : {}),
                          name: bp.name ?? name,
                          ...(bpDescription !== undefined ? { description: bpDescription } : {}),
                          ...(compile && bpRootDir
                              ? { compile: normalizeCompile(compile, bpRootDir, projectRootDir) }
                              : {}),
                          dependencies: bp.dependencies ?? {},
                          ...(bp.achievement !== undefined ? { achievement: bp.achievement } : {}),
                          include: bp.include ?? [],
                      },
                  }
                : {}),
            ...(rp
                ? {
                      rp: {
                          root: rp.root!,
                          uuid: rp.uuid,
                          moduleUuid: rp.moduleUuid!,
                          name: rp.name ?? name,
                          ...(rpDescription !== undefined ? { description: rpDescription } : {}),
                          ...(rp.pbr !== undefined ? { pbr: rp.pbr } : {}),
                          include: rp.include ?? [],
                      },
                  }
                : {}),
        },
        install: {
            registry: raw.install?.registry ?? DEFAULT_CONFIG.install.registry,
            saveTo: raw.install?.saveTo ?? DEFAULT_CONFIG.install.saveTo,
            packageManager: raw.install?.packageManager ?? DEFAULT_CONFIG.install.packageManager,
            runPackageManager:
                raw.install?.runPackageManager ?? DEFAULT_CONFIG.install.runPackageManager,
            updatePackageJson:
                raw.install?.updatePackageJson ?? DEFAULT_CONFIG.install.updatePackageJson,
            updateManifest: raw.install?.updateManifest ?? DEFAULT_CONFIG.install.updateManifest,
            dependencyCatalog: pluginCatalog,
            dependencyResolvers: [...pluginResolvers, ...(raw.install?.dependencyResolvers ?? [])],
        },
        build: {
            copy: raw.build?.copy ?? DEFAULT_CONFIG.build.copy,
            timing: raw.build?.timing ?? DEFAULT_CONFIG.build.timing,
        },
        dev: {
            copy: raw.dev?.copy ?? DEFAULT_CONFIG.dev.copy,
            ...(raw.dev?.watch ? { watch: raw.dev.watch } : {}),
        },
        copy: {
            defaultTarget: raw.copy?.defaultTarget ?? DEFAULT_CONFIG.copy.defaultTarget,
            ...(raw.copy?.name ? { name: raw.copy.name } : {}),
            ...(raw.copy?.include ? { include: raw.copy.include } : {}),
            targets: raw.copy?.targets ?? {},
        },
        pack: {
            name: raw.pack?.name ?? DEFAULT_CONFIG.pack.name,
            outDir: raw.pack?.outDir ?? DEFAULT_CONFIG.pack.outDir,
        },
        hooks: mergeHooks(plugins, raw.hooks),
    };
}
