import { describe, expect, it } from "vitest";
import { createDefineTransform, normalizeDefine } from "../define.js";

describe("normalizeDefine", () => {
    it("returns empty object for undefined", () => {
        expect(normalizeDefine(undefined)).toEqual({});
    });

    it("preserves valid expression strings", () => {
        expect(
            normalizeDefine({
                __TARGET__: '"server"',
                __FLAG__: "true",
                __ENV__: "process.env.NODE_ENV",
            })
        ).toEqual({ __TARGET__: '"server"', __FLAG__: "true", __ENV__: "process.env.NODE_ENV" });
    });

    it("throws CONFIG_INVALID for non-expression values", () => {
        expect(() => normalizeDefine({ __BAD__: "not an expression {" })).toThrow(
            'packs.bp.compile.define["__BAD__"] is not a valid JavaScript expression'
        );
    });

    it("does not mutate the input object", () => {
        const input = { __TARGET__: '"server"' };
        normalizeDefine(input);
        expect(input).toEqual({ __TARGET__: '"server"' });
    });
});

describe("createDefineTransform", () => {
    it("returns undefined when define is empty", () => {
        expect(createDefineTransform({})).toBeUndefined();
    });

    it("returns transform.define option when non-empty", () => {
        expect(createDefineTransform({ __TARGET__: '"server"' })).toEqual({
            transform: { define: { __TARGET__: '"server"' } },
        });
    });
});
