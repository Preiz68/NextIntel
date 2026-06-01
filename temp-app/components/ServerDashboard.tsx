// ======================================================
// FILE: app/components/ServerDashboard.tsx
// ======================================================

import ClientDashboard from "./ClientDashboard";

export default async function ServerDashboard() {
  // ❌ browser API in server component
  const theme = localStorage.getItem("theme");

  return (
    <div>
      <h1>Server Dashboard</h1>

      <ClientDashboard theme={theme} />
    </div>
  );
}