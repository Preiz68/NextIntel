/**
 * framework-apis.ts
 *
 * NextIntel Framework Knowledge Layer — Next.js API Semantic Database
 *
 * A typed, versioned, extensible registry of every Next.js framework API with
 * its runtime constraints, allowed execution contexts, and metadata.
 *
 * Rules and the execution model engine query this instead of hardcoding lists.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FrameworkRuntime =
  | "server-only"   // requires Node.js runtime, never runs in browser
  | "client-only"   // requires browser runtime, never runs on server
  | "universal"     // safe in both environments
  | "edge";         // runs in V8 isolate edge runtime only

export type SemanticContext =
  | "server-component"
  | "client-component"
  | "server-action"
  | "route-handler"
  | "middleware"
  | "server-util"
  | "client-util"
  | "shared-util"
  | "page"
  | "layout";

export interface FrameworkAPI {
  /** npm module specifier (e.g. "next/headers", "react", "server-only") */
  module: string;

  /**
   * Named exports from this module that are subject to these constraints.
   * Empty array means ALL exports from the module are subject to the rule.
   */
  exports: string[];

  /** Where this API can run */
  runtime: FrameworkRuntime;

  /**
   * True when this API requires an active HTTP request lifecycle context
   * (i.e. it reads from the request pipeline — headers, cookies, etc.)
   */
  requiresRequestContext: boolean;

  /**
   * Semantic contexts where this API is permitted.
   * Used by isAllowedIn() to validate usage sites.
   */
  allowedIn: SemanticContext[];

  /** Minimum Next.js version this API was introduced */
  since?: string;

  /** What this API does — surfaces in diagnostic output */
  description: string;

  /**
   * Constraint IDs that are triggered when this API is used outside
   * its allowedIn contexts. Used to generate targeted constraint violations.
   */
  triggersConstraints: string[];

  /**
   * If true, this module acts as a hard runtime fence — importing it in a
   * client bundle will cause a build error (like "server-only" package).
   */
  isFencingModule?: boolean;
}

// ---------------------------------------------------------------------------
// The Framework API Database
// ---------------------------------------------------------------------------

