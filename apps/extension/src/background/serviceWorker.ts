const DEFAULT_SETTINGS = {
  schemaVersion: 11,
  instId: "",
  symbolMode: "page",
  watchlist: ["GOOGL-USDT-SWAP", "INTC-USDT-SWAP", "MU-USDT-SWAP"],
  interval: "30m",
  panelVisible: true,
  collapsed: false,
  acknowledgedDisclaimer: false,
  realtime: true,
  chartLayers: {
    showFractals: false,
    showStructures: true,
    showSignals: true,
    bareK: false,
  },
  panelPosition: { x: 24, y: 88 },
};

async function ensureDefaults() {
  const existing = await chrome.storage.local.get("chanlunSettings");
  if (!existing.chanlunSettings) {
    await chrome.storage.local.set({ chanlunSettings: DEFAULT_SETTINGS });
  }
}

async function sendToActiveTab(message: unknown) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // The active tab may not be an OKX page or the content script may not be ready yet.
  }
}

async function injectPageBridge(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/pageBridge.js"],
    world: "MAIN",
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
  await sendToActiveTab({ type: "TOGGLE_CHANLUN_PANEL" });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-panel") {
    void sendToActiveTab({ type: "TOGGLE_CHANLUN_PANEL" });
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "INJECT_CHANLUN_PAGE_BRIDGE"
  ) {
    void (async () => {
      const tabId = _sender.tab?.id;
      if (typeof tabId !== "number") {
        sendResponse({ ok: false });
        return;
      }
      await injectPageBridge(tabId);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "OPEN_CHANLUN_SIDEPANEL"
  ) {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId !== undefined) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
