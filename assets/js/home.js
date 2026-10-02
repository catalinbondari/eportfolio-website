/* Home page layer: hero instrument wiring, the horizontal Experience chapter (stations),
   timeline rail, skill cube, station WebGL mounting, 3D work cards and the right HUD rail.
   Loaded by app.js on the home page only. Everything degrades to the plain HTML. */

let ctx;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const scrollSubs = new Set();
const onScroll = (fn) => scrollSubs.add(fn);

/* one scroll hub for the page: ScrollTrigger when present, rAF-throttled listener otherwise */
function initScrollHub() {
  const ST = window.ScrollTrigger;
  let queued = false;
  const run = () => { queued = false; scrollSubs.forEach((fn) => fn()); };
  if (ST) ST.create({ start: 0, end: "max", onUpdate: () => { if (!queued) { queued = true; requestAnimationFrame(run); } }, onRefresh: () => requestAnimationFrame(run) });
  else addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(run); } }, { passive: true });
  addEventListener("resize", () => requestAnimationFrame(run), { passive: true });
}

/* ================================================================ hero */
function initHero() {
  const host = $("[data-surface]");
  const hud = $("[data-hero-hud]");
  const zk = $("[data-zoom-key]");
  if (zk) zk.textContent = ctx.isMac ? "⌘" : "Ctrl";
  if (!host || ctx.reduced() || ctx.tier < 1) return;
  const tm = Object.fromEntries($$("[data-tm]").map((el) => [el.dataset.tm, el]));
  const viewBtns = $$("[data-view]", hud);
  const regimeBtn = $("[data-regime]", hud);
  const pinBtn = $("[data-pin-centre]", hud);
  const sgn = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);
  const start = () => import("./hero.js").then((m) => {
    const api = m.mountHero(host, {
      tier: ctx.tier,
      ui: {
        pins: $("[data-pins]"), label: $("[data-probe-label]"), probe: $("[data-probe]"), pinBtn,
        onView: (name) => viewBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === name))),
        onTelemetry: (v) => {
          if (tm.atm) tm.atm.textContent = v.atm.toFixed(2) + "%";
          if (tm.skew) tm.skew.textContent = sgn(v.skew);
          if (tm.term) tm.term.textContent = sgn(v.slope);
          if (tm.regime) tm.regime.textContent = v.regime;
          if (tm.fps) tm.fps.textContent = v.fps + " fps";
        },
        onBail: () => { hud.hidden = true; },
      },
    });
    if (!api) return;
    hud.hidden = false;
    // scroll-linked fold: the surface flattens and the camera rises as the hero leaves
    const hero = host.closest(".hero") || host;
    const fold = () => api.setScroll(scrollY / Math.max(1, hero.offsetHeight * 0.85));
    onScroll(fold); fold();
    viewBtns.forEach((b) => b.addEventListener("click", () => api.setView(b.dataset.view)));
    regimeBtn.addEventListener("click", () => { const on = regimeBtn.getAttribute("aria-pressed") !== "true"; regimeBtn.setAttribute("aria-pressed", String(on)); api.setRegime(on); });
    pinBtn.addEventListener("click", () => api.pinCentre());
  }).catch(() => { /* poster stays */ });
  // every tier starts once the page has loaded and the main thread is idle: the poster stays the
  // LCP image and three.js is only imported after first paint. Phones get tier 1 (lower DPR, fewer objects).
  ctx.idle(start, 600);
}

/* ================================================================ chapter */
let chapter = { horizontal: false, stationY: () => null, st: null };

