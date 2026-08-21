const QUOTE_PATTERN = "USDT|USDC|USD";
const OKX_SWAP_REGEX = new RegExp(`\\b([A-Z0-9]{1,20})[-_/](${QUOTE_PATTERN})[-_/]SWAP\\b`, "i");
const OKX_PAIR_REGEX = new RegExp(`\\b([A-Z0-9]{1,20})[-_/](${QUOTE_PATTERN})\\b(?![-_/]SWAP)`, "i");
const OKX_COMPACT_PAIR_REGEX = new RegExp(`\\b([A-Z0-9]{1,20})(${QUOTE_PATTERN})\\b`, "i");
const OKX_SWAP_GLOBAL_REGEX = new RegExp(`\\b([A-Z0-9]{1,20})[-_/](${QUOTE_PATTERN})[-_/]SWAP\\b`, "gi");
const OKX_PAIR_GLOBAL_REGEX = new RegExp(`\\b([A-Z0-9]{1,20})[-_/](${QUOTE_PATTERN})\\b(?![-_/]SWAP)`, "gi");
const OKX_COMPACT_PAIR_GLOBAL_REGEX = new RegExp(`\\b([A-Z0-9]{2,20})(${QUOTE_PATTERN})\\b`, "gi");
const SUPPORTED_SWAP_REGEX = new RegExp(`^[A-Z0-9]{1,20}-(${QUOTE_PATTERN})-SWAP$`);

const MAX_EXTRACTED_SYMBOLS = 36;
const GOOGL_SWAP_INST_ID = "GOOGL-USDT-SWAP";
const INTC_SWAP_INST_ID = "INTC-USDT-SWAP";
const MU_SWAP_INST_ID = "MU-USDT-SWAP";
const INST_ID_ALIASES = new Map<string, string>([
  ["ALPHABET", GOOGL_SWAP_INST_ID],
  ["ALPHABET-USDT", GOOGL_SWAP_INST_ID],
  ["ALPHABET-USDT-SWAP", GOOGL_SWAP_INST_ID],
  ["GOOG", GOOGL_SWAP_INST_ID],
  ["GOOG-USDT", GOOGL_SWAP_INST_ID],
  ["GOOG-USDT-SWAP", GOOGL_SWAP_INST_ID],
  ["GOOGLE", GOOGL_SWAP_INST_ID],
  ["GOOGLE-USDT", GOOGL_SWAP_INST_ID],
  ["GOOGLE-USDT-SWAP", GOOGL_SWAP_INST_ID],
  ["GOOGL", GOOGL_SWAP_INST_ID],
  ["INTC", INTC_SWAP_INST_ID],
  ["INTC-USDT", INTC_SWAP_INST_ID],
  ["INTC-USDT-SWAP", INTC_SWAP_INST_ID],
  ["INTEL", INTC_SWAP_INST_ID],
  ["INTEL-USDT", INTC_SWAP_INST_ID],
  ["INTEL-USDT-SWAP", INTC_SWAP_INST_ID],
  ["MICRON", MU_SWAP_INST_ID],
  ["MICRON-USDT", MU_SWAP_INST_ID],
  ["MICRON-USDT-SWAP", MU_SWAP_INST_ID],
  ["MU", MU_SWAP_INST_ID],
  ["MU-USDT", MU_SWAP_INST_ID],
  ["MU-USDT-SWAP", MU_SWAP_INST_ID],
  ["美光", MU_SWAP_INST_ID],
  ["英特尔", INTC_SWAP_INST_ID],
  ["谷歌", GOOGL_SWAP_INST_ID],
]);

export function normalizeInstId(raw: string) {
  const normalized = raw.trim().toUpperCase().replaceAll("_", "-").replaceAll("/", "-");
  const alias = INST_ID_ALIASES.get(normalized);
  if (alias) return alias;

  const swap = normalized.match(OKX_SWAP_REGEX);
  if (swap?.[1] && swap[2]) return `${swap[1].toUpperCase()}-${swap[2].toUpperCase()}-SWAP`;

  const pair = normalized.match(OKX_PAIR_REGEX);
  if (pair?.[1] && pair[2]) return `${pair[1].toUpperCase()}-${pair[2].toUpperCase()}-SWAP`;

  const compactPair = normalized.match(OKX_COMPACT_PAIR_REGEX);
  if (compactPair?.[1] && compactPair[2]) {
    return `${compactPair[1].toUpperCase()}-${compactPair[2].toUpperCase()}-SWAP`;
  }

  return normalized;
}

export function isSupportedOkxSwapInstId(value: string) {
  return SUPPORTED_SWAP_REGEX.test(value);
}

export function normalizeInstIdList(raw: string | string[]) {
  const items = Array.isArray(raw) ? raw : raw.split(/[\s,;，；、]+/);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of items) {
    const instId = normalizeInstId(item);
    if (!isSupportedOkxSwapInstId(instId) || seen.has(instId)) continue;
    seen.add(instId);
    normalized.push(instId);
  }
  return normalized;
}

function resolveFromText(text: string) {
  const source = decodeURIComponent(text);
  const swap = source.match(OKX_SWAP_REGEX);
  if (swap?.[1] && swap[2]) return `${swap[1].toUpperCase()}-${swap[2].toUpperCase()}-SWAP`;

  const pair = source.match(OKX_PAIR_REGEX);
  if (pair?.[1] && pair[2]) return `${pair[1].toUpperCase()}-${pair[2].toUpperCase()}-SWAP`;

  const compactPair = source.match(OKX_COMPACT_PAIR_REGEX);
  if (compactPair?.[1] && compactPair[2]) {
    return `${compactPair[1].toUpperCase()}-${compactPair[2].toUpperCase()}-SWAP`;
  }

  return null;
}

function collectFromText(text: string, output: Set<string>) {
  const source = decodeURIComponent(text);
  for (const regex of [OKX_SWAP_GLOBAL_REGEX, OKX_PAIR_GLOBAL_REGEX, OKX_COMPACT_PAIR_GLOBAL_REGEX]) {
    regex.lastIndex = 0;
    for (const match of source.matchAll(regex)) {
      const base = match[1]?.toUpperCase();
      const quote = match[2]?.toUpperCase();
      if (!base || !quote) continue;
      output.add(`${base}-${quote}-SWAP`);
      if (output.size >= MAX_EXTRACTED_SYMBOLS) return;
    }
  }
}

export function resolveOkxInstId(href = globalThis.location?.href, title = document.title) {
  const resolvedFromHead = resolveFromText(`${href ?? ""} ${title ?? ""}`);
  if (resolvedFromHead) return resolvedFromHead;

  const bodyText = (document.body?.innerText ?? document.body?.textContent ?? "").slice(0, 20_000);
  const resolvedFromBody = resolveFromText(bodyText);
  if (resolvedFromBody) return resolvedFromBody;

  return null;
}

export function extractOkxInstIdsFromPage(
  href = globalThis.location?.href,
  title = document.title,
  bodyText = (document.body?.innerText ?? document.body?.textContent ?? "").slice(0, 60_000),
) {
  const output = new Set<string>();
  collectFromText(`${href ?? ""} ${title ?? ""}`, output);
  if (output.size < MAX_EXTRACTED_SYMBOLS) collectFromText(bodyText, output);
  return [...output].filter(isSupportedOkxSwapInstId).slice(0, MAX_EXTRACTED_SYMBOLS);
}
