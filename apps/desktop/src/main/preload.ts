import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, DesktopMode, DesktopSettings, PaperAccountId, PaperOrderRequest } from "../shared/types.js";

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke("desktop:snapshot"),
  refreshPaperMarket: () => ipcRenderer.invoke("paper:refresh-market"),
  workspace: (symbol?: string) => ipcRenderer.invoke("desktop:workspace", symbol),
  resetPaper: (accountId: PaperAccountId) => ipcRenderer.invoke("paper:reset", accountId),
  previewPaperOrder: (request: PaperOrderRequest) => ipcRenderer.invoke("paper:preview", request),
  confirmPaperOrder: (previewId: string) => ipcRenderer.invoke("paper:confirm", previewId),
  closePaperPosition: (accountId: PaperAccountId, symbol: string) => ipcRenderer.invoke("paper:close-position", accountId, symbol),
  requestMode: (mode: DesktopMode) => ipcRenderer.invoke("mode:request", mode),
  runBacktest: (symbol: string) => ipcRenderer.invoke("research:backtest", symbol),
  syncPublicData: (symbol: string) => ipcRenderer.invoke("research:sync-public", symbol),
  runIntegrityCheck: () => ipcRenderer.invoke("database:integrity"),
  createBackup: () => ipcRenderer.invoke("database:backup"),
  addReviewNote: (input) => ipcRenderer.invoke("review:add-note", input),
  saveSettings: (settings: DesktopSettings) => ipcRenderer.invoke("settings:save", settings),
  trainAdaptiveModel: (accountId: PaperAccountId, symbol: string) => ipcRenderer.invoke("learning:train", accountId, symbol),
  runAdaptiveWalkForward: (accountId: PaperAccountId, symbol: string) => ipcRenderer.invoke("learning:walk-forward", accountId, symbol),
  toggleAdaptiveLearning: (accountId: PaperAccountId, enabled: boolean) => ipcRenderer.invoke("learning:toggle", accountId, enabled),
  auditAdaptiveLearning: () => ipcRenderer.invoke("learning:audit"),
};

contextBridge.exposeInMainWorld("quantDesktop", api);
