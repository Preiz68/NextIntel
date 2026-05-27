import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";
import { getFileCapabilityProfile, checkCapabilitySatisfaction } from "../registry/runtime-capability-registry.js";

export const noServerApiInClientComponents: Rule = {
  id: "no-server-api-in-client-components",

  meta: {
    description:
      "Server-only Next.js APIs cannot be used in Client Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isClient = analysis.isClientComponent || analysis.executionModel.componentType === "client";
      if (!isClient) continue;

      const profile = getFileCapabilityProfile(analysis);

      for (const t of analysis.taints || []) {
        if (t.state === "CLEAN") continue;
        const { satisfied, missing } = checkCapabilitySatisfaction(profile, t.type);
        if (!satisfied) {
          const messageText = t.derived
            ? `Client bundle contaminated by server-only dependency chain: imported '${t.source}' which requires ${missing.join(", ")}.`
            : `Server-only API or module requiring ${missing.join(", ")} (e.g. from '${t.source}') is imported or used in a Client Component.`;
          
          const diag = mapEventToDiagnostic(
            "RENDER_PHASE_SERVER_API_ACCESS",
            "CC-RUNTIME-LEAK-001",
            this.id,
            analysis.filePath,
            t.line,
            messageText
          );
          if (t.originFile) {
            (diag as any).originFile = t.originFile;
          }

          // Generate safe refactor suggestions based on the type of capability leak
          if (t.type === "REQUEST_CONTEXT") {
            diag.safeRefactorSuggestion = `// Enforce unidirectional data flow. Access request context APIs on the Server and pass results down:
// 1. Parent Server Component (page.tsx):
import { cookies } from "next/headers";
import ClientComponent from "./ClientComponent";

export default function Page() {
  const theme = cookies().get("theme")?.value;
  return <ClientComponent initialTheme={theme} />;
}

// 2. Client Component (ClientComponent.tsx):
'use client';
export default function ClientComponent({ initialTheme }: { initialTheme: string | undefined }) {
  return <div>Theme: {initialTheme}</div>;
}`;
          } else if (t.type === "NODE_NATIVE_API" || t.type === "SERVER_ONLY") {
            diag.safeRefactorSuggestion = `// Server-only APIs cannot run in the browser bundle. Fetch the data in a Server Component:
// 1. Parent Server Component (page.tsx):
import { getDbData } from "./server/db";
import ClientComponent from "./ClientComponent";

export default function Page() {
  const data = await getDbData();
  return <ClientComponent initialData={data} />;
}

// 2. Client Component (ClientComponent.tsx):
'use client';
export default function ClientComponent({ initialData }: { initialData: any }) {
  return <div>Data: {JSON.stringify(initialData)}</div>;
}`;
          } else {
            diag.safeRefactorSuggestion = `// Move the server-only dependency execution into a Server Action or API Route:
// 1. Server Action (actions.ts):
'use server';
export async function performServerOperation() {
  // Safe server-only code here
  return { success: true };
}

// 2. Client Component (ClientComponent.tsx):
'use client';
import { performServerOperation } from "./actions";

export default function ClientComponent() {
  const handleClick = async () => {
    const res = await performServerOperation();
    console.log(res);
  };
  return <button onClick={handleClick}>Run Server Operation</button>;
}`;
          }

          diagnostics.push(diag);
        }
      }
    }

    return diagnostics;
  },
};

