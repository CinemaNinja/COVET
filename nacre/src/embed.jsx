import { createRoot } from "react-dom/client";
import Nacre from "./Nacre.jsx";

// Drop-in build for pages that are not React apps: any element marked
// data-nacre gets the living shell, filling whatever size the page gives it.
// The shell is made from a photograph: name it in the attribute
// (data-nacre="images/layers/shell-a.jpg"), or leave the attribute empty and
// the element's own background picture is used. That still picture stays
// underneath and remains visible if the browser cannot draw the shell.
const mounted = new WeakSet();

function photoFor(node) {
  const named = node.getAttribute("data-nacre");
  if (named) return named;
  const match = /url\((['"]?)(.*?)\1\)/.exec(getComputedStyle(node).backgroundImage || "");
  return match ? match[2] : "";
}

export function mount(node) {
  if (mounted.has(node)) return;
  mounted.add(node);
  createRoot(node).render(<Nacre src={photoFor(node)} />);
}

export function mountAll() {
  document.querySelectorAll("[data-nacre]").forEach(mount);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}
