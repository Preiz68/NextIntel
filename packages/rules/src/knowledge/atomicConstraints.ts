import { Diagnostic } from "../types.js";

export type SemanticEvent =
  | "RENDER_PHASE_BROWSER_API_ACCESS"
  | "RENDER_PHASE_SERVER_API_ACCESS"
  | "EFFECT_PHASE_BROWSER_API_ACCESS"
  | "EVENT_HANDLER_BROWSER_API_ACCESS"
  | "CLIENT_COMPONENT_ASYNC_EXECUTION"
  | "SERVER_ACTION_MISSING_AUTH"
  | "SERVER_ACTION_UNSAFE_INPUT"
  | "SERVER_IMPORT_IN_CLIENT_COMPONENT"
  | "CACHE_CONFLICT_DETECTED"
  | "HYDRATION_UNSTABLE_RENDER"
  | "BOUNDARY_VIOLATION_DETECTED"
  | "FETCH_CACHE_MISCONFIGURATION"
  | "CLIENT_SIDE_DATA_FETCHING"
  | "REQUEST_DEDUPLICATION_OPPORTUNITY"
  | "INTERNAL_API_ROUTE_CALL"
  | "SEQUENTIAL_FETCH_WATERFALL"
  | "INVALID_ROUTING_FILE_STRUCTURE"
  | "CO_LOCATED_PAGE_AND_ROUTE_HANDLER"
  | "MISSING_PARALLEL_ROUTE_DEFAULT"
  | "DUPLICATE_DATA_REQUEST"
  | "CLIENT_SERVER_DATA_REFETCH"
  | "STALE_CACHE_TAG"
  | "BROAD_CACHE_INVALIDATION"
  | "INTERCEPTING_ROUTE_MISCONFIGURATION"
  | "MISSING_SUSPENSE_BOUNDARY";

export interface AtomicConstraint {
  id: string;
  semanticEvent: SemanticEvent;
  phase: "render" | "effect" | "event" | "server" | "action";
  concept: "server-components" | "client-components" | "server-actions" | "caching" | "data-fetching" | "routing" | "streaming";
  problem: string;
  whyItMatters: string;
  forbiddenConditions: string[];
  detectionStrategy: string[];
  productionRisks: string[];
  quickFix: string[];
  architectureGuidance: string[];
}