function initChapter() {
  const sec = $("[data-chapter]");
  if (!sec) return;
  const pin = $("[data-chapter-pin]", sec), track = $("[data-chapter-track]", sec);
  const stations = $$(".station", sec);
  const links = $$("[data-station-link]", sec);
  const nodes = $$("[data-rail-node]", sec);
  const signal = $("[data-rail-signal]", sec);
  const rail = $("[data-rail]", sec);
  const gsap = window.gsap, ST = window.ScrollTrigger;
  const canPin = gsap && ST && !ctx.reduced() && matchMedia("(min-width: 960px) and (min-height: 620px) and (pointer: fine)").matches;

  const setActive = (i) => {
    links.forEach((a, j) => a.classList.toggle("is-active", j === i));
    chapter.active = i;
  };
  const revealed = new Set();
  const revealStation = (el) => {
    if (revealed.has(el)) return;
    revealed.add(el);
    ctx.scan?.(el);
  };

  if (!canPin) {
    // vertical sequence: rail nodes light as they cross 60% of the viewport
    if (ctx.reduced() || !("IntersectionObserver" in window)) nodes.forEach((n) => n.classList.add("is-lit"));
    else {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-lit"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -40% 0px" });
      nodes.forEach((n) => io.observe(n));
      const sio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { revealStation(e.target); setActive(stations.indexOf(e.target)); } }), { rootMargin: "0px 0px -35% 0px" });
      stations.forEach((s) => sio.observe(s));
    }
    chapter.stationY = (i) => { const el = stations[i]; return el ? el.getBoundingClientRect().top + scrollY - 72 : null; };
    return;
  }

  sec.classList.add("is-horizontal");
  nodes.forEach((n) => { const d = document.createElement("span"); d.className = "node-dot"; d.setAttribute("aria-hidden", "true"); n.append(d); });
  const dist = () => Math.max(0, track.scrollWidth - innerWidth);
  const leftOf = (el) => el.getBoundingClientRect().left - track.getBoundingClientRect().left;
  const stationP = (el) => clamp((leftOf(el) - ctx.gutter()) / Math.max(1, dist()), 0, 1);
  let snaps = [];
  const computeSnaps = () => { snaps = [0, ...stations.map(stationP), 1]; };

  const tween = gsap.to(track, {
    x: () => -dist(),
    ease: "none",
    scrollTrigger: {
      trigger: sec,
      start: "top top",
      end: () => "+=" + dist(),
      pin,
      scrub: 0.7,
      invalidateOnRefresh: true,
      anticipatePin: 1,
      onRefresh: computeSnaps,
    },
  });
  // soft snap: when scrolling stops close to a station start, settle onto it (never flings)
  ST.addEventListener("scrollEnd", () => {
    const st = chapter.st;
    if (!st || !st.isActive || ctx.reduced()) return;
    const v = st.progress;
    let best = null, bd = 0.03;
    for (const s of snaps) { const d = Math.abs(s - v); if (d > 0.002 && d < bd) { bd = d; best = s; } }
    if (best != null) window.scrollTo({ top: Math.round(st.start + best * (st.end - st.start)), behavior: "smooth" });
  });
  chapter.st = tween.scrollTrigger;
  chapter.horizontal = true;
  chapter.stationY = (i) => { const st = chapter.st, el = stations[i]; if (!st || !el) return null; return st.start + stationP(el) * (st.end - st.start); };

  // per-frame, scrub-driven: coverflow tilt, rail light-up, signal playhead, station reveals
  const tick = () => {
    const vw = innerWidth;
    const rects = nodes.map((n) => n.getBoundingClientRect());
    const rr = rail.getBoundingClientRect();
    rects.forEach((r, i) => {
      const c = (r.left + r.width / 2 - vw / 2) / vw;
      nodes[i].style.transform = `rotateY(${(-c * 24).toFixed(2)}deg) translateZ(${(-Math.abs(c) * 140).toFixed(1)}px)`;
      if (r.left < vw * 0.66) nodes[i].classList.add("is-lit"); else nodes[i].classList.remove("is-lit");
    });
    if (signal) signal.style.transform = `translate3d(${(clamp(vw * 0.5 - rr.left, 0, rr.width) - 90).toFixed(1)}px,0,0)`;
    let act = -1;
    stations.forEach((s, i) => { const r = s.getBoundingClientRect(); if (r.left < vw * 0.82) { revealStation(s); act = i; } });
    if (act !== chapter.active) setActive(act);
  };
  gsap.ticker.add(() => { const st = chapter.st; if (st && st.isActive) tick(); });
  ST.addEventListener("refresh", () => requestAnimationFrame(tick));
  requestAnimationFrame(tick);

  // keyboard: focusing something inside an off-screen station scrolls the page to that station
  track.addEventListener("focusin", (e) => {
    const s = e.target.closest(".station, .chapter-intro");
    if (!s) return;
    const st = chapter.st;
    const r = e.target.getBoundingClientRect();
    if (r.left >= 0 && r.right <= innerWidth && scrollY >= st.start - 2 && scrollY <= st.end + 2) return;
    const y = s.classList.contains("chapter-intro") ? st.start : chapter.stationY(stations.indexOf(s));
    if (y == null) return;
    window.scrollTo({ top: Math.round(y), behavior: "instant" });
    st.update?.();
    gsap.set(track, { x: -(stationP(s) * dist()) });
  });
  links.forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); goStation(+a.dataset.stationLink, true); }));
  document.fonts?.ready?.then(() => ST.refresh());
  // a deep link (#work etc.) was resolved against the vertical layout: resolve it again
  if (location.hash.length > 1) requestAnimationFrame(() => { const t = document.getElementById(location.hash.slice(1)); if (t) { ST.refresh(); jumpTo(t); } });
}

