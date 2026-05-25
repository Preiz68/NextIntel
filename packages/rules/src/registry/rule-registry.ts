import type { RuleSpec } from "../types.js";

export const RULE_REGISTRY: Record<string, RuleSpec> = {

  // ── Server Component rules ─────────────────────────────────────────────────

  "SC-BROWSER-API-001": {
    id: "SC-BROWSER-API-001",
    name: "Browser API used in Server Component",
    category: "runtime",
    severityBase: 9,
    phases: ["rsc-render"],
    triggers: {
      imports: ["localStorage", "sessionStorage", "window", "document", "navigator", "location"],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "A browser-only global is evaluated during the Node.js RSC render pass, where no DOM or Web API context exists.",
      impact:
        "ReferenceError thrown during RSC tree construction — server cannot serialize the React payload, returning a 500 to the client.",
      ruleExplanation:
        "Server Components execute exclusively in the Node.js runtime. Browser globals (window, localStorage, navigator) are undefined in this environment.",
    },
    fix: {
      primary:
        "Move the browser API access into a Client Component and defer execution to useEffect after hydration.",
      confidence: "HIGH",
      confidenceReason: "Canonical Next.js architecture — officially documented in the App Router migration guide.",
      architecture:
        "Keep Server Components fully stateless and pure — push all browser-state interaction into hydration boundaries.",
      alternatives: [
        "Use next/dynamic with { ssr: false } to exclude the component from server rendering entirely",
        "Guard with typeof window !== 'undefined' if the expression must remain in a shared module",
      ],
    },
    severity: "CRITICAL",
    kind: "runtime",
    confidence: 0.95,
    detectionMode: "deterministic",
  },

  "SC-HOOK-USAGE-001": {
    id: "SC-HOOK-USAGE-001",
    name: "React Hook used in Server Component",
    category: "runtime",
    severityBase: 9,
    phases: ["rsc-render"],
    triggers: {
      nodeType: ["CallExpression"],
      patterns: [/\buse[A-Z]/],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "A React hook is called inside a Server Component, which executes as a single-pass stateless generator with no fiber reconciler.",
      impact:
        "Immediate runtime crash during RSC rendering — hooks require an active client-side fiber index that does not exist on the server.",
      ruleExplanation:
        "React hooks rely on the browser-side fiber reconciler's state registry. RSC rendering is a pure stateless function — there is no hook state tree, no effect scheduler, and no context propagation.",
    },
    fix: {
      primary:
        "Add 'use client' at the top of the file, or extract the stateful logic into a child Client Component leaf.",
      confidence: "HIGH",
      confidenceReason: "Deterministic fix — hooks require the client fiber which is activated by 'use client'.",
      architecture:
        "Design page trees so Server Components are stateless containers; push all state hooks to the outermost Client Component boundary.",
      alternatives: [
        "Inject static values as props from the Server Component instead of using hook state",
        "Store UI state in URL search parameters to keep the component server-safe",
      ],
    },
    severity: "CRITICAL",
    kind: "runtime",
    confidence: 0.95,
    detectionMode: "deterministic",
  },

  "SC-EVENT-HANDLER-001": {
    id: "SC-EVENT-HANDLER-001",
    name: "Event handler used in Server Component",
    category: "runtime",
    severityBase: 8,
    phases: ["rsc-render"],
    triggers: {
      patterns: [/\bon[A-Z][a-zA-Z]+=/],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "An interactive event handler (onClick, onChange, onSubmit) is attached to a DOM element inside a Server Component whose output is serialized to a static JSON payload.",
      impact:
        "Function callbacks cannot cross the RSC network serialization boundary — the element renders as dead HTML with no event delegation.",
      ruleExplanation:
        "Server Component output is serialized into a static RSC payload transmitted over the network. Function expressions are not serializable and cannot be included in that payload.",
    },
    fix: {
      primary:
        "Extract the interactive DOM element and its handler into a dedicated Client Component with 'use client'.",
      confidence: "HIGH",
      confidenceReason: "Deterministic fix — event handlers require the client event delegation system enabled by 'use client'.",
      architecture:
        "Maintain a strict separation: Server Components own static structure and data; Client Components own all interactivity.",
      alternatives: [
        "Use standard HTML form actions for submissions without onClick handlers",
        "Use Next.js Link or anchor tags for navigation instead of onClick",
      ],
    },
    severity: "HIGH",
    kind: "runtime",
    confidence: 0.90,
    detectionMode: "deterministic",
  },

  "SC-CONTEXT-001": {
    id: "SC-CONTEXT-001",
    name: "React Context used in Server Component",
    category: "runtime",
    severityBase: 8,
    phases: ["rsc-render"],
    triggers: {
      imports: ["createContext", "useContext"],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "React Context is consumed or created inside a Server Component, which renders without a client-side provider tree or fiber propagation chain.",
      impact:
        "Context lookup fails at runtime — there is no active Provider to supply values, causing the render to throw.",
      ruleExplanation:
        "Context propagation is a client-side fiber mechanism. Server Components render in isolation without access to the browser provider chain.",
    },
    fix: {
      primary:
        "Access Context values only within Client Component files. Pass data down from Server Components as explicit props.",
      confidence: "HIGH",
      confidenceReason: "Official Next.js App Router pattern — Context Providers belong at client subtree roots.",
      architecture:
        "Position all Context Providers at client-side root boundaries. Server Components feed data down via props, not context.",
      alternatives: [
        "Store shared server configuration in a static module instead of context",
        "Use Next.js cookies() or headers() to pass per-request data on the server side",
      ],
    },
    severity: "HIGH",
    kind: "runtime",
    confidence: 0.95,
    detectionMode: "deterministic",
  },

  "SC-MUTATION-001": {
    id: "SC-MUTATION-001",
    name: "State mutation during Server Component render",
    category: "runtime",
    severityBase: 8,
    phases: ["rsc-render"],
    triggers: {
      imports: ["cookies", "revalidatePath", "revalidateTag"],
      patterns: [/cookies\(\)\.set/, /revalidatePath\(/, /revalidateTag\(/],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "A side-effecting write operation (cookie mutation or cache revalidation) is executed inside the render body of a Server Component.",
      impact:
        "Breaks the pure-render contract — risks writing response headers after the stream has begun, causing runtime errors and cache state corruption.",
      ruleExplanation:
        "React Server Component rendering is expected to be a pure, read-only function. Mutations mid-render violate this constraint and destabilize the streaming pipeline.",
    },
    fix: {
      primary:
        "Move cookie mutations and revalidation calls into Server Actions or Route Handlers, not the render body.",
      confidence: "HIGH",
      confidenceReason: "Deterministic fix — Next.js enforces render purity; mutations must go through the action boundary.",
      architecture:
        "Enforce a strict read/write separation: render functions only read data; Server Actions perform all writes.",
      alternatives: [
        "Trigger revalidation lazily from a client event handler via a Server Action",
      ],
    },
    severity: "HIGH",
    kind: "runtime",
    confidence: 0.90,
    detectionMode: "deterministic",
  },

  "SC-SERIALIZATION-001": {
    id: "SC-SERIALIZATION-001",
    name: "Non-serializable prop passed to Client Component",
    category: "runtime",
    severityBase: 7,
    phases: ["rsc-render"],
    triggers: {
      nodeType: ["JSXAttribute"],
      patterns: [/=\{(?:function|\(.*\)=>|async)/],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "A non-serializable value (function, class instance, or Symbol) is passed as a prop from a Server Component to a Client Component across the RSC network boundary.",
      impact:
        "Serialization failure during RSC payload construction — the page throws at render time and returns a 500 error.",
      ruleExplanation:
        "Props crossing the Server-to-Client boundary must be transmitted over the network as a JSON-like RSC payload. Only serializable primitives, plain objects, and arrays are valid.",
    },
    fix: {
      primary:
        "Replace function callbacks with serializable identifiers (IDs, strings). Implement the action using a Server Action instead.",
      confidence: "MEDIUM",
      confidenceReason: "Requires refactoring the callback contract — straightforward but involves structural changes to the prop interface.",
      architecture:
        "Treat all Server→Client prop boundaries as network boundaries — only JSON-serializable values may cross.",
      alternatives: [
        "Instantiate class instances inside the Client Component where they are needed",
        "Use React Server Actions for cross-boundary callbacks",
      ],
    },
    severity: "HIGH",
    kind: "runtime",
    confidence: 0.80,
    detectionMode: "heuristic",
  },

  "SC-THIRD-PARTY-001": {
    id: "SC-THIRD-PARTY-001",
    name: "Unwrapped third-party component in Server Component",
    category: "runtime",
    severityBase: 8,
    phases: ["rsc-render"],
    triggers: {
      nodeType: ["ImportDeclaration"],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "A third-party npm package that internally accesses browser APIs is imported and rendered directly inside a Server Component.",
      impact:
        "ReferenceError on the server when the package attempts to access window, document, or other browser globals that do not exist in Node.js.",
      ruleExplanation:
        "Many UI library packages access browser globals at module-evaluation time. Running them in the RSC render phase exposes those calls to Node.js.",
    },
    fix: {
      primary:
        "Create a local Client Component wrapper file (with 'use client') that imports the third-party package and re-exports it.",
      confidence: "HIGH",
      confidenceReason: "Standard wrapping pattern — officially recommended for third-party compatibility in Next.js docs.",
      architecture:
        "All browser-dependent third-party dependencies must be isolated behind local 'use client' boundaries before use in Server Components.",
      alternatives: [
        "Use next/dynamic to lazily load the package only in the browser runtime",
      ],
    },
    severity: "HIGH",
    kind: "runtime",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  // ── Client Component rules ─────────────────────────────────────────────────

  "CC-ASYNC-CLIENT-001": {
    id: "CC-ASYNC-CLIENT-001",
    name: "Async Client Component declaration",
    category: "runtime",
    severityBase: 9,
    phases: ["client-render"],
    triggers: {
      patterns: [/^export\s+(?:default\s+)?async\s+function/m],
    },
    boundary: "CLIENT_RENDER",
    message: {
      cause:
        "A Client Component is declared as an async function, which returns a Promise instead of a synchronous React element tree.",
      impact:
        "Immediate crash of the client-side fiber reconciler — React cannot process a Promise as a valid render output, producing a blank page.",
      ruleExplanation:
        "React's browser reconciler is entirely synchronous. Async function components are only valid in Server Components, where the RSC renderer awaits the Promise before serializing.",
    },
    fix: {
      primary:
        "Remove the async keyword and fetch data in a parent Server Component, passing the result as props to this Client Component.",
      confidence: "HIGH",
      confidenceReason: "Deterministic fix — React explicitly disallows async client components; this is a hard framework constraint.",
      architecture:
        "Client Components must be synchronous render functions. Delegate all data fetching to Server Components in the parent tree.",
      alternatives: [
        "Use useEffect + useState to fetch data client-side after mount",
        "Use SWR or React Query for client-side async data management",
        "Wrap with React.use() if receiving a Promise prop from a Server Component",
      ],
    },
    severity: "CRITICAL",
    kind: "runtime",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "CC-RUNTIME-LEAK-001": {
    id: "CC-RUNTIME-LEAK-001",
    name: "Server API imported in Client Component",
    category: "runtime",
    severityBase: 9,
    phases: ["client-render"],
    triggers: {
      imports: ["next/headers", "next/server", "server-only", "cookies", "headers", "draftMode"],
    },
    boundary: "CLIENT_RENDER",
    message: {
      cause:
        "A request-scoped server API (cookies(), headers(), draftMode()) is imported and invoked within a Client Component thread executing in the browser.",
      impact:
        "Fatal runtime error in the browser — the request context and Node.js globals required by this API are absent after the server response is sent.",
      ruleExplanation:
        "Server-only APIs depend on the active HTTP request context which exists only during the server render lifecycle. Once the response is serialized and sent, this context is destroyed.",
    },
    fix: {
      primary:
        "Read the required server values (headers, cookies) in the parent Server Component and pass them as serialized props.",
      confidence: "HIGH",
      confidenceReason: "Canonical App Router data flow — server data flows downward as props, never imported client-side.",
      architecture:
        "Enforce a strict unidirectional data flow: server-exclusive data is read at layout/page level and passed down as props — never imported client-side.",
      alternatives: [
        "Pass request metadata via URL search parameters if the values are non-sensitive",
        "Use a Route Handler to proxy server data if client re-fetching is necessary",
      ],
    },
    severity: "CRITICAL",
    kind: "runtime",
    confidence: 0.98,
    detectionMode: "graph-inferred",
  },

  "CC-SERVER-IMPORT-001": {
    id: "CC-SERVER-IMPORT-001",
    name: "Server Component imported in Client Component",
    category: "bundler",
    severityBase: 9,
    phases: ["bundler-graph-resolution"],
    triggers: {
      nodeType: ["ImportDeclaration"],
    },
    boundary: "CLIENT_RENDER",
    message: {
      cause:
        "A Client Component statically imports a Server Component module, pulling it into the Webpack client module graph.",
      impact:
        "Bundler error or silent leakage of Node.js-only code and secrets into the public browser bundle.",
      ruleExplanation:
        "In Next.js, client-side imports define what enters the browser bundle. Importing a Server Component forces the bundler to compile all its Node.js dependencies for the browser.",
    },
    fix: {
      primary:
        "Pass the Server Component as a children or slot prop from a parent Server Component instead of importing it directly.",
      confidence: "HIGH",
      confidenceReason: "RSC composition pattern — officially documented as the correct solution for mixing server and client subtrees.",
      architecture:
        "Use the RSC composition pattern: Server Components orchestrate the tree and pass rendered sub-trees into Client Components via children/slots.",
      alternatives: [
        "Extract shared types and interfaces into a separate 'shared' module with no runtime code",
        "Convert the imported file to a Client Component if it has no server-only dependencies",
      ],
    },
    severity: "CRITICAL",
    kind: "bundle",
    confidence: 0.98,
    detectionMode: "graph-inferred",
  },

  "CC-ROUTE-HANDLER-001": {
    id: "CC-ROUTE-HANDLER-001",
    name: "Internal API fetch in Client Component",
    category: "architecture",
    severityBase: 5,
    phases: ["client-render"],
    triggers: {
      patterns: [/fetch\(['"`]\/api\//],
    },
    boundary: "CLIENT_RENDER",
    message: {
      cause:
        "A Client Component performs a client-side HTTP fetch to an internal Next.js API route, creating an unnecessary client-to-server roundtrip.",
      impact:
        "Increased latency, bypassed server-side caching, and degraded Core Web Vitals (LCP) compared to server-first data fetching.",
      ruleExplanation:
        "Internal API routes trigger a full HTTP roundtrip from the browser. Fetching this data in a parent Server Component avoids the roundtrip entirely and leverages Next.js request deduplication.",
    },
    fix: {
      primary:
        "Move the data fetch into a parent Server Component and pass the result down as props.",
      confidence: "MEDIUM",
      confidenceReason: "Correct architectural direction but requires restructuring the data-fetch location and component hierarchy.",
      architecture:
        "Prefer server-first data acquisition at layout/page boundaries using async Server Components and React cache().",
      alternatives: [
        "Use SWR or React Query if client-side revalidation is required",
        "Query the database or service directly from a Server Component loader",
      ],
    },
    severity: "MEDIUM",
    kind: "architecture",
    confidence: 0.90,
    detectionMode: "deterministic",
  },

  "HY-RENDER-BROWSER-API-001": {
    id: "HY-RENDER-BROWSER-API-001",
    name: "Browser API accessed during Client render (Hydration Risk)",
    category: "hydration",
    severityBase: 8,
    phases: ["hydration"],
    triggers: {
      imports: ["localStorage", "sessionStorage", "window", "document", "navigator"],
    },
    boundary: "HYDRATION",
    message: {
      cause:
        "A browser-only global (localStorage, navigator) is read synchronously inside the render function of a Client Component before the hydration cycle completes.",
      impact:
        "Deterministic hydration mismatch — the server-rendered HTML differs from the browser's first render output, forcing React to discard the pre-rendered DOM and rebuild from scratch.",
      ruleExplanation:
        "Next.js pre-renders Client Components to static HTML on the server before sending to the browser. Reading browser-only globals during this server-side pre-render produces different markup than the browser's hydration pass, violating the deterministic render contract.",
    },
    fix: {
      primary:
        "Defer browser API access into a useEffect hook so it executes only after hydration completes on the client.",
      confidence: "HIGH",
      confidenceReason: "Standard isomorphic pattern — useEffect is guaranteed to run only in the browser after hydration.",
      architecture:
        "Keep the initial render output isomorphic — render a safe default value on first paint, then hydrate client-specific state in useEffect.",
      alternatives: [
        "Use a mounted state flag: useState(false) + useEffect(() => setMounted(true), [])",
        "Use a fallback value for SSR and load the real value lazily post-mount",
      ],
    },
    severity: "HIGH",
    kind: "hydration",
    confidence: 0.72,
    detectionMode: "heuristic",
  },

  // ── Server Action rules ────────────────────────────────────────────────────

  "SA-AUTH-001": {
    id: "SA-AUTH-001",
    name: "Server Action missing auth validation",
    category: "security",
    severityBase: 9,
    phases: ["server-action-execution"],
    triggers: {
      nodeType: ["ServerAction"],
    },
    boundary: "SERVER_ACTION_EXECUTION",
    message: {
      cause:
        "A Server Action function executes database mutations or sensitive operations without first verifying the caller's identity or authorization.",
      impact:
        "The action is exposed as a public unauthenticated HTTP POST endpoint — any external agent can invoke it directly via network request to perform unauthorized data mutations.",
      ruleExplanation:
        "Next.js compiles Server Actions into public POST endpoint handlers. Route-level middleware or UI-level guards do NOT protect these endpoints. Authentication must be enforced at the action entry point itself.",
    },
    fix: {
      primary:
        "Call auth() or getSession() at the very first line of the action body and throw immediately if the session is invalid.",
      confidence: "HIGH",
      confidenceReason: "Mandatory security requirement — Next.js docs explicitly state actions are public POST endpoints that must self-authenticate.",
      architecture:
        "Implement a typed withAuth() action wrapper factory that enforces authentication before executing any action handler.",
      alternatives: [
        "Validate a signed CSRF token passed in the request before processing the action body",
        "Use NextAuth.js getServerSession() at action entry to verify session context",
      ],
    },
    severity: "CRITICAL",
    kind: "security",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  "SA-VALIDATION-001": {
    id: "SA-VALIDATION-001",
    name: "Server Action missing input schema validation",
    category: "security",
    severityBase: 8,
    phases: ["server-action-execution"],
    triggers: {
      nodeType: ["ServerAction"],
      patterns: [/\.parse\(|\.safeParse\(|\.validate\(/],
    },
    boundary: "SERVER_ACTION_EXECUTION",
    message: {
      cause:
        "A Server Action accepts arguments from the client network without validating them against a strict schema, passing raw unverified input directly to backend logic.",
      impact:
        "Vulnerable to SQL/NoSQL injection, type mismatch crashes, and data corruption from malformed or adversarial client payloads.",
      ruleExplanation:
        "Server Actions are invoked via POST requests. Client-side TypeScript types provide zero runtime guarantee — any payload shape can be sent over the network. Schema validation at the action boundary is a mandatory security requirement, not an optimization.",
    },
    fix: {
      primary:
        "Define a Zod (or Valibot/Yup) schema and call schema.safeParse(args) as the first operation in the action body.",
      confidence: "HIGH",
      confidenceReason: "Security requirement — Next.js docs treat schema validation at action boundaries as mandatory, not optional.",
      architecture:
        "Treat every Server Action boundary as a trust boundary — validate all inputs as if they arrive from an untrusted external API.",
      alternatives: [
        "Use a validated action wrapper (e.g. next-safe-action) that enforces schema parsing automatically",
        "Throw a typed validation error back to the client to update form state",
      ],
    },
    severity: "HIGH",
    kind: "security",
    confidence: 0.80,
    detectionMode: "heuristic",
  },

  "SA-SERIALIZATION-001": {
    id: "SA-SERIALIZATION-001",
    name: "Non-serializable Server Action payload",
    category: "architecture",
    severityBase: 7,
    phases: ["server-action-execution"],
    triggers: {
      nodeType: ["ServerAction"],
    },
    boundary: "SERVER_ACTION_EXECUTION",
    message: {
      cause:
        "A Server Action accepts or returns a non-serializable value (class instance, function, or cyclic object) that cannot be transmitted over the HTTP POST boundary.",
      impact:
        "Serialization failure at the action boundary — the action throws at runtime and the client receives an unrecoverable error response.",
      ruleExplanation:
        "Server Actions communicate over HTTP. All inputs and return values must be serializable to the React Server Component payload format (JSON-like). Functions, class instances, and Symbols cannot be serialized.",
    },
    fix: {
      primary:
        "Restrict all Server Action parameters and return values to plain JSON-serializable types: primitives, plain objects, arrays, FormData.",
      confidence: "HIGH",
      confidenceReason: "Framework constraint — non-serializable values cannot physically cross the HTTP action boundary.",
      architecture:
        "Design action contracts as strict DTOs (Data Transfer Objects) — accept and return only simple data shapes at the boundary.",
      alternatives: [
        "Resolve complex values server-side and return only the serializable result",
        "Use FormData for file uploads and multi-part data",
      ],
    },
    severity: "HIGH",
    kind: "architecture",
    confidence: 0.80,
    detectionMode: "heuristic",
  },

  "SA-MUTATION-READ-001": {
    id: "SA-MUTATION-READ-001",
    name: "Server Action used for read operation",
    category: "architecture",
    severityBase: 4,
    phases: ["server-action-execution"],
    triggers: {
      patterns: [/^(?:get|fetch|read|load|query)[A-Z]/],
    },
    boundary: "SERVER_ACTION_EXECUTION",
    message: {
      cause:
        "A Server Action is named and structured as a read/query operation (get*, fetch*, read*), routing a cacheable GET-equivalent query through an uncacheable POST endpoint.",
      impact:
        "Bypasses Next.js fetch caching entirely — every invocation hits the database with no deduplication or cache reuse, increasing server load.",
      ruleExplanation:
        "Server Actions use POST semantics and are never cached by Next.js or browsers. Read operations should use async Server Component data fetching or Route Handlers with GET caching to leverage the App Router's request deduplication and cache layers.",
    },
    fix: {
      primary:
        "Convert the read operation into an async Server Component fetch or a React cache() function called during rendering.",
      confidence: "MEDIUM",
      confidenceReason: "Correct direction but requires architectural refactoring — moving data fetching from actions to Server Component render tree.",
      architecture:
        "Reserve Server Actions strictly for state mutations (writes). All read operations belong in the Server Component render tree or in GET Route Handlers.",
      alternatives: [
        "Wrap the fetch in React cache() for request deduplication across the render tree",
        "Use a GET Route Handler with appropriate Cache-Control headers for shared reads",
      ],
    },
    severity: "MEDIUM",
    kind: "architecture",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  "SA-BROWSER-API-001": {
    id: "SA-BROWSER-API-001",
    name: "Browser API used in Server Action",
    category: "runtime",
    severityBase: 9,
    phases: ["server-action-execution"],
    triggers: {
      imports: ["localStorage", "sessionStorage", "window", "document", "navigator", "location"],
    },
    boundary: "SERVER_ACTION_EXECUTION",
    message: {
      cause:
        "A browser-only global is referenced inside a Server Action, which runs exclusively on Node.js/Edge server runtimes.",
      impact:
        "ReferenceError thrown during Server Action execution — the action fails to execute and returns a 500 server error to the client.",
      ruleExplanation:
        "Server Actions execute on the server. Browser globals (window, localStorage, navigator) are undefined in this environment and accessing them throws a ReferenceError.",
    },
    fix: {
      primary:
        "Remove browser API access from the Server Action, or pass the browser-only data as an argument from the Client Component caller.",
      confidence: "HIGH",
      confidenceReason: "Server Actions are purely server-side endpoints; all browser state must be passed as arguments.",
      architecture:
        "Keep Server Actions purely server-centric — consume all client context explicitly as input arguments.",
      alternatives: [
        "Retrieve browser state (e.g. cookies, headers, local storage) in the client before initiating the Server Action call"
      ],
    },
    severity: "CRITICAL",
    kind: "runtime",
    confidence: 0.95,
    detectionMode: "deterministic",
  },

  "RU-001-CRITICAL": {
    id: "RU-001-CRITICAL",
    name: "Native Node.js API in Edge Runtime",
    category: "runtime",
    severityBase: 10,
    phases: ["rsc-render"],
    triggers: {
      imports: ["fs", "path", "net", "crypto"],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "A native Node.js API (e.g. fs, path) is imported/referenced in an Edge runtime context.",
      impact:
        "Immediate crash during compilation or route execution on lightweight V8 Edge environments.",
      ruleExplanation:
        "The Edge Runtime is a lightweight V8 isolate without native Node.js API capabilities or socket layers.",
    },
    fix: {
      primary:
        "Change export const runtime = 'edge' to 'nodejs', or remove the native imports/APIs.",
      confidence: "HIGH",
      confidenceReason: "Deterministic fix — changing the runtime configuration to nodejs restores full Node API support.",
      architecture:
        "Isolate Node-heavy operations to background queues or standard Node.js routes.",
      alternatives: [
        "Replace native Node APIs with isomorphic Web API equivalents (like Web streams)"
      ],
    },
    severity: "CRITICAL",
    kind: "runtime",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RU-001-HIGH": {
    id: "RU-001-HIGH",
    name: "Restricted capability in Edge Runtime",
    category: "runtime",
    severityBase: 8,
    phases: ["rsc-render"],
    triggers: {
      patterns: [/process\.env/],
    },
    boundary: "RSC_RENDER",
    message: {
      cause:
        "A restricted runtime-specific capability (such as process.env) is accessed dynamically in Edge Runtime.",
      impact:
        "Potential cache bypass, runtime crash, or undefined value leakage in Edge server environments.",
      ruleExplanation:
        "Dynamic environment variable lookup is restricted on Edge to ensure determinism and security.",
    },
    fix: {
      primary:
        "Use compile-time env definitions or map environments explicitly via next.config.js.",
      confidence: "MEDIUM",
      confidenceReason: "Requires updating build configurations or environment patterns.",
      architecture:
        "Use static configuration injection or environment wrappers for Edge routes.",
      alternatives: [
        "Prefilter environment variables before Edge invocation"
      ],
    },
    severity: "HIGH",
    kind: "runtime",
    confidence: 0.90,
    detectionMode: "heuristic",
  },
};

/**
 * Look up a RuleSpec by constraint ID.
 * Returns undefined if the rule is not in the registry.
 */
export function getRuleSpec(constraintId: string): RuleSpec | undefined {
  return RULE_REGISTRY[constraintId];
}

/**
 * Look up a RuleSpec by constraint ID.
 * Throws if the rule is not found — use in contexts where the ID is guaranteed valid.
 */
export function requireRuleSpec(constraintId: string): RuleSpec {
  const spec = RULE_REGISTRY[constraintId];
  if (!spec) {
    throw new Error(`[rule-registry] No RuleSpec found for constraint ID: "${constraintId}"`);
  }
  return spec;
}
