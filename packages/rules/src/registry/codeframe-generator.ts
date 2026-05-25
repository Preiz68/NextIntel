import fs from "node:fs";

/**
 * Extracts and formats a 5-line code snippet with carets pointing to the violation.
 */
export function generateCodeFrame(
  filePath: string,
  lineNum: number,
  affects: string[] = []
): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const startLine = Math.max(1, lineNum - 2);
    const endLine = Math.min(lines.length, lineNum + 2);

    let frame = "";
    for (let l = startLine; l <= endLine; l++) {
      const lineText = lines[l - 1]!;
      const isTarget = l === lineNum;
      const prefix = isTarget ? " > " : "   ";
      frame += `${prefix}${l.toString().padStart(4)} | ${lineText}\n`;

      if (isTarget) {
        let carets = "";
        let found = false;

        for (const symbol of affects) {
          const idx = lineText.indexOf(symbol);
          if (idx !== -1) {
            carets = " ".repeat(idx) + "^".repeat(symbol.length);
            found = true;
            break;
          }
        }

        if (!found) {
          const trimStart = lineText.length - lineText.trimStart().length;
          const trimLength = lineText.trim().length;
          carets = " ".repeat(trimStart) + "^".repeat(Math.max(1, trimLength));
        }

        frame += `        | ${carets}\n`;
      }
    }
    return frame;
  } catch {
    return "";
  }
}
