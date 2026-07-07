import path from "node:path";
import os from "node:os";
import { BePackError } from "../errors/BePackError.js";

export function getWinTarget() {
    const root = path.join(
        "C:/Users",
        os.userInfo().username,
        "AppData/Roaming/Minecraft Bedrock/Users/Shared/games/com.mojang"
    );
    return {
        type: "custom" as const,
        bp: path.join(root, "development_behavior_packs"),
        rp: path.join(root, "development_resource_packs"),
    };
}

export function getWinOldTarget() {
    const local = process.env.LOCALAPPDATA;
    if (!local)
        throw new BePackError(
            "COPY_TARGET_NOT_FOUND",
            "%LOCALAPPDATA% is required for winold copy target."
        );
    const root = path.join(
        local,
        "Packages",
        "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
        "LocalState",
        "games",
        "com.mojang"
    );
    return {
        type: "custom" as const,
        bp: path.join(root, "development_behavior_packs"),
        rp: path.join(root, "development_resource_packs"),
    };
}
