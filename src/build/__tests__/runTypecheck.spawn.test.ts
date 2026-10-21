import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { runTypecheck } from "../runTypecheck.js";
import { BePackError } from "../../errors/BePackError.js";

/**
 * End-to-end coverage for the spawn path: a fake checker script records its argv, so
 * these tests prove what BePack actually executes (not just what it would print).
 */
function makeProject(): string {
    const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-typecheck-"));
    writeFileSync(path.join(temp, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    return temp;
}

/** Write a checker script that records its argv to `argv.json` and exits with `code`. */
function writeFakeChecker(cwd: string, code = 0): string {
    const script = path.join(cwd, "fake-checker.mjs");
    writeFileSync(
        script,
        [
            'import { writeFileSync } from "node:fs";',
            "writeFileSync(",
            '  new URL("./argv.json", import.meta.url),',
            "  JSON.stringify(process.argv.slice(2))",
            ");",
            `process.exit(${code});`,
        ].join("\n")
    );
    // NOTE: deliberately returned with native separators. Normalizing to forward slashes
    // here would hide backslash-mangling in `tokenizeCommandLine`.
    return script;
}

/**
 * Write a `.cmd` shim that runs the fake checker.
 *
 * This is the real Windows path BePack takes for npm-installed checkers (`tsc.cmd`,
 * `npx.cmd`, ...): `.cmd` files can only run through `cmd.exe`, so this is the only way to
 * prove that arguments containing spaces are quoted rather than split.
 */
function writeFakeCmdShim(
    cwd: string,
    nodeScript: string,
    code = 0,
    name = "fake-checker"
): string {
    const shim = path.join(cwd, `${name}.cmd`);
    writeFileSync(
        shim,
        ["@echo off", `"${process.execPath}" "${nodeScript}" %*`, `exit /b ${code}`, ""].join(
            "\r\n"
        )
    );
    return shim;
}

function readArgv(cwd: string): string[] {
    return JSON.parse(readFileSync(path.join(cwd, "argv.json"), "utf-8")) as string[];
}

/** Narrow a caught value to BePackError without losing the assertion on failure. */
function expectBePackError(error: unknown): BePackError {
    expect(error).toBeInstanceOf(BePackError);
    return error as BePackError;
}

describe("runTypecheck (spawn)", () => {
    it("runs a custom command and passes only the configured args", async () => {
        const cwd = makeProject();
        const script = writeFakeChecker(cwd);
        const result = await runTypecheck(cwd, {
            command: `node "${script}"`,
            args: ["--pretty"],
            quiet: true,
        });

        expect(result.isDefault).toBe(false);
        expect(result.commandLine).toContain("fake-checker.mjs");
        // No `--project` is injected for a custom command.
        expect(readArgv(cwd)).toEqual(["--pretty"]);
    });

    it("never injects cache or tsconfig flags into a custom command", async () => {
        const cwd = makeProject();
        const script = writeFakeChecker(cwd);
        const tsBuildInfoFile = path.join(cwd, "cache", "tsconfig.tsbuildinfo");

        await runTypecheck(cwd, {
            command: `node "${script}"`,
            args: ["--noEmit"],
            // Even though the caller offers a tsconfig and a cache file, a custom command
            // owns its arguments and must not receive either.
            tsconfigPath: "tsconfig.json",
            incremental: true,
            tsBuildInfoFile,
            quiet: true,
        });

        expect(readArgv(cwd)).toEqual(["--noEmit"]);
        expect(existsSync(tsBuildInfoFile)).toBe(false);
    });

    it("fails with TYPECHECK_FAILED, the exit code and the command line", async () => {
        const cwd = makeProject();
        const script = writeFakeChecker(cwd, 2);

        const error = expectBePackError(
            await runTypecheck(cwd, {
                command: `node "${script}"`,
                quiet: true,
            }).catch((cause: unknown) => cause)
        );

        expect(error.code).toBe("TYPECHECK_FAILED");
        const details = error.details as { exitCode: number; command: string; label: string };
        expect(details.exitCode).toBe(2);
        expect(details.command).toContain("fake-checker.mjs");
        expect(details.label).toContain("node");
    });

    it("reports a missing tsconfig as TYPECHECK_FAILED for the default checker", async () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), "bepack-typecheck-empty-"));
        const error = expectBePackError(
            await runTypecheck(cwd, { quiet: true }).catch((cause: unknown) => cause)
        );

        expect(error.code).toBe("TYPECHECK_FAILED");
        expect(error.message).toMatch(/TypeScript config not found/);
    });

    it("only warns about a missing tsconfig for a custom command", async () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), "bepack-typecheck-empty2-"));
        const script = writeFakeChecker(cwd);
        const warnings: string[] = [];

        const result = await runTypecheck(cwd, {
            command: `node "${script}"`,
            quiet: true,
            warn: (message) => warnings.push(message),
        });

        expect(result.isDefault).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/TypeScript config not found/);
        expect(warnings[0]).toMatch(/running/);
        // The custom command still ran.
        expect(readArgv(cwd)).toEqual([]);
    });

    it("reports a missing executable as TYPECHECK_FAILED with suggestions", async () => {
        const cwd = makeProject();
        const error = expectBePackError(
            await runTypecheck(cwd, {
                command: "definitely-not-a-real-checker-binary",
                quiet: true,
            }).catch((cause: unknown) => cause)
        );

        expect(error.code).toBe("TYPECHECK_FAILED");
        const details = error.details as { command: string };
        expect(details.command).toContain("definitely-not-a-real-checker-binary");
        expect(error.suggestions?.length).toBeGreaterThan(0);
        expect(error.suggestions?.join(" ")).toMatch(/--skip-typecheck/);
    });

    it("preserves tsconfig and cache flags for deprecated useNpx", async () => {
        const cwd = makeProject();
        const customTsconfig = path.join(cwd, "configs", "custom.json");
        mkdirSync(path.dirname(customTsconfig), { recursive: true });
        writeFileSync(customTsconfig, JSON.stringify({ compilerOptions: {} }));
        const script = writeFakeChecker(cwd);

        if (process.platform === "win32") {
            writeFakeCmdShim(cwd, script, 0, "npx");
        } else {
            const npx = path.join(cwd, "npx");
            writeFileSync(npx, `#!/bin/sh\nexec node ${JSON.stringify(script)} "$@"\n`);
            chmodSync(npx, 0o755);
        }

        const originalPath = process.env.PATH;
        process.env.PATH = [cwd, originalPath].filter(Boolean).join(path.delimiter);
        try {
            const result = await runTypecheck(cwd, {
                useNpx: true,
                tsconfigPath: path.relative(cwd, customTsconfig),
                incremental: true,
                tsBuildInfoFile: path.join(cwd, "cache", "typecheck.tsbuildinfo"),
                quiet: true,
            });
            expect(result.command).toBe("npx");
            expect(readArgv(cwd)).toEqual([
                "tsc",
                "--noEmit",
                "--project",
                customTsconfig,
                "--incremental",
                "--tsBuildInfoFile",
                path.join(cwd, "cache", "typecheck.tsbuildinfo"),
            ]);
            expect(existsSync(path.join(cwd, "cache"))).toBe(true);
        } finally {
            if (originalPath === undefined) delete process.env.PATH;
            else process.env.PATH = originalPath;
        }
    });

    it("maps a synchronous spawn throw (Windows EFTYPE) to TYPECHECK_FAILED", async () => {
        const cwd = makeProject();
        // A real file that is not an executable entry point: `spawn` throws synchronously
        // on Windows (EFTYPE) instead of emitting an `error` event.
        const notExecutable = path.join(cwd, "checker.mjs");
        writeFileSync(notExecutable, "export const x = 1;");

        const error = expectBePackError(
            await runTypecheck(cwd, {
                command: process.platform === "win32" ? notExecutable : "not-executable-binary",
                quiet: true,
            }).catch((cause: unknown) => cause)
        );

        expect(error.code).toBe("TYPECHECK_FAILED");
        expect(error.message).toMatch(/Cannot start|Cannot find/);
        expect(error.suggestions?.length).toBeGreaterThan(0);
    });

    it("keeps a Windows-style backslash path intact in a custom command", async () => {
        const cwd = makeProject();
        // Native separators on purpose: `tokenizeCommandLine` must not treat `\` as an
        // escape character, or this becomes `C:...toolscheck.mjs`.
        const toolsDir = path.join(cwd, "tools");
        mkdirSync(toolsDir, { recursive: true });
        const script = writeFakeChecker(toolsDir);

        const result = await runTypecheck(cwd, {
            command: `node "${script}"`,
            quiet: true,
        });

        expect(result.command).toBe("node");
        // The checker actually ran from its backslash path.
        expect(readArgv(toolsDir)).toEqual([]);
    });

    it("resolves a relative executable path against the supplied project cwd", async () => {
        const cwd = makeProject();
        const toolsDir = path.join(cwd, "tools");
        mkdirSync(toolsDir, { recursive: true });

        if (process.platform === "win32") {
            const script = writeFakeChecker(toolsDir);
            writeFakeCmdShim(toolsDir, script);
            await runTypecheck(cwd, {
                command: "tools/fake-checker.cmd",
                quiet: true,
            });
            expect(readArgv(toolsDir)).toEqual([]);
            return;
        }

        const script = writeFakeChecker(cwd);
        const executable = path.join(toolsDir, "fake-checker");
        writeFileSync(executable, `#!/bin/sh\nexec node ${JSON.stringify(script)} "$@"\n`);
        chmodSync(executable, 0o755);
        await runTypecheck(cwd, {
            command: "tools/fake-checker",
            quiet: true,
        });
        expect(readArgv(cwd)).toEqual([]);
    });

    it.runIf(process.platform === "win32")(
        "quotes arguments for a .cmd shim so a spaced path is not split",
        async () => {
            // A directory containing a space, exactly like `C:\Users\First Last\...`.
            const base = mkdtempSync(path.join(os.tmpdir(), "bepack-typecheck-"));
            const cwd = path.join(base, "spaced project");
            mkdirSync(cwd, { recursive: true });
            writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));

            const script = writeFakeChecker(cwd);
            const shim = writeFakeCmdShim(cwd, script);

            const result = await runTypecheck(cwd, {
                command: `"${shim}"`,
                // The spaced path only reaches the command line through `args`, which is
                // where an unquoted shell spawn would split it.
                args: ["--project", path.join(cwd, "tsconfig.json")],
                quiet: true,
            });

            expect(result.isDefault).toBe(false);
            // Without proper quoting, cmd.exe splits this into three argv entries.
            expect(readArgv(cwd)).toEqual(["--project", path.join(cwd, "tsconfig.json")]);
        }
    );

    it.runIf(process.platform === "win32")(
        "quotes cmd metacharacters so they cannot split or chain the command",
        async () => {
            const base = mkdtempSync(path.join(os.tmpdir(), "bepack-typecheck-"));
            const cwd = path.join(base, "spaced & meta");
            mkdirSync(cwd, { recursive: true });
            writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));

            const script = writeFakeChecker(cwd);
            const shim = writeFakeCmdShim(cwd, script);

            await runTypecheck(cwd, {
                command: `"${shim}"`,
                args: ["--project", path.join(cwd, "tsconfig.json"), "--tag", "literal-%TEMP%"],
                quiet: true,
            });

            // `&` must reach the checker as ordinary text, not start a second command.
            expect(readArgv(cwd)).toEqual([
                "--project",
                path.join(cwd, "tsconfig.json"),
                "--tag",
                "literal-%TEMP%",
            ]);
            expect(existsSync(path.join(base, "x"))).toBe(false);
        }
    );

    it.runIf(process.platform === "win32")(
        "finds a .cmd executable by its explicit extension on PATH",
        async () => {
            const cwd = makeProject();
            const script = writeFakeChecker(cwd);
            writeFakeCmdShim(cwd, script);
            const originalPath = process.env.PATH;
            process.env.PATH = [cwd, originalPath].filter(Boolean).join(path.delimiter);
            try {
                await runTypecheck(cwd, {
                    command: "fake-checker.cmd",
                    quiet: true,
                });
                expect(readArgv(cwd)).toEqual([]);
            } finally {
                if (originalPath === undefined) delete process.env.PATH;
                else process.env.PATH = originalPath;
            }
        }
    );
});
