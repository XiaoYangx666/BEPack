import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import type { Logger } from "../../logger/logger.js";
import { watchProject } from "../watch.js";

const mocks = vi.hoisted(() => ({
    watch: vi.fn(),
    patchManifest: vi.fn(),
    copyPacks: vi.fn(),
    runBuild: vi.fn(),
}));

vi.mock("chokidar", () => ({ default: { watch: mocks.watch } }));
vi.mock("../../manifest/patchManifest.js", () => ({ patchManifest: mocks.patchManifest }));
vi.mock("../../copy/copyPacks.js", () => ({ copyPacks: mocks.copyPacks }));
vi.mock("../../build/runBuild.js", () => ({ runBuild: mocks.runBuild }));

describe("watchProject", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refreshes manifests for extra watch paths when copy is disabled", async () => {
        let onChange: ((event: string, file: string) => Promise<void>) | undefined;
        const watcher = {
            on: vi.fn((event: string, handler: (event: string, file: string) => Promise<void>) => {
                if (event === "all") onChange = handler;
                return watcher;
            }),
        };
        mocks.watch.mockReturnValue(watcher);
        mocks.patchManifest.mockResolvedValue({});

        const cwd = "/tmp/bepack-watch-project";
        const config = normalizeConfig(
            {
                name: "test",
                packs: { bp: { root: "bp", uuid: "a" } },
                dev: { copy: false, watch: { include: ["extra.json"] } },
            },
            {},
            cwd
        );
        const logger = {
            clear: vi.fn(),
            bepack: vi.fn(),
            done: vi.fn(),
            error: vi.fn(),
            progress: vi.fn(),
            formatDuration: vi.fn(() => "0ms"),
        } as unknown as Logger;

        watchProject(cwd, config, logger, {
            copy: false,
            typecheck: false,
            cache: false,
            dryRun: false,
        });

        expect(onChange).toBeDefined();
        await onChange!("change", "extra.json");

        expect(mocks.patchManifest).toHaveBeenCalledOnce();
        expect(mocks.copyPacks).not.toHaveBeenCalled();
        expect(mocks.runBuild).not.toHaveBeenCalled();
    });
});
