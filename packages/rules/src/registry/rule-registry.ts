import type { RuleSpec } from "../types.js";

export const RULE_REGISTRY: Record<string, RuleSpec> = {

  // ── Server Component rules ─────────────────────────────────────────────────

  "SC-BROWSER-API-001": {
    id: "SC-BROWSER-API-001",
    name: "Browser API used in Server Component",
    category: "RSC_API_VIOLATION",
    severityBase: 9,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 9,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 7,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 9,
    phases: ["CLIENT_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "CLIENT_GRAPH_LEAK",
    severityBase: 9,
    phases: ["CLIENT_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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

  "CC-HYDRATION-ABUSE-001": {
    id: "CC-HYDRATION-ABUSE-001",
    name: "Large static data import in Client Component",
    category: "CLIENT_GRAPH_LEAK",
    severityBase: 6,
    phases: ["CLIENT_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/import.*from\s+['"].*\.(json|csv)['"]/] },
    boundary: "CLIENT_RENDER",
    message: {
      cause: "Client Component directly imports a data file (.json or .csv) that exceeds 50KB.",
      impact: "The entire static dataset is bundled into the clientside JavaScript, bloating page size, slowing down parsing, and increasing React hydration time.",
      ruleExplanation: "Client bundle sizes should be minimized. Large static datasets should remain server-side and be passed as prop subsets or fetched dynamically.",
    },
    fix: {
      primary: "Move the import to a Server Component parent and pass only required fields as props.",
      confidence: "HIGH",
      confidenceReason: "Separates server data from client rendering, preventing bundle bloat.",
      architecture: "Keep Client Components focused on user interaction, holding zero heavy static data payloads.",
      alternatives: [
        "Create an API Route and load the data on demand via fetch().",
        "Move the data to the public/ folder and load it dynamically.",
      ],
    },
    severity: "HIGH",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "CC-SERVER-IMPORT-001": {
    id: "CC-SERVER-IMPORT-001",
    name: "Server Component imported in Client Component",
    category: "CLIENT_GRAPH_LEAK",
    severityBase: 9,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
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
    category: "CLIENT_GRAPH_LEAK",
    severityBase: 5,
    phases: ["CLIENT_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "HYDRATION_MISMATCH",
    severityBase: 8,
    phases: ["HYDRATION"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "SERVER_ACTION_MISUSE",
    severityBase: 9,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "SERVER_ACTION_MISUSE",
    severityBase: 8,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "SERVER_ACTION_MISUSE",
    severityBase: 7,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "SERVER_ACTION_MISUSE",
    severityBase: 4,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "SERVER_ACTION_MISUSE",
    severityBase: 9,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 10,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
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

  // ── Caching/Taxonomy specific rules ────────────────────────────────────────

  "DYNAMIC_RENDER_TRIGGER-003": {
    id: "DYNAMIC_RENDER_TRIGGER-003",
    name: "Dynamic API called in static route/layout segment",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: {
      imports: ["cookies", "headers", "draftMode"],
    },
    boundary: "RSC_RENDER",
    message: {
      cause: "Dynamic server-only data APIs are called outside dynamic execution paths.",
      impact: "Bypasses Full Route Cache and forces request-time server compute load for static targets.",
      ruleExplanation: "Calling dynamic APIs during layout or page generation triggers request-time routing compilation.",
    },
    fix: {
      primary: "Wrap the component in a Suspense boundary or extract it into a dynamic-rendered child component.",
      confidence: "HIGH",
    },
    severity: "HIGH",
    kind: "cache",
    confidence: 0.95,
    detectionMode: "deterministic",
  },

  "RSC_API_VIOLATION-005": {
    id: "RSC_API_VIOLATION-005",
    name: "'use cache' directive used in Client Component",
    category: "RSC_API_VIOLATION",
    severityBase: 9,
    phases: ["CLIENT_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: {
      patterns: [/use cache/],
    },
    boundary: "CLIENT_RENDER",
    message: {
      cause: "The 'use cache' directive was defined in a Client Component file.",
      impact: "Produces a Next.js bundler build compilation crash or client-side execution failure.",
      ruleExplanation: "'use cache' is a server-exclusive data directive and cannot compile inside browser bundles.",
    },
    fix: {
      primary: "Remove the 'use cache' directive or move the cached function to a Server Component/Utility module.",
      confidence: "HIGH",
    },
    severity: "CRITICAL",
    kind: "runtime",
    confidence: 0.98,
    detectionMode: "deterministic",
  },

  "HY-NON-DETERMINISTIC-001": {
    id: "HY-NON-DETERMINISTIC-001",
    name: "Non-deterministic render operation",
    category: "HYDRATION_MISMATCH",
    severityBase: 7,
    phases: ["CLIENT_RENDER", "HYDRATION", "RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: {
      patterns: [/Math\.random/, /Date\.now/, /new Date/],
    },
    boundary: "HYDRATION",
    message: {
      cause: "Non-deterministic functions (like Math.random, Date.now) accessed during top-level render of components cause hydration mismatches.",
      impact: "Client components pre-render to HTML on the server. If a component generates a random value or reads the current timestamp during render, the server-generated HTML and the browser's first render will mismatch, leading to hydration errors.",
      ruleExplanation: "Ensure all rendering functions are pure and deterministic. Side effects and dynamic browser values must be loaded after hydration.",
    },
    fix: {
      primary: "Wrap the non-deterministic calculation in useEffect or useMemo with a static fallback.",
      confidence: "HIGH",
      confidenceReason: "Guarantees deterministic render on first pass, resolving hydration issues.",
      architecture: "Defer dynamic values or side-effects until after the component mounts on the client.",
      alternatives: [
        "Move the calculation to page/layout level and pass down as props",
      ],
    },
    severity: "MEDIUM",
    kind: "hydration",
    confidence: 0.95,
    detectionMode: "deterministic",
  },

  "HY-RENDER-MUTATION-001": {
    id: "HY-RENDER-MUTATION-001",
    name: "Side effect / mutation in render path",
    category: "HYDRATION_MISMATCH",
    severityBase: 8,
    phases: ["CLIENT_RENDER", "HYDRATION", "RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: {},
    boundary: "HYDRATION",
    message: {
      cause: "State mutations or external writes inside the render body of a component violate React's pure rendering model.",
      impact: "React component rendering must be pure. Modifying variables outside the component scope or mutating props during the render pass causes bugs, inconsistent states, and breaks React's performance optimizations.",
      ruleExplanation: "Rendering is a pure calculation. All side effects (API calls, state updates, routing, external mutations) belong in event handlers or useEffect hooks.",
    },
    fix: {
      primary: "Move the side-effect / write into a useEffect callback.",
      confidence: "HIGH",
      confidenceReason: "Keeps the render pass pure and isolates mutations to post-render phases.",
      architecture: "Never mutate external state or props during rendering.",
      alternatives: [
        "Pass modifications back to the parent component using a state callback",
      ],
    },
    severity: "MEDIUM",
    kind: "runtime",
    confidence: 0.90,
    detectionMode: "deterministic",
  },

  // ── Data Fetching rules ────────────────────────────────────────────────────

  "DF-001": {
    id: "DF-001",
    name: "Explicit Fetch Cache Strategy Missing",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\bfetch\(/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "A fetch() call in a Server Component or Server Action uses no explicit cache or revalidation strategy.",
      impact: "Next.js cannot determine whether to cache the response, falling back to per-request dynamic behavior and bypassing the Data Cache entirely.",
      ruleExplanation: "In Next.js 15+, fetch() calls are opt-out of caching by default. Without { cache: 'force-cache' } or { next: { revalidate: N } }, every render triggers a live network request, eliminating the performance benefits of the Data Cache.",
    },
    fix: {
      primary: "Add an explicit cache policy: fetch(url, { cache: 'force-cache' }) for static data, or fetch(url, { next: { revalidate: 60 } }) for ISR.",
      confidence: "HIGH",
      confidenceReason: "Documented Next.js Data Cache configuration — explicit options are required for predictable caching behavior.",
      architecture: "Define a caching tier per data source: static (force-cache), time-based (revalidate: N), or per-request (no-store). Apply consistently at the data access layer.",
      alternatives: [
        "Use React.cache() on the fetching function for request-level deduplication without persistent caching",
        "Use { cache: 'no-store' } explicitly for truly dynamic data to make the intent clear",
      ],
    },
    severity: "MEDIUM",
    kind: "cache",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  "DF-002": {
    id: "DF-002",
    name: "Database function not wrapped in React.cache()",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 5,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\bdb\.\w+|\bprisma\.\w+|\bdrizzle\.\w+/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "An exported data access function performs ORM/database queries but is not wrapped in React.cache(), causing duplicate queries when called from multiple components.",
      impact: "Multiple React components calling the same data function within one render pass each trigger an independent database query. React.cache() deduplicates these automatically within a single request lifecycle.",
      ruleExplanation: "Unlike fetch(), ORM queries (Prisma, Drizzle, Mongoose) receive no automatic request deduplication. React.cache() provides per-request memoization that eliminates duplicate queries across the entire server render tree.",
    },
    fix: {
      primary: "Wrap the function: import { cache } from 'react'; export const getUser = cache(async (id: string) => { return db.user.findUnique({ where: { id } }); });",
      confidence: "HIGH",
      confidenceReason: "Standard Next.js Data Access Layer pattern — officially recommended in the App Router docs for ORM deduplication.",
      architecture: "Build a Data Access Layer (lib/dal.ts) where every exported async function is wrapped in React.cache(). This layer is the single source of truth for data access across all Server Components.",
    },
    severity: "MEDIUM",
    kind: "performance",
    confidence: 0.90,
    detectionMode: "heuristic",
  },

  "DF-003": {
    id: "DF-003",
    name: "Server Component calling internal API Route",
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/fetch\(['"]\/api\//] },
    boundary: "RSC_RENDER",
    message: {
      cause: "A Server Component fetches data from an internal /api/ Route Handler via an HTTP loopback request rather than calling the data access function directly.",
      impact: "Creates an unnecessary full HTTP roundtrip: Server Component → network → Route Handler → database. This adds network latency, bypasses the Data Cache, and increases server load with a loopback TCP connection.",
      ruleExplanation: "Server Components can import and call data access functions directly — no network layer is needed. Internal API routes exist for Client Components and external consumers, not for Server-to-Server communication.",
    },
    fix: {
      primary: "Import and call the underlying data function directly instead of fetching the Route Handler: import { getUsers } from '@/lib/dal'; const users = await getUsers();",
      confidence: "HIGH",
      confidenceReason: "Eliminates the network loopback entirely — Server Components have direct module access to all server-side code.",
      architecture: "Route Handlers serve external and client-side consumers. For server-to-server data access, always call the data layer directly.",
    },
    severity: "HIGH",
    kind: "architecture",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "DF-004": {
    id: "DF-004",
    name: "Uncached database query in Server Component",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\bdb\.\w+|\bprisma\.\w+/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "A Server Component queries the database directly without any caching layer ('use cache', unstable_cache, or React.cache()).",
      impact: "Every page render triggers a live database query. Under traffic, this removes all caching benefits and increases database load proportional to request volume.",
      ruleExplanation: "Database queries in Server Components bypass Next.js's Data Cache unless explicitly wrapped. The 'use cache' directive or React.cache() provides request-level and multi-request caching respectively.",
    },
    fix: {
      primary: "Wrap the database call in a cached function using React.cache() or Next.js 'use cache' directive for persistent cross-request caching.",
      confidence: "MEDIUM",
      confidenceReason: "Caching strategy depends on data freshness requirements — correct approach but requires contextual judgment.",
      architecture: "Separate data access from rendering: queries live in a cached DAL layer; Server Components consume cached results.",
    },
    severity: "MEDIUM",
    kind: "cache",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  "DF-005": {
    id: "DF-005",
    name: "Sequential fetch waterfall in Server Component",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 7,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/await\s+\w+\(/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Multiple independent data fetches are awaited sequentially inside a Server Component, each blocking the next from starting.",
      impact: "Total fetch time equals the sum of all individual fetch times. With Promise.all(), independent fetches run concurrently and total time equals the slowest single fetch.",
      ruleExplanation: "JavaScript's event loop allows initiating multiple async operations before awaiting any of them. Sequential awaiting of independent fetches eliminates concurrency and compounds latency.",
    },
    fix: {
      primary: "Replace sequential awaits with parallel execution: const [users, posts] = await Promise.all([getUsers(), getPosts()]);",
      confidence: "HIGH",
      confidenceReason: "Deterministic optimization — Promise.all() is always correct for independent data dependencies.",
      architecture: "Establish a convention: at the top of every Server Component, declare all independent data dependencies in a single Promise.all() call before any conditional logic.",
      alternatives: [
        "Use the preload pattern: call the async function without awaiting to start the fetch early, then await it later when the result is needed",
      ],
    },
    severity: "HIGH",
    kind: "performance",
    confidence: 0.90,
    detectionMode: "heuristic",
  },

  "DF-006": {
    id: "DF-006",
    name: "Duplicate data function called multiple times in one render",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 5,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/await\s+\w+\(/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "The same data-fetching function is called more than once within a single Server Component render pass, issuing redundant database queries.",
      impact: "Each duplicate call triggers an independent database roundtrip. N calls = N queries. React.cache() on the source function collapses all calls to a single in-memory result per request.",
      ruleExplanation: "Unlike fetch() which is automatically deduplicated by React for identical URLs, ORM and custom async functions receive no automatic memoization. React.cache() must be applied explicitly at the function declaration.",
    },
    fix: {
      primary: "Wrap the source function with React.cache(): import { cache } from 'react'; export const getRevenue = cache(async () => { ... });",
      confidence: "HIGH",
      confidenceReason: "React.cache() is the official Next.js mechanism for request-scoped memoization of server functions.",
      architecture: "Data Access Layer rule: every exported async data function must be wrapped in React.cache() at the point of declaration. Callers are then free to call it as many times as needed.",
    },
    severity: "MEDIUM",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "DF-007": {
    id: "DF-007",
    name: "Client Component re-fetching server-available data",
    category: "CLIENT_GRAPH_LEAK",
    severityBase: 9,
    phases: ["CLIENT_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/fetch\(['"]\/api\//] },
    boundary: "CLIENT_RENDER",
    message: {
      cause: "A Client Component fetches data via a client-side HTTP request when the same data is already available from a parent Server Component that could pass it as props.",
      impact: "Double network cost: the data is fetched server-side during SSR, then fetched again client-side after hydration. Users see a loading state for data that could have been pre-rendered.",
      ruleExplanation: "Server Components own data. When a Server Component already has the data, it should serialize it into the RSC payload and pass it as props to Client Components — zero additional network cost.",
    },
    fix: {
      primary: "Remove the client-side fetch and accept the data as a prop: // Server: const data = await getData(); <ClientComponent data={data} /> // Client: function ClientComponent({ data }) { ... }",
      confidence: "HIGH",
      confidenceReason: "Eliminates the client-server roundtrip for data already available at render time.",
      architecture: "Architectural rule: Server Components own data acquisition. Client Components display data. Props are the handoff mechanism — never a re-fetch.",
      alternatives: [
        "If real-time updates are required, use SWR with an initial data prop: useSWR(key, fetcher, { fallbackData: serverData })",
      ],
    },
    severity: "CRITICAL",
    kind: "architecture",
    confidence: 0.85,
    detectionMode: "graph-inferred",
  },

  "DF-009": {
    id: "DF-009",
    name: "generateMetadata Duplicate Fetches",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 4,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/generateMetadata/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Duplicate fetch() call detected between generateMetadata() and the Page component render function.",
      impact: "Triggers redundant network calls or maintenance overhead. In Next.js, deduplicating fetches using cache() or shared fetchers is a cleaner and safer pattern.",
      ruleExplanation: "Even though Next.js automatically dedupes GET requests, cache settings (like cache: 'no-store') or custom query configurations can bypass this, triggering redundant requests.",
    },
    fix: {
      primary: "Wrap the fetch or data acquisition logic in React.cache() or use a shared fetcher function.",
      confidence: "HIGH",
      confidenceReason: "Guarantees a single promise is shared between metadata extraction and rendering.",
      architecture: "Deduplicate data fetchers in a Data Access Layer using standard React and Next.js caching methods.",
      alternatives: [
        "Rely on Next.js automatic fetch deduplication for simple GET requests.",
      ],
    },
    severity: "LOW",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "DF-010": {
    id: "DF-010",
    name: "Cross-Route Duplicate Fetches",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 5,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/fetch/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Duplicate fetch() call targeting the same endpoint detected across parent layout and nested child routes.",
      impact: "Triggers redundant network requests and increased server load.",
      ruleExplanation: "Layouts and child routes execute during the same request lifecycle. Duplicate fetches without request-level caching double the data rendering cost.",
    },
    fix: {
      primary: "Wrap the shared fetch/query in React.cache() inside a shared data access layer module.",
      confidence: "HIGH",
      confidenceReason: "Shared React.cache() guarantees a single promise is resolved across different route files in the same request path.",
      architecture: "Centralize data fetching utilities in a shared data layer with memoization wrapper.",
      alternatives: [
        "Use Next.js automatic fetch deduplication for simple GET requests.",
      ],
    },
    severity: "MEDIUM",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "MD-002": {
    id: "MD-002",
    name: "Avoid Fetch Duplication Inside Dynamic generateMetadata and Pages",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 5,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/generateMetadata/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Fetching the same dataset twice (once in generateMetadata and once in page.tsx) using uncached non-fetch drivers (like standard ORM queries) causes database request waterfalls.",
      impact: "Each duplicate call triggers an independent database/API roundtrip. In Next.js, wrap the source function with React.cache() to deduplicate data fetching during request lifecycle.",
      ruleExplanation: "Next.js automatically deduplicates fetch() requests with the same signature. However, if you are querying databases directly (e.g. using Prisma, Mongoose, or raw pg sockets) inside generateMetadata() and again inside page.tsx, these queries are not cached by default. This causes twice the database load per page view.",
    },
    fix: {
      primary: "Wrap the database/fetch query function with React.cache: const getCachedItem = cache(async (id) => { return db.getItem(id); })",
      confidence: "HIGH",
      confidenceReason: "React.cache() is the official Next.js mechanism for request-scoped memoization of custom server queries.",
      architecture: "Establish a cached Data Access Layer (DAL) consumed by both metadata resolvers and render pages.",
      alternatives: [
        "Use Next.js fetch() with standard caching configuration for data API endpoints.",
      ],
    },
    severity: "MEDIUM",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  // ── Routing rules ──────────────────────────────────────────────────────────

  "RO-001": {
    id: "RO-001",
    name: "Non-routing file co-located in route segment",
    category: "RSC_API_VIOLATION",
    severityBase: 4,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "BUNDLER_RESOLUTION",
    message: {
      cause: "A non-routing file (utility, component, helper) is placed directly inside a route segment folder that contains a page.tsx or layout.tsx.",
      impact: "Risk of accidental route exposure if the file is misnamed, bundler confusion during tree-shaking, and organizational debt that grows as the app scales.",
      ruleExplanation: "Next.js App Router treats every folder containing a page.tsx as a publicly addressable URL segment. Non-routing files in these folders are technically safe if correctly named, but create maintenance risks and violate the principle that route segment folders should contain only routing-relevant files.",
    },
    fix: {
      primary: "Move utility files to an organizational folder outside the routing tree (app/components/, app/lib/, app/shared/) or into a private folder prefixed with underscore (_components/).",
      confidence: "MEDIUM",
      confidenceReason: "Correct architectural direction but requires reorganizing file structure — a mechanical refactor.",
      architecture: "Keep route segment folders lean: only page.tsx, layout.tsx, loading.tsx, error.tsx, and other Next.js routing files. All other code lives in dedicated organizational folders.",
    },
    severity: "LOW",
    kind: "architecture",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RO-002": {
    id: "RO-002",
    name: "route.ts and page.tsx co-located in same segment",
    category: "RSC_API_VIOLATION",
    severityBase: 9,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "BUNDLER_RESOLUTION",
    message: {
      cause: "A route.ts (HTTP handler) and page.tsx (React Server Component) coexist in the same route segment directory.",
      impact: "Next.js build compilation error — the framework cannot determine whether to serve this segment as a JSON API endpoint or a rendered HTML page.",
      ruleExplanation: "route.ts configures a segment as a raw HTTP handler (GET, POST, etc.). page.tsx configures it as a React render target. These are mutually exclusive — Next.js will throw during build if both exist.",
    },
    fix: {
      primary: "Move the route.ts to a dedicated API segment: app/api/resource/route.ts, keeping page.tsx at app/resource/page.tsx.",
      confidence: "HIGH",
      confidenceReason: "Deterministic fix — the two file types are mutually exclusive in any single route segment.",
      architecture: "Separate API routes into app/api/... and page routes into their own segments. Use Server Actions for mutations instead of co-locating API handlers near pages.",
    },
    severity: "CRITICAL",
    kind: "architecture",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RO-003": {
    id: "RO-003",
    name: "Parallel route slot missing default.tsx fallback",
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "RSC_RENDER",
    message: {
      cause: "A parallel route slot folder (@slot) contains a page.tsx but no default.tsx fallback file.",
      impact: "404 error on full page reload — Next.js cannot restore the slot's state and has no fallback to render in its place.",
      ruleExplanation: "On browser reload, Next.js cannot reconstruct the client-side slot state. Without a default.tsx fallback, the slot has nothing to render and the entire layout returns a 404. This is a hard requirement for parallel routes in production.",
    },
    fix: {
      primary: "Create a default.tsx file in the @slot directory that returns null or a structural skeleton component.",
      confidence: "HIGH",
      confidenceReason: "Mandatory Next.js requirement — officially documented as a hard constraint for parallel routes.",
      architecture: "Every parallel route slot must ship as a complete set: page.tsx (the content) + default.tsx (the fallback) + optional loading.tsx and error.tsx.",
    },
    severity: "HIGH",
    kind: "architecture",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RO-004": {
    id: "RO-004",
    name: "Intercepting route missing sibling @slot",
    category: "RSC_API_VIOLATION",
    severityBase: 7,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\(\.\)|\(\.\.\)|\(\.\.\.\)/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "An intercepting route segment ((.), (..), or (...)) exists without a matching sibling @slot parallel route in the parent layout.",
      impact: "Silent fallback to full page navigation — the intercepted content has no parallel slot to render into, so Next.js ignores the interception and performs a standard route change.",
      ruleExplanation: "Intercepting routes depend on a sibling parallel route slot (@modal, @drawer, etc.) to render the intercepted content alongside the current page. Without the slot, the interception has no render target and fails silently.",
    },
    fix: {
      primary: "Create a sibling @modal (or @drawer) folder at the same layout level with page.tsx and default.tsx. Update the parent layout.tsx to accept and render the slot.",
      confidence: "HIGH",
      confidenceReason: "Required structural pattern — intercepting routes are non-functional without a matching parallel slot.",
      architecture: "Intercepting route structure: parent-layout/@modal/default.tsx + parent-layout/(.)target/page.tsx + parent-layout/layout.tsx with { children, modal } props.",
      alternatives: [
        "If modal behavior is not needed, remove the intercepting route convention and use standard navigation instead",
      ],
    },
    severity: "HIGH",
    kind: "architecture",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RO-005": {
    id: "RO-005",
    name: "Streaming Opportunity: Wrap data fetch in Suspense boundary",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 3,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid", // change render correctness to valid as it is not a correct violation
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/export\s+default\s+async\s+function/] },
    boundary: "Streaming Opportunity",
    message: {
      cause: "An async page or layout awaits data directly in its render body. Wrapping data-dependent output in a Suspense boundary allows progressive streaming.",
      impact: "Streaming is optional. If the page contains independently loadable sections, streaming the shell first can improve perceived performance and TTFB.",
      ruleExplanation: "Next.js supports HTML streaming — the page shell can be sent to the browser immediately while data loads in the background. Suspense boundaries define independent streaming chunks. Without them, the page render is waterfall-sequential from the server's perspective.",
    },
    fix: {
      primary: "Extract the data-fetching section into a child async component and wrap it: <Suspense fallback={<Skeleton />}><DataComponent /></Suspense>",
      confidence: "HIGH",
      confidenceReason: "Standard Next.js streaming pattern — officially documented as the mechanism for enabling incremental HTML delivery.",
      architecture: "Streaming page architecture: page.tsx renders a static shell instantly. Each independent data source is a separate async child component wrapped in its own Suspense boundary, streaming content as data resolves.",
      alternatives: [
        "Use loading.tsx as a route-level Suspense boundary for the entire page",
        "Use dynamic() with loading UI for component-level streaming",
      ],
    },
    severity: "LOW",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RO-006": {
    id: "RO-006",
    name: "Layout Await Blocks Rendering",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/export\s+default\s+async\s+function/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "An async layout component awaits data directly in its render body, blocking child component execution.",
      impact: "React cannot render any child pages or nested layouts until the layout's fetches resolve. This completely disables parallel streaming and degrades page performance.",
      ruleExplanation: "Layouts wrap entire page subtrees. Blocking layout execution stalls page shell delivery and child component mount phases.",
    },
    fix: {
      primary: "Move the async data-fetching logic into a separate async component and render it inside layout wrapped in <Suspense>.",
      confidence: "HIGH",
      confidenceReason: "Official Next.js recommendation to keep layout components light and delegate data fetching to Suspense boundaries.",
      architecture: "Layout components should act as static shell hosts, loading instantly without network blocks.",
      alternatives: [
        "Use loading.tsx for route-level fallback UI",
      ],
    },
    severity: "HIGH",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "LAYOUT_AUTH_GATE": {
    id: "LAYOUT_AUTH_GATE",
    name: "Expected Authentication Boundary",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 3,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/export\s+default\s+async\s+function/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Layout blocks rendering to resolve user authentication, session, or tenant constraints.",
      impact: "This is a standard design pattern for route-level guards where children should not mount until authorization resolves.",
      ruleExplanation: "Awaiting authentication, session, or redirect APIs inside layout files acts as a route gate, which is intentional and expected.",
    },
    fix: {
      primary: "No changes needed. Confirm auth gating is required at the layout boundary.",
      confidence: "HIGH",
      confidenceReason: "Intentional await of auth methods blocks rendering to enforce security boundaries.",
      architecture: "Expected Auth Gate pattern ensures pages are protected before mounting.",
      alternatives: [],
    },
    severity: "LOW",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RO-007": {
    id: "RO-007",
    name: "Sequential Async Waterfall",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\bawait\b/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Multiple independent fetches or async functions are awaited sequentially instead of in parallel.",
      impact: "Each awaited promise blocks the next one, resulting in a cumulative execution latency waterfall. This extends TTFB and overall page load time.",
      ruleExplanation: "Awaiting independent operations one by one forces serial resolution. Using Promise.all() parallelizes request resolution.",
    },
    fix: {
      primary: "Combine independent awaits with Promise.all() or Promise.allSettled(): const [resA, resB] = await Promise.all([fetchA(), fetchB()]);",
      confidence: "HIGH",
      confidenceReason: "Official Next.js and React recommendations to use parallel data fetching for independent requests.",
      architecture: "Parallel data fetching leverages concurrent processing, minimizing overall request latency.",
      alternatives: [
        "Prefetch data in separate child components, each wrapped in its own Suspense boundary.",
      ],
    },
    severity: "HIGH",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RV-003": {
    id: "RV-003",
    name: "Dynamic revalidatePath Missing Type Parameter",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 7,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\brevalidatePath\b/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "revalidatePath() is called on a dynamic route segment without specifying the second 'type' argument.",
      impact: "Next.js treats it as a literal string path rather than matching dynamic route parameters, which fails to invalidate cached dynamic segments (e.g. /blog/[slug]).",
      ruleExplanation: "Dynamic route segment invalidation via revalidatePath requires an explicit type parameter ('page' or 'layout') to tell Next.js to match dynamic brackets.",
    },
    fix: {
      primary: "Add the 'page' or 'layout' parameter to revalidatePath: revalidatePath('/blog/[slug]', 'page')",
      confidence: "HIGH",
      confidenceReason: "Official Next.js documentation states type argument is mandatory for dynamic segment invalidation.",
      architecture: "Ensure revalidation points match the dynamic layout hierarchy structure.",
      alternatives: [],
    },
    severity: "HIGH",
    kind: "performance",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "RE-005": {
    id: "RE-005",
    name: "Leverage Next.js 15 'use cache' for Component Caching",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 3,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/async\s+function/, /export\s+default\s+async/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Server Component or data query helper performs network/database access but lacks component-level caching.",
      impact: "Every page render requests database rows or external assets dynamically, adding compute overhead.",
      ruleExplanation: "Using Next.js 15 'use cache' enables memoization of outputs for expensive data-fetching functions.",
    },
    fix: {
      primary: "Add the 'use cache' directive at the top of the component or helper function body.",
      confidence: "MEDIUM",
      confidenceReason: "Component-level caching is highly effective for static/semi-static dynamic components.",
      architecture: "Optimize the data access layer (DAL) using fine-grained server-side caching directives.",
      alternatives: [
        "Use unstable_cache() or React.cache() if 'use cache' directive is not enabled."
      ],
    },
    severity: "LOW",
    kind: "performance",
    confidence: 0.90,
    detectionMode: "heuristic",
  },

  "PF-007": {
    id: "PF-007",
    name: "Optimize Package Imports in next.config",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 3,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: { patterns: [/from\s+['"](lucide-react|react-icons|@radix-ui\/react-icons)['"]/] },
    boundary: "CLIENT_RENDER",
    message: {
      cause: "Heavy icon/UI packages are imported client-side but next.config.js lacks experimental.optimizePackageImports configuration.",
      impact: "All sub-modules of the package are bundled together, increasing initial bundle download size, TTI, and compilation build times.",
      ruleExplanation: "optimizePackageImports config instructs Next.js compiler to tree-shake heavy components automatically.",
    },
    fix: {
      primary: "Add the package to experimental.optimizePackageImports in next.config.js.",
      confidence: "HIGH",
      confidenceReason: "Standard Next.js package optimization technique for large distributed libraries.",
      architecture: "Configure Next.js packagers to prune unused components at build time.",
      alternatives: [
        "Use deep imports (e.g. lucide-react/dist/esm/icons/...) if next.config optimization is not desired."
      ],
    },
    severity: "LOW",
    kind: "performance",
    confidence: 0.95,
    detectionMode: "heuristic",
  },

  "SC-SECURITY-002": {
    id: "SC-SECURITY-002",
    name: "Server-only Module Boundary Guard",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 8,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "invalid",
      HYDRATION: "invalid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: { patterns: [/\b(db|prisma|pg|drizzle|sql|knex|mysql|mongodb)\b/i] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Database connection initialization or credential modules do not import 'server-only'.",
      impact: "Risk of importing backend files into client bundles, exposing credentials and causing build failures.",
      ruleExplanation: "Importing 'server-only' raises a compile-time build error if the module is referenced client-side, enforcing a strict backend security boundary.",
    },
    fix: {
      primary: "Add import 'server-only'; at the top of the server-only backend utility file.",
      confidence: "HIGH",
      confidenceReason: "Official React and Next.js pattern to secure backend-only execution modules.",
      architecture: "Isolate database, API routes, and backend connectors using 'server-only' guards.",
      alternatives: [],
    },
    severity: "HIGH",
    kind: "security",
    confidence: 0.95,
    detectionMode: "heuristic",
  },

  // ── Cache rules ─────────────────────────────────────────────────────────────

  "CA-006": {
    id: "CA-006",
    name: "Cache tag declared but never revalidated",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/next\.tags/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "A cache tag is applied to a fetch() call using next.tags, but revalidateTag() is never called with that tag anywhere in the project.",
      impact: "The cached data can never be surgically invalidated after mutations. It will remain stale until the revalidate interval expires or the app is redeployed.",
      ruleExplanation: "Cache tags are inert without a corresponding revalidateTag() call. A tag without an invalidation path is dead infrastructure — the cache will retain stale data indefinitely regardless of database changes.",
    },
    fix: {
      primary: "Add revalidateTag('tag-name') to the Server Action that mutates the data this tag covers.",
      confidence: "HIGH",
      confidenceReason: "Structural requirement — on-demand revalidation requires a paired tag declaration and revalidateTag() call.",
      architecture: "Adopt a tag-per-entity convention: declare a canonical tag constant and use it symmetrically in the data fetch (next.tags) and in the mutation (revalidateTag). One source of truth for the tag value.",
      alternatives: [
        "Use next: { revalidate: N } instead if time-based expiry is acceptable for this data",
      ],
    },
    severity: "MEDIUM",
    kind: "cache",
    confidence: 0.90,
    detectionMode: "graph-inferred",
  },

  "CA-007": {
    id: "CA-007",
    name: "Broad cache invalidation after single-entity mutation",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/revalidatePath\(['"]\/['"]\)/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "revalidatePath('/') is called after a single-entity mutation, purging the entire route cache tree when only one entity changed.",
      impact: "Under high traffic, all cached routes become stale simultaneously, causing a cache stampede: every route must re-render on the next request, spiking server CPU and response times.",
      ruleExplanation: "revalidatePath('/') is equivalent to 'clear everything'. For a single record update, the scope of invalidation should match the scope of the change — one entity → one cache tag, not the entire route tree.",
    },
    fix: {
      primary: "Replace revalidatePath('/') with revalidateTag('entity-tag') targeting only the specific data that changed.",
      confidence: "HIGH",
      confidenceReason: "Surgical invalidation is always correct when the scope of change is a single entity — revalidateTag() is O(1), revalidatePath('/') is O(all cached routes).",
      architecture: "Surgical invalidation principle: the scope of revalidation equals the scope of mutation. Design entity-scoped cache tags at the data layer and invalidate them at the mutation layer.",
      alternatives: [
        "Use revalidatePath('/specific-page') to scope invalidation to only the affected pages",
        "Use revalidatePath('/entity-type/[id]', 'page') to scope to a dynamic segment",
      ],
    },
    severity: "MEDIUM",
    kind: "cache",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  // ── Routing/Static Generation rules ────────────────────────────────────────

  "RE-003": {
    id: "RE-003",
    name: "Dynamic route missing generateStaticParams()",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\[.*\]\/page\./] },
    boundary: "RSC_RENDER",
    message: {
      cause: "A dynamic route segment ([param]) does not export generateStaticParams(), preventing Next.js from statically generating the known paths at build time.",
      impact: "All matching routes are rendered server-side on every request (dynamic rendering) instead of being pre-built as static HTML. Increases TTFB and server load for routes that could be static.",
      ruleExplanation: "Next.js can statically generate dynamic routes if it knows the possible values of the dynamic segment at build time. generateStaticParams() provides these values, enabling Full Route Cache and eliminating per-request server rendering for known paths.",
    },
    fix: {
      primary: "Export generateStaticParams() from the page: export async function generateStaticParams() { const items = await getItems(); return items.map(item => ({ id: item.id.toString() })); }",
      confidence: "MEDIUM",
      confidenceReason: "Correct optimization but only applicable when the set of possible param values is known and finite at build time.",
      architecture: "Categorize dynamic routes: known-finite paths use generateStaticParams() for static generation; truly dynamic paths (user-generated slugs) use dynamic rendering with appropriate caching.",
      alternatives: [
        "Add export const dynamicParams = false to return 404 for any path not returned by generateStaticParams()",
        "Use ISR with revalidate to statically serve known paths while allowing new paths to generate on-demand",
      ],
    },
    severity: "MEDIUM",
    kind: "performance",
    confidence: 0.65,
    detectionMode: "heuristic",
  },

  // ── Server Action cache rules ───────────────────────────────────────────────

  "DYNAMIC_RENDER_TRIGGER-004": {
    id: "DYNAMIC_RENDER_TRIGGER-004",
    name: "Server Action mutation without cache revalidation",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 7,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { patterns: [/\bdb\.\w+|\bfetch\b/] },
    boundary: "RSC_RENDER",
    message: {
      cause: "A Server Action performs a database mutation or data write but does not call revalidateTag(), revalidatePath(), or redirect() to clear stale cached data.",
      impact: "The mutation succeeds but the Router Cache and Data Cache retain the old data. Users see stale content on the next page visit until the cache naturally expires.",
      ruleExplanation: "Next.js caches route renders in the Router Cache (client-side) and Data Cache (server-side). Mutations that skip revalidation leave both caches serving pre-mutation data. Every mutation action must include an explicit cache invalidation strategy.",
    },
    fix: {
      primary: "Add revalidateTag('affected-tag') or revalidatePath('/affected-page') immediately after the mutation completes.",
      confidence: "HIGH",
      confidenceReason: "Mandatory pattern — Next.js docs explicitly require cache invalidation after Server Action mutations to maintain data consistency.",
      architecture: "Every mutation action follows a three-step pattern: validate input → perform mutation → invalidate cache (revalidateTag) → optionally redirect. No exceptions.",
      alternatives: [
        "Use redirect() after mutation — Next.js automatically invalidates the Router Cache for the redirected path",
        "Use revalidatePath('/path', 'layout') to invalidate all pages under a layout segment",
      ],
    },
    severity: "HIGH",
    kind: "cache",
    confidence: 1.0,
    detectionMode: "deterministic",
  },

  "MW-002": {
    id: "MW-002",
    name: "Strictly Configure Middleware Matcher to Ignore Static Assets",
    category: "RSC_API_VIOLATION",
    severityBase: 5,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "ROUTE_HANDLER_EXECUTION",
    message: {
      cause: "Middleware matcher configuration is missing or does not exclude system and static asset routes.",
      impact: "Middleware execution triggers on all network asset requests, inflating response latency and cloud computing cost.",
      ruleExplanation: "Next.js Middleware intercepts all route requests by default. Restricting it with a matcher avoids running logic on static resources like CSS, JS, and images.",
    },
    fix: {
      primary: "Define a config matcher to restrict Middleware execution to actual routing paths, excluding static files.",
      confidence: "HIGH",
      confidenceReason: "Standard framework optimization to prevent performance and resource usage overhead.",
      architecture: "Define routing policies inside clear matching boundaries. Keep middleware script footprint minimal.",
      alternatives: [
        "Use standard negative-lookahead regex matcher: '/((?!_next/static|_next/image|favicon.ico|.*\\\\.png$).*)'"
      ],
    },
    severity: "MEDIUM",
    kind: "architecture",
    confidence: 0.90,
    detectionMode: "deterministic",
  },

  "BD-003": {
    id: "BD-003",
    name: "Avoid Centralized Barrel File Imports in Client Components",
    category: "CLIENT_GRAPH_LEAK",
    severityBase: 4,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "CLIENT_RENDER",
    message: {
      cause: "Importing modules from a centralized barrel file (index.ts) inside a Client Component defeats tree-shaking.",
      impact: "Inflation of the clientside JS bundle size due to compiling unused dependencies imported through the barrel file.",
      ruleExplanation: "Webpack/Turbopack cannot effectively tree-shake unused exports when imported through a multi-export barrel file, pulling in the entire consolidated dependency tree.",
    },
    fix: {
      primary: "Import components directly from their specific individual file path rather than the centralized index file.",
      confidence: "HIGH",
      confidenceReason: "Ensures only the required code is compiled into the client bundle.",
      architecture: "Avoid root barrel files in components directory. Structure imports explicitly.",
      alternatives: [
        "Configure sideEffects: false in package.json to assist compiler tree-shaking"
      ],
    },
    severity: "MEDIUM",
    kind: "performance",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  "SA-002": {
    id: "SA-002",
    name: "Server Action Arguments and Return Values Must Be Serializable",
    category: "SERVER_ACTION_MISUSE",
    severityBase: 8,
    phases: ["SERVER_ACTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "invalid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { nodeType: ["FunctionDeclaration"] },
    boundary: "SERVER_ACTION_EXECUTION",
    message: {
      cause: "A Server Action accepts or returns non-serializable values (like functions, classes, or database connections).",
      impact: "Serialization failure during execution — the action throws at runtime and the client receives a 500 error.",
      ruleExplanation: "Server Actions execute over HTTP; all inputs and outputs must be serializable to React Server Component payload format.",
    },
    fix: {
      primary: "Pass and return only plain, serializable structures: primitives, plain objects, arrays, or FormData.",
      confidence: "HIGH",
      confidenceReason: "Strict framework serialization contract.",
      architecture: "Map ORM model instances to clean DTOs before returning them from Server Actions.",
      alternatives: [
        "Return structured plain objects: { success: true, data: { ... } } or { error: 'message' }"
      ],
    },
    severity: "HIGH",
    kind: "architecture",
    confidence: 0.90,
    detectionMode: "heuristic",
  },

  "RV-002": {
    id: "RV-002",
    name: "Time-based Cache Revalidation Mismatch",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 5,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Setting low revalidation intervals in layouts can cause caching mismatch boundaries with child route segments.",
      impact: "Static HTML pages served to users remain stale while dynamic child data updates, causing rendering inconsistencies.",
      ruleExplanation: "Caching strategies should be aligned between layout shells and child pages to ensure consistent rendering outputs.",
    },
    fix: {
      primary: "Align layout-wide revalidation values with child pages to ensure stable data synchronization.",
      confidence: "HIGH",
      confidenceReason: "Prevents serving mismatched layout/page content states.",
      architecture: "Declare consistent global segment behaviors (e.g. export const revalidate = 60) across routing trees.",
      alternatives: [
        "Use dynamic route configurations consistently instead of mismatched revalidation times"
      ],
    },
    severity: "MEDIUM",
    kind: "cache",
    confidence: 0.85,
    detectionMode: "heuristic",
  },

  "OB-002": {
    id: "OB-002",
    name: "Avoid console.log in High-Frequency Edge Routes",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 4,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "ROUTE_HANDLER_EXECUTION",
    message: {
      cause: "Using raw console.log inside Edge middleware or high-frequency routes prints excessive diagnostics.",
      impact: "Saturates execution logging pools, blocks thread execution in V8 isolates, and increases operational log costs.",
      ruleExplanation: "High-frequency logging in hot request paths degrades performance and inflates log storage costs.",
    },
    fix: {
      primary: "Replace raw console.log statements with gated conditional loggers (development-only or structured).",
      confidence: "HIGH",
      confidenceReason: "Reduces logging overhead in performance-critical execution paths.",
      architecture: "Separate application diagnostics from user request traffic. Use conditional production log limits.",
      alternatives: [
        "Use structured, level-gated logger packages like pino or winston"
      ],
    },
    severity: "LOW",
    kind: "performance",
    confidence: 0.90,
    detectionMode: "deterministic",
  },

  "SE-001": {
    id: "SE-001",
    name: "Do Not Expose Private Secrets in NEXT_PUBLIC Environment Variables",
    category: "RSC_API_VIOLATION",
    severityBase: 8,
    phases: ["BUNDLER_RESOLUTION"],
    phaseCorrectness: {
      RSC_RENDER: "valid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "invalid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "CLIENT_RENDER",
    message: {
      cause: "Sensitive keys or DB urls are prefixed with the NEXT_PUBLIC_ identifier.",
      impact: "Backend credentials compile directly into the public JavaScript bundle, exposing them to client-side inspection.",
      ruleExplanation: "NEXT_PUBLIC_ env variables are inlined in the client build. Stripping this prefix protects secrets from leakage.",
    },
    fix: {
      primary: "Remove NEXT_PUBLIC_ from the env variable name and access it only inside Server Component scopes.",
      confidence: "HIGH",
      confidenceReason: "Security boundary requirement — client bundle analysis exposes public strings.",
      architecture: "Keep private keys undecorated (e.g. STRIPE_KEY) and guard with server-only package imports.",
      alternatives: [
        "Load secrets on-demand at server runtime instead of static build replacement"
      ],
    },
    severity: "CRITICAL",
    kind: "security",
    confidence: 0.95,
    detectionMode: "deterministic",
  },
  "DYNAMIC_LAYOUT_IMPACT": {
    id: "DYNAMIC_LAYOUT_IMPACT",
    name: "Avoid Dynamic request-time APIs blocking initial layout streaming",
    category: "DYNAMIC_RENDER_TRIGGER",
    severityBase: 6,
    phases: ["RSC_RENDER"],
    phaseCorrectness: {
      RSC_RENDER: "invalid",
      CLIENT_RENDER: "valid",
      HYDRATION: "valid",
      SERVER_ACTION: "valid",
      BUNDLER_RESOLUTION: "valid",
    },
    triggers: { nodeType: ["SourceFile"] },
    boundary: "RSC_RENDER",
    message: {
      cause: "Accessing dynamic server APIs (cookies(), headers()) in layout component body blocks progressive streaming.",
      impact: "The layout shell and its subtree are forced into dynamic on-demand rendering.",
      ruleExplanation: "Root layouts should remain static and lightweight. Extract user-specific details into Suspense-wrapped async sub-components.",
    },
    fix: {
      primary: "Wrap dynamic header/profile components in Suspense boundaries to allow page shell pre-rendering.",
      confidence: "HIGH",
      confidenceReason: "Standard streaming performance optimization pattern.",
      architecture: "Adopt a shell-and-grain page design to serve static containers instantly while stream dynamic grains.",
      alternatives: [
        "Use Client Component dynamic mounts or POST-hydration cookies fetch"
      ],
    },
    severity: "HIGH",
    kind: "performance",
    confidence: 0.90,
    detectionMode: "heuristic",
  },
};


/**
 * Normalises tiered/suffixed diagnostic IDs to their base constraint IDs.
 */
export function getBaseConstraintId(id: string): string {
  if (id.startsWith("DYNAMIC_LAYOUT_IMPACT-")) {
    return "DYNAMIC_LAYOUT_IMPACT";
  }
  if (id.startsWith("DF-005-")) {
    return "DF-005";
  }
  if (id.startsWith("RE-003-")) {
    return "RE-003";
  }
  if (id.startsWith("DYNAMIC_RENDER_TRIGGER-004-")) {
    return "DYNAMIC_RENDER_TRIGGER-004";
  }
  return id;
}

/**
 * Look up a RuleSpec by constraint ID.
 * Returns undefined if the rule is not in the registry.
 */
export function getRuleSpec(constraintId: string): RuleSpec | undefined {
  const baseId = getBaseConstraintId(constraintId);
  return RULE_REGISTRY[baseId];
}

/**
 * Look up a RuleSpec by constraint ID.
 * Throws if the rule is not found — use in contexts where the ID is guaranteed valid.
 */
export function requireRuleSpec(constraintId: string): RuleSpec {
  const baseId = getBaseConstraintId(constraintId);
  const spec = RULE_REGISTRY[baseId];
  if (!spec) {
    throw new Error(`[rule-registry] No RuleSpec found for constraint ID: "${constraintId}" (base: "${baseId}")`);
  }
  return spec;
}
