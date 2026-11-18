(function () {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;

  function light(x, y) {
    root.style.setProperty("--lx", x + "%");
    root.style.setProperty("--ly", y + "%");
  }

  const ring = document.querySelector(".cursor-ring");
  let rx = window.innerWidth * 0.68;
  let ry = window.innerHeight * 0.24;
  let tx = rx;
  let ty = ry;
  let ringOn = false;

  function tickRing() {
    rx += (tx - rx) * (reduce ? 1 : 0.18);
    ry += (ty - ry) * (reduce ? 1 : 0.18);
    if (ring) ring.style.transform = "translate(" + rx.toFixed(1) + "px," + ry.toFixed(1) + "px)";
    if (!reduce) requestAnimationFrame(tickRing);
  }

  if (!coarse && ring) {
    ring.hidden = false;
    requestAnimationFrame(tickRing);
  }

  if (!reduce) {
    window.addEventListener("pointermove", (event) => {
      light((event.clientX / window.innerWidth) * 100, (event.clientY / window.innerHeight) * 100);
      tx = event.clientX;
      ty = event.clientY;
      if (ring && !ringOn) {
        ringOn = true;
        ring.classList.add("is-on");
      }
    }, { passive: true });

    window.addEventListener("deviceorientation", (event) => {
      if (event.gamma == null) return;
      const x = Math.min(92, Math.max(8, 50 + event.gamma * 1.1));
      const y = Math.min(88, Math.max(8, 42 + (event.beta - 40) * 0.7));
      light(x, y);
    });
  }

  const nav = document.getElementById("nav");
  const toggle = document.getElementById("nav-toggle");
  const panel = document.getElementById("site-nav");
  function closeMenu() {
    if (!nav || !toggle) return;
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  }
  if (toggle && nav && panel) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    panel.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  const links = new Map();
  document.querySelectorAll(".nav nav a").forEach((link) => {
    const id = (link.getAttribute("href") || "").slice(1);
    if (id) links.set(id, link);
  });
  if ("IntersectionObserver" in window && links.size) {
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => link.classList.remove("is-here"));
        const current = links.get(entry.target.id);
        if (current) current.classList.add("is-here");
      });
    }, { rootMargin: "-40% 0px -45% 0px", threshold: 0.01 });
    links.forEach((link, id) => {
      const section = document.getElementById(id);
      if (section) watch.observe(section);
    });
  }
})();
