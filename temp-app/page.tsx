// ======================================================
// FILE: app/page.tsx
// ======================================================

import ServerDashboard from "./components/ServerDashboard";
import ClientPage from "./components/ClientPage";

export default function Page() {
  return (
    <main>
      <ServerDashboard />
      <ClientPage />
    </main>
  );
}