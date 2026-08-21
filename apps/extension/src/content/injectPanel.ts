import { StrictMode, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChanlunPanel } from "@/app/ChanlunPanel";
import contentCss from "./content.css?inline";

const HOST_ID = "chanlun-okx-visualizer-root";
const SWITCH_TRADINGVIEW_EVENT = "chanlun:switch-tradingview";
const SYNC_OKX_INTERVAL_EVENT = "chanlun:sync-okx-interval";
const MIN_CHART_WIDTH = 520;
const MIN_CHART_HEIGHT = 260;
const CHART_SELECTOR_HINTS = [
  "canvas",
  "iframe",
  '[class*="chart"]',
  '[class*="Chart"]',
  '[class*="trading"]',
  '[class*="Trading"]',
  '[class*="kline"]',
  '[class*="Kline"]',
  '[id*="chart"]',
  '[id*="Chart"]',
  '[data-testid*="chart"]',
  '[data-testid*="Chart"]',
];

const OKX_INTERVAL_LABELS: Record<string, string[]> = {
  "1m": ["1m", "1M", "1分", "1分钟"],
  "5m": ["5m", "5M", "5分", "5分钟"],
  "15m": ["15m", "15M", "15分", "15分钟"],
  "30m": ["30m", "30M", "30分", "30分钟"],
  "1H": ["1H", "1h", "1小时"],
  "4H": ["4H", "4h", "4小时"],
  "1D": ["1D", "1d", "1日", "日线"],
};

let root: Root | null = null;
let cleanupLayout: (() => void) | null = null;
let currentAttached = false;

function isUsableRect(rect: DOMRect) {
  return (
    rect.width >= MIN_CHART_WIDTH &&
    rect.height >= MIN_CHART_HEIGHT &&
    rect.bottom > 80 &&
    rect.right > 120 &&
    rect.top < window.innerHeight - 120 &&
    rect.left < window.innerWidth - 120
  );
}

function tokenScore(element: HTMLElement) {
  const token = [
    element.id,
    element.className,
    element.getAttribute("data-testid"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  if (token.includes("tradingview")) score += 2_000_000;
  if (token.includes("chart")) score += 1_200_000;
  if (token.includes("kline") || token.includes("candle")) score += 900_000;
  if (token.includes("trade")) score += 200_000;
  return score;
}

function climbToChartShell(start: Element) {
  let current: HTMLElement | null =
    start instanceof HTMLElement ? start : start.parentElement instanceof HTMLElement ? start.parentElement : null;
  let best: HTMLElement | null = null;
  let bestArea = 0;

  for (let depth = 0; current && depth < 8; depth += 1) {
    if (current === document.body || current === document.documentElement) break;

    const rect = current.getBoundingClientRect();
    if (isUsableRect(rect)) {
      const area = rect.width * rect.height;
      const coversViewport = rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.92;
      if (!coversViewport && area > bestArea) {
        best = current;
        bestArea = area;
      }
    }
    current = current.parentElement;
  }

  return best;
}

function findChartAnchor() {
  const candidates = new Map<HTMLElement, number>();

  for (const selector of CHART_SELECTOR_HINTS) {
    for (const element of document.querySelectorAll(selector)) {
      const shell = climbToChartShell(element);
      if (!shell) continue;

      const rect = shell.getBoundingClientRect();
      const previous = candidates.get(shell) ?? 0;
      candidates.set(shell, Math.max(previous, rect.width * rect.height + tokenScore(shell)));
    }
  }

  return [...candidates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function renderPanel(attached: boolean) {
  root?.render(createElement(StrictMode, null, createElement(ChanlunPanel, { attached })));
}

function applyFloatingLayout(host: HTMLElement) {
  host.dataset.attached = "false";
  host.style.all = "initial";
  host.style.display = "block";
  host.style.position = "fixed";
  host.style.inset = "0 auto auto 0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
}

function applyAttachedLayout(host: HTMLElement, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  host.dataset.attached = "true";
  host.style.all = "initial";
  host.style.display = "block";
  host.style.position = "fixed";
  host.style.top = `${Math.max(0, rect.top)}px`;
  host.style.left = `${Math.max(0, rect.left)}px`;
  host.style.width = `${Math.min(window.innerWidth - Math.max(0, rect.left), rect.width)}px`;
  host.style.height = `${Math.min(window.innerHeight - Math.max(0, rect.top), rect.height)}px`;
  host.style.zIndex = "2147483646";
  host.style.pointerEvents = "none";
}

function startChartDocking(host: HTMLElement) {
  let frame = 0;
  let retryCount = 0;

  const syncLayout = () => {
    frame = 0;
    const anchor = findChartAnchor();
    const nextAttached = Boolean(anchor);

    if (anchor) {
      applyAttachedLayout(host, anchor);
    } else {
      applyFloatingLayout(host);
    }

    if (nextAttached !== currentAttached) {
      currentAttached = nextAttached;
      renderPanel(nextAttached);
    }
  };

  const scheduleSync = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(syncLayout);
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-testid"],
  });

  window.addEventListener("resize", scheduleSync, true);
  window.addEventListener("scroll", scheduleSync, true);

  const retryTimer = window.setInterval(() => {
    retryCount += 1;
    scheduleSync();
    if (currentAttached || retryCount >= 45) window.clearInterval(retryTimer);
  }, 1_000);

  scheduleSync();

  return () => {
    observer.disconnect();
    window.removeEventListener("resize", scheduleSync, true);
    window.removeEventListener("scroll", scheduleSync, true);
    window.clearInterval(retryTimer);
    if (frame) window.cancelAnimationFrame(frame);
  };
}

function injectNativeChartBridge() {
  void chrome.runtime.sendMessage({ type: "INJECT_CHANLUN_PAGE_BRIDGE" }).catch(() => {
    // The extension can still run in floating-panel mode if the bridge cannot be injected.
  });
}

function clickTradingViewMode() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="tab"], [role="button"], span, div'),
  );
  const tradingViewLabel = candidates.find((element) => element.innerText?.trim() === "TradingView");
  const clickable =
    tradingViewLabel?.closest<HTMLElement>('button, [role="tab"], [role="button"]') ?? tradingViewLabel;

  if (!clickable) return false;
  clickable.click();
  return true;
}

function isVisibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function isInsideChartArea(element: HTMLElement) {
  const anchor = findChartAnchor();
  if (!anchor) return true;

  if (anchor.contains(element)) return true;

  const chartRect = anchor.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return (
    rect.left >= chartRect.left - 24 &&
    rect.right <= chartRect.right + 24 &&
    rect.bottom >= chartRect.top - 96 &&
    rect.top <= chartRect.bottom
  );
}

function clickableForIntervalLabel(element: HTMLElement) {
  return element.closest<HTMLElement>('button, [role="tab"], [role="button"], [data-testid*="interval"]') ?? element;
}

function clickOkxInterval(interval: string) {
  const labels = new Set(OKX_INTERVAL_LABELS[interval] ?? [interval]);
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="tab"], [role="button"], span, div'),
  );

  for (const element of candidates) {
    const text = element.innerText?.trim();
    if (!text || !labels.has(text) || !isVisibleElement(element) || !isInsideChartArea(element)) continue;

    const clickable = clickableForIntervalLabel(element);
    if (!isVisibleElement(clickable)) continue;
    clickable.click();
    return true;
  }

  return false;
}

export function injectPanel() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  applyFloatingLayout(host);
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = contentCss;
  shadow.appendChild(style);

  const mount = document.createElement("div");
  mount.id = "chanlun-shadow-app";
  shadow.appendChild(mount);

  root = createRoot(mount);
  renderPanel(false);
  injectNativeChartBridge();
  const cleanupDocking = startChartDocking(host);
  const switchTradingView = () => {
    clickTradingViewMode();
    window.setTimeout(injectNativeChartBridge, 800);
  };
  const syncOkxInterval = (event: Event) => {
    const interval = (event as CustomEvent<{ interval?: string }>).detail?.interval;
    if (!interval) return;
    clickOkxInterval(interval);
  };
  window.addEventListener(SWITCH_TRADINGVIEW_EVENT, switchTradingView);
  window.addEventListener(SYNC_OKX_INTERVAL_EVENT, syncOkxInterval);
  cleanupLayout = () => {
    cleanupDocking();
    window.removeEventListener(SWITCH_TRADINGVIEW_EVENT, switchTradingView);
    window.removeEventListener(SYNC_OKX_INTERVAL_EVENT, syncOkxInterval);
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_CHANLUN_PANEL") {
      window.dispatchEvent(new CustomEvent("chanlun:toggle-panel"));
    }
  });
}

export function unmountPanel() {
  cleanupLayout?.();
  cleanupLayout = null;
  currentAttached = false;
  root?.unmount();
  root = null;
  document.getElementById(HOST_ID)?.remove();
}