export const FRAMEWORK_APIS: FrameworkAPI[] = [

  // ── Next.js Request Context APIs ──────────────────────────────────────────

  {
    module: "next/headers",
    exports: ["headers", "cookies", "draftMode", "unstable_noStore"],
    runtime: "server-only",
    requiresRequestContext: true,
    allowedIn: ["server-component", "server-action", "route-handler", "layout", "page", "server-util"],
    since: "13.0.0",
    description: "Next.js request-scoped header and cookie accessors. Requires an active HTTP request context. Available only on the server.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001", "SC-BROWSER-API-001"],
  },

  {
    module: "next/cache",
    exports: ["revalidatePath", "revalidateTag", "unstable_cache", "unstable_noStore"],
    runtime: "server-only",
    requiresRequestContext: false,
    allowedIn: ["server-component", "server-action", "route-handler", "layout", "page", "server-util"],
    since: "14.0.0",
    description: "Next.js on-demand and time-based cache invalidation APIs. Server-only — mutates the shared cache store.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001", "SC-MUTATION-001"],
  },

  {
    module: "next/navigation",
    exports: ["redirect", "permanentRedirect", "notFound"],
    runtime: "server-only",
    requiresRequestContext: true,
    allowedIn: ["server-component", "server-action", "route-handler", "layout", "page"],
    since: "13.0.0",
    description: "Server-side navigation utilities. Throw special Next.js internal errors consumed by the RSC renderer.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001"],
  },

  {
    module: "next/navigation",
    exports: ["useRouter", "usePathname", "useSearchParams", "useParams", "useSelectedLayoutSegment", "useSelectedLayoutSegments"],
    runtime: "client-only",
    requiresRequestContext: false,
    allowedIn: ["client-component", "client-util"],
    since: "13.0.0",
    description: "Client-side navigation hooks. Require the React client fiber — cannot be called in Server Components.",
    triggersConstraints: ["SC-HOOK-USAGE-001", "SC-BROWSER-API-001"],
  },

  // ── Next.js Server-only Fencing ────────────────────────────────────────────

  {
    module: "server-only",
    exports: [],
    runtime: "server-only",
    requiresRequestContext: false,
    allowedIn: ["server-component", "server-action", "route-handler", "layout", "page", "server-util"],
    description: "Hard runtime fence — causes a build error if imported from a client bundle. Use to protect server-only utility modules.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001", "CC-SERVER-IMPORT-001"],
    isFencingModule: true,
  },

  {
    module: "client-only",
    exports: [],
    runtime: "client-only",
    requiresRequestContext: false,
    allowedIn: ["client-component", "client-util"],
    description: "Hard client fence — causes a build error if imported in a server context. Use to protect browser-only utility modules.",
    triggersConstraints: ["SC-BROWSER-API-001"],
    isFencingModule: true,
  },

  // ── Next.js Image / Font / Script ─────────────────────────────────────────

  {
    module: "next/image",
    exports: ["Image"],
    runtime: "universal",
    requiresRequestContext: false,
    allowedIn: ["server-component", "client-component", "layout", "page", "server-util", "client-util", "shared-util"],
    since: "10.0.0",
    description: "Optimized Image component. Renders on server and hydrates on client. Safe in all component types.",
    triggersConstraints: [],
  },

  {
    module: "next/font/google",
    exports: [],
    runtime: "server-only",
    requiresRequestContext: false,
    allowedIn: ["layout", "page", "server-component"],
    since: "13.2.0",
    description: "Google Fonts optimization. Font subsets are generated at build time on the server.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001"],
  },

  {
    module: "next/link",
    exports: ["Link"],
    runtime: "universal",
    requiresRequestContext: false,
    allowedIn: ["server-component", "client-component", "layout", "page", "server-util", "client-util", "shared-util"],
    since: "1.0.0",
    description: "Client-side navigation link. Pre-fetches routes on hover. Safe in both component types.",
    triggersConstraints: [],
  },

  {
    module: "next/dynamic",
    exports: ["default"],
    runtime: "universal",
    requiresRequestContext: false,
    allowedIn: ["client-component", "server-component", "layout", "page"],
    since: "1.0.0",
    description: "Dynamic import with SSR control. Use { ssr: false } to exclude browser-only components from server rendering.",
    triggersConstraints: [],
  },

  // ── Next.js App Router Metadata / Routing ─────────────────────────────────

  {
    module: "next/server",
    exports: ["NextRequest", "NextResponse"],
    runtime: "edge",
    requiresRequestContext: true,
    allowedIn: ["middleware", "route-handler"],
    since: "12.0.0",
    description: "Edge runtime request/response primitives for middleware and API route handlers.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001"],
  },

  // ── React Server / Client Boundary ────────────────────────────────────────

  {
    module: "react",
    exports: ["useState", "useEffect", "useReducer", "useContext", "useRef", "useCallback", "useMemo", "useTransition", "useDeferredValue", "useId", "useLayoutEffect", "useInsertionEffect", "useImperativeHandle", "useDebugValue"],
    runtime: "client-only",
    requiresRequestContext: false,
    allowedIn: ["client-component", "client-util"],
    since: "16.8.0",
    description: "React client-side hooks. Require the browser fiber reconciler — cannot be used in Server Components.",
    triggersConstraints: ["SC-HOOK-USAGE-001"],
  },

  {
    module: "react",
    exports: ["createContext", "useContext"],
    runtime: "client-only",
    requiresRequestContext: false,
    allowedIn: ["client-component", "client-util"],
    description: "React Context API. Requires the client fiber tree — not available in Server Components.",
    triggersConstraints: ["SC-CONTEXT-001"],
  },

  {
    module: "react",
    exports: ["cache", "use", "Suspense", "lazy", "forwardRef", "memo", "createElement", "Fragment"],
    runtime: "universal",
    requiresRequestContext: false,
    allowedIn: ["server-component", "client-component", "layout", "page", "server-util", "client-util", "shared-util"],
    description: "Universal React APIs safe in both server and client rendering contexts.",
    triggersConstraints: [],
  },

  // ── Browser Global APIs ────────────────────────────────────────────────────

  {
    module: "__browser_globals__",
    exports: ["window", "document", "localStorage", "sessionStorage", "navigator", "location", "history", "screen", "alert", "confirm", "prompt", "fetch"],
    runtime: "client-only",
    requiresRequestContext: false,
    allowedIn: ["client-component", "client-util"],
    description: "Browser Web API globals. Undefined in Node.js server environments. Access must be deferred to useEffect or event handlers.",
    triggersConstraints: ["SC-BROWSER-API-001", "HY-RENDER-BROWSER-API-001"],
  },

  // ── Database / ORM Clients ─────────────────────────────────────────────────

  {
    module: "@prisma/client",
    exports: ["PrismaClient"],
    runtime: "server-only",
    requiresRequestContext: false,
    allowedIn: ["server-component", "server-action", "route-handler", "server-util"],
    description: "Prisma ORM client. Connects to a database — must never be imported in client bundles.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001", "CC-SERVER-IMPORT-001"],
  },

  {
    module: "drizzle-orm",
    exports: [],
    runtime: "server-only",
    requiresRequestContext: false,
    allowedIn: ["server-component", "server-action", "route-handler", "server-util"],
    description: "Drizzle ORM — database query builder. Server-only; must not be bundled client-side.",
    triggersConstraints: ["CC-RUNTIME-LEAK-001"],
  },

  // ── Auth Libraries ─────────────────────────────────────────────────────────

  {
    module: "next-auth",
    exports: ["getServerSession", "getSession"],
    runtime: "server-only",
    requiresRequestContext: true,
    allowedIn: ["server-component", "server-action", "route-handler", "server-util"],
    since: "4.0.0",
    description: "NextAuth session retrieval. Reads from the active request context — server-only.",
    triggersConstraints: ["SA-AUTH-001"],
  },

  {
    module: "next-auth/react",
    exports: ["useSession", "signIn", "signOut", "SessionProvider"],
    runtime: "client-only",
    requiresRequestContext: false,
    allowedIn: ["client-component", "client-util"],
    since: "4.0.0",
    description: "NextAuth client-side hooks and providers. Require the browser React runtime.",
    triggersConstraints: ["SC-HOOK-USAGE-001"],
  },

];
