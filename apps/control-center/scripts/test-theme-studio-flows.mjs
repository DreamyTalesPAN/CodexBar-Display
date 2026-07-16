import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const customerFlowScript = join(scriptsDir, "test-customer-flows.mjs");

const child = spawn(process.execPath, [customerFlowScript, "--theme-studio-safety"], {
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Could not start Theme Studio flows: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Theme Studio flows stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
