import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    // The preview borrows the shell photograph from the site's images folder.
    fs: { allow: [".."] },
  },
});