export const ATOMIC_CONSTRAINTS: Record<string, AtomicConstraint> = {
  "SC-BROWSER-API-001": {
    id: "SC-BROWSER-API-001",
    semanticEvent: "RENDER_PHASE_BROWSER_API_ACCESS",
    phase: "render",
    concept: "server-components",
    problem: "Browser-only globals such as window, document, localStorage, sessionStorage, navigator, and location cannot be accessed inside Server Components.",
    whyItMatters: "Server Components execute only in the Node.js server runtime. There is no browser context, no DOM, and no Web APIs. Any usage will throw a ReferenceError at runtime or during build, crashing the render and returning a 500 error to users.",
    forbiddenConditions: ["Direct reference to browser globals during the SSR/RSC build and render pass."],
    detectionStrategy: ["Identify identifiers referencing browser globals that are not in a deferred execution scope."],
    productionRisks: [
      "ReferenceError crashing the server render",
      "500 errors served to users",
      "Build failures in strict mode",
      "Broken pages when deployed to serverless environments"
    ],
    quickFix: ["Add 'use client' at the top of the file if the component needs browser APIs", "Extract only the browser-dependent part into a separate Client Component and import it"],
    architectureGuidance: [
      "Design components so that the Server Component fetches and owns data, and a thin Client Component handles display/interaction",
      "Use the children/slot pattern to pass server-rendered subtrees into client wrappers"
    ]
  },
  "SC-HOOK-USAGE-001": {
    id: "SC-HOOK-USAGE-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "render",
    concept: "server-components",
    problem: "React hooks (useState, useEffect, useReducer, useContext, useRef, useCallback, useMemo, useTransition, useDeferredValue, useId, useLayoutEffect, useInsertionEffect) cannot be used in Server Components.",
    whyItMatters: "Hooks are part of the React client runtime and rely on the fiber reconciler running in the browser. Server Components are rendered to the RSC Payload in a one-shot server pass with no reconciler, no state tree, and no effect scheduling. Attempting to use hooks causes an immediate runtime error.",
    forbiddenConditions: ["Use of any standard React hook in a Server Component."],
    detectionStrategy: ["Match identifier calls starting with 'use' in a Server Component context."],
    productionRisks: [
      "Immediate runtime crash during RSC rendering",
      "Compilation/TypeScript compilation errors",
      "Server rendering completely halted"
    ],
    quickFix: [
      "Add 'use client' at the top of the file to enable client hooks",
      "Push interactivity and state hooks down into leaf-level Client Components"
    ],
    architectureGuidance: [
      "Server Components must remain pure, declarative rendering templates",
      "Lift state up to Client Component boundaries if interactivity is required, and pass Server Components as children"
    ]
  },
  "SC-EVENT-HANDLER-001": {
    id: "SC-EVENT-HANDLER-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "render",
    concept: "server-components",
    problem: "Event handlers like onClick, onSubmit, onChange, and onKeyDown cannot be passed to HTML elements inside Server Components.",
    whyItMatters: "Server Components are rendered into static HTML and the React Server Component Payload (RSC Payload) on the server. Because the JavaScript for Server Components is never sent to the browser, there is no event delegation system or interactive JS runner associated with them. Passing event handlers to DOM elements has no effect and React will throw an error.",
    forbiddenConditions: ["Passing JSX attributes starting with 'on' to DOM tags in a Server Component."],
    detectionStrategy: ["Examine JSX elements in RSC for prop names starting with 'on' followed by a capital letter."],
    productionRisks: [
      "Runtime rendering errors during RSC generation",
      "Broken interactivity where click handlers silently fail to bind"
    ],
    quickFix: [
      "Mark the containing component with 'use client' to support event handlers",
      "Move the interactive DOM element with its handler into a separate Client Component"
    ],
    architectureGuidance: [
      "Segregate static content (Server Components) from dynamic interactions (Client Components)",
      "Maintain a thin interactive layer with leaf-node Client Components"
    ]
  },
  "SC-CONTEXT-001": {
    id: "SC-CONTEXT-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "render",
    concept: "server-components",
    problem: "React Context (createContext and useContext) cannot be created or consumed inside Server Components.",
    whyItMatters: "React Context is designed for dynamic state propagation across the client-side component fiber tree. Server Components render in a flat, stateless, non-interactive one-shot pass on the server. They do not share context state since there is no client-side reconciler active during their generation. Using createContext or useContext in a Server Component causes immediate errors.",
    forbiddenConditions: ["Importing or calling createContext/useContext in a Server Component."],
    detectionStrategy: ["Identify imports or references to createContext/useContext inside a Server Component file."],
    productionRisks: [
      "RSC renderer crashes with Context-related errors",
      "Inability to pass implicit dependencies between Server Components"
    ],
    quickFix: [
      "Use explicit prop drilling or custom layouts to pass data down the Server Component tree",
      "Wrap components needing Context in a Client Component provider"
    ],
    architectureGuidance: [
      "Pass data explicitly down the server tree as props, or fetch data close to the component that needs it",
      "Client-side providers should wrap the client sub-trees requiring context sharing"
    ]
  },
  "SC-MUTATION-001": {
    id: "SC-MUTATION-001",
    semanticEvent: "RENDER_PHASE_SERVER_API_ACCESS",
    phase: "render",
    concept: "server-components",
    problem: "State mutations and side-effects (like cookies().set(), revalidatePath(), revalidateTag()) cannot be executed during the render phase of Server Components.",
    whyItMatters: "React rendering is meant to be pure and side-effect free. Mutating cookies or triggering revalidation during the render phase of a Server Component breaks request flow pipelines and leads to unhandled runtime errors.",
    forbiddenConditions: ["Calling mutating server APIs directly inside the render body of a Server Component."],
    detectionStrategy: ["Check for cookies().set or revalidate calls inside the render function of a Server Component."],
    productionRisks: [
      "Pipeline runtime crashes during rendering",
      "Inconsistent page cache states and hydration failures"
    ],
    quickFix: [
      "Move the mutating operations into a Server Action or Route Handler instead of the render phase"
    ],
    architectureGuidance: [
      "Keep Server Component rendering functions purely read-only",
      "Delegate all writes, cache invalidations, and cookie mutations to Server Actions or API routes"
    ]
  },
  "SC-SERIALIZATION-001": {
    id: "SC-SERIALIZATION-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "render",
    concept: "server-components",
    problem: "Non-serializable props (such as functions, classes, custom symbols, or complex objects) cannot be passed from Server Components to Client Components.",
    whyItMatters: "The boundary between Server and Client Components requires all props to be serializable because they must traverse the network (via the RSC payload). Passing non-serializable props causes serialization failures during rendering.",
    forbiddenConditions: ["Passing arrow functions, functions, or complex class instances across the RSC boundary to a client component."],
    detectionStrategy: ["Analyze JSX attributes passed to client components for non-serializable values."],
    productionRisks: [
      "Serialization errors at build or request time",
      "Failed hydration and application crash in production"
    ],
    quickFix: [
      "Pass serializable values (like IDs, primitives, plain objects) instead of function callbacks",
      "Implement Server Actions for callback actions needed by Client Components"
    ],
    architectureGuidance: [
      "Ensure RSC boundaries are strictly data-driven with simple JSON-serializable payloads",
      "Utilize Next.js Server Actions to safely handle actions across the boundary"
    ]
  },
  "SC-THIRD-PARTY-001": {
    id: "SC-THIRD-PARTY-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "render",
    concept: "server-components",
    problem: "Third-party client components that do not declare 'use client' must be wrapped in a local Client Component before being used in Server Components.",
    whyItMatters: "Many npm packages utilize client-only APIs but do not include the 'use client' directive. Direct imports of these packages inside Server Components will execute on the server and crash due to missing browser globals.",
    forbiddenConditions: ["Directly importing and rendering client-heavy third-party libraries inside a Server Component without wrapper."],
    detectionStrategy: ["Match third-party npm package imports that are used directly as JSX tags in a Server Component."],
    productionRisks: [
      "ReferenceError crashes on the server",
      "Build failures during pre-rendering of third-party wrappers"
    ],
    quickFix: [
      "Create a local Client Component wrapper (with 'use client') that imports and exports the third-party component"
    ],
    architectureGuidance: [
      "Always wrap external UI library components in a local client-directed wrapper before importing them into Server Components"
    ]
  },
  "CC-ASYNC-CLIENT-001": {
    id: "CC-ASYNC-CLIENT-001",
    semanticEvent: "CLIENT_COMPONENT_ASYNC_EXECUTION",
    phase: "render",
    concept: "client-components",
    problem: "Client Components cannot be declared as async functions.",
    whyItMatters: "React does not support async Client Components. Because they render in the browser reconciler, declaring them as async will return a Promise instead of valid React elements, causing an immediate runtime error and crashing the client render.",
    forbiddenConditions: ["Declaring a component with 'use client' as an async function or returning a Promise from its render."],
    detectionStrategy: ["Examine default/named exports in client component files for async function declarations."],
    productionRisks: [
      "Immediate runtime crash in the browser during component reconciliation",
      "Hydration mismatches and blank pages"
    ],
    quickFix: [
      "Remove 'async' and use standard hooks (useEffect, useState, or libraries like SWR/React Query) for client-side data fetching",
      "Convert the component into a Server Component if async/await rendering is required"
    ],
    architectureGuidance: [
      "Keep Client Components synchronous in terms of rendering signature",
      "Manage asynchronous data fetching on the client via hooks or fetch state libraries"
    ]
  },
  "CC-RUNTIME-LEAK-001": {
    id: "CC-RUNTIME-LEAK-001",
    semanticEvent: "RENDER_PHASE_SERVER_API_ACCESS",
    phase: "render",
    concept: "client-components",
    problem: "Server-only APIs and modules (e.g. cookies(), headers(), draftMode() from 'next/headers') cannot be imported or used in Client Components.",
    whyItMatters: "Server-only modules require a Node.js context and access to the request lifecycle. Importing them in Client Components leaks server-only code to the client bundle, causing bundle bloat and runtime errors in the browser.",
    forbiddenConditions: ["Importing from next/headers or server-only packages in a client component."],
    detectionStrategy: ["Check client component files for imports from 'next/headers', 'server-only', or database clients."],
    productionRisks: [
      "Compilation failures or webpack bundle errors",
      "Leaking server configuration, credentials, or code to the browser bundle",
      "Crashing client runtime due to missing Node.js globals"
    ],
    quickFix: [
      "Remove the server-only import and pass the required server data (like headers or cookies) as props from a parent Server Component"
    ],
    architectureGuidance: [
      "Pass server data down to Client Components as read-only serializable props rather than importing server APIs client-side"
    ]
  },
  "CC-SERVER-IMPORT-001": {
    id: "CC-SERVER-IMPORT-001",
    semanticEvent: "SERVER_IMPORT_IN_CLIENT_COMPONENT",
    phase: "render",
    concept: "client-components",
    problem: "Server Components or server-only modules cannot be directly imported into Client Components.",
    whyItMatters: "When a Client Component imports another file, that file is included in the client bundle. Directly importing a Server Component pulls its server-only dependencies into the browser bundle, crashing at runtime.",
    forbiddenConditions: ["Static or dynamic imports of Server Components/modules inside a Client Component."],
    detectionStrategy: ["Identify import edges pointing from client components to server-only components/modules in the graph."],
    productionRisks: [
      "Webpack bundling errors or runtime ReferenceErrors in the browser",
      "Massive client bundles leaking server-side libraries"
    ],
    quickFix: [
      "Pass the Server Component as children or as a prop (slot pattern) from a parent Server Component instead of importing it"
    ],
    architectureGuidance: [
      "Leverage composition (children/slots) to nest Server Components inside Client Components without establishing a direct import relationship"
    ]
  },
  "CC-ROUTE-HANDLER-001": {
    id: "CC-ROUTE-HANDLER-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "render",
    concept: "client-components",
    problem: "Client Components should not perform client-side data fetching of internal API routes (like fetch('/api/...')).",
    whyItMatters: "Internal API routes trigger separate HTTP network roundtrips. Fetching them directly from Client Components increases network latency, degrades rendering performance, and bypasses RSC optimization benefits.",
    forbiddenConditions: ["Client-side fetch calls pointing to internal api endpoints starting with '/api/' during render or lifecycle."],
    detectionStrategy: ["Identify fetch calls in Client Components where the target URL starts with '/api/'."],
    productionRisks: [
      "High network latency and degradation of Core Web Vitals",
      "Exposing internal data fetching logic directly to public clients"
    ],
    quickFix: [
      "Fetch the data in a parent Server Component and pass it to the Client Component as props",
      "Use Server Actions for data queries and mutations"
    ],
    architectureGuidance: [
      "Prefer data-fetching in Server Components at the boundary, avoiding unnecessary internal HTTP route calls from the client browser"
    ]
  },
  "HY-RENDER-BROWSER-API-001": {
    id: "HY-RENDER-BROWSER-API-001",
    semanticEvent: "RENDER_PHASE_BROWSER_API_ACCESS",
    phase: "render",
    concept: "client-components",
    problem: "Browser API globals (like localStorage, window) accessed during the top-level render of a Client Component cause hydration mismatches.",
    whyItMatters: "Client Components are pre-rendered to HTML on the server. If they read browser-only globals (which do not exist on the server) during their render phase, the HTML generated on the server will differ from the hydration output in the browser, causing visual bugs and rendering restarts.",
    forbiddenConditions: ["Accessing window, document, localStorage, or navigator directly in the component's main rendering function."],
    detectionStrategy: ["Identify browser API references that are executed in the top-level component scope (not deferred inside useEffect or event handlers)."],
    productionRisks: [
      "Hydration mismatch warnings and UI flashes",
      "Server HTML discarded entirely, causing slow page loads (LCP/CLS degradation)"
    ],
    quickFix: [
      "Defer the browser API access to a useEffect hook or event handler",
      "Use a mounted state flag (const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []))"
    ],
    architectureGuidance: [
      "Render an isomorphic initial UI shell that is safe for both server and client environments, then load client-specific dynamic states after mounting"
    ]
  },
  "SA-AUTH-001": {
    id: "SA-AUTH-001",
    semanticEvent: "SERVER_ACTION_MISSING_AUTH",
    phase: "action",
    concept: "server-actions",
    problem: "Server Actions must explicitly verify authentication and authorization credentials.",
    whyItMatters: "Server Actions are compiled into public HTTP POST endpoints. Any user can trigger them via direct HTTP requests. Without explicit authentication checks inside each action function, unauthorized users can invoke them and manipulate database records.",
    forbiddenConditions: ["Lack of auth/session check calls (e.g. auth(), getSession(), session) inside a Server Action function."],
    detectionStrategy: ["Scan Server Action function bodies for authentication checking keywords or functions."],
    productionRisks: [
      "Unauthorized database writes and privilege escalations",
      "Data theft and modification by unauthenticated users"
    ],
    quickFix: [
      "Add an authentication check (e.g., const session = await getSession(); if (!session) throw new Error('Unauthorized');) at the start of the Server Action"
    ],
    architectureGuidance: [
      "Treat Server Actions as public API endpoints. Never assume the caller is authenticated based on page layout protection"
    ]
  },
  "SA-SERIALIZATION-001": {
    id: "SA-SERIALIZATION-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "action",
    concept: "server-actions",
    problem: "Server Actions must receive and return serializable payloads.",
    whyItMatters: "Because Server Actions are invoked over HTTP, all parameters and return values must be serializable (e.g., plain JSON or FormData). Passing functions, classes, or cyclic structures will fail serialization.",
    forbiddenConditions: ["Server Action definitions with non-serializable arguments or return signatures."],
    detectionStrategy: ["Analyze Server Action argument types and return annotations for non-serializable structures."],
    productionRisks: [
      "Network execution failures and payload delivery crashes",
      "Uncaught serialization runtime exceptions on the server and client"
    ],
    quickFix: [
      "Use plain JavaScript objects, database IDs, or FormData for all action parameters and return structures"
    ],
    architectureGuidance: [
      "Design Server Action boundaries to consume and return simple DTOs (Data Transfer Objects) and simple primitives"
    ]
  },
  "SA-READ-ACTION-001": {
    id: "SA-READ-ACTION-001",
    semanticEvent: "CACHE_CONFLICT_DETECTED",
    phase: "action",
    concept: "server-actions",
    problem: "Server Actions should be reserved for data mutations, not simple read operations.",
    whyItMatters: "Using Server Actions for data queries (like functions starting with get/fetch/read) bypasses Next.js page caching and routing optimization pipelines. Reads should be handled in Server Components directly or via API routes.",
    forbiddenConditions: ["Server Action naming conventions indicating query/read behavior (starts with 'get', 'fetch', 'read') and lack of database/side-effect writes."],
    detectionStrategy: ["Scan action names for prefix match and check for missing mutate or validation patterns."],
    productionRisks: [
      "Bypassing cache systems leading to excessive database strain",
      "Slow, uncacheable query responses on client components"
    ],
    quickFix: [
      "Convert the data read into a Server Component async fetch, or use standard caching route handlers"
    ],
    architectureGuidance: [
      "Reserve Server Actions strictly for state mutations (POST-like writes). Keep queries inside the React Server Component render tree"
    ]
  },
  "SA-VALIDATION-001": {
    id: "SA-VALIDATION-001",
    semanticEvent: "SERVER_ACTION_UNSAFE_INPUT",
    phase: "action",
    concept: "server-actions",
    problem: "Server Actions must validate all input payloads using a schema validation library (Zod, Yup, or Valibot).",
    whyItMatters: "Server Actions accept raw user input from the client. Without strict schema validation, actions are vulnerable to malformed input, database injection attacks, and application crashes.",
    forbiddenConditions: ["Lack of schema verification calls (e.g., parse, safeParse, validate) inside the action execution body."],
    detectionStrategy: ["Scan Server Action code for validation library calls or schema definitions."],
    productionRisks: [
      "SQL/NoSQL database injection vulnerabilities",
      "Database corruption and invalid states from unvalidated types",
      "Uncaught server runtime crashes due to unexpected object shapes"
    ],
    quickFix: [
      "Define a Zod schema and parse the input arguments at the beginning of the action"
    ],
    architectureGuidance: [
      "Always validate input at the trust boundary. Client-side validation is a UX enhancement, server-side validation is a security requirement"
    ]
  },
  "SA-ROUTE-HANDLER-001": {
    id: "SA-ROUTE-HANDLER-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "server",
    concept: "server-actions",
    problem: "Route Handlers should not be used for mutating operations (like POST, PUT, DELETE) if Server Actions can be used.",
    whyItMatters: "Next.js Server Actions automatically handle CSRF protection, cache revalidation, and state transition syncing, which are manual and error-prone to implement in custom Route Handlers.",
    forbiddenConditions: ["Defining custom Route Handlers with mutating HTTP verbs when a Server Action is more appropriate."],
    detectionStrategy: ["Match POST, PUT, DELETE exports in route.ts/route.js files."],
    productionRisks: [
      "Vulnerability to CSRF attacks",
      "State sync mismatch between browser and server router state"
    ],
    quickFix: [
      "Refactor the HTTP route handler mutation into a Server Action"
    ],
    architectureGuidance: [
      "Use Server Actions for all user-initiated state transitions, reserving Route Handlers for external API integrations (webhook endpoints, public APIs)"
    ]
  },
  "SA-BROWSER-API-001": {
    id: "SA-BROWSER-API-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "action",
    concept: "server-actions",
    problem: "Browser-only globals (like localStorage, window, navigator, etc.) cannot be accessed inside Server Actions.",
    whyItMatters: "Server Actions execute exclusively in the Node.js/Edge server runtime. There is no browser context, DOM, or Web API. Calling browser APIs inside a Server Action will cause a ReferenceError during execution.",
    forbiddenConditions: ["Reference to browser globals inside a Server Action function body."],
    detectionStrategy: ["Identify browser API identifiers used within Server Actions."],
    productionRisks: [
      "ReferenceError at runtime during Server Action execution",
      "Failed action execution returning 500 server error to the client"
    ],
    quickFix: [
      "Remove browser API access from the Server Action",
      "Pass the required browser-only data as an argument from the Client Component caller"
    ],
    architectureGuidance: [
      "Keep Server Actions purely server-centric — consume all client context explicitly as input arguments",
      "Retrieve browser state (e.g. cookies, headers, local storage) in the client before initiating the Server Action call"
    ]
  },
  "HY-NON-DETERMINISTIC-001": {
    id: "HY-NON-DETERMINISTIC-001",
    semanticEvent: "HYDRATION_UNSTABLE_RENDER",
    phase: "render",
    concept: "client-components",
    problem: "Non-deterministic functions (like Math.random, Date.now) accessed during top-level render of components cause hydration mismatches.",
    whyItMatters: "Client components pre-render to HTML on the server. If a component generates a random value or reads the current timestamp during render, the server-generated HTML and the browser's first render will mismatch, leading to hydration errors.",
    forbiddenConditions: ["Calling Math.random(), Date.now(), or other non-deterministic APIs directly inside the render path of a component."],
    detectionStrategy: ["Scan React component render bodies for direct calls to Math.random(), Date.now(), or construction of new Date()."],
    productionRisks: [
      "Hydration mismatches causing visual flickers",
      "React discarding pre-rendered server DOM, hurting LCP/CLS performance metrics"
    ],
    quickFix: [
      "Wrap the non-deterministic calculation in useEffect or useMemo with a static fallback",
      "Move the calculation to page/layout level and pass down as props"
    ],
    architectureGuidance: [
      "Ensure all rendering functions are pure and deterministic. Side effects and dynamic browser values must be loaded after hydration."
    ]
  },
  "HY-RENDER-MUTATION-001": {
    id: "HY-RENDER-MUTATION-001",
    semanticEvent: "BOUNDARY_VIOLATION_DETECTED",
    phase: "render",
    concept: "client-components",
    problem: "State mutations or external writes inside the render body of a component violate React's pure rendering model.",
    whyItMatters: "React component rendering must be pure. Modifying variables outside the component scope or mutating props during the render pass causes bugs, inconsistent states, and breaks React's performance optimizations.",
    forbiddenConditions: ["Directly mutating props or assigning to variables declared outside the component function during rendering."],
    detectionStrategy: ["Identify assignment operations to outer scope variables or properties of props inside a React component render body."],
    productionRisks: [
      "Race conditions and UI state bugs",
      "Intermittent render caching issues",
      "Hydration mismatches and broken application state"
    ],
    quickFix: [
      "Move the side-effect / write into a useEffect callback",
      "Pass modifications back to the parent component using a state callback"
    ],
    architectureGuidance: [
      "Rendering is a pure calculation. All side effects (API calls, state updates, routing, external mutations) belong in event handlers or useEffect hooks."
    ]
  },
  "DF-001": {
    id: "DF-001",
    semanticEvent: "FETCH_CACHE_MISCONFIGURATION",
    phase: "render",
    concept: "data-fetching",
    problem: "Explicit Fetch Cache Strategy Missing: fetch() requests are not cached by default in modern Next.js. Without explicit cache settings, every render hits the network, bypassing the Data Cache.",
    whyItMatters: "Without explicit caching, every incoming request triggers a fresh fetch to the upstream data source. At scale, this means O(requests * data_sources) upstream calls, increasing latency, cost, and the risk of rate-limiting by external APIs. Prerendering opportunities are lost when data is not cacheable.",
    forbiddenConditions: ["Assuming fetch() is cached without explicitly setting cache: 'force-cache' or next.revalidate"],
    detectionStrategy: ["Identify fetch calls in Server Components for lack of explicit cache or next.revalidate options."],
    productionRisks: [
      "Excessive upstream API calls leading to rate limiting",
      "High database load from uncached queries",
      "Increased latency for every page request",
      "Higher infrastructure costs",
      "Loss of static prerendering benefits"
    ],
    quickFix: [
      "Add { cache: 'force-cache' } to fetch calls for stable data",
      "Add { next: { revalidate: 3600 } } for hourly revalidation",
      "Add 'use cache' to data functions or components that should be cached"
    ],
    architectureGuidance: [
      "Establish a team convention: every data-fetching function must document its cache strategy in a comment",
      "Create a central data access layer where caching decisions are co-located with the data fetching logic"
    ]
  },
  "RSC_API_VIOLATION-002": {
    id: "RSC_API_VIOLATION-002",
    semanticEvent: "RENDER_PHASE_SERVER_API_ACCESS",
    phase: "render",
    concept: "caching",
    problem: "revalidateTag() and revalidatePath() can only be called from Server Actions or Route Handlers, not from Server Component render functions.",
    whyItMatters: "Calling revalidation functions during render creates a feedback loop: rendering triggers revalidation, which triggers re-rendering. This is prevented by Next.js, but attempting it causes errors. Proper cache invalidation is always event-driven (user action, webhook, scheduled job), not render-driven.",
    forbiddenConditions: [
      "revalidateTag() inside a Server Component body",
      "revalidatePath() inside a Server Component body",
      "revalidateTag() inside a Client Component",
      "revalidatePath() inside a useEffect",
      "Calling revalidation during a GET Route Handler in response to read operations"
    ],
    detectionStrategy: ["Find revalidateTag or revalidatePath calls in the render body of a Server Component."],
    productionRisks: [
      "Runtime errors blocking page rendering",
      "Infinite revalidation loops degrading server performance",
      "Stale data served if revalidation is called in the wrong context and silently fails"
    ],
    quickFix: [
      "Move the revalidateTag() call into the Server Action that performs the mutation",
      "For webhooks, create a POST Route Handler that calls revalidateTag()"
    ],
    architectureGuidance: [
      "Define cache tags that map to business entities (e.g., 'product', 'user', 'post') and tag all fetches for that entity, enabling surgical invalidation with a single revalidateTag() call"
    ]
  },
  "DYNAMIC_RENDER_TRIGGER-003": {
    id: "DYNAMIC_RENDER_TRIGGER-003",
    semanticEvent: "RENDER_PHASE_SERVER_API_ACCESS",
    phase: "render",
    concept: "caching",
    problem: "Using runtime APIs (cookies(), headers(), searchParams) in a Server Component without Suspense wrapping causes the entire route to be dynamically rendered, disabling Full Route Cache (static HTML prerendering).",
    whyItMatters: "Static routes are prerendered at build time and served from CDN with zero server compute cost. A single call to cookies() or headers() at the top level of a page forces every request to go to the server and re-render. This increases cost, latency, and server load at scale.",
    forbiddenConditions: [
      "Calling cookies() at the top level of a layout.tsx (opts the entire app into dynamic rendering)",
      "Calling headers() directly in a Server Component that could otherwise be static",
      "Accessing searchParams directly in page.tsx without Suspense wrapping",
      "Using dynamic route params without generateStaticParams when static generation is desired"
    ],
    detectionStrategy: ["Scan for cookies() or headers() calls in page or layout files outside of a Suspense boundary."],
    productionRisks: [
      "Entire app rendered dynamically because cookies() is called in root layout",
      "Loss of CDN cacheability for routes that could be static",
      "Increased server costs proportional to traffic",
      "Higher TTFB for every request compared to a CDN-cached static response"
    ],
    quickFix: [
      "Move cookies()/headers() calls from layout.tsx to a child component wrapped in <Suspense>",
      "Extract the dynamic section into a separate component and wrap with <Suspense fallback={...}>"
    ],
    architectureGuidance: [
      "Adopt a PPR-first architecture: design every page as a static shell with dynamic holes wrapped in Suspense",
      "Treat dynamic rendering as an explicit opt-in, not the default"
    ]
  },
  "DYNAMIC_RENDER_TRIGGER-004": {
    id: "DYNAMIC_RENDER_TRIGGER-004",
    semanticEvent: "CACHE_CONFLICT_DETECTED",
    phase: "render",
    concept: "caching",
    problem: "The client-side Router Cache stores RSC Payload for visited routes and prefetched pages. After a Server Action mutation, the Router Cache may continue serving stale data on client-side navigation until it expires or is explicitly invalidated.",
    whyItMatters: "The Router Cache is an in-memory client-side cache with a minimum 30-second stale time enforced by the client router. Mutations performed via Server Actions automatically invalidate the Data Cache and Full Route Cache, but the Router Cache requires a full page reload or explicit revalidation to clear, potentially showing stale data to users navigating between routes.",
    forbiddenConditions: [
      "Expecting Router Cache to update immediately after revalidatePath() in a Route Handler",
      "Relying on automatic Router Cache expiration for time-critical UX updates",
      "Using router.refresh() as the primary solution for all stale data issues instead of proper revalidation"
    ],
    detectionStrategy: ["Analyze routes and components for lack of manual router.refresh() or proper Server Action redirecting/revalidation after mutations."],
    productionRisks: [
      "Users see stale data after mutations when navigating back to a page",
      "Confusing UX: a user creates a post, navigates back, and does not see it",
      "Difficult-to-reproduce bugs dependent on navigation history"
    ],
    quickFix: [
      "Add router.refresh() in Client Components after a mutation that must be reflected immediately",
      "Call revalidatePath() from the Server Action after the mutation"
    ],
    architectureGuidance: [
      "Design mutation flows as: Server Action → mutate data → revalidateTag() → redirect() to fresh route for guaranteed cache coherence"
    ]
  },
  "RSC_API_VIOLATION-005": {
    id: "RSC_API_VIOLATION-005",
    semanticEvent: "CACHE_CONFLICT_DETECTED",
    phase: "render",
    concept: "caching",
    problem: "When cacheComponents: true is enabled, accessing uncached or runtime data outside of a <Suspense> boundary or 'use cache' scope causes a build-time error: 'Uncached data was accessed outside of Suspense'.",
    whyItMatters: "With Cache Components, Next.js enforces explicit handling of all data access patterns at build time. Any component that accesses non-deterministic or runtime data must either cache it ('use cache') or stream it (Suspense). This prevents accidental dynamic rendering of what should be static routes.",
    forbiddenConditions: [
      "Accessing cookies(), headers(), or searchParams outside of a <Suspense> boundary without 'use cache'",
      "Calling fetch() without 'use cache' and without Suspense wrapping",
      "Querying a database without 'use cache' and without Suspense wrapping",
      "Placing a <Suspense> with an empty fallback (null) at the root layout body"
    ],
    detectionStrategy: ["Scan components under cacheComponents: true mode for uncached runtime data access outside Suspense or 'use cache' context."],
    productionRisks: [
      "Build failures blocking deployment",
      "Accidental full-page dynamic rendering when only a portion needed to be dynamic",
      "Performance regression from losing the static shell on routes that should be mostly static"
    ],
    quickFix: [
      "Wrap the component accessing runtime data in <Suspense fallback={<Loading />}>",
      "Add 'use cache' to the function accessing the data if it is safe to cache"
    ],
    architectureGuidance: [
      "Architect pages as: static header (no Suspense needed) + cached dynamic content ('use cache' components) + runtime user content (Suspense + streaming)"
    ]
  },
  "DF-008": {
    id: "DF-008",
    semanticEvent: "CLIENT_SIDE_DATA_FETCHING",
    phase: "render",
    concept: "data-fetching",
    problem: "Fetching initial page data in Client Components via useEffect or third-party libraries (SWR, TanStack Query) on mount creates a client-side waterfall: the HTML loads, JavaScript executes, then the data fetch begins, resulting in a blank or skeleton state that users must wait through.",
    whyItMatters: "Server Components can fetch data before sending any HTML to the browser. By the time the user sees the page, data is already rendered. Client-side initial data fetching means users always see a loading state on first visit, degrading LCP and perceived performance. It also prevents static prerendering of the data.",
    forbiddenConditions: [
      "useEffect(() => { fetch('/api/data').then(setData) }, []) for initial page data",
      "SWR or TanStack Query for data that is available at render time and does not change via user interaction",
      "Fetching data in Client Components when a parent Server Component could fetch it instead",
      "Using getServerSideProps-style API Route fetching patterns in the App Router"
    ],
    detectionStrategy: ["Identify useEffect or SWR/TanStack Query usage for data fetching in Client Components that are not driven by explicit user interaction."],
    productionRisks: [
      "Degraded LCP from client-side data loading waterfalls",
      "Flash of loading state on every page visit",
      "Loss of prerendering and CDN caching for data",
      "Unnecessary client JavaScript for data fetching libraries"
    ],
    quickFix: [
      "Move the fetch() call to the parent Server Component and pass data as props",
      "Make the page component async and await the data directly"
    ],
    architectureGuidance: [
      "Establish a rule: initial data is always fetched server-side. Client-side fetching is for subsequent mutations and real-time updates only."
    ]
  },
  "DF-002": {
    id: "DF-002",
    semanticEvent: "REQUEST_DEDUPLICATION_OPPORTUNITY",
    phase: "render",
    concept: "data-fetching",
    problem: "When multiple Server Components in the same render tree need the same data (e.g., user session, product details), each component calling the data source independently results in duplicate database queries or API calls within a single request.",
    whyItMatters: "React automatically memoizes fetch() requests with the same URL and options within a render pass. But for ORM queries, database clients, and custom async functions, no deduplication occurs by default. Without React.cache(), the same database query may execute dozens of times per request in a complex component tree.",
    forbiddenConditions: [
      "Calling the same database query function in multiple components without React.cache() wrapping",
      "Fetching the same user session in every component that needs it",
      "Prop-drilling data from a top-level component to avoid duplicate fetches"
    ],
    detectionStrategy: ["Match database or custom async function calls that are duplicated across components without React.cache() memoization."],
    productionRisks: [
      "N×M database queries per request where N is the number of components and M is the number of shared data sources",
      "Database connection pool exhaustion under load",
      "Increased latency from redundant upstream calls"
    ],
    quickFix: [
      "import { cache } from 'react'; then wrap the data function: export const getData = cache(async (id) => { ... })"
    ],
    architectureGuidance: [
      "Build a Data Access Layer (lib/dal.ts) where every exported function is wrapped with React.cache() and import 'server-only', creating a safe, deduplicating, server-only data interface"
    ]
  },
  "DF-003": {
    id: "DF-003",
    semanticEvent: "INTERNAL_API_ROUTE_CALL",
    phase: "render",
    concept: "data-fetching",
    problem: "Server Components calling internal Route Handlers (fetch('/api/...')) to load data creates an unnecessary HTTP roundtrip through the network stack on the same server.",
    whyItMatters: "A Server Component calling its own Route Handler sends an HTTP request from the server back to itself (or to another server instance in distributed deployments). This adds network latency, bypasses the database connection pool optimization, and prevents prerendering. The correct approach is to call the data access function directly.",
    forbiddenConditions: [
      "fetch('/api/users') inside a Server Component",
      "fetch('/api/products') inside a Server Component when a direct DB call is available",
      "Using Route Handlers as an abstraction layer between Server Components and data sources"
    ],
    detectionStrategy: ["Check fetch calls in Server Components where the URL matches an internal API route starting with '/api/'."],
    productionRisks: [
      "Unnecessary HTTP roundtrip latency (10-100ms overhead per call)",
      "Loss of prerendering capability",
      "Increased server load from loopback requests",
      "Connection pool waste"
    ],
    quickFix: [
      "Replace fetch('/api/data') with direct import and call of the data access function"
    ],
    architectureGuidance: [
      "Structure: Server Component → calls DAL function → queries DB. Not: Server Component → fetch('/api') → Route Handler → calls DAL → queries DB."
    ]
  },
  "DF-004": {
    id: "DF-004",
    semanticEvent: "CACHE_CONFLICT_DETECTED",
    phase: "render",
    concept: "data-fetching",
    problem: "Database queries, ORM calls, and custom async functions do not benefit from Next.js's extended fetch() caching. Without explicit caching via 'use cache' (Cache Components model) or unstable_cache (legacy model), these operations run on every request.",
    whyItMatters: "fetch() is automatically extended by Next.js to participate in the Data Cache. ORM queries (Prisma, Drizzle, TypeORM) and database clients (pg, mysql2) are plain JavaScript calls with no inherent caching. They must be explicitly wrapped to gain persistent caching across requests.",
    forbiddenConditions: [
      "ORM queries in Server Components without 'use cache' or unstable_cache when the data is suitable for caching",
      "Database queries running on every request for data that changes infrequently",
      "Omitting cacheTag() on cached functions that need on-demand invalidation"
    ],
    detectionStrategy: ["Match ORM or direct database queries inside Server Components that do not use any caching wrappers (unstable_cache, 'use cache')."],
    productionRisks: [
      "Database overload from uncached queries under production traffic",
      "High latency from per-request database calls for static content",
      "Missed ISR opportunities for content that changes infrequently"
    ],
    quickFix: [
      "Add 'use cache' and cacheLife() to ORM query functions in the DAL",
      "Wrap with unstable_cache() for the legacy model"
    ],
    architectureGuidance: [
      "Co-locate caching decisions with data access functions in the DAL: each function declares its cache strategy and tags"
    ]
  },
  "DF-005": {
    id: "DF-005",
    semanticEvent: "SEQUENTIAL_FETCH_WATERFALL",
    phase: "render",
    concept: "data-fetching",
    problem: "When one piece of data depends on another (sequential dependency), but other independent data can be fetched in parallel, failing to initiate parallel fetches early causes the overall response to be slower than necessary.",
    whyItMatters: "JavaScript's async model allows initiating multiple promises before awaiting any of them. The preload pattern kicks off data fetching before any blocking await, allowing parallel execution even when some sequential logic exists. Missing this optimization causes request waterfalls where sequential awaits compound latency.",
    forbiddenConditions: [
      "Awaiting sequential fetches when later fetches could start earlier",
      "Not starting data fetches until after conditional logic completes when the condition does not affect the data"
    ],
    detectionStrategy: ["Identify independent fetch calls in a single Server Component that are awaited sequentially instead of being fetched in parallel (Promise.all) or preloaded."],
    productionRisks: [
      "Unnecessary request latency from sequential data loading that could be parallel",
      "P99 latency degradation on pages with multiple data dependencies"
    ],
    quickFix: [
      "Replace: const a = await fetchA(); const b = await fetchB() With: const [a, b] = await Promise.all([fetchA(), fetchB()])"
    ],
    architectureGuidance: [
      "Establish a convention: data dependencies at the top of Server Components are always declared before any await, using Promise.all() for independent fetches"
    ]
  },
  "RO-001": {
    id: "RO-001",
    semanticEvent: "INVALID_ROUTING_FILE_STRUCTURE",
    phase: "server",
    concept: "routing",
    problem: "Placing utility files, test files, or components directly in dynamic routing directories can confuse the bundler or cause route resolution errors if named incorrectly.",
    whyItMatters: "Next.js enforces strict routing rules. Any folder containing a `route.ts` or `page.tsx` defines an addressable route. Exposing other files in these folders can accidentally expose internal routes if they match the framework pattern, or lead to deployment bundling inflation.",
    forbiddenConditions: [
      "Placing internal components directly inside route folders without prefixing them with an underscore or keeping them in separate components folder",
      "Co-locating route.ts and page.tsx inside the exact same routing folder segment"
    ],
    detectionStrategy: ["Check app/ directory segments containing page/layout files for presence of files that do not follow Next.js routing patterns or aren't prefixed with underscore."],
    productionRisks: [
      "Conflicting route resolutions resulting in 404 or 500 errors",
      "Exposure of internal utility functions as public API endpoints",
      "Increased bundler payload from unorganized routing files"
    ],
    quickFix: [
      "Move nested component files to an external components/ folder, or rename the local folder prefix to an underscore (_components)"
    ],
    architectureGuidance: [
      "Keep the app/ folder lightweight, holding only routing folders and route-specific layouts/pages, while keeping structural components elsewhere"
    ]
  },
  "RO-002": {
    id: "RO-002",
    semanticEvent: "CO_LOCATED_PAGE_AND_ROUTE_HANDLER",
    phase: "server",
    concept: "routing",
    problem: "Creating a route.ts (or route.js) and a page.tsx (or page.js) inside the exact same directory will crash the compiler or cause route mismatches during execution.",
    whyItMatters: "Next.js App Router treats route.ts files as raw HTTP dynamic endpoints (handling GET, POST, DELETE, etc.) and page.tsx files as component rendering targets. If both exist in the same route folder, Next.js cannot determine whether to render HTML or serve JSON. It will throw a compilation error or ignore one of them entirely.",
    forbiddenConditions: ["Creating app/api/items/page.tsx and app/api/items/route.ts together inside the items/ directory"],
    detectionStrategy: ["Identify folders inside the app router directory that contain both a page file and a route file."],
    productionRisks: [
      "Build compilation failures blocking deployments",
      "Server routing crashing during dynamic API requests",
      "Total loss of page or API route access in production environments"
    ],
    quickFix: [
      "Move the route.ts file out of the page.tsx folder, typically into a dedicated app/api/... segment"
    ],
    architectureGuidance: [
      "Use Server Actions inside pages/components for mutations instead of route handlers, completely eliminating the need for co-located route.ts API endpoints"
    ]
  },
  "RO-003": {
    id: "RO-003",
    semanticEvent: "MISSING_PARALLEL_ROUTE_DEFAULT",
    phase: "render",
    concept: "routing",
    problem: "Omitting a default.tsx (or default.jsx) fallback file inside Parallel Route slots (@slot) will cause 404 errors during clientside page reload or navigation.",
    whyItMatters: "During client-side navigation, Next.js keeps track of currently rendered parallel slots. However, on a full browser page refresh (reload), Next.js cannot retrieve the previous slot state. If it cannot find a corresponding `default.tsx` file for that parallel route slot at the current sub-URL, it immediately crashes and serves a 404. Defining a default fallback layout is mandatory to ensure navigation robustness.",
    forbiddenConditions: ["Defining parallel slots (e.g. @analytics) under layout folders without providing a sibling default.tsx file"],
    detectionStrategy: ["Find Parallel Route slot folders (@name) that have a page.tsx but no default.tsx file."],
    productionRisks: [
      "Users experiencing unexpected 404 page crashes on reload",
      "Incomplete routing state transitions during deep link share clicks",
      "Critical dashboard layouts failing to load under specific client-side navigations"
    ],
    quickFix: [
      "Create a default.tsx file in your parallel slot directory that returns null or a matching structural loader component"
    ],
    architectureGuidance: [
      "Build parallel route slots with complete layout boundaries (holding layout, page, and default files) to ensure seamless independent rendering capability"
    ]
  },
  "DF-006": {
    id: "DF-006",
    semanticEvent: "DUPLICATE_DATA_REQUEST",
    phase: "render",
    concept: "data-fetching",
    problem: "The same data-fetching function is called multiple times in the same Server Component render pass, executing the same database query or API call redundantly.",
    whyItMatters: "React Request Memoization automatically deduplicates fetch() calls with identical URLs within a single render pass. But for ORM queries and custom async functions, no automatic deduplication exists. Calling getUsers() twice in the same component issues two separate database queries. Wrapping the source function with React.cache() makes it return the same in-memory result for all calls within one request lifecycle.",
    forbiddenConditions: [
      "Calling the same database access function more than once in a single component",
      "Calling the same data helper in both a layout and a page without React.cache() on the source"
    ],
    detectionStrategy: ["Count await CallExpression occurrences within a single async function body and flag callee names appearing 2+ times."],
    productionRisks: [
      "N× database round-trips per render where N is the number of duplicate calls",
      "Database connection pool pressure under load",
      "Increased per-request latency proportional to duplication depth"
    ],
    quickFix: [
      "Wrap the source function with React.cache(): import { cache } from 'react'; export const getUsers = cache(async () => { ... })"
    ],
    architectureGuidance: [
      "Build a Data Access Layer (lib/dal.ts) where every exported function is wrapped with React.cache() — calls are deduplicated per-request automatically"
    ]
  },
  "DF-007": {
    id: "DF-007",
    semanticEvent: "CLIENT_SERVER_DATA_REFETCH",
    phase: "render",
    concept: "data-fetching",
    problem: "A Client Component performs a client-side fetch to retrieve data that its parent Server Component has already fetched and could have passed down as props.",
    whyItMatters: "When a Server Component already holds the data, passing it via props is zero network cost — the data is serialized into the RSC payload and sent once. Re-fetching client-side adds a full HTTP roundtrip, creates a client-side loading state, bypasses server caching, and doubles the database load for this data.",
    forbiddenConditions: [
      "useEffect(() => fetch('/api/users'), []) in a Client Component whose parent Server Component already calls getUsers()",
      "SWR or React Query for data that the parent Server Component already owns"
    ],
    detectionStrategy: ["Match client-side fetch URLs against data-fetching function names in parent Server Component via import graph edges and semantic name matching."],
    productionRisks: [
      "Visible loading flash on every navigation — users see skeleton state for data that could have been server-rendered",
      "Double database load: once server-side during SSR, once client-side after hydration",
      "Cache bypass: server-fetched data benefits from Next.js Data Cache; client re-fetches do not"
    ],
    quickFix: [
      "Remove the client-side fetch and accept the data as a prop from the parent Server Component",
      "In the Server Component: const data = await getData(); then <ClientComponent data={data} />"
    ],
    architectureGuidance: [
      "Architectural rule: Server Components own and fetch data. Client Components display data passed as props. The handoff point is always explicit props, never a re-fetch."
    ]
  },
  "CA-006": {
    id: "CA-006",
    semanticEvent: "STALE_CACHE_TAG",
    phase: "server",
    concept: "caching",
    problem: "A cache tag is applied to a fetch() call via next.tags, but no Server Action or Route Handler anywhere in the project calls revalidateTag() with that tag. The cached data can never be surgically invalidated.",
    whyItMatters: "Cache tags are the foundation of on-demand revalidation in Next.js. A tag without a corresponding revalidateTag() call is dead infrastructure — the cache will hold the data until the full revalidate interval passes or the app is redeployed. Under an ISR or force-cache strategy, this means mutations to the underlying data are never reflected until the cache expires naturally.",
    forbiddenConditions: [
      "fetch(url, { next: { tags: ['users'] } }) with no revalidateTag('users') anywhere in server actions",
      "Defining cache tags in a data access layer without a paired invalidation function in the mutation layer"
    ],
    detectionStrategy: ["Global scan: extract all declared next.tags across all fetch calls, then diff against the set of all revalidateTag() call arguments across all server action files."],
    productionRisks: [
      "Stale data permanently cached — mutations are never reflected without a full deployment or cache purge",
      "User confusion when data they updated does not appear fresh after actions",
      "Cache dead zones: tags accumulate over time with no invalidation path"
    ],
    quickFix: [
      "Add revalidateTag('tag-name') to the Server Action that mutates the data this tag covers",
      "Create a paired cache tag + revalidation function in your data access layer for every entity type"
    ],
    architectureGuidance: [
      "Adopt a tag-per-entity convention: declare a canonical tag constant (e.g. CACHE_TAGS.users = 'users') and use it in both the fetch and the revalidation — one source of truth"
    ]
  },
  "CA-007": {
    id: "CA-007",
    semanticEvent: "BROAD_CACHE_INVALIDATION",
    phase: "action",
    concept: "caching",
    problem: "revalidatePath('/') or a high-traffic root path is called after a single-entity mutation, invalidating the entire route cache tree when only one specific entity changed.",
    whyItMatters: "revalidatePath('/') marks every cached route in the application as stale. On a site with 1000 cached pages, this forces Next.js to re-render all 1000 pages on the next request. Under high traffic, this creates a cache stampede: all cached responses expire simultaneously, causing a spike of server-side rendering work. The correct approach is to invalidate only the cache entries affected by the specific mutation.",
    forbiddenConditions: [
      "revalidatePath('/') after updating a single database record",
      "revalidatePath('/dashboard') (a high-traffic parent path) after a leaf-node mutation"
    ],
    detectionStrategy: ["Find revalidatePath('/') or broad root-path calls co-located with single-entity mutation patterns (where: { id }, URL with ID segment, update/delete verbs)."],
    productionRisks: [
      "Cache stampede under high traffic: all routes simultaneously miss cache after a mutation",
      "Server CPU spike from N simultaneous page re-renders",
      "Degraded response times for all users during the re-render window"
    ],
    quickFix: [
      "Replace revalidatePath('/') with revalidateTag('entity-type') using a tag applied to the specific data source",
      "Or use revalidatePath('/specific-page') targeting only the affected page"
    ],
    architectureGuidance: [
      "Surgical invalidation rule: the scope of revalidation should match the scope of the mutation — a single record update should invalidate a single cache tag, not the entire route tree"
    ]
  },
  "RO-004": {
    id: "RO-004",
    semanticEvent: "INTERCEPTING_ROUTE_MISCONFIGURATION",
    phase: "server",
    concept: "routing",
    problem: "An intercepting route segment uses (.), (..), or (...) conventions but has no sibling parallel route slot (@slot) in the parent layout to render the intercepted content alongside the current page.",
    whyItMatters: "Intercepting routes work by rendering a route's content inside a parallel slot rather than navigating away. Without a matching @slot in the parent layout.tsx, there is nowhere for the intercepted content to render. Next.js falls back to a full page navigation, completely defeating the purpose of the interception. This is a common source of confusing behavior where modal overlays fail silently.",
    forbiddenConditions: [
      "app/feed/(.)photo/[id]/page.tsx without a sibling app/feed/@modal/ parallel slot",
      "Intercepting route depth mismatch: (..) used when the target is only one level up, not two"
    ],
    detectionStrategy: ["Identify route folders matching the (.), (..), or (...) intercepting route convention and verify a sibling @slot directory exists at the same layout level."],
    productionRisks: [
      "Silent fallback to full-page navigation instead of modal overlay",
      "404 errors when the intercepting route has no rendering destination",
      "Broken UX patterns (photo galleries, modals, sheets) that appear to work in development but fail in production"
    ],
    quickFix: [
      "Create a sibling @modal directory at the same layout level as the intercepting route segment",
      "Add a default.tsx to the @modal slot to handle the non-intercepted state",
      "Update the parent layout.tsx to accept and render the modal slot: function Layout({ children, modal }) { return <>{children}{modal}</> }"
    ],
    architectureGuidance: [
      "Think of intercepting routes as modal-layer routing: the (.) folder is the modal content, the @modal slot is the modal container, and layout.tsx is the portal host"
    ]
  },
  "RO-005": {
    id: "RO-005",
    semanticEvent: "MISSING_SUSPENSE_BOUNDARY",
    phase: "render",
    concept: "streaming",
    problem: "An async Server Component (page.tsx or layout.tsx) awaits data directly in its render body. While this is valid, wrapping the data-dependent section in a Suspense boundary can be a performance opportunity to stream the page shell.",
    whyItMatters: "This is a performance opportunity, not a correctness issue. Streaming is optional and may improve TTFB if the page contains independently loadable sections. If the page only has one main fetch, wrapping it in Suspense is not required and may add unnecessary complexity.",
    forbiddenConditions: [
      "export default async function Page() { const data = await fetchData(); return <Component data={data} />; } — no Suspense wrapping",
      "Multiple independent await calls at the top level of a page component with no Suspense boundaries between them"
    ],
    detectionStrategy: ["Check async page/layout components for direct await expressions in the render body without any <Suspense> usage in the JSX return."],
    productionRisks: [
      "Full TTFB delay equal to the slowest data fetch — users see nothing until all data resolves",
      "Degraded LCP and FCP metrics especially on slow networks or high database load",
      "Loss of streaming capability — one of Next.js's primary performance advantages"
    ],
    quickFix: [
      "Extract the async data-fetching section into a separate async child component",
      "Wrap the extracted component: <Suspense fallback={<Skeleton />}><DataComponent /></Suspense>"
    ],
    architectureGuidance: [
      "Streaming architecture: page.tsx is the static shell. Each independent data dependency is a separate async component wrapped in its own Suspense boundary. They load in parallel and stream independently."
    ]
  },
  "MD-002": {
    id: "MD-002",
    semanticEvent: "DUPLICATE_DATA_REQUEST",
    phase: "render",
    concept: "data-fetching",
    problem: "Duplicate data fetch/query detected between generateMetadata() and the page component.",
    whyItMatters: "Although fetch() is cached by default in Next.js, direct database queries, ORM calls, or un-cached fetches inside generateMetadata() and the page component are not. They will run twice on the server per request, increasing database load and latency. Consider using React.cache() to deduplicate non-fetch data queries.",
    forbiddenConditions: [
      "Fetching or querying the same resource inside generateMetadata and the default exported page component without memoization/caching wrappers."
    ],
    detectionStrategy: [
      "Compare AST nodes or fetch strings inside generateMetadata and the page function body."
    ],
    productionRisks: [
      "Doubled database/API queries per request",
      "Increased server response latency (TTFB)",
      "Redundant server execution overhead"
    ],
    quickFix: [
      "Wrap the custom data fetch in React.cache() so both calls use the same cached Promise."
    ],
    architectureGuidance: [
      "Separate data access into a DAL and wrap exported query methods in React.cache()."
    ]
  },
  "RO-006": {
    id: "RO-006",
    semanticEvent: "LAYOUT_BLOCKING_STREAMING",
    phase: "render",
    concept: "streaming",
    problem: "An async layout component awaits data directly in its render body (e.g. database query, fetch). This blocks all child pages and nested layouts from rendering.",
    whyItMatters: "Unlike leaf pages where blocking on an await only blocks that page's contents, layouts wrap the entire route subtree. When a layout blocks on an await, React cannot render or stream any child pages or nested layouts, completely neutralizing streaming and causing the entire subtree to render only after the layout's data is fully resolved.",
    forbiddenConditions: [
      "export default async function Layout({ children }) { const user = await fetchUser(); return <div>{children}</div>; }"
    ],
    detectionStrategy: ["Identify layout components that await fetches or database queries directly in their render body."],
    productionRisks: [
      "Blocking of all nested pages and layouts until layout fetches resolve.",
      "Severe degradation of TTFB and LCP for the entire route subtree.",
      "Complete elimination of parallel streaming advantages."
    ],
    quickFix: [
      "Move the async data-fetching logic into a separate async component and render it inside layout wrapped in <Suspense>.",
      "Alternatively, use a clientside fetch or retrieve data through cookies/headers inside the page itself if it is request-specific."
    ],
    architectureGuidance: [
      "Layout components should render static shells instantly. Avoid calling await fetch() or awaiting database queries directly inside the layout body. Instead, pass layout-level data fetching into child components wrapped in Suspense."
    ]
  },
  "LAYOUT_AUTH_GATE": {
    id: "LAYOUT_AUTH_GATE",
    semanticEvent: "LAYOUT_BLOCKING_STREAMING",
    phase: "render",
    concept: "streaming",
    problem: "Layout blocks rendering to perform authentication, session, or tenant verification. This is an expected pattern for layouts guarding route access.",
    whyItMatters: "Authentication gates and route guards must resolve user session details before mounting child pages or executing nested subtrees.",
    forbiddenConditions: [],
    detectionStrategy: ["Identify layout components that await authentication, session, or redirect APIs directly in their render body."],
    productionRisks: [],
    quickFix: [
      "No fix needed. This is an expected authentication boundary."
    ],
    architectureGuidance: [
      "Keep layout auth checks focused on route validation. Consider delegating non-sensitive rendering sections to Suspense-wrapped child components."
    ]
  },
  "RO-007": {
    id: "RO-007",
    semanticEvent: "SEQUENTIAL_FETCH_WATERFALL",
    phase: "render",
    concept: "data-fetching",
    problem: "Independent async fetches/database queries are awaited sequentially rather than in parallel.",
    whyItMatters: "Awaiting multiple independent promises sequentially forces the browser or server to resolve them one-by-one, extending rendering latency. Running them in parallel with Promise.all() optimizes loading times.",
    forbiddenConditions: [
      "const user = await fetchUser(); const posts = await fetchPosts();"
    ],
    detectionStrategy: ["Identify independent async expressions in pages/layouts that are awaited sequentially."],
    productionRisks: [
      "Substantially higher TTFB and rendering delays."
    ],
    quickFix: [
      "Use Promise.all() to run independent requests in parallel: const [a, b] = await Promise.all([fetchA(), fetchB()]);"
    ],
    architectureGuidance: [
      "Keep async operations independent and bundle them using Promise.all() or Promise.allSettled()."
    ]
  },
  "CC-HYDRATION-ABUSE-001": {
    id: "CC-HYDRATION-ABUSE-001",
    semanticEvent: "CLIENT_GRAPH_LEAK",
    phase: "render",
    concept: "hydration",
    problem: "Client Component imports large static data file (.json or .csv), which bloats the client bundle and increases hydration time.",
    whyItMatters: "Importing large static files directly into Client Components includes the entire dataset in the clientside JavaScript bundle. This data must be parsed and hydrated on the client, causing severe page load bloat and hydration delay. Server Components should be used to filter or render this data, or it should be loaded on demand.",
    forbiddenConditions: [
      "import largeData from './large.json' inside a 'use client' component"
    ],
    detectionStrategy: ["Scan for relative imports of .json or .csv files inside Client Components and check if file size exceeds 50KB."],
    productionRisks: [
      "Severe bloat of the clientside JavaScript bundle size.",
      "Increased time to interactive (TTI) and hydration delays.",
      "Poor performance on mobile devices due to massive parsing and memory overhead."
    ],
    quickFix: [
      "Move the import to a Server Component parent and pass only the required fields as props.",
      "Load the data dynamically via fetch from an API route.",
      "Move the data file into the public/ folder and fetch it on-demand on the client."
    ],
    architectureGuidance: [
      "Architectural rule: Server Components own and process raw data. Client Components receive filtered props. Raw datasets should never cross the server-client boundary directly via imports."
    ]
  },
  "DF-009": {
    id: "DF-009",
    semanticEvent: "DUPLICATE_DATA_REQUEST",
    phase: "render",
    concept: "data-fetching",
    problem: "Duplicate fetch() calls to the same endpoint detected between generateMetadata() and the page component.",
    whyItMatters: "Although GET fetches may be cached by default, duplicate fetch statements inside generateMetadata() and the Page component lead to redundant network queries if cache options are bypassed (e.g. no-store) or code logic is changed. Using shared fetchers or React cache() ensures complete safety and cleaner architecture.",
    forbiddenConditions: [
      "Calling fetch('api/endpoint') inside generateMetadata and again inside the default exported Page component."
    ],
    detectionStrategy: ["Compare fetch URLs inside generateMetadata and the page function body."],
    productionRisks: [
      "Redundant server API calls under uncached fetch setups.",
      "Maintenance complexity from duplicate fetch configurations.",
      "Potential request waterfall/latency when caching is bypassed."
    ],
    quickFix: [
      "Wrap the fetch in React.cache() or use a shared fetcher function to clean up the duplicate calls."
    ],
    architectureGuidance: [
      "Keep dynamic fetch queries inside a centralized module, using React.cache() or unstable_cache() to share fetching promises across metadata extraction and page render phases."
    ]
  },
  "DF-010": {
    id: "DF-010",
    semanticEvent: "DUPLICATE_DATA_REQUEST",
    phase: "render",
    concept: "data-fetching",
    problem: "Cross-route duplicate fetch() calls to the same endpoint detected across parent layouts and nested child routes.",
    whyItMatters: "Layouts and child components render within the same request path. Running duplicate fetch queries across layout and page components results in redundant network queries if cache headers are ignored or request memoization is bypassed. Placing these queries in a shared module wrapped with React.cache() guarantees request-level deduplication.",
    forbiddenConditions: [
      "A parent layout and a child route fetch the exact same URL during the same request cycle."
    ],
    detectionStrategy: ["Track parent layout and child page fetch calls and flag matching endpoint requests."],
    productionRisks: [
      "Unnecessary server load and network duplication during initial render phases.",
      "Potential data synchronization issues between layout and child views."
    ],
    quickFix: [
      "Move duplicate fetching logic to a shared helper wrapped in React.cache()."
    ],
    architectureGuidance: [
      "Always locate shared fetching queries inside a memoized utility so layouts and child components share the exact same promise."
    ]
  }
};


