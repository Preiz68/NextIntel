export const REACT_BUILT_IN_HOOKS = new Set([
  "useState",
  "useEffect",
  "useContext",
  "useReducer",
  "useCallback",
  "useMemo",
  "useRef",
  "useImperativeHandle",
  "useLayoutEffect",
  "useDebugValue",
  "useDeferredValue",
  "useTransition",
  "useId",
  "useSyncExternalStore",
  "useInsertionEffect",
  "useOptimistic",
  "useFormStatus",
  "useFormState",
  "useActionState",
]);

export const NEXT_BUILT_IN_HOOKS = new Set([
  "useRouter",
  "usePathname",
  "useSearchParams",
  "useParams",
  "useSelectedLayoutSegment",
  "useSelectedLayoutSegments",
  "useServerInsertedHTML",
]);

export const ALL_BUILT_IN_HOOKS = new Set([
  ...REACT_BUILT_IN_HOOKS,
  ...NEXT_BUILT_IN_HOOKS,
]);

export const BROWSER_APIS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "crypto",
  "performance",
  "screen",
  "alert",
  "confirm",
  "prompt",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "ServiceWorker",
  "Notification",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "getComputedStyle",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "CustomEvent",
  "FileReader",
] as const;

export const BROWSER_GLOBALS = new Set(BROWSER_APIS);

export const FETCH_CACHE_OPTIONS = new Set([
  "force-cache",
  "no-store",
  "no-cache",
  "reload",
  "default",
  "only-if-cached",
]);
