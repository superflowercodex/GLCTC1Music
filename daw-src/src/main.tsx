import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startApp } from "./startup";
import "./styles.css";
// The glass cockpit (instruments, mixer, kit controls) loads after the foundation so its rules win on ties.
import "./ui/cockpit.css";
// Frosted-glass utilities (.frost-sheet, .frost-pop, seams) load after the cockpit so they can reuse its scopes.
import "./ui/frost.css";
// Phones and tablets: every rule sits behind (max-width: 1000px), so desktop is untouched. Loaded last so it wins ties.
import "./ui/mobile.css";

void startApp();

// Every face index.html asks Google Fonts for. The first render waits for them (at most FONT_WAIT_MS): drawn in
// a fallback first, every label, chip and readout would re-flow once when the real fonts swap in.
const FACES = ['400 15px "DM Mono"', '500 15px "DM Mono"', "400 15px Manrope", "500 15px Manrope", "600 15px Manrope", "700 15px Manrope", '400 15px "Tenor Sans"'];
const FONT_WAIT_MS = 1200;

function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const loaded = Promise.all(FACES.map((f) => document.fonts.load(f))).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS));
  // A blocked font request must not keep the studio from opening.
  return Promise.race([loaded, timeout]).catch(() => undefined);
}

void fontsReady().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