export function mapEventToDiagnostic(
  event: SemanticEvent,
  constraintId: string,
  ruleId: string,
  file: string,
  line: number | undefined,
  details: string,
  isGuarded: boolean = false,
  column?: number,
  endColumn?: number
): Diagnostic {
  const constraint = ATOMIC_CONSTRAINTS[constraintId];
  if (!constraint) {
    throw new Error(`Constraint not found: ${constraintId}`);
  }

  const ERROR_CONSTRAINTS = new Set([
    // Server Component hard violations
    "SC-BROWSER-API-001", "SC-HOOK-USAGE-001", "SC-EVENT-HANDLER-001",
    // Client Component hard violations  
    "CC-ASYNC-CLIENT-001", "CC-RUNTIME-LEAK-001", "CC-SERVER-IMPORT-001",
    // Cache API misuse
    "RSC_API_VIOLATION-002", "RSC_API_VIOLATION-005",
    // Data fetching — loopback network call
    "DF-003",
    // Routing hard violations
    "RO-002", "RO-003",
    // Client re-fetch is always wrong when server data exists
    "DF-007",
  ]);
  const baseSeverity = ERROR_CONSTRAINTS.has(constraint.id) ? "error" : "warning";

  return {
    file,
    line,
    column,
    endColumn,
    severity: isGuarded ? "warning" : baseSeverity,
    ruleId,
    id: constraint.id,
    message: details,
    whyItMatters: constraint.whyItMatters,
    quickFixes: constraint.quickFix,
    architectureSuggestions: constraint.architectureGuidance,
    optimizationGuidance: [],
    productionRisks: constraint.productionRisks,
    fix: constraint.quickFix[0],
    isGuarded
  };
}
