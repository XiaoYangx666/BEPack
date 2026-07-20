import { replacePlugin } from "rolldown/plugins";
import type { ResolvedConfig, ReplaceOptions } from "../config/configTypes.js";

const BUILTIN_TOKENS = {
    VERSION: (config: ResolvedConfig) => config.version,
    NAME: (config: ResolvedConfig) => config.name,
    UUID: (config: ResolvedConfig) => config.packs.bp?.uuid ?? "",
    DESCRIPTION: (config: ResolvedConfig) => config.description ?? "",
} as const;

/** Resolve user replacements and enabled built-ins into Rolldown's value map. */
export function resolveReplaceValues(config: ResolvedConfig): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [name, enabled] of Object.entries(config.replace.builtins)) {
        if (enabled)
            values[`**${name}**`] = BUILTIN_TOKENS[name as keyof typeof BUILTIN_TOKENS](config);
    }
    // User values are applied last so a custom definition can intentionally
    // override the value of an enabled built-in token.
    for (const [token, value] of Object.entries(config.replace.values)) {
        values[token] = typeof value === "function" ? value(config) : value;
    }
    return values;
}

export function createReplacePlugin(config: ResolvedConfig): ReturnType<typeof replacePlugin> {
    return replacePlugin(resolveReplaceValues(config));
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
