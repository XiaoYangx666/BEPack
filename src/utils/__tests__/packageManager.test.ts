import { describe, expect, it } from "vitest";
import { sanitizePackageManagerEnv } from "../packageManager.js";

describe("sanitizePackageManagerEnv", () => {
    it("drops npm_config_allow_scripts inherited from npm run", () => {
        const { env, removed } = sanitizePackageManagerEnv({
            PATH: "/usr/bin",
            npm_config_allow_scripts: "esbuild",
        });

        expect(removed).toEqual(["npm_config_allow_scripts"]);
        expect(env).toEqual({ PATH: "/usr/bin" });
    });

    it("is case-insensitive, matching npm's config keys", () => {
        const { env, removed } = sanitizePackageManagerEnv({
            NPM_CONFIG_ALLOW_SCRIPTS: "esbuild",
            NPM_CONFIG_REGISTRY: "https://example.test/",
        });

        expect(removed).toEqual(["NPM_CONFIG_ALLOW_SCRIPTS"]);
        expect(env.NPM_CONFIG_REGISTRY).toBe("https://example.test/");
    });

    it("keeps unrelated npm config so registry/auth settings still apply", () => {
        const source = {
            npm_config_registry: "https://registry.example.test/",
            npm_config_userconfig: "/home/user/.npmrc",
            npm_config_strict_ssl: "true",
        };
        const { env, removed } = sanitizePackageManagerEnv(source);

        expect(removed).toEqual([]);
        expect(env).toEqual(source);
    });

    it("ignores an empty value, which npm treats as no policy", () => {
        const { env } = sanitizePackageManagerEnv({ npm_config_allow_scripts: "" });
        expect(env.npm_config_allow_scripts).toBeUndefined();
    });
});
