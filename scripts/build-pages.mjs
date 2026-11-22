import { execFileSync } from "node:child_process";
const command = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(command, ["run", "build"], {
  stdio: "inherit",
  env: { ...process.env, VITE_BASE_PATH: "/modScore/" },
  shell: process.platform === "win32",
});
