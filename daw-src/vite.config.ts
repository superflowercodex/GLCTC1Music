import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base keeps the build working under /daw/ and on any preview host.
// Output goes to the repo's /daw folder because GitHub Pages serves the branch as-is.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // The offline-audio tests contend for CPU when files run in parallel and fail intermittently.
  test: { fileParallelism: false },
  build: { outDir: "../daw", emptyOutDir: true, target: "es2022" },
});
