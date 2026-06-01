// ======================================================
// FILE: app/client-utils.ts
// ======================================================

export function getClientTheme() {
  // ❌ hydration mismatch risk
  return localStorage.getItem("theme");
}

export function getLanguage() {
  // ❌ hydration mismatch risk
  return navigator.language;
}