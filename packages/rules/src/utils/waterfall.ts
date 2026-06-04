import { Node, SyntaxKind } from "ts-morph";

export function isWaterfallCandidate(node: Node): boolean {
  if (node.getKind() !== SyntaxKind.AwaitExpression) {
    return false;
  }
  
  const awaitExpr = node.asKind(SyntaxKind.AwaitExpression);
  if (!awaitExpr) return false;
  
  const expression = awaitExpr.getExpression();
  if (!expression) return false;
  
  const callExpr = Node.isCallExpression(expression) ? expression : expression.getFirstDescendantByKind(SyntaxKind.CallExpression);
  if (!callExpr) return false;
  
  const callText = callExpr.getText();
  const baseCall = Node.isPropertyAccessExpression(callExpr.getExpression()) 
    ? callExpr.getExpression().getName() 
    : callExpr.getExpression().getText();

  const res = (() => {
    // 1. HARD EXCLUSIONS
    // Request parsing (ALWAYS ignore)
    const EXCLUDED_METHODS = new Set([
      "json", "text", "formData", "arrayBuffer", "blob", "clone"
    ]);
    if (EXCLUDED_METHODS.has(baseCall)) {
      return false;
    }
    
    if (/\b(req|request)\.(json|text|formData|arrayBuffer|blob|clone)\b/i.test(callText)) {
      return false;
    }
    
    // Next.js / framework control APIs
    const FRAMEWORK_APIS = new Set([
      "cookies", "headers", "draftMode", "redirect", "notFound", "revalidatePath", "revalidateTag"
    ]);
    if (FRAMEWORK_APIS.has(baseCall) || FRAMEWORK_APIS.has(callText)) {
      return false;
    }
    
    // Runtime utilities (NOT I/O)
    const RUNTIME_UTILS = new Set([
      "sleep", "delay", "wait", "resolve", "reject", "next"
    ]);
    if (RUNTIME_UTILS.has(baseCall) || RUNTIME_UTILS.has(callText)) {
      return false;
    }
    
    // 2. INCLUDED CATEGORIES (ONLY real I/O)
    // Network I/O
    if (
      baseCall === "fetch" ||
      callText.startsWith("axios.") ||
      /\b(openai|genAI|anthropic|cohere)\b/i.test(callText)
    ) {
      return true;
    }
    
    // Database I/O
    const isDbIo =
      /\b(prisma|drizzle|mongoose|mongodb|firestore|firebase|sql)\b/i.test(callText) ||
      /^(prisma|drizzle|mongoose|mongodb|db)\b/.test(callText);
    if (isDbIo) {
      return true;
    }
    
    const DB_METHODS = new Set([
      "findMany", "findUnique", "findFirst",
      "create", "update", "delete", "upsert",
      "count", "aggregate",
      "getDoc", "getDocs",
      "addDoc", "setDoc", "updateDoc", "deleteDoc",
      "findOne", "findById", "insertOne", "updateOne", "deleteOne", "save"
    ]);
    if (DB_METHODS.has(baseCall)) {
      return true;
    }
    
    // Storage I/O
    const isStorageIo = /\b(s3|storage|bucket)\b/i.test(callText);
    if (isStorageIo) {
      return true;
    }
    
    const STORAGE_METHODS = new Set([
      "uploadBytes", "uploadString",
      "getDownloadURL",
      "putObject", "getObject", "deleteObject"
    ]);
    if (STORAGE_METHODS.has(baseCall)) {
      return true;
    }
    
    // User-defined async I/O (STRICT rule)
    const USER_IO_PREFIX_REGEX = /^(get|fetch|load|retrieve|query|find|read|write|update|delete|create|save|send|upload|download)[A-Z]/;
    if (USER_IO_PREFIX_REGEX.test(baseCall)) {
      const identifier = callExpr.getExpression();
      let rightIdentifier = identifier;
      if (Node.isPropertyAccessExpression(identifier)) {
        rightIdentifier = identifier.getNameNode();
      }
      
      const symbol = rightIdentifier.getSymbol();
      if (symbol) {
        const declarations = symbol.getDeclarations();
        if (declarations.length > 0) {
          for (const decl of declarations) {
            if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl)) {
              if (decl.isAsync()) {
                return true;
              }
              const returnTypeNode = decl.getReturnTypeNode();
              if (returnTypeNode && returnTypeNode.getText().startsWith("Promise")) {
                return true;
              }
            } else if (Node.isVariableDeclaration(decl)) {
              const init = decl.getInitializer();
              if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                if (init.isAsync()) {
                  return true;
                }
              }
              const typeNode = decl.getTypeNode();
              if (typeNode && typeNode.getText().includes("Promise")) {
                return true;
              }
            } else if (Node.isImportSpecifier(decl) || Node.isImportClause(decl)) {
              return true;
            }
          }
        }
      }
      
      // Fallback: Check imports and local bindings in source file
      const sourceFile = node.getSourceFile();
      const imports = sourceFile.getImportDeclarations();
      for (const imp of imports) {
        for (const spec of imp.getNamedImports()) {
          if (spec.getName() === baseCall) {
            return true;
          }
        }
        const defaultImport = imp.getDefaultImport();
        if (defaultImport && defaultImport.getText() === baseCall) {
          return true;
        }
        const namespaceImport = imp.getNamespaceImport();
        if (namespaceImport && namespaceImport.getText() === baseCall) {
          return true;
        }
      }
      
      const localFns = sourceFile.getFunctions();
      for (const fn of localFns) {
        if (fn.getName() === baseCall) {
          return true;
        }
      }
      const localVars = sourceFile.getVariableStatements();
      for (const statement of localVars) {
        for (const decl of statement.getDeclarations()) {
          if (decl.getName() === baseCall) {
            return true;
          }
        }
      }
    }
    
    return false;
  })();

  return res;
}
