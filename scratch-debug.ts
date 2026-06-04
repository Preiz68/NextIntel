import { Project, SyntaxKind, Node } from "ts-morph";

function isMutationAction(actionNode: any): boolean {
  console.log("Debugging actionNode:", actionNode.getKindName());
  
  let actionName = "";
  if (Node.isFunctionDeclaration(actionNode)) {
    actionName = actionNode.getName() || "";
  } else {
    const varDec = actionNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (varDec) {
      actionName = varDec.getName();
    }
  }
  console.log("actionName:", actionName);
  if (actionName) {
    const lowerActionName = actionName.toLowerCase();
    const nameMutationKeywords = ["create", "update", "delete", "insert", "remove", "save", "patch", "upsert", "write", "execute"];
    if (nameMutationKeywords.some(kw => lowerActionName.includes(kw))) {
      console.log("Matched function name keyword!");
      return true;
    }
  }

  const callExprs = actionNode.getDescendantsOfKind(SyntaxKind.CallExpression);
  console.log("callExprs count:", callExprs.length);
  for (const call of callExprs) {
    const expression = call.getExpression();
    let name = "";
    if (Node.isPropertyAccessExpression(expression)) {
      name = expression.getName();
    } else if (Node.isIdentifier(expression)) {
      name = expression.getText();
    }
    
    console.log("Call expression name:", name);
    const lowerName = name.toLowerCase();
    const mutationKeywords = [
      "create", "update", "delete", "insert", "remove", "save", "patch",
      "updateone", "updatemany", "deleteone", "deletemany",
      "findbyidandupdate", "findbyidanddelete", "insertone", "insertmany",
      "replaceone", "upsert"
    ];
    
    if (mutationKeywords.some(kw => lowerName.includes(kw))) {
      console.log("Matched call name keyword!");
      return true;
    }
  }

  return false;
}

const project = new Project();
const sourceFile = project.createSourceFile("temp.ts", `
  'use server';
  export async function createEvent(data) {
    const event = await Event.create(data);
    return event;
  }
`);

const f = sourceFile.getFunction("createEvent");
console.log("isMutationAction:", isMutationAction(f));