function jumpTo(el) {
  const i = $$("[data-chapter] .station").indexOf(el.closest?.(".station"));
  if (i >= 0) return goStation(i, false);
  window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - (ctx.headerH() + 16), behavior: "instant" });
}
function goStation(i, focus) {
  const y = chapter.stationY(i);
  if (y == null) return;
  window.scrollTo({ top: Math.round(y), behavior: ctx.reduced() ? "auto" : "smooth" });
  if (focus) {
    const h = $$("[data-chapter] .station h3")[i];
    if (h) { h.setAttribute("tabindex", "-1"); setTimeout(() => h.focus({ preventScroll: true }), ctx.reduced() ? 0 : 650); }
  }
}

/* ================================================================ cube */
function initCube() {
  const viz = $("[data-viz='cube']"), cube = $("[data-cube]"), wire = $(".cube-wire"), list = $("[data-skill-list]");
  const controls = $("[data-cube-controls]");
  if (!viz || !cube || !list) return;
  const groups = $$("[data-face]", list);
  const faces = $$(".cube-face", cube);
  // faces mirror the list (the list is the accessible content; the cube is aria-hidden)
  groups.forEach((g, i) => {
    const items = $$("li", g).map((li) => `<li>${li.innerHTML}</li>`).join("");
    const n = $$("li", g).length;
    faces[i].innerHTML = `<span class="cf-id"><span>F-0${i + 1}</span><span>${n === 1 ? "1 skill" : n + " skills"}</span></span><span class="cf-title">${$("dt", g).innerHTML}</span><ul>${items}</ul><span class="cf-n">${String(n).padStart(2, "0")}</span>`;
  });
  faces[5].innerHTML = `<span class="cf-id"><span>F-06</span><span>index</span></span><span class="cf-title">Toolkit</span><ul><li>5 groups</li><li>18 skills</li></ul><span class="cf-n">18</span>`;
  wire.innerHTML = "<i></i>".repeat(6);
  $$("i", wire).forEach((f, i) => { f.style.transform = ["rotateY(0deg)", "rotateY(90deg)", "rotateY(180deg)", "rotateY(-90deg)", "rotateX(90deg)", "rotateX(-90deg)"][i] + " translateZ(calc(var(--s) / 2))"; });

  const live = document.createElement("span");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  controls.append(live);
  controls.hidden = false;

  const reduced = ctx.reduced();
  const s = { rx: -14, ry: -28, vx: 0, vy: 0, tx: null, ty: null };
  let front = -1, dragging = false, lastUser = 0, raf = 0, visible = false;
  const faceMats = faces.map((f) => new DOMMatrix(getComputedStyle(f).transform));
  const computeFront = () => {
    const m = new DOMMatrix().rotateAxisAngleSelf(1, 0, 0, s.rx).rotateAxisAngleSelf(0, 1, 0, s.ry);
    let best = 0, bz = -2;
    faceMats.forEach((fm, i) => {
      const t = m.multiply(fm);
      const z = t.transformPoint(new DOMPoint(0, 0, 1, 0)).z; // face normal, w=0 (direction)
      if (z > bz) { bz = z; best = i; }
    });
    return best;
  };
  const apply = () => {
    cube.style.transform = `rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg)`;
    wire.style.transform = `rotateX(${(s.rx * 0.6).toFixed(2)}deg) rotateY(${(-s.ry * 0.35).toFixed(2)}deg) scale3d(1.42,1.42,1.42)`;
    const f = computeFront();
    if (f !== front) {
      front = f;
      faces.forEach((el, i) => el.classList.toggle("is-front", i === f));
      groups.forEach((g, i) => g.classList.toggle("is-face", i === f));
    }
  };
  const targetFor = (k) => (k < 4 ? { rx: -14, ry: -k * 90 } : k === 4 ? { rx: -78, ry: 0 } : { rx: 78, ry: 0 });
  const nearestRy = (ry) => { let r = ry; while (r - s.ry > 180) r -= 360; while (s.ry - r > 180) r += 360; return r; };
  const goFace = (k, announce) => {
    const t = targetFor(k);
    s.tx = t.rx; s.ty = nearestRy(t.ry); s.vx = s.vy = 0;
    if (reduced) { s.rx = s.tx; s.ry = s.ty; s.tx = s.ty = null; apply(); }
    else kick();
    if (announce) live.textContent = "Showing " + $("dt", groups[k] || groups[0]).textContent;
  };
  const settle = () => { // snap to the nearest face after a fling
    if (Math.abs(s.rx) > 50) { s.tx = s.rx > 0 ? 78 : -78; s.ty = nearestRy(Math.round(s.ry / 90) * 90); }
    else { s.tx = -14; s.ty = Math.round(s.ry / 90) * 90; }
  };
  let last = performance.now();
  const loop = (now) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    let moving = false;
    if (!dragging) {
      if (s.tx != null) {
        const k = 1 - Math.exp(-dt * 7);
        s.rx += (s.tx - s.rx) * k; s.ry += (s.ty - s.ry) * k;
        if (Math.abs(s.tx - s.rx) < 0.05 && Math.abs(s.ty - s.ry) < 0.05) { s.rx = s.tx; s.ry = s.ty; s.tx = s.ty = null; } else moving = true;
      } else if (Math.abs(s.vx) + Math.abs(s.vy) > 8) {
        s.ry += s.vy * dt; s.rx = clamp(s.rx + s.vx * dt, -88, 88);
        const d = Math.exp(-dt * 3.2); s.vx *= d; s.vy *= d; moving = true;
        if (Math.abs(s.vx) + Math.abs(s.vy) <= 8) { settle(); }
      }
    }
    apply();
    if (moving || dragging) kick();
  };
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };

  // drag with pointer capture and inertia
  let p0 = null;
  viz.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    p0 = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, touch: e.pointerType === "touch" };
    s.tx = s.ty = null; s.vx = s.vy = 0;
    if (!p0.touch) viz.setPointerCapture(e.pointerId);
  });
  viz.addEventListener("pointermove", (e) => {
    if (!p0) return;
    const dx = e.clientX - p0.x, dy = e.clientY - p0.y, now = performance.now(), dt = Math.max(8, now - p0.t);
    p0.moved += Math.abs(dx) + Math.abs(dy);
    if (!dragging && p0.moved > 4) { dragging = true; viz.classList.add("is-dragging"); }
    if (!dragging) return;
    s.ry += dx * 0.45;
    if (!p0.touch) s.rx = clamp(s.rx - dy * 0.35, -88, 88);
    s.vy = s.vy * 0.5 + ((dx * 0.45) / dt) * 1000 * 0.5;
    s.vx = p0.touch ? 0 : s.vx * 0.5 + ((-dy * 0.35) / dt) * 1000 * 0.5;
    p0.x = e.clientX; p0.y = e.clientY; p0.t = now;
    lastUser = now;
    if (reduced) { s.vx = s.vy = 0; }
    kick();
  });
  const end = () => {
    if (!p0) return;
    if (performance.now() - p0.t > 90) { s.vx = s.vy = 0; }
    p0 = null;
    if (dragging) { dragging = false; viz.classList.remove("is-dragging"); if (Math.abs(s.vx) + Math.abs(s.vy) <= 8) settle(); kick(); }
  };
  viz.addEventListener("pointerup", end);
  viz.addEventListener("pointercancel", end);
  $$("[data-cube-step]", controls).forEach((b) => b.addEventListener("click", () => {
    lastUser = performance.now();
    const cur = front > 4 ? 0 : front;
    goFace((cur + +b.dataset.cubeStep + 5) % 5, true);
  }));
  // idle: step to the next face every few seconds while visible (not under reduced motion)
  if (!reduced) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(viz);
    setInterval(() => { if (visible && !document.hidden && !dragging && performance.now() - lastUser > 7000) goFace(((front > 4 ? -1 : front) + 1) % 5, false); }, 3600);
  }
  apply();
}

