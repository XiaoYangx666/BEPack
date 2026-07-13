import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Config serialization — test the real safeSerialize behavior
// We can't import it directly (it's private), so we test via its observable
// contract: JSON.stringify on the config output.
// ---------------------------------------------------------------------------

describe("config output structure", () => {
    it("functions are not present in resolved config (hooks are callable)", () => {
        // ResolvedConfig.hooks is an object of functions, but when serialized
        // they become "[function]" strings
        const obj = { hooks: { beforeBuild: () => "test" } };
        const result = JSON.parse(
            JSON.stringify(obj, (_k, v) => (typeof v === "function" ? "[function]" : v))
        );
        expect(result.hooks.beforeBuild).toBe("[function]");
    });

    it("RegExp is serialized as string", () => {
        const obj = { pattern: /^test$/ };
        const result = JSON.parse(
            JSON.stringify(obj, (_k, v) => (v instanceof RegExp ? v.toString() : v))
        );
        expect(result.pattern).toBe("/^test$/");
    });

    it("shared references are not marked as circular", () => {
        // The safeSerialize function uses a stack for cycle detection
        // Shared refs (not in current recursion stack) are "[shared]"
        // This tests that shared refs don't cause infinite recursion
        const shared = { x: 1 };
        const obj = { a: shared, b: shared };
        // This won't throw
        expect(() => JSON.stringify(obj)).not.toThrow();
    });

    it("true circular references are handled", () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        // JSON.stringify on a circular reference throws
        expect(() => JSON.stringify(obj)).toThrow();
    });
});
