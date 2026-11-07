import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build`              -> dist/ (served by FastAPI at http://localhost:8000)
// `npm run build:webresource`  -> dist-webresource/cqa.html, one self-contained file
//                                 that can be uploaded as a Dynamics 365 HTML web resource.
export default defineConfig(({ mode }) => {
  const webresource = mode === "webresource";
  return {
    plugins: [react(), ...(webresource ? [viteSingleFile({ outputFileName: "cqa.html" })] : [])],
    base: "./",
    build: { outDir: webresource ? "dist-webresource" : "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
    server: {
      port: 5173,
      proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
    },
  };
});
