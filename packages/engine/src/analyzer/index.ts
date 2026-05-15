export { analyzeFile, analyzeFiles, resetProject } from "./analyzeFile.js";
export type { AnalyzeOptions } from "./analyzeFile.js";

export type {
  FileAnalysis,
  ImportInfo,
  ExportInfo,
  FetchCall,
  HookUsage,
  BrowserAPIUsage,
} from "./types.js";

export {
  REACT_BUILT_IN_HOOKS,
  NEXT_BUILT_IN_HOOKS,
  ALL_BUILT_IN_HOOKS,
  BROWSER_APIS,
  BROWSER_GLOBALS,
} from "./constants.js";
