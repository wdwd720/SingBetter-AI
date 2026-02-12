import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import { installCsrfFetchInterceptor } from "@/lib/csrf";

installCsrfFetchInterceptor();

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);
