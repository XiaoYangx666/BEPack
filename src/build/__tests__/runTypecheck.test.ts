import { describe, expect, it } from "vitest";
import { buildShellCommandLine, quoteForCmd, quoteForPosixShell } from "../runTypecheck.js";
import {
    DEFAULT_TYPECHECK_COMMAND,
    formatTypecheckCommand,
    resolveTypecheck,
    tokenizeCommandLine,
} from "../typecheckers.js";

describe("resolveTypecheck", () => {
    it("defaults to tsc --noEmit with the tsconfig", () => {
        const typecheck = resolveTypecheck(undefined, [], {
            tsconfigPath: "configs/tsconfig.build.json",
        });
        expect(typecheck.isDefault).toBe(true);
        expect(typecheck.command).toBe("tsc");
        expect(formatTypecheckCommand(typecheck)).toBe(
            "tsc --noEmit --project configs/tsconfig.build.json"
        );
    });

    it("does not treat an explicit command as the default, so nothing is auto-appended", () => {
        // Only an unset command gets BePack's tsconfig/cache arguments. Writing
        // `tsc --noEmit` yourself means you own the whole command line.
        const typecheck = resolveTypecheck(DEFAULT_TYPECHECK_COMMAND, [], {
            tsconfigPath: "tsconfig.json",
            incremental: true,
            tsBuildInfoFile: "cache/tsconfig.tsbuildinfo",
        });
        expect(typecheck.isDefault).toBe(false);
        expect(formatTypecheckCommand(typecheck)).toBe("tsc --noEmit");
    });

    it("appends the tsconfig and cache flags to the unset default", () => {
        const typecheck = resolveTypecheck(undefined, [], {
            tsconfigPath: "tsconfig.json",
            incremental: true,
            tsBuildInfoFile: "cache/tsconfig.tsbuildinfo",
        });
        expect(typecheck.isDefault).toBe(true);
        expect(formatTypecheckCommand(typecheck)).toBe(
            "tsc --noEmit --project tsconfig.json --incremental --tsBuildInfoFile cache/tsconfig.tsbuildinfo"
        );
    });

    it("appends configured args to the default command", () => {
        const typecheck = resolveTypecheck(undefined, ["--pretty"], {
            tsconfigPath: "tsconfig.json",
        });
        expect(typecheck.args).toEqual(["--noEmit", "--project", "tsconfig.json", "--pretty"]);
    });

    it("keeps tsconfig and cache flags for deprecated useNpx", () => {
        const typecheck = resolveTypecheck(undefined, [], {
            tsconfigPath: "configs/tsconfig.json",
            incremental: true,
            tsBuildInfoFile: "cache/tsbuildinfo",
            useNpx: true,
        });
        expect(typecheck.command).toBe("npx");
        expect(typecheck.args).toEqual([
            "tsc",
            "--noEmit",
            "--project",
            "configs/tsconfig.json",
            "--incremental",
            "--tsBuildInfoFile",
            "cache/tsbuildinfo",
        ]);
    });

    it("quotes a path with spaces when rendering the command line", () => {
        const tsconfigPath = "C:\\my project\\tsconfig.json";
        const typecheck = resolveTypecheck(undefined, [], { tsconfigPath });
        // Rendering quotes the path so the logged line matches what a shell would need.
        expect(formatTypecheckCommand(typecheck)).toBe(
            `tsc --noEmit --project ${JSON.stringify(tsconfigPath)}`
        );
    });

    it("runs a custom command verbatim and adds nothing of its own", () => {
        const typecheck = resolveTypecheck("bun check", []);
        expect(typecheck.isDefault).toBe(false);
        expect(typecheck.command).toBe("bun");
        expect(typecheck.args).toEqual(["check"]);
        expect(typecheck.label).toBe("bun check");
        // No `--project` is injected: a custom command owns its arguments.
        expect(typecheck.args).not.toContain("--project");
    });

    it("lets a custom command opt into tsconfig and cache flags through args", () => {
        const typecheck = resolveTypecheck("tsc-rs", ["--noEmit", "--project", "tsconfig.json"], {
            tsconfigPath: "ignored-by-custom",
            incremental: true,
            tsBuildInfoFile: "ignored.tsbuildinfo",
        });
        expect(formatTypecheckCommand(typecheck)).toBe("tsc-rs --noEmit --project tsconfig.json");
    });

    it("appends args after a custom command's own arguments", () => {
        const typecheck = resolveTypecheck("bun check", ["--noEmit"]);
        expect(typecheck.args).toEqual(["check", "--noEmit"]);
    });

    it("keeps a command whose path contains spaces as one executable", () => {
        const typecheck = resolveTypecheck('node "C:\\tools\\my checker.mjs"', []);
        expect(typecheck.command).toBe("node");
        expect(typecheck.args).toEqual(["C:\\tools\\my checker.mjs"]);
    });

    it("falls back to the default for a blank command instead of spawning nothing", () => {
        expect(resolveTypecheck("   ", []).command).toBe("tsc");
        expect(resolveTypecheck("   ", []).isDefault).toBe(true);
    });

    it("rejects a command line that reduces to no executable", () => {
        expect(() => resolveTypecheck('""', [])).toThrow(/non-empty command line/);
    });
});

