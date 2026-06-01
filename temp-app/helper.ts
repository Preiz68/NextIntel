// ======================================================
// FILE: app/helper.ts
// ======================================================

import { db } from "./lib/db";

export async function helper() {
  return db.user.findMany();
}