import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

function copyManifestPlugin() {
  return {
    name: "copy-extension-manifest",
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      mkdirSync("dist/content", { recursive: true });
      copyFileSync("manifest.json", "dist/manifest.json");
      writeFileSync(
        "dist/content/index.js",
        "void import(chrome.runtime.getURL('content/app.js')).catch((error) => console.error('[chanlun-okx] failed to load content module', error));\n",
      );
      copyFileSync("src/content/pageBridge.js", "dist/content/pageBridge.js");
      mkdirSync("dist/popup", { recursive: true });
      mkdirSync("dist/sidepanel", { recursive: true });
      if (existsSync("dist/src/popup/popup.html")) {
        copyFileSync("dist/src/popup/popup.html", "dist/popup/popup.html");
      }
      if (existsSync("dist/src/sidepanel/sidepanel.html")) {
        copyFileSync("dist/src/sidepanel/sidepanel.html", "dist/sidepanel/sidepanel.html");
      }
      rmSync("dist/src", { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  publicDir: "public",
  resolve: {
    alias: {
      "@": resolve(projectRoot, "src"),
      "@intelligence/core": resolve(projectRoot, "../../packages/core/src/index.ts"),
      "@intelligence/contracts": resolve(projectRoot, "../../packages/contracts/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome114",
    modulePreload: false,
    rollupOptions: {
      input: {
        content: resolve(projectRoot, "src/content/index.tsx"),
        serviceWorker: resolve(projectRoot, "src/background/serviceWorker.ts"),
        popup: resolve(projectRoot, "src/popup/popup.html"),
        sidepanel: resolve(projectRoot, "src/sidepanel/sidepanel.html"),
      },
      output: {
        entryFileNames(chunk) {
          if (chunk.name === "content") return "content/app.js";
          if (chunk.name === "serviceWorker") return "background/serviceWorker.js";
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames(assetInfo) {
          if (assetInfo.name?.endsWith(".css")) {
            return "assets/[name][extname]";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
