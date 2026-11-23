/*
  The Covet card pack. Builds a fanning deck inside every element marked
  data-card-pack. Styles are in card-pack.css.

  Optional hooks in the page:
    data-pack-stage   an ancestor of the pack. A lifted card stays inside it.
    data-pack-flip    a button inside the stage that turns the deck over.
    data-clear="#id"  on the pack: a fixed bar at the top of the window that
                      a lifted card should stay below.

  Hover picks a card with arithmetic against the resting fan, so moving the
  pointer never asks the browser to measure anything.
*/
(function () {
  var RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "king", "ace", "queen"];
  var SUITS = ["clubs", "diamonds", "spades", "hearts"];
  var RANK_NAME = {
    "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six", "7": "Seven", "8": "Eight",
    "9": "Nine", "10": "Ten", jack: "Jack", queen: "Queen", king: "King", ace: "Ace"
  };
  var VERSION = "8";

  /* Pictures sit beside this script, wherever the site is served from. */
  var here = document.currentScript && document.currentScript.src;
  var IMAGES = (here ? new URL(".", here).href : "") + "images/cards/";

  var PAD = 12;      /* gap kept between a lifted card and the edge of its room */
  var REACH = 64;    /* how far past the fan the pointer can drift before it closes */
  var TILT = 0.6;    /* a lifted card keeps this share of its lean */
  var LIFT = 0.04;   /* and rises by this share of its height */
  var PIVOT = 0.6;   /* cards turn about a point this far down their height */

  function buildDeck() {
    var deck = [];
    function add(file, name, red) {
      var back = "back-" + (red ? "red" : "blue");
      deck.push({
        src: IMAGES + "sm/" + file + ".webp?v=" + VERSION,
        full: IMAGES + "lg/" + file + ".webp?v=" + VERSION,
        back: IMAGES + "sm/" + back + ".webp?v=" + VERSION,
        backFull: IMAGES + "lg/" + back + ".webp?v=" + VERSION,
        backName: red ? "Red card back" : "Blue card back",
        name: name
      });
    }
    RANKS.forEach(function (rank) {
      SUITS.forEach(function (suit) {
        var red = suit === "hearts" || suit === "diamonds";
        add(rank + "-of-" + suit, RANK_NAME[rank] + " of " + suit.charAt(0).toUpperCase() + suit.slice(1), red);
      });
    });
    add("joker-teal", "Teal joker", false);
    add("joker-copper", "Copper joker", true);
    return deck;
  }

  /* Reach of one card from its turning point, once rotated. */
  function extent(w, h, cos, sin) {
    var out = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    var xs = [-w / 2, w / 2];
    var ys = [-PIVOT * h, (1 - PIVOT) * h];
    for (var a = 0; a < 2; a++) {
      for (var b = 0; b < 2; b++) {
        var x = xs[a] * cos - ys[b] * sin;
        var y = xs[a] * sin + ys[b] * cos;
        if (x < out.l) out.l = x;
        if (x > out.r) out.r = x;
        if (y < out.t) out.t = y;
        if (y > out.b) out.b = y;
      }
    }
    return out;
  }

  function fit(lo, hi, min, max) {
    if (hi - lo > max - min) return (min + max) / 2 - (lo + hi) / 2;
    if (lo < min) return min - lo;
    if (hi > max) return max - hi;
    return 0;
  }

  function mount(pack) {
    var stage = pack.closest("[data-pack-stage]");
    var flip = stage ? stage.querySelector("[data-pack-flip]") : null;
    var clear = pack.dataset.clear ? document.querySelector(pack.dataset.clear) : null;

    /* ---------- The deck ---------- */

    var deck = buildDeck();
    var n = deck.length;
    var mid = (n - 1) / 2;
    pack.setAttribute("aria-label", "Card pack of " + n + " cards");
    pack.innerHTML = '<span class="pack-shadow" aria-hidden="true"></span>' + deck.map(function (card, i) {
      var away = mid ? Math.abs(i - mid) / mid : 0;
      var jitter = (((i * 17) % 7) - 3) * 0.55;
      var nudge = (((i * 13) % 5) - 2) * 2;
      var style = [
        "--i:" + i,
        "--sx:" + nudge + "px",
        "--sy:" + ((mid - i) * 36 / Math.max(1, n - 1)).toFixed(2) + "px",
        "--sr:" + jitter.toFixed(2) + "deg",
        /* The fan opens from the middle outward and takes about a second,
           however many cards are in it. */
        "--open-wait:" + Math.round(away * 190 + (i * 19) % 40) + "ms",
        "--close-wait:" + Math.round(away * 110) + "ms"
      ].join(";");
      return '<article class="pack-card" style="' + style + '">' +
        '<div class="pack-turn">' +
          '<img class="pack-face pack-front" src="' + card.src + '" data-full="' + card.full + '" alt="' + card.name + '" loading="lazy" decoding="async" draggable="false">' +
          '<img class="pack-face pack-back" src="' + card.back + '" data-full="' + card.backFull + '" alt="' + card.backName + '" loading="lazy" decoding="async" draggable="false">' +
        '</div>' +
        '</article>';
    }).join("");
    var cards = Array.prototype.slice.call(pack.querySelectorAll(".pack-card"));

    /* ---------- Where each card sits ---------- */

    var geo = { w: 0, h: 0, ox: 0, oy: 0, spots: [], box: null, room: { l: 0, r: 0, t: 0, b: 0 } };
    var lifted = null;

    /* The pack's turning point, and the room a lifted card may use: the
       stage, cut down to what is on screen below any fixed bar. */
    function readOrigin() {
      var rect = pack.getBoundingClientRect();
      var vw = document.documentElement.clientWidth;
      var vh = window.innerHeight;
      var room = { l: 0, r: vw, t: clear ? Math.max(0, clear.getBoundingClientRect().bottom) : 0, b: vh };
      if (stage) {
        var s = stage.getBoundingClientRect();
        room.l = Math.max(room.l, s.left);
        room.r = Math.min(room.r, s.right);
        if (Math.min(room.b, s.bottom) - Math.max(room.t, s.top) > geo.h) {
          room.t = Math.max(room.t, s.top);
          room.b = Math.min(room.b, s.bottom);
        }
      }
      geo.ox = rect.left + geo.w / 2;
      geo.oy = rect.top + geo.h * PIVOT;
      geo.room = { l: room.l + PAD, r: room.r - PAD, t: room.t + PAD, b: room.b - PAD };
    }

    /* Runs on load and on resize only. Cards sit on a circle so the arc is
       even, and the fan narrows to fit the room on either side of it. */
    function layout() {
      var w = pack.offsetWidth;
      var h = pack.offsetHeight;
      if (!w || !h) return;
      geo.w = w;
      geo.h = h;
      readOrigin();
      var vw = document.documentElement.clientWidth;
      var top = ((vw <= 800 ? 56 : 46) * Math.PI / 180) / 2;
      var edge = (w / 2) * Math.cos(top) + PIVOT * h * Math.sin(top);
      var side = Math.min(geo.ox - geo.room.l, geo.room.r - geo.ox);
      var half = Math.max(w * 0.9, Math.min(w * 4.25, side - edge));
      var radius = half / Math.sin(top);
      var box = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };

      geo.spots = cards.map(function (card, i) {
        var turn = mid ? ((i - mid) / mid) * top : 0;
        var spot = {
          x: radius * Math.sin(turn),
          y: radius * (1 - Math.cos(turn)),
          turn: turn,
          cos: Math.cos(turn),
          sin: Math.sin(turn)
        };
        card.style.setProperty("--x", spot.x.toFixed(2) + "px");
        card.style.setProperty("--y", spot.y.toFixed(2) + "px");
        card.style.setProperty("--r", (turn * 180 / Math.PI).toFixed(3) + "deg");
        var reach = extent(w, h, spot.cos, spot.sin);
        box.l = Math.min(box.l, spot.x + reach.l);
        box.r = Math.max(box.r, spot.x + reach.r);
        box.t = Math.min(box.t, spot.y + reach.t);
        box.b = Math.max(box.b, spot.y + reach.b);
        return spot;
      });
      geo.box = box;
      if (hot >= 0) place(hot);
    }

    /* Topmost card under the pointer, worked out from the resting fan. The
       lifted card is ignored on purpose, so it never blocks its neighbours
       and a slow glide steps through every card. */
    function pick(px, py) {
      var box = geo.box;
      if (!box) return -1;
      var x = px - geo.ox;
      var y = py - geo.oy;
      if (x < box.l || x > box.r || y < box.t || y > box.b) return -1;
      var hw = geo.w / 2;
      var up = -PIVOT * geo.h;
      var down = (1 - PIVOT) * geo.h;
      for (var i = n - 1; i >= 0; i--) {
        var s = geo.spots[i];
        var dx = x - s.x;
        var dy = y - s.y;
        var lx = dx * s.cos + dy * s.sin;
        if (lx < -hw || lx > hw) continue;
        var ly = dy * s.cos - dx * s.sin;
        if (ly >= up && ly <= down) return i;
      }
      return -1;
    }

    function overLifted(px, py) {
      if (!lifted) return false;
      var x = px - geo.ox - lifted.x;
      var y = py - geo.oy - lifted.y;
      var lx = (x * lifted.cos + y * lifted.sin) / lifted.zoom;
      var ly = (y * lifted.cos - x * lifted.sin) / lifted.zoom;
      return lx >= -geo.w / 2 && lx <= geo.w / 2 && ly >= -PIVOT * geo.h && ly <= (1 - PIVOT) * geo.h;
    }

    function nearFan(px, py) {
      var box = geo.box;
      if (!box) return false;
      var x = px - geo.ox;
      var y = py - geo.oy;
      return x >= box.l - REACH && x <= box.r + REACH && y >= box.t - REACH && y <= box.b + REACH;
    }

    /* Size and nudge for the lifted card. It stays on its own spot. The
       nudge is zero unless the larger card would leave its room. */
    function place(i) {
      var s = geo.spots[i];
      var room = geo.room;
      var tilt = s.turn * TILT;
      var cos = Math.cos(tilt);
      var sin = Math.sin(tilt);
      var e = extent(geo.w, geo.h, cos, sin);
      var zoom = Math.max(1.2, Math.min(2,
        (room.r - room.l) / (e.r - e.l),
        (room.b - room.t) / (e.b - e.t)));
      var cx = geo.ox + s.x;
      var cy = geo.oy + s.y - geo.h * LIFT;
      var dx = fit(cx + e.l * zoom, cx + e.r * zoom, room.l, room.r);
      var dy = fit(cy + e.t * zoom, cy + e.b * zoom, room.t, room.b) - geo.h * LIFT;
      var style = cards[i].style;
      style.setProperty("--hx", dx.toFixed(1) + "px");
      style.setProperty("--hy", dy.toFixed(1) + "px");
      style.setProperty("--hr", (tilt * 180 / Math.PI).toFixed(3) + "deg");
      style.setProperty("--zoom", zoom.toFixed(3));
      lifted = { x: s.x + dx, y: s.y + dy, cos: cos, sin: sin, zoom: zoom };
    }

    /* ---------- State ---------- */

    var open = false;
    var live = false;
    var pinned = false;
    var flipped = false;
    var hot = -1;
    var touch = false;
    var dragging = false;
    var onFlip = false;
    var stale = false;
    var queued = false;
    var px = 0;
    var py = 0;
    var openedAt = 0;
    var startX = 0;
    var startY = 0;
    var wake = 0;
    var sharpTimer = 0;
    var cooling = {};

    /* Swap in the sharp picture once it is fully decoded, so the swap
       never stalls a frame. Waits for the pointer to rest on a card. */
    function sharpen(card) {
      var img = card.querySelector(flipped ? ".pack-back" : ".pack-front");
      if (!img || img.dataset.state) return;
      var full = img.getAttribute("data-full");
      if (!full) return;
      img.dataset.state = "loading";
      var pre = new Image();
      pre.decoding = "async";
      pre.src = full;
      var ready = pre.decode ? pre.decode() : new Promise(function (resolve, reject) {
        pre.onload = resolve;
        pre.onerror = reject;
      });
      ready.then(function () {
        img.src = full;
        img.dataset.state = "ready";
      }, function () {
        img.dataset.state = "";
      });
    }

    function setHot(i) {
      if (i === hot) return;
      if (hot >= 0) {
        var was = hot;
        var old = cards[was];
        old.classList.remove("is-hot");
        old.classList.add("was-hot");
        clearTimeout(cooling[was]);
        cooling[was] = setTimeout(function () { old.classList.remove("was-hot"); }, 260);
      }
      hot = i;
      clearTimeout(sharpTimer);
      if (i < 0) {
        lifted = null;
        return;
      }
      clearTimeout(cooling[i]);
      place(i);
      cards[i].classList.remove("was-hot");
      cards[i].classList.add("is-hot");
      if (!live) {
        live = true;
        pack.classList.add("is-live");
      }
      sharpTimer = setTimeout(function () {
        if (hot === i) sharpen(cards[i]);
      }, 120);
    }

    function openFan() {
      if (open) return;
      open = true;
      openedAt = performance.now();
      startX = px;
      startY = py;
      readOrigin();
      pack.classList.add("is-open");
      pack.setAttribute("aria-expanded", "true");
      clearTimeout(wake);
      wake = setTimeout(schedule, 300);
    }

    function closeFan() {
      if (!open) return;
      setHot(-1);
      open = false;
      live = false;
      pack.classList.remove("is-open", "is-live");
      pack.setAttribute("aria-expanded", "false");
    }

    /* One pass per frame at most, however fast the pointer reports. */
    function schedule() {
      if (queued || !open) return;
      queued = true;
      requestAnimationFrame(tick);
    }

    function tick() {
      queued = false;
      if (!open) return;
      if (stale) {
        stale = false;
        readOrigin();
        if (hot >= 0) place(hot);
      }
      if (onFlip) return;
      var i = pick(px, py);
      if (i >= 0) {
        /* Let the fan open before the first card lifts. */
        if (!touch && hot < 0) {
          var moved = Math.abs(px - startX) + Math.abs(py - startY);
          if (performance.now() - openedAt < 260 || moved < 10) return;
        }
        setHot(i);
        return;
      }
      if (hot >= 0 && overLifted(px, py)) return;
      if (touch || pinned) return;
      if (nearFan(px, py)) setHot(-1);
      else closeFan();
    }

    /* ---------- Mouse ---------- */

    pack.addEventListener("pointerenter", function (e) {
      if (e.pointerType !== "mouse") return;
      touch = false;
      px = e.clientX;
      py = e.clientY;
      openFan();
    });

    window.addEventListener("pointermove", function (e) {
      if (!open) return;
      if (e.pointerType === "mouse") touch = false;
      else if (!dragging) return;
      px = e.clientX;
      py = e.clientY;
      onFlip = !!flip && e.target instanceof Element && flip.contains(e.target);
      schedule();
    }, { passive: true });

    document.documentElement.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse" && !pinned) closeFan();
    });

    /* ---------- Touch ---------- */

    pack.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      touch = true;
      onFlip = false;
      px = e.clientX;
      py = e.clientY;
      if (!open) {
        openFan();
        return;
      }
      dragging = true;
      schedule();
    });

    function endDrag() { dragging = false; }
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" || !open) return;
      if (!(e.target instanceof Element) || pack.contains(e.target) || (flip && flip.contains(e.target))) return;
      pinned = false;
      closeFan();
    });

    /* ---------- Keyboard ---------- */

    pack.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (open && pinned) {
          pinned = false;
          closeFan();
        } else {
          pinned = true;
          openFan();
        }
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        pinned = false;
        closeFan();
        return;
      }
      var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      pinned = true;
      setHot(hot < 0 ? (step > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, hot + step)));
    });

    pack.addEventListener("blur", function () {
      if (!pinned) return;
      pinned = false;
      if (!nearFan(px, py)) closeFan();
    });

    /* ---------- Flip ---------- */

    if (flip) {
      flip.addEventListener("click", function () {
        flipped = !flipped;
        pack.classList.toggle("is-flipped", flipped);
        pack.classList.toggle("is-unflipped", !flipped);
        flip.setAttribute("aria-pressed", String(flipped));
        flip.textContent = flipped ? "Show the faces" : "Show the backs";
        if (hot >= 0) sharpen(cards[hot]);
      });
    }

    /* ---------- Window ---------- */

    var resizing = false;
    window.addEventListener("resize", function () {
      if (resizing) return;
      resizing = true;
      requestAnimationFrame(function () {
        resizing = false;
        layout();
      });
    });

    /* The page can move under a still pointer. Look again when it does. */
    window.addEventListener("scroll", function () {
      if (!open) return;
      stale = true;
      schedule();
    }, { passive: true });

    /* Cards hold their own layers only while the pack is near the screen,
       and a fan left open closes once it has scrolled away. */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        var near = entries[entries.length - 1].isIntersecting;
        pack.classList.toggle("is-near", near);
        if (near) layout();
        else if (!pinned) closeFan();
      }, { rootMargin: "30% 0px" }).observe(pack);
    } else {
      pack.classList.add("is-near");
    }

    layout();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-card-pack]"), mount);
})();
