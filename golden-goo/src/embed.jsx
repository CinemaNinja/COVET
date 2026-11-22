import { createRoot } from "react-dom/client";
import GoldenGoo from "./GoldenGoo.jsx";

// Drop-in build for pages that are not React apps: any element marked
// data-golden-goo gets the liquid, filling whatever size the page gives it.
const mounted = new WeakSet();

export function mount(node) {
  if (mounted.has(node)) return;
  mounted.add(node);
  createRoot(node).render(<GoldenGoo />);
}

export function mountAll() {
  document.querySelectorAll("[data-golden-goo]").forEach(mount);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}
