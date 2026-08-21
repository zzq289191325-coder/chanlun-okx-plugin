import { readFile } from "node:fs/promises";
import type { MultiTimeframeInput } from "../multiTimeframe/engine.js";
import { replayResearchOpportunities, type ResearchStrategyConfig } from "./replay.js";

interface BridgeRequest {
  candles: MultiTimeframeInput;
  config?: Partial<ResearchStrategyConfig>;
}

async function main() {
  const inputIndex = process.argv.indexOf("--input");
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (!inputPath) throw new Error("Usage: bridgeCli.js --input <request.json>");
  const request = JSON.parse(await readFile(inputPath, "utf8")) as BridgeRequest;
  const result = replayResearchOpportunities(request.candles, request.config ?? {});
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Backtest bridge failed"}\n`);
  process.exitCode = 1;
});
