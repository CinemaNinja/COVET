import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds embed/nacre.js, the single script the Covet site loads.
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
      name: "Nacre",
      formats: ["iife"],
      fileName: () => "nacre.js",
    },
  },
});
