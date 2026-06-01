// ======================================================
// FILE: app/server-utils.ts
// ======================================================

import { headers, cookies } from "next/headers";

export function getRequestData() {
  const headerStore = headers();
  const cookieStore = cookies();

  return {
    userAgent: headerStore.get("user-agent"),
    token: cookieStore.get("token"),
  };
}

// ❌ browser API inside server util
export function getThemeServer() {
  return localStorage.getItem("theme");
}