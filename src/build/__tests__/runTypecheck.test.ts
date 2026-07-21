import { describe, expect, it } from "vitest";
import { resolveTypecheckCommand } from "../runTypecheck.js";

describe("resolveTypecheckCommand", () => {
    it("uses the configured tsconfig as the project", () => {
        expect(resolveTypecheckCommand(false, "configs/tsconfig.build.json", false)).toBe(
            'tsc --noEmit --project "configs/tsconfig.build.json"'
        );
    });

    it("keeps incremental options alongside the project", () => {
        expect(
            resolveTypecheckCommand(true, "tsconfig.json", true, "cache/tsconfig.tsbuildinfo")
        ).toBe(
            'npx tsc --noEmit --project "tsconfig.json" --incremental --tsBuildInfoFile "cache/tsconfig.tsbuildinfo"'
        );
    });
});
