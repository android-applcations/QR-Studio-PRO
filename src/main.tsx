import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { PwaProvider } from "./pwa/PwaProvider";

// PwaProvider is the single place where the service worker is registered
// (vite-plugin-pwa `injectRegister: null` — no inline registration script).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PwaProvider>
      <App />
    </PwaProvider>
  </StrictMode>,
);
