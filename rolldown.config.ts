import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

// `rolldown` subpaths (e.g. `rolldown/config`, `rolldown/plugins`) must stay external
// too — bundling them would inline a second copy of rolldown's runtime.
const external = ["chokidar", /^rolldown(\/.*)?$/];

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
        input: "src/bin.ts",
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