describe("tokenizeCommandLine", () => {
    it("splits on whitespace and respects quotes", () => {
        expect(tokenizeCommandLine("bun check")).toEqual(["bun", "check"]);
        expect(tokenizeCommandLine('vue-tsc --project "my dir/tsconfig.json"')).toEqual([
            "vue-tsc",
            "--project",
            "my dir/tsconfig.json",
        ]);
        expect(tokenizeCommandLine("a 'b c' d")).toEqual(["a", "b c", "d"]);
    });

    it("keeps Windows backslash paths verbatim", () => {
        // A general backslash-escape rule would silently produce `C:toolssome dircheck.mjs`.
        expect(tokenizeCommandLine('node "C:\\tools\\some dir\\check.mjs"')).toEqual([
            "node",
            "C:\\tools\\some dir\\check.mjs",
        ]);
        expect(tokenizeCommandLine("node C:\\tools\\check.mjs")).toEqual([
            "node",
            "C:\\tools\\check.mjs",
        ]);
        // A UNC path keeps both leading backslashes and its separators.
        expect(tokenizeCommandLine('node "\\\\server\\share\\check.mjs"')).toEqual([
            "node",
            "\\\\server\\share\\check.mjs",
        ]);
    });

    it("still escapes the surrounding quote", () => {
        expect(tokenizeCommandLine('node "say \\"hi\\".mjs"')).toEqual(["node", 'say "hi".mjs']);
        expect(tokenizeCommandLine(`node 'it\\'s check.mjs'`)).toEqual(["node", "it's check.mjs"]);
        expect(tokenizeCommandLine('\\"quoted\\"')).toEqual(['"quoted"']);
    });

    it("rejects an unterminated quote", () => {
        expect(() => tokenizeCommandLine('tsc "unterminated')).toThrow(/Unterminated/);
    });
});

describe("shell quoting", () => {
    it("quotes cmd arguments so spaces and metacharacters stay literal", () => {
        expect(quoteForCmd("--noEmit")).toBe("--noEmit");
        expect(quoteForCmd("C:\\plain\\tsconfig.json")).toBe("C:\\plain\\tsconfig.json");
        expect(quoteForCmd("C:\\my project\\tsconfig.json")).toBe(
            '"C:\\my project\\tsconfig.json"'
        );
        expect(quoteForCmd("a&b")).toBe('"a&b"');
        expect(quoteForCmd("a^b")).toBe('"a^b"');
        expect(quoteForCmd("%TEMP%")).toBe("^%TEMP^%");
        expect(quoteForCmd("a %TEMP% b")).toBe('"a "^%"TEMP"^%" b"');
        expect(quoteForCmd("")).toBe('""');
        expect(quoteForCmd("C:\\dir \\")).toBe('"C:\\dir \\\\"');
        expect(quoteForCmd('a"b')).toBe('"a\\"b"');
    });

    it("joins an executable and its arguments into one command line", () => {
        expect(
            buildShellCommandLine("C:\\bin\\tsc.cmd", [
                "--noEmit",
                "--project",
                "C:\\my project\\tsconfig.json",
            ])
        ).toBe('C:\\bin\\tsc.cmd --noEmit --project "C:\\my project\\tsconfig.json"');
    });

    it("quotes POSIX arguments with single quotes", () => {
        expect(quoteForPosixShell("--noEmit")).toBe("--noEmit");
        expect(quoteForPosixShell("/my project/tsconfig.json")).toBe("'/my project/tsconfig.json'");
        expect(quoteForPosixShell("it's")).toBe("'it'\\''s'");
        expect(quoteForPosixShell("$HOME")).toBe("'$HOME'");
    });
});
