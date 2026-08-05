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

/** Create a single replace plugin: all keys (custom values and enabled built-ins) match literally. */
export function createReplacePlugins(config: ResolvedConfig): ReturnType<typeof replacePlugin>[] {
    const custom = resolveCustomReplaceValues(config);
    const builtins = Object.fromEntries(
        Object.entries(config.replace.builtins)
            .filter(([, enabled]) => enabled)
            .map(([name]) => [
                `**${name}**`,
                BUILTIN_TOKENS[name as keyof typeof BUILTIN_TOKENS](config),
            ])
    );
    const values = { ...custom, ...builtins };
    if (Object.keys(values).length === 0) return [];
    // Literal matching: every key is replaced verbatim. Word-boundary matching
    // (rolldown's default) would silently skip **TOKEN** markers surrounded by
    // non-word characters like quotes, which is surprising for declared replaces.
    return [replacePlugin(values, { delimiters: ["", ""] })];
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
