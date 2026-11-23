import { createRoot } from "react-dom/client";
import Abalone from "./Abalone.jsx";

// Drop-in build for pages that are not React apps: any element marked
// data-abalone gets the living shell, filling whatever size the page gives it.
// Whatever the element already shows (a still photograph, say) stays underneath
// and remains visible if the browser cannot draw the shell.
const mounted = new WeakSet();

export function mount(node) {
  if (mounted.has(node)) return;
  mounted.add(node);
  createRoot(node).render(<Abalone />);
}

export function mountAll() {
  document.querySelectorAll("[data-abalone]").forEach(mount);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}
