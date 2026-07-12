import chokidar from "chokidar";
import path from "node:path";
import { runBuild } from "../build/runBuild.js";
import type { PackType, ResolvedConfig } from "../config/configTypes.js";
import {
    DEFAULT_BP_INCLUDES,
    DEFAULT_RP_INCLUDES,
    getIncludes,
} from "../constants/copyIncludes.js";
import { copyPacks } from "../copy/copyPacks.js";
import type { Logger } from "../logger/logger.js