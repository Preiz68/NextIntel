// ======================================================
// FILE: app/lib/db.ts
// ======================================================

import "server-only";

import { headers } from "next/headers";

export const db = {
  user: {
    async findMany() {
      const h = headers();

      return [
        {
          id: 1,
          ua: h.get("user-agent"),
        },
      ];
    },
  },
};