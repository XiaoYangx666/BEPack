import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { commandBuild } from "../../commands/build.js";
import { commandManifest } from "../../commands/manifest.js";
import { runBuild } from "../../build/runBuild.js";
import { loadConfig } from "../../config/loadConfig.js";
import { Logger } from "../../logger/logger.js";

type HookEvent = { name: string; command: string; dryRun: boolean };

/**
 * Project whose config records every hook call into `hooks.log`, so the wiring of
 * manifest/copy/pack hooks can be asserted from the outside.
 */
function makeHookedProject(options: { copyTarget?: boolean } = {}): string {
    const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-hooks-"));
    mkdirSync(path.join(temp, "bp", "scripts"), { recursive: true });
    mkdirSync(path.join(temp, "src"), { recursive: true });
    if (options.copyTarget) mkdirSync(path.join(temp, "copied"), { recursive: true });
    writeFileSync(
        path.join(temp, "bp", "manifest.json"),
        JSON.stringify({
            format_version: 2,
            header: {
                name: "Hooked",
                description: "",
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                version: [1, 0, 0],
                min_engine_version: [1, 21, 0],
            },
            modules: [
                {
                    type: "script",
                    language: "javascript",
                    uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    version: [1, 0, 0],
                    entry: "scripts/main.js",
                },
            ],
        })
    );
    writeFileSync(path.join(temp, "src", "main.ts"), "console.warn('hi');\n");
    const copyConfig = options.copyTarget
        ? `copy: { targets: { test: { type: "custom", bp: ${JSON.stringify(
              path.join(temp, "copied")
          )} } } },`
        : "";
    writeFileSync(
        path.join(temp, "bepack.config.mjs"),
        `import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const logFile = fileURLToPath(new URL("./hooks.log", import.meta.url));
const record = (name) => (ctx) =>
    appendFileSync(logFile, JSON.stringify({ name, command: ctx.command, dryRun: ctx.dryRun }) + "\\n");
export default {
    name: "addon",
    packs: {
        bp: {
            root: "bp",
            uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            moduleUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            compile: { entry: "src/main.ts", typecheck: false },
        },
    },
    ${copyConfig}
    pack: { outDir: "dist" },
    hooks: {
        beforeManifest: record("beforeManifest"),
        afterManifest: record("afterManifest"),
        beforeBuild: record("beforeBuild"),
        afterBuild: record("afterBuild"),
        beforeCopy: record("beforeCopy"),
        afterCopy: record("afterCopy"),
        beforePack: record("beforePack"),
        afterPack: record("afterPack"),
    },
};
`
    );
    return temp;
}

function hookEvents(temp: string): HookEvent[] {
    const file = path.join(temp, "hooks.log");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as HookEvent);
}

function names(temp: string): string[] {
    return hookEvents(temp).map((event) => event.name);
}

describe("hook wiring", () => {
    it("fires manifest hooks from `build`", async () => {
        const temp = makeHookedProject();
        try {
            await commandBuild({ cwd: temp, skipTypecheck: true, silent: true });

            expect(names(temp)).toEqual([
                "beforeManifest",
                "afterManifest",
                "beforeBuild",
                "afterBuild",
            ]);
            expect(hookEvents(temp)[0]).toMatchObject({ command: "build", dryRun: false });
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("fires copy hooks for `build --copy`", async () => {
        const temp = makeHookedProject({ copyTarget: true });
        try {
            await commandBuild({
                cwd: temp,
                skipTypecheck: true,
                silent: true,
                copy: true,
                copyTarget: "test",
            });

            expect(names(temp)).toEqual([
                "beforeManifest",
                "afterManifest",
                "beforeBuild",
                "afterBuild",
                "beforeCopy",
                "afterCopy",
            ]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("fires pack hooks for `build --pack`", async () => {
        const temp = makeHookedProject();
        try {
            await commandBuild({ cwd: temp, skipTypecheck: true, silent: true, pack: true });

            expect(names(temp)).toEqual([
                "beforeManifest",
                "afterManifest",
                "beforeBuild",
                "afterBuild",
                "beforePack",
                "afterPack",
            ]);
            const packEvents = hookEvents(temp).filter((event) => event.name.endsWith("Pack"));
            expect(packEvents.every((event) => event.command === "pack")).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("reports dryRun inside the hook context", async () => {
        const temp = makeHookedProject();
        try {
            await commandBuild({ cwd: temp, skipTypecheck: true, silent: true, dryRun: true });

            expect(hookEvents(temp).every((event) => event.dryRun)).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("reports command `dev` when the dev pipeline rebuilds", async () => {
        const temp = makeHookedProject();
        try {
            const { cwd, config } = await loadConfig({ cwd: temp });
            await runBuild({
                cwd,
                config,
                logger: new Logger({ silent: true }),
                command: "dev",
                typecheck: false,
            });

            expect(hookEvents(temp).map((event) => [event.name, event.command])).toEqual([
                ["beforeManifest", "dev"],
                ["afterManifest", "dev"],
                ["beforeBuild", "dev"],
                ["afterBuild", "dev"],
            ]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("fires manifest hooks from the standalone `manifest` command", async () => {
        const temp = makeHookedProject();
        try {
            await commandManifest({ cwd: temp, silent: true });

            expect(hookEvents(temp).map((event) => [event.name, event.command])).toEqual([
                ["beforeManifest", "manifest"],
                ["afterManifest", "manifest"],
            ]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
