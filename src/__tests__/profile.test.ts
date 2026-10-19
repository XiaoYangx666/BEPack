import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCLI } from "../cli.js";

function fixture(name: string): string {
    return fileURLToPath(new URL(`../profile/__tests__/fixtures/${name}`, import.meta.url));
}

async function run(...args: string[]): Promise<void> {
    await runCLI(["node", "bepack", ...args]);
}

function output(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.map((call) => String(call[0])).join("\n");
}

afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
});

describe("bepack profile", () => {
    it("shows command help", async () => {
        const spy = vi.spyOn(console, "info").mockImplementation(() => {});
        await run("profile", "--help");
        const text = output(spy);

        expect(text).toContain("profile <command>");
        expect(text).toContain("--gap");
        expect(text).toContain("--min-samples");
        expect(text).toContain("bepack profile diff");
    });

    it("prints a text summary with relative source paths", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {});
        await run("profile", "summary", fixture("bursts.cpuprofile"), "--root", "/project");
        const text = output(spy);

        expect(text).toContain("duration: 195.0 ms | samples: 48");
        expect(text).toContain("active: 45 (45.0 ms)");
        expect(text).toContain("@ 121.0-145.0 ms");
        expect(text).toContain("slowLoop  scripts/loop.js:31");
        expect(text).not.toContain("/project/scripts");
    });

    it("returns BEPack-shaped JSON", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {});
        await run("profile", "summary", fixture("bursts.cpuprofile"), "--json");

        const parsed = JSON.parse(String(spy.mock.calls[0]?.[0] ?? ""));
        expect(parsed).toMatchObject({
            ok: true,
            command: "profile",
            mode: "summary",
        });
        expect(parsed.profiles[0].activeSamples).toBe(45);
        expect(parsed.profiles[0].bursts[0].samples).toBe(25);
    });

    it("excludes the leading gap from top windows", async () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {});
        await run(
            "profile",
            "top",
            fixture("idle-gap.cpuprofile"),
            "--from",
            "50",
            "--to",
            "60",
            "--json"
        );

        const parsed = JSON.parse(String(spy.mock.calls[0]?.[0] ?? ""));
        expect(parsed.profile.activeSamples).toBe(10);
        expect(
            parsed.profile.rows.map((row: { functionName: string }) => row.functionName)
        ).toEqual(["doWork"]);
    });

    it("reports invalid arguments and invalid profiles with stable codes", async () => {
        const errorSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        await run("profile", "top", fixture("idle-gap.cpuprofile"), "--by", "bogus", "--json");
        expect(errorSpy).toHaveBeenCalled();
        expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0] ?? ""))).toMatchObject({
            ok: false,
            command: "profile",
            error: { code: "CLI_ARGUMENT_INVALID" },
        });
        expect(process.exitCode).toBe(1);

        process.exitCode = 0;
        errorSpy.mockClear();

        const temp = mkdtempSync(join(tmpdir(), "bepack-profile-cli-"));
        try {
            const invalid = join(temp, "invalid.cpuprofile");
            writeFileSync(invalid, "{}");
            await run("profile", "summary", invalid, "--json");
            expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0] ?? ""))).toMatchObject({
                ok: false,
                command: "profile",
                error: { code: "PROFILE_INVALID" },
            });
            expect(process.exitCode).toBe(1);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
