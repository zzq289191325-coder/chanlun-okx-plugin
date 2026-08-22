import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import "./chart-markers.css";
import "./overview-positions.css";
import "./paper-accounts.css";
import "./compact.css";
import "./theme.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
