/**
 * framework-contracts.ts
 *
 * Formalized Next.js Framework Contract specifications.
 */

export const NEXT_FRAMEWORK_CONTRACTS = {
  SERVER_ACTIONS: {
    validParams: [
      "FormData",
      "string",
      "number",
      "boolean",
      "plain-object",
      "array"
    ],
    isValidParamType(typeText: string): boolean {
      const cleanText = typeText.trim();
      if (cleanText === "FormData" || cleanText.endsWith(".FormData") || cleanText.startsWith("FormData")) return true;
      
      const lower = cleanText.toLowerCase();
      if (
        lower === "string" ||
        lower === "number" ||
        lower === "boolean" ||
        lower === "any" ||
        lower === "void" ||
        lower === "null" ||
        lower === "undefined" ||
        lower === "unknown"
      ) {
        return true;
      }

      // Allow simple array types
      if (cleanText.endsWith("[]") || cleanText.startsWith("Array<") || cleanText.startsWith("ReadonlyArray<")) {
        return true;
      }

      // Allow plain objects, Record types, or typed inline interfaces
      if (cleanText.startsWith("{") || cleanText.startsWith("Record<") || cleanText.startsWith("Partial<")) {
        return true;
      }

      return false;
    }
  }
};
