import { describe, expect, it } from "vitest";
import { safeSerialize } from "../config.js";

describe("config output structure", () => {
    it("serializes functions and regular expressions", () => {
        expect(safeSerialize({ hook: () => "test", pattern: /^test$/ })).toEqual({
            hook: "[function]",
            pattern: "/^test$/",
        });
    });

    it("serializes shared references normally", () => {
        const shared = { x: 1 };
        expect(safeSerialize({ a: shared, b: shared })).toEqual({ a: { x: 1 }, b: { x: 1 } });
    });

    it("marks circular references", () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        expect(safeSerialize(obj)).toEqual({ a: 1, self: "[circular]" });
    });
});
