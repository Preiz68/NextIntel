// ======================================================
// FILE: app/components/ClientPage.tsx
// ======================================================

"use client";

import { helper } from "../helper";

export default function ClientPage() {
  // ❌ indirect server import contamination
  helper();

  return <div>Client Page</div>;
}