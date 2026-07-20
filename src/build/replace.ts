import { replacePlugin } from "rolldown/plugins";
import type { ResolvedConfig, ReplaceOptions } from "../config/configTypes.js";

const BUILTIN_TOKENS = {
    VERSION: (config: ResolvedConfig) => config.version,
    NAME: (config: ResolvedConfig) => config.name,
    UUID: (config: ResolvedConfig) => config.packs.bp?.uuid ?? "",
    DESCRIPTION: (config: ResolvedConfig) =>
        config.packs.bp?.description ?? config.description ?? "",
} as const;

/** Resolve user replacements and enabled built-ins into Rolldown's value map. */
export function resolveReplaceValues(config: ResolvedConfig): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [name, enabled] of Object.entries(config.replace.builtins)) {
        if (enabled)
            values[`**${name}**`] = BUILTIN_TOKENS[name as keyof typeof BUILTIN_TOKENS](config);
    }
    return { ...values, ...resolveCustomReplaceValues(config) };
}

function resolveCustomReplaceValues(config: ResolvedConfig): Record<string, string> {
    return Object.fromEntries(
        Object.entries(config.replace.values).map(([token, value]) => [
            token,
            typeof value === "function" ? value(config) : value,
        ])
    );
}

/** Create separate plugins so built-in `**TOKEN**` markers are matched literally. */
export function createReplacePlugins(config: ResolvedConfig): ReturnType<typeof replacePlugin>[] {
    const plugins: ReturnType<typeof replacePlugin>[] = [];
    if (Object.keys(config.replace.values).length > 0) {
        plugins.push(replacePlugin(resolveCustomReplaceValues(config)));
    }
    const resolvedValues = resolveReplaceValues(config);
    const builtins = Object.fromEntries(
        Object.entries(config.replace.builtins)
            .filter(([, enabled]) => enabled)
            .map(([name]) => [`**${name}**`, resolvedValues[`**${name}**`] ?? ""])
    );
    if (Object.keys(builtins).length > 0) {
        plugins.push(replacePlugin(builtins, { delimiters: ["", ""] }));
    }
    return plugins;
}

export function normalizeReplace(options: ReplaceOptions | undefined) {
    return {
        values: options?.values ?? {},
        builtins: {
            VERSION: options?.builtins?.VERSION ?? false,
            NAME: options?.builtins?.NAME ?? false,
            UUID: options?.builtins?.UUID ?? false,
            DESCRIPTION: options?.builtins?.DESCRIPTION ?? false,
        },
    };
}
