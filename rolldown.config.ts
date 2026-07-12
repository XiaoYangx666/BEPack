import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

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
            minify: true,
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
            minify: true,
        },
    },
    {
        input: "src/index.ts",
        external,
        plugins: [
            dts({
                emitDtsOnly: true,
                tsconfig: "./tsconfig.json",
            }),
        ],
        output: {
            dir: "dist",
            format: "esm",
        },
    },
]);
