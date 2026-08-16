import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import type { BpCompileOptions } from "../../config/configTypes.js";

function configWithDefine(define: BpCompileOptions["define"]) {
    return normalizeConfig({
        name: "Test Addon",
        version: "1.2.3",
        packs: {
            bp: {
                root: "bp",
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                compile: { entry: "src/main.ts", ...(define ? { define } : {}) },
            },
        },
    });
}

async function bundleDefine(define: BpCompileOptions["define"]): Promise<string> {
    const config = configWithDefine(define);
    const bundle = await rolldown({
        input: "input.ts",
        ...(config.packs.bp!.compile!.define &&
        Object.keys(config.packs.bp!.compile!.define).length > 0
            ? { transform: { define: config.packs.bp!.compile!.define } }
            : {}),
        plugins: [
            {
                name: "virtual-entry",
                resolveId: (id: string) => (id === "input.ts" ? id : null),
                load: (id: string) =>
                    id === "input.ts"
                        ? `declare const __TARGET__: "server" | "client";
export const t = __TARGET__;
export const r = __FLAG__ ? "yes" : "no";
const obj = { __TARGET__: "not a ref" };
export const key = obj.__TARGET__;
// __TARGET__ in a comment
export const s = "__TARGET__ in string";`
                        : null,
            },
        ],
    });
    const { output } = await bundle.generate({ format: "esm" });
    return output[0].code as string;
}

describe("compile.define (semantic injection via rolldown transform.define)", () => {
    it("replaces identifier references with the expression value", async () => {
        const code = await bundleDefine({ __TARGET__: JSON.stringify("server"), __FLAG__: "true" });
        expect(code).toContain('const t = "server";');
        expect(code).toContain('const r = "yes";');
    });

    it("preserves declare declarations, object keys, and string literals", async () => {
        const code = await bundleDefine({ __TARGET__: JSON.stringify("server") });
        expect(code).not.toContain("declare const __TARGET__");
        expect(code).toContain('const key = { __TARGET__: "not a ref" }.__TARGET__;');
        expect(code).toContain('const s = "__TARGET__ in string";');
    });
});
