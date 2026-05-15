export { scanProject } from "./scanProject.js";
export type {
  ScanOptions,
  ScanResult,
  ScanStats,
  ExtensionBreakdown,
} from "./scanProject.js";

export { normalizePath, toRelativePath, isInsideDir } from "./normalizePath.js";

export {
  SOURCE_EXTENSIONS,
  EXCLUDED_DIRS,
  SCAN_TARGETS,
  ROOT_CONFIG_FILES,
} from "./constants.js";
export type { SourceExtension, ExcludedDir, ScanTarget } from "./constants.js";
