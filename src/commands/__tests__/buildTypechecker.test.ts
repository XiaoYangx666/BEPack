import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { commandBuild } from "../build.js";

/**
 * A fake checker that records its argv, so these tests prove what the CLI actually
 * executes — including which config values reach the command line.
 */
function makeProject(options: {
    /** Point the generated config's `typecheck.command` at the fake checker. */
    configUsesChecker?: boolean;
    /** Explicit command to write into the config. */
    typecheckCommand?: string;
    typecheckArgs?: string[];
    useNpx?: boolean;
}): { cwd: string; checker: string; argvFile: string } {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "bepack-cli-typecheck-"));
    mkdirSync(path.join(cwd, "bp"), { recursive: true });
    mkdirSync(path.join(cwd, "src"), { recursive: true });

    const checker = path.join(cwd, "checker.mjs").replace(/\\/g, "/");
    const argvFile = path.join(cwd, "argv.json");
    writeFileSync(
        checker,
        [
            'import { writeFileSync } from "node:fs";',
            `writeFileSync(${JSON.stringify(argvFile.replace(/\\/g, "/"))}, JSON.stringify(process.argv.slice(2)));`,
        ].join("\n")
    );
    writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    writeFileSync(path.join(cwd, "src", "main.ts"), "export const x: string = 'x';\n");

    const commandLine = `node "${checker}"`;
    const configured =
        options.typecheckCommand ?? (options.configUsesChecker ? commandLine : undefined);

    const compileParts = [
        'entry: "src/main.ts"',
        // Keep rolldown out of the way; only the typecheck step is under test.
        "typecheck: false",
    ];
    if (configured !== undefined) {
        compileParts.push(`typecheckCommand: ${JSON.stringify(configured)}`);
    }
    if (options.typecheckArgs) {
        compileParts.push(`typecheckArgs: ${JSON.stringify(options.typecheckArgs)}`);
    }
    if (options.useNpx) compileParts.push("useNpx: true");

    writeFileSync(
        path.join(cwd, "bepack.config.mjs"),
        [
            "export default {",
            '    name: "cli-typecheck",',
            '    version: "1.0.0",',
            "    packs: {",
            "        bp: {",
            '            root: "bp",',
            '            uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",',
            '            moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",',
            `            compile: { ${compileParts.join(", ")} },`,
            "        },",
            "    },",
            "};",
        ].join("\n")
    );
    writeFileSync(
        path.join(cwd, "bp", "manifest.json"),
        JSON.stringify({
            format_version: 2,
            header: {
                name: "cli-typecheck",
                description: "",
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                version: [1, 0, 0],
                min_engine_version: [1, 21, 0],
            },
            modules: [],
        })
    );

    return { cwd, checker, argvFile };
}

function readArgv(argvFile: string): string[] {
    return JSON.parse(readFileSync(argvFile, "utf-8")) as string[];
}

describe("commandBuild typecheck command overrides", () => {
    it("uses the configured command and appends its args", async () => {
        const { cwd, argvFile } = makeProject({
            configUsesChecker: true,
            typecheckArgs: ["--from-config"],
        });

        const result = (await commandBuild({ cwd, typecheck: true, json: true, silent: true })) as {
            build: { typecheckCommand: string };
        };

        expect(readArgv(argvFile)).toEqual(["--from-config"]);
        expect(result.build.typecheckCommand).toContain("--from-config");
    });

    it("drops config args when the CLI supplies a command", async () => {
        const { cwd, checker, argvFile } = makeProject({
            typecheckCommand: "tsc --noEmit",
            typecheckArgs: ["--from-config"],
        });

        await commandBuild({
            cwd,
            typecheck: true,
            json: true,
            silent: true,
            typecheckCommand: `node "${checker}"`,
        });

        // The CLI command replaces the command *and* its args.
        expect(readArgv(argvFile)).toEqual([]);
    });

    it("passes --typecheck-command through unchanged when it is a preset-looking word", async () => {
        const { cwd, argvFile } = makeProject({ typecheckCommand: "tsc --noEmit" });

        // A literal command line is never reinterpreted as a shorthand.
        await commandBuild({
            cwd,
            typecheck: true,
            json: true,
            silent: true,
            typecheckCommand: `node "${path.join(cwd, "checker.mjs")}"`,
        });

        expect(readArgv(argvFile)).toEqual([]);
    });

    it("does not run any checker with --skip-typecheck", async () => {
        const { cwd, argvFile } = makeProject({ configUsesChecker: true });

        await commandBuild({ cwd, skipTypecheck: true, json: true, silent: true });

        expect(() => readArgv(argvFile)).toThrow();
    });

    it("lets an explicit CLI command override the deprecated --use-npx", async () => {
        const { cwd, checker, argvFile } = makeProject({});
        // `--use-npx` implies `npx tsc --noEmit`; the CLI command still wins over it.
        await commandBuild({
            cwd,
            typecheck: true,
            json: true,
            silent: true,
            useNpx: true,
            typecheckCommand: `node "${checker}"`,
        });
        expect(readArgv(argvFile)).toEqual([]);
    });

    it("keeps tsconfig and cache flags for the deprecated config useNpx option", async () => {
        const { cwd, argvFile } = makeProject({
            useNpx: true,
            typecheckArgs: ["--from-config"],
        });
        const npxArgsRecorder = path.join(cwd, "record-npx.mjs");
        writeFileSync(
            npxArgsRecorder,
            [
                'import { writeFileSync } from "node:fs";',
                `writeFileSync(${JSON.stringify(argvFile.replace(/\\/g, "/"))}, JSON.stringify(process.argv.slice(2)));`,
            ].join("\n")
        );

        if (process.platform === "win32") {
            writeFileSync(
                path.join(cwd, "npx.cmd"),
                [
                    "@echo off",
                    `"${process.execPath}" "${npxArgsRecorder}" %*`,
                    "exit /b 0",
                    "",
                ].join("\r\n")
            );
        } else {
            const npx = path.join(cwd, "npx");
            writeFileSync(
                npx,
                `#!/bin/sh\nexec "${process.execPath}" ${JSON.stringify(npxArgsRecorder)} "$@"\n`
            );
            chmodSync(npx, 0o755);
        }

        const originalPath = process.env.PATH;
        process.env.PATH = [cwd, originalPath].filter(Boolean).join(path.delimiter);
        try {
            const result = (await commandBuild({
                cwd,
                typecheck: true,
                cache: true,
                json: true,
                silent: true,
            })) as { build: { typecheckCommand: string } };

            expect(readArgv(argvFile)).toEqual([
                "tsc",
                "--noEmit",
                "--project",
                path.join(cwd, "tsconfig.json"),
                "--incremental",
                "--tsBuildInfoFile",
                path.resolve(cwd, "node_modules/.cache/bepack/tsconfig.tsbuildinfo"),
                "--from-config",
            ]);
            expect(result.build.typecheckCommand).toContain("npx tsc --noEmit");
            expect(result.build.typecheckCommand).toContain("--from-config");
        } finally {
            if (originalPath === undefined) delete process.env.PATH;
            else process.env.PATH = originalPath;
        }
    });
});
