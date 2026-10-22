import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base keeps the build working under /daw/ and on any preview host.
// Output goes to the repo's /daw folder because GitHub Pages serves the branch as-is.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "../daw", emptyOutDir: true, target: "es2022" },
});
