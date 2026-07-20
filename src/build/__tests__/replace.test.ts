import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { resolveReplaceValues } from "../replace.js";

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
});
