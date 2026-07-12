import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import { api } from "@riftversus/api-runtime";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
