import { PanelRightOpen } from "lucide-react";
import { createRoot } from "react-dom/client";
import "@/styles/theme.css";

function Popup() {
  const openSidePanel = async () => {
    await chrome.runtime.sendMessage({ type: "OPEN_CHANLUN_SIDEPANEL" });
  };

  return (
    <main className="cv-extension-page">
      <h1>Chanlun OKX Visualizer</h1>
      <p>结构可视化学习与复盘工具，不自动交易。</p>
      <button type="button" onClick={() => void openSidePanel()}>
        <PanelRightOpen size={16} />
        打开侧边栏
      </button>
    </main>
  );
}

createRoot(document.getElementById("popup-root")!).render(<Popup />);