/* ================================================================ stations (WebGL) */
function initStations() {
  const vChart = $("[data-viz='chart']"), vRadar = $("[data-viz='radar']");
  const range = $("[data-chart-pick]"), chartOut = $("[data-chart-readout]"), radarOut = $("[data-radar-readout]");
  const sigBtns = $$("[data-signal]");
  const ctrl = { chart: null, radar: null };
  let mod = null, loading = null;
  let chartPick = 15, radarPick = -1;

  const writeChart = (i) => {
    if (!mod) return;
    const [o, h, l, c] = mod.CANDLES[i];
    const ch = ((c - o) / o) * 100;
    chartOut.textContent = `W${String(i + 1).padStart(2, "0")} · O ${o.toFixed(2)} · H ${h.toFixed(2)} · L ${l.toFixed(2)} · C ${c.toFixed(2)} · ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`;
  };
  const writeRadar = (i) => {
    if (!mod) return;
    const [name, b, r, lv] = mod.SIGNALS[i];
    radarOut.textContent = `${name} · bearing ${String(b).padStart(3, "0")}° · range ${r.toFixed(2)} · level ${Math.round(lv * 100)} / 100 (synthetic)`;
    sigBtns.forEach((btn, j) => btn.setAttribute("aria-pressed", String(j === i)));
  };
  const load = () => (loading ||= import("./stations.js").then((m) => { mod = m; return m; }));
  // keyboard equivalents work with or without WebGL
  range?.addEventListener("input", () => { chartPick = +range.value - 1; load().then(() => { writeChart(chartPick); ctrl.chart?.setPick(chartPick); }); });
  sigBtns.forEach((b) => b.addEventListener("click", () => { radarPick = +b.dataset.signal; load().then(() => { writeRadar(radarPick); ctrl.radar?.setPick(radarPick); }); }));

  if (ctx.tier < 1 || !vChart || !vRadar) return;
  const opts = { tier: ctx.tier, reduced: ctx.reduced() };
  const mounts = [
    ["chart", vChart, (m) => m.mountChart(vChart, { ...opts, onPick: (i) => { chartPick = i; range.value = String(i + 1); writeChart(i); } })],
    ["radar", vRadar, (m) => m.mountRadar(vRadar, { ...opts, onPick: (i) => { radarPick = i; writeRadar(i); } })],
  ];
  const check = () => {
    const vw = innerWidth, vh = innerHeight;
    for (const [key, viz, mount] of mounts) {
      const r = viz.getBoundingClientRect();
      const near = r.right > -vw * 0.8 && r.left < vw * 1.8 && r.bottom > -vh * 0.8 && r.top < vh * 1.8;
      const far = r.right < -vw * 1.5 || r.left > vw * 2.6 || r.bottom < -vh * 1.5 || r.top > vh * 2.6;
      if (near && !ctrl[key]) {
        ctrl[key] = "loading";
        load().then((m) => {
          const c = mount(m);
          ctrl[key] = c || null;
          if (!c) return;
          if (key === "chart") c.setPick(chartPick); else if (radarPick >= 0) c.setPick(radarPick);
        }).catch(() => { ctrl[key] = null; });
      } else if (far && ctrl[key] && ctrl[key] !== "loading") { ctrl[key].dispose(); ctrl[key] = null; }
    }
  };
  onScroll(check);
  if (window.gsap) gsap.ticker.add(() => { if (chapter.st?.isActive) check(); });
  check();
}

