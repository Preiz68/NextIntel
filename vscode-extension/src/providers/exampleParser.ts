export interface ParsedExampleFile {
  filename?: string;
  code: string;
}

export interface ParsedExample {
  description?: string;
  files: ParsedExampleFile[];
}

/**
 * Parses raw rule examples by:
 * 1. Extracting multi-line explanation comments at the start (prefixed by // ❌ Invalid: or // ✅ Valid:).
 * 2. Splitting the remaining code block into individual files (marked by // filename.ext comments).
 * 3. Cleaning and formatting the code blocks while preserving proper line breaks and indentation.
 */
export function parseExample(raw: string): ParsedExample {
  const lines = raw.split("\n");
  const descriptionLines: string[] = [];
  let lineIdx = 0;

  // Try to find the description comment block at the very beginning
  if (lines.length > 0 && lines[0] !== undefined) {
    const firstLine = lines[0].trim();
    const descMatch = firstLine.match(/^\/\/\s*(?:❌\s*Invalid:|✅\s*Valid:)\s*(.*)$/i);
    if (descMatch && descMatch[1] !== undefined) {
      descriptionLines.push(descMatch[1].trim());
      lineIdx = 1;

      // Consume subsequent lines if they are comments and NOT file headers
      while (lineIdx < lines.length) {
        const nextLineText = lines[lineIdx];
        if (nextLineText === undefined) {
          lineIdx++;
          continue;
        }
        const nextLine = nextLineText.trim();
        if (nextLine.startsWith("//")) {
          // Check if it's a file header (e.g. // page.tsx (Server Component) or // app/posts/page.tsx)
          const isFileHeader = nextLine.match(/^\/\/\s*([\w\-./@]+\.[a-zA-Z0-9]+(?:\s*\(.*?\))?)$/);
          if (isFileHeader) {
            break;
          }
          const content = nextLine.substring(2).trim();
          descriptionLines.push(content);
          lineIdx++;
        } else {
          break;
        }
      }
    }
  }

  const description = descriptionLines.length > 0 ? descriptionLines.join(" ") : undefined;
  const files: { filename?: string; code: string[] }[] = [];
  let currentFileCode: string[] = [];
  let currentFileName: string | undefined;

  for (let i = lineIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();

    // Match file header comments like // page.tsx (Server Component) or // app/posts/page.tsx
    const fileHeaderMatch = trimmed.match(/^\/\/\s*([\w\-./@]+\.[a-zA-Z0-9]+(?:\s*\(.*?\))?)$/);

    if (fileHeaderMatch && fileHeaderMatch[1] !== undefined) {
      if (currentFileCode.length > 0 || currentFileName) {
        files.push({
          filename: currentFileName,
          code: currentFileCode,
        });
        currentFileCode = [];
      }
      currentFileName = fileHeaderMatch[1].trim();
    } else {
      currentFileCode.push(line);
    }
  }

  if (currentFileCode.length > 0 || currentFileName) {
    files.push({
      filename: currentFileName,
      code: currentFileCode,
    });
  }

  // Fallback: if no files were identified but we have content, treat the whole block as code
  if (files.length === 0 && raw) {
    const rawLines = lines.slice(lineIdx).filter((l): l is string => l !== undefined);
    files.push({
      code: rawLines,
    });
  }

  // Post-process the code blocks to remove empty leading/trailing lines
  const processedFiles = files.map((f) => {
    const codeLines = [...(f.code || [])].filter((l): l is string => l !== undefined);
    
    while (codeLines.length > 0) {
      const first = codeLines[0];
      if (first !== undefined && first.trim() === "") {
        codeLines.shift();
      } else {
        break;
      }
    }
    
    while (codeLines.length > 0) {
      const last = codeLines[codeLines.length - 1];
      if (last !== undefined && last.trim() === "") {
        codeLines.pop();
      } else {
        break;
      }
    }

    return {
      filename: f.filename,
      code: codeLines.join("\n"),
    };
  });

  return {
    description,
    files: processedFiles,
  };
}
