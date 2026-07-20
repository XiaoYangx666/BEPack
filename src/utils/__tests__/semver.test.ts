import { describe, expect, it } from "vitest";
import { satisfiesSemver } from "../semver.js";

describe("satisfiesSemver", () => {
    it.each([
        ["2.8.0", "^2.8.0", true],
        ["2.9.0", "^2.8.0", true],
        ["3.0.0", "^2.8.0", false],
        ["2.4.0-xxx-beta", "2.3.0", true],
        ["2.2.9-beta", "2.3.0", false],
        ["2.9.0-beta.1.26.33-stable", "2.9.0-beta.1.26.30-stable", true],
        ["2.9.0-1.26.33-beta", "2.9.0-1.26.30-beta", true],
        ["2.9.0-beta.1.26.29-stable", "2.9.0-beta.1.26.30-stable", false],
        ["2.9.0", "2.9.0-beta.1.26.30-stable", false],
        ["2.9.0-beta.1.26.33-stable", "^2.9.0-beta.1.26.30-stable", true],
    ])("%s satisfies %s: %s", (version, range, expected) => {
        expect(satisfiesSemver(version, range)).toBe(expected);
    });

    it("returns false for malformed versions and ranges", () => {
        expect(satisfiesSemver("not-a-version", "^2.8.0")).toBe(false);
        expect(satisfiesSemver("2.8.0", "latest")).toBe(false);
    });
});