/* ================================================================ work cards */
function initCards() {
  const cards = $$("[data-card3d]");
  const gsap = window.gsap;
  const tilt = gsap && ctx.fine() && !ctx.reduced();
  cards.forEach((card) => {
    const link = $("h3 a", card);
    const spec = $(".card-spec", card);
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      if (String(getSelection?.() || "").length) return;
      link?.click();
    });
    const rx = tilt ? gsap.quickTo(card, "rotationX", { duration: 0.6, ease: "power3.out" }) : null;
    const ry = tilt ? gsap.quickTo(card, "rotationY", { duration: 0.6, ease: "power3.out" }) : null;
    if (tilt) {
      card.addEventListener("pointerenter", () => card.classList.add("is-lifted"));
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        ry((px - 0.5) * 12); rx(-(py - 0.5) * 9);
        spec.style.setProperty("--px", (px * 100).toFixed(1) + "%");
        spec.style.setProperty("--py", (py * 100).toFixed(1) + "%");
      });
      card.addEventListener("pointerleave", () => { if (!card.contains(document.activeElement)) card.classList.remove("is-lifted"); rx(0); ry(0); });
    }
    // keyboard focus gets the same separation
    card.addEventListener("focusin", () => { card.classList.add("is-lifted"); if (tilt) { rx(4); ry(-6); } });
    card.addEventListener("focusout", () => { if (!card.matches(":hover")) card.classList.remove("is-lifted"); if (tilt) { rx(0); ry(0); } });
  });
}

