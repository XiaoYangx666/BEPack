import { describe, it, expect, vi, afterEach } from "vitest";
import { runCLI } from "../cli.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, "../../package.json");
const pkg: { version: string } = JSON.parse(readFileSync(pkgPath, "utf-8"));

afterEach(() => {
    process.exitCode = 0;
});

async function run(...args: string[]): Promise<void> {
    await runCLI(["node", "bepack", ...args]);
}

describe("CLI entry point", () => {
    // ── Help ──────────────────────────────────────────────────────────

    it("shows help when no arguments are given", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        await run();
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(output).toMatch(/bepack/i);
        expect(output).toMatch(/Commands/i);
        spy.mockRestore();
    });

    it("shows help with --help", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        await run("--help");
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it("shows help with -h", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        await run("-h");
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    // ── Version ────────────────────────────────────────────────────────

    it("shows version with --version matching package.json", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        await run("--version");
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(output).toContain(pkg.version);
        spy.mockRestore();
    });

    it("shows version with -v matching package.json", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        await run("-v");
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(output).toContain(pkg.version);
        spy.mockRestore();
    });

    // ── Known commands ────────────────────────────────────────────────

    it("executes a known command without unknown-command error", async () => {
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        // --help on a known command shows command-specific help, not an error
        await run("init", "--help");
        expect(errSpy).not.toHaveBeenCalled();
        errSpy.mockRestore();
    });

    it("executes the build alias (b) without unknown-command error", async () => {
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await run("b", "--help");
        expect(errSpy).not.toHaveBeenCalled();
        errSpy.mockRestore();
    });

    // ── Unknown commands ──────────────────────────────────────────────

    it("reports UNKNOWN_COMMAND for an unrecognized subcommand", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        await run("buidl");
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(output).toContain("UNKNOWN_COMMAND");
        expect(output).toContain("buidl");
        expect(output).toContain("bepack --help");
        spy.mockRestore();
    });

    it("sets a non-zero exit code for unknown commands", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        await run("unknown");
        expect(process.exitCode).toBe(1);
    });

    it("reports UNKNOWN_COMMAND for bare unknown word after known options", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        await run("--verbose", "unknown");
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(output).toContain("UNKNOWN_COMMAND");
        spy.mockRestore();
    });

    // ── Unknown options (CACError) ────────────────────────────────────

    it("reports an error for unknown option flags on a known command", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        await run("build", "--nonexistent-flag");
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(output).toContain("ERROR");
        // CAC camelCases the flag in the error message
        expect(output).toContain("nonexistentFlag");
        spy.mockRestore();
    });

    // ── JSON output ──────────────────────────────────────────────────

    it("outputs valid JSON for unknown command with --json", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {});
        await run("--json", "buidl");
        expect(spy).toHaveBeenCalled();
        const text = String(spy.mock.calls[0]?.[0] ?? "");
        const parsed = JSON.parse(text);
        expect(parsed).toMatchObject({
            ok: false,
            command: "cli",
            error: { code: "UNKNOWN_COMMAND" },
        });
        spy.mockRestore();
    });

    // ── Async action error capture ────────────────────────────────────

    it("captures errors thrown by CAC validation (e.g. missing required option value)", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        // `build` has boolean options only, but pass a flag that needs a value
        // to trigger CAC's checkOptionValue on a different command
        await run("pack", "--name");
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
        // CACError is not a BePackError so it shows "ERROR:"
        expect(output).toContain("ERROR");
        spy.mockRestore();
    });
});
