import { defineConfig } from "rolldown";

const external = ["chokidar", "rolldown"];

export default defineConfig([
    {
        input: "src/index.ts",
        platform: "node",
        external,
        output: {
            file: "dist/index.js",
            format: "esm",
            codeSplitting: false,
        },
    },
    {
        input: "src/cli.ts",
        platform: "node",
        external,
        output: {
            file: "dist/cli.js",
            format: "esm",
            codeSplitting: false,
        },
    },
]);
