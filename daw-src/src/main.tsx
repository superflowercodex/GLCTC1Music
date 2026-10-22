import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startApp } from "./startup";
import "./styles.css";

void startApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
