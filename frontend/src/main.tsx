import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Bundled with the app (Latin subset only), so the look works offline too.
import "@fontsource/caveat/latin-700.css";
import "@fontsource/patrick-hand/latin-400.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
