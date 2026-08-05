import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { createReplacePlugins, resolveReplaceValues } from "../replace.js";

vi.mock("rolldown/plugins", () => ({
    replacePlugin: vi.fn((values: Record<string, string>, options?: object) => ({ values, options })),
}));

function configWithReplace(replace: NonNullable<Parameters<typeof normalizeConfig>[0]>["replace"]) {
    return normalizeConfig({
        name: "Test Addon",
        version: "1.2.3",
        description: "A test addon",
        ...(replace ? { replace } : {}),
        packs: {
            bp: {
                root: "bp",
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            },
        },
    });
}

describe("replacePlugin configuration", () => {
    it("resolves literal and config-aware values", () => {
        const resolver = vi.fn((config: ReturnType<typeof normalizeConfig>) => config.name);
        const config = configWithReplace({
            values: {
                __LITERAL__: "literal",
                __NAME__: resolver,
            },
        });

        expect(resolveReplaceValues(config)).toEqual({
            __LITERAL__: "literal",
            __NAME__: "Test Addon",
        });
        expect(resolver).toHaveBeenCalledWith(config);
    });

    it("only emits enabled built-in tokens", () => {
        const config = configWithReplace({
            builtins: { VERSION: true, NAME: true, UUID: true, DESCRIPTION: true },
        });

        expect(resolveReplaceValues(config)).toEqual({
            "**VERSION**": "1.2.3",
            "**NAME**": "Test Addon",
            "**UUID**": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "**DESCRIPTION**": "A test addon",
        });
    });

    it("prefers BP description over the root description", () => {
        const config = configWithReplace({ builtins: { DESCRIPTION: true } });
        config.packs.bp!.description = "BP description";

        expect(resolveReplaceValues(config)["**DESCRIPTION**"]).toBe("BP description");
    });

    it("disables built-in tokens by default", () => {
        expect(resolveReplaceValues(configWithReplace(undefined))).toEqual({});
    });

    it("matches custom values literally, not with word boundaries", () => {
        const config = configWithReplace({ values: { "**NAMESPACE**": "my_addon_abc123" } });
        const plugins = createReplacePlugins(config);
        expect(plugins).toHaveLength(1);
        expect(plugins[0]).toMatchObject({
            values: { "**NAMESPACE**": "my_addon_abc123" },
            options: { delimiters: ["", ""] },
        });
    });

    it("merges custom values and enabled built-ins into one literal plugin", () => {
        const config = configWithReplace({
            values: { "**AUTHOR**": "me" },
            builtins: { NAME: true },
        });
        const plugins = createReplacePlugins(config);
        expect(plugins).toHaveLength(1);
        expect(plugins[0]).toMatchObject({
            values: { "**AUTHOR**": "me", "**NAME**": "Test Addon" },
        });
    });

    it("emits no plugin when nothing is configured", () => {
        expect(createReplacePlugins(configWithReplace(undefined))).toEqual([]);
    });
});
