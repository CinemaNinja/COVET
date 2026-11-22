import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds embed/golden-goo.js, the single script the Covet site loads.
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "embed",
    emptyOutDir: true,
    lib: {
      entry: "src/embed.jsx",
      name: "GoldenGoo",
      formats: ["iife"],
      fileName: () => "golden-goo.js",
    },
  },
});
