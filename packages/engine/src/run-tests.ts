import { runTaintEngineTests } from "./taint/taintEngine.test.js";
import { runExecutionSimulatorTests } from "./simulator/executionSimulator.test.js";

async function main() {
  console.log("=========================================");
  console.log("🏃 RUNNING PACKAGE:ENGINE UNIT TESTS");
  console.log("=========================================");
  
  try {
    runTaintEngineTests();
    runExecutionSimulatorTests();
    console.log("\n🎉 All package:engine tests passed successfully!\n");
  } catch (err) {
    console.error("\n❌ Test execution failed:", err);
    process.exit(1);
  }
}

main();
