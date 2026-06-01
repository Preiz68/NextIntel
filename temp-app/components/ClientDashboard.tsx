// ======================================================
// FILE: app/components/ClientDashboard.tsx
// ======================================================

"use client";

import { getRequestData } from "../server-utils";
import ServerDashboard from "./ServerDashboard";
import { getClientTheme } from "../client-utils";

// ❌ async client component
export default async function ClientDashboard({
  theme,
}: {
  theme: string | null;
}) {
  // ❌ server runtime leak
  const request = getRequestData();

  // ❌ hydration risk
  const clientTheme = getClientTheme();

  console.log(request);

  return (
    <div>
      <h2>{clientTheme}</h2>

      {/* ❌ server component imported into client */}
      <ServerDashboard />
    </div>
  );
}