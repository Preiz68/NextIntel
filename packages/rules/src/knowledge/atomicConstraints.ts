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
  | "BOUNDARY_VIOLATION_DETECTED";

export interface AtomicConstraint {
  id: string;
  semanticEvent: SemanticEvent;
  phase: "render" | "effect" | "event" | "server" | "action";
  concept: "server-components" | "client-components" | "server-actions";
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
  }
};


export function mapEventToDiagnostic(
  event: SemanticEvent,
  constraintId: string,
  ruleId: string,
  file: string,
  line: number | undefined,
  details: string,
  isGuarded: boolean = false
): Diagnostic {
  const constraint = ATOMIC_CONSTRAINTS[constraintId];
  if (!constraint) {
    throw new Error(`Constraint not found: ${constraintId}`);
  }

  const baseSeverity = constraint.id.startsWith("SC-") || constraint.id.startsWith("CC-") ? "error" : "warning";

  return {
    file,
    line,
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