/* ================================================================ right HUD rail */
function initRail() {
  if (!matchMedia("(min-width: 1100px) and (hover: hover)").matches) return;
  const targets = [
    ["top", "Index"], ["about", "About"], ["experience", "Experience"],
    ["stn-timeline", "STN-01 Timeline", 0], ["stn-data", "STN-02 Data", 1], ["stn-risk", "STN-03 Risk", 2], ["stn-tools", "STN-04 Toolkit", 3],
    ["work", "Work"], ["projects", "Projects"], ["writing", "Writing"], ["media", "Media"], ["reading", "Reading"],
    ["credentials", "Credentials"], ["more-about-me", "More about me"], ["contact", "Contact"],
  ].filter(([id]) => document.getElementById(id));
  const nav = document.createElement("nav");
  nav.className = "hud-rail";
  nav.setAttribute("aria-label", "Section scrubber");
  nav.innerHTML = `<span class="hr-head" aria-hidden="true">Nav</span><div class="hr-track"><span class="hr-fill"></span>${targets.map(([id, label, st]) =>
    `<a class="hr-link${st != null ? " is-sub" : ""}" href="#${id}"${st != null ? ` data-st="${st}"` : ""}><span class="hr-tip">${label}</span><span class="visually-hidden">${label}</span></a>`).join("")}<span class="hr-cursor"></span></div>
    <div class="hr-read" aria-hidden="true"><span>V<b data-hr-v>0</b></span><span>Y<b data-hr-y>0</b></span><span>X<b data-hr-x>--</b></span></div>`;
  document.body.append(nav);
  document.documentElement.classList.add("has-rail");
  const links = $$(".hr-link", nav), fill = $(".hr-fill", nav), cursor = $(".hr-cursor", nav), track = $(".hr-track", nav);
  const vOut = $("[data-hr-v]", nav), yOut = $("[data-hr-y]", nav), xOut = $("[data-hr-x]", nav);
  let ys = [];
  const yFor = ([id, , st]) => (st != null ? chapter.stationY(st) : id === "top" ? 0 : document.getElementById(id).getBoundingClientRect().top + scrollY - (ctx.headerH() + 16));
  const layout = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    ys = targets.map((t) => clamp(yFor(t) ?? 0, 0, max));
    // keep at least 24px between ticks (WCAG 2.2 target size) when sections sit close together
    const H = track.clientHeight, gap = 24, pos = ys.map((y) => (y / max) * H);
    for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + gap);
    for (let i = pos.length - 1; i >= 0; i--) pos[i] = Math.min(pos[i], (i === pos.length - 1 ? H : pos[i + 1] - gap));
    links.forEach((a, i) => { a.style.top = pos[i].toFixed(1) + "px"; });
  };
  links.forEach((a, i) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const t = targets[i];
    if (t[2] != null) return goStation(t[2], true);
    const el = document.getElementById(t[0]);
    history.pushState(null, "", "#" + t[0]);
    window.scrollTo({ top: ys[i], behavior: ctx.reduced() ? "auto" : "smooth" });
    const h = $("h1, h2", el) || el;
    h.setAttribute("tabindex", "-1");
    setTimeout(() => h.focus({ preventScroll: true }), ctx.reduced() ? 0 : 700);
  }));
  let lastY = scrollY, lastT = performance.now(), vel = 0, decay = 0, cur = -1;
  const write = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const p = clamp(scrollY / max, 0, 1);
    fill.style.setProperty("--p", p.toFixed(4));
    cursor.style.transform = `translate3d(0, ${(p * track.clientHeight).toFixed(1)}px, 0)`;
    yOut.textContent = String(Math.round(scrollY)).padStart(5, "0");
    const st = chapter.st;
    xOut.textContent = st && scrollY >= st.start && scrollY <= st.end ? Math.round(st.progress * 100) + "%" : "--";
    let c = 0;
    ys.forEach((y, i) => { if (scrollY + innerHeight * 0.35 >= y) c = i; });
    if (c !== cur) { cur = c; links.forEach((a, i) => a.setAttribute("aria-current", String(i === c))); }
  };
  onScroll(() => {
    const now = performance.now(), dt = Math.max(1, now - lastT);
    vel = vel * 0.6 + (Math.abs(scrollY - lastY) / dt) * 1000 * 0.4;
    lastY = scrollY; lastT = now;
    write();
    if (!decay) decay = requestAnimationFrame(fall);
  });
  const fall = () => {
    decay = 0;
    if (performance.now() - lastT > 120) vel *= 0.85;
    vOut.textContent = vel > 999 ? (vel / 1000).toFixed(1) + "k" : String(Math.round(vel));
    if (vel > 1) decay = requestAnimationFrame(fall); else vOut.textContent = "0";
  };
  if (window.ScrollTrigger) ScrollTrigger.addEventListener("refresh", () => { layout(); write(); });
  addEventListener("load", () => { layout(); write(); });
  layout(); write();
}

export function initHome(c) {
  ctx = c;
  initScrollHub();
  initChapter();
  initCube();
  initStations();
  initCards();
  initRail();
  initHero();
}
