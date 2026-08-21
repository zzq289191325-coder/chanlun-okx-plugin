import { createRoot } from "react-dom/client";
import { ChanlunPanel } from "@/app/ChanlunPanel";
import "@/content/content.css";

function SidePanel() {
  return (
    <div className="cv-sidepanel-shell">
      <ChanlunPanel embedded />
    </div>
  );
}

createRoot(document.getElementById("sidepanel-root")!).render(<SidePanel />);
