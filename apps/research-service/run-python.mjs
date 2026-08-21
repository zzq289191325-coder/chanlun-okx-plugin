import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const bundledPython = join(
  homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe",
);
const candidates = [
  process.env.CHANLUN_PYTHON,
  process.env.PYTHON,
  "python",
  "python3",
  "py",
  existsSync(bundledPython) ? bundledPython : undefined,
].filter(Boolean);

for (const executable of candidates) {
  const result = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
  if (result.error?.code === "ENOENT") continue;
  if (result.error) {
    console.error(`Unable to start Python: ${result.error.message}`);
    process.exit(2);
  }
  process.exit(result.status ?? 2);
}

console.error(
  "Python 3.11+ was not found. Install Python or set CHANLUN_PYTHON to the executable path.",
);
process.exit(2);
