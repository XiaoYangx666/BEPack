import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { createReplacePlugins } from "../replace.js";

function configWithReplace(replace: NonNullable<Parameters<typeof normalizeConfig>[0]>["replace"]) {
    return normalizeConfig({
        name: "Test Addon",
        version: "1.2.3",
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

async function bundleReplace(replace: NonNullable<Parameters<typeof normalizeConfig>[0]>["replace"]) {
    const config = configWithReplace(replace);
    const bundle = await rolldown({
        input: "input.js",
        plugins: [
            {
                name: "virtual-entry",
                resolveId: (id: string) => (id === "input.js" ? id : null),
                load: (id: string) =>
                    id === "input.js"
                        ? "export const ns = '**NAMESPACE**'; export const nm = '**NAME**';"
                        : null,
            },
            ...createReplacePlugins(config),
        ],
    });
    const { output } = await bundle.generate({ format: "esm" });
    return output[0].code as string;
}

describe("replace literal matching (real rolldown build)", () => {
    it("replaces a custom **TOKEN** surrounded by quotes", async () => {
        const code = await bundleReplace({ values: { "**NAMESPACE**": "my_addon_abc123" } });
        expect(code).toContain("my_addon_abc123");
        expect(code).not.toContain("**NAMESPACE**");
    });

    it("replaces an enabled built-in token", async () => {
        const code = await bundleReplace({ builtins: { NAME: true } });
        expect(code).toContain("Test Addon");
        expect(code).not.toContain("**NAME**");
    });

    it("merges custom values and built-ins in one pass", async () => {
        const code = await bundleReplace({ values: { "**NAMESPACE**": "my_addon_abc123" }, builtins: { NAME: true } });
        expect(code).toContain("my_addon_abc123");
        expect(code).toContain("Test Addon");
        expect(code).not.toContain("**");
    });
});
