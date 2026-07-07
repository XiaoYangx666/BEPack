import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Network tests against the real npm registry can be slow
        testTimeout: 15_000,
    },
});
