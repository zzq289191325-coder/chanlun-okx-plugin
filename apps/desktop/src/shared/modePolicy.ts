import type { DesktopMode } from "./types.js";

export function modeRequest(mode: DesktopMode): { accepted: boolean; message: string } {
  if (mode === "PAPER") return { accepted: true, message: "已进入完全本地 PAPER 模式" };
  return { accepted: false, message: `${mode} 尚未配置且保持锁定；本构建禁止外部订单` };
}
