import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `vite` serves the demo (index.html); `vite build` emits the library.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "rehoboam.js" : "rehoboam.cjs"),
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
});
