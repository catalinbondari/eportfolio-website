/* Terminal 2035 v2: progressive enhancement layer.
   Everything here is optional: with JS off (or a failure) the HTML is complete and readable.
   Home-only work (3D hero, stations, rail) lives in home.js and is imported on the home page. */

const doc = document.documentElement;
const body = document.body;
const ROOT = body.dataset.root || "./";
const PAGE = body.dataset.page || "page";
const mqReduced = matchMedia("(prefers-reduced-motion: reduce)");
const mqFine = matchMedia("(hover: hover) and (pointer: fine)");
const reduced = () => mqReduced.matches;
const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
const BOOT_KEY = "t35-boot";

/* ------------------------------------------------------------------ utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const raf = (fn) => requestAnimationFrame(fn);
const idle = (fn, timeout = 1200) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 200));

/* ------------------------------------------------------------------ clock */
function initClock() {
  const el = $("[data-clock]");
  if (!el) return;
  let fmt;
  try { fmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
  catch { return; }
  let timer = 0;
  const tick = () => { el.textContent = "DUB " + fmt.format(new Date()); };
  const start = () => { clearInterval(timer); tick(); timer = setInterval(tick, 1000); };
  document.addEventListener("visibilitychange", () => (document.hidden ? clearInterval(timer) : start()));
  start();
}

/* ------------------------------------------------- scroll progress & spy */
function initScrollSpy() {
  const bar = $("[data-progress]");
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = doc.scrollHeight - innerHeight;
    if (bar) bar.style.setProperty("--p", max > 0 ? Math.min(1, scrollY / max).toFixed(4) : 0);
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; raf(update); } }, { passive: true });
  update();

  const sections = $$("[data-section]");
  if (!sections.length || !("IntersectionObserver" in window)) return;
  const links = new Map($$(".site-nav a[href^='#']").map((a) => [a.getAttribute("href").slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a, id) => a.classList.toggle("is-active", id === e.target.id));
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  sections.forEach((s) => io.observe(s));
}

/* ------------------------------------------------------------- mobile nav */
function initNav() {
  const toggle = $("[data-nav-toggle]");
  const nav = toggle && document.getElementById(toggle.getAttribute("aria-controls"));
  if (!toggle || !nav) return;
  const set = (open, returnFocus) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    if (!open && returnFocus) toggle.focus();
  };
  toggle.addEventListener("click", () => set(toggle.getAttribute("aria-expanded") !== "true", false));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false, false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") set(false, true);
  });
  document.addEventListener("click", (e) => {
    if (toggle.getAttribute("aria-expanded") === "true" && !nav.contains(e.target) && !toggle.contains(e.target)) set(false, false);
  });
  matchMedia("(min-width: 1280px)").addEventListener?.("change", (e) => { if (e.matches) set(false, false); });
}

/* -------------------------------------------------------- command palette */
function paletteItems() {
  const onHome = PAGE === "home";
  const sec = (id, label, key) => ({ label, key, hint: "Section", href: (onHome ? "" : ROOT) + "#" + id, local: onHome ? id : null });
  return [
    sec("about", "About", "01"),
    sec("experience", "Experience", "02"),
    sec("work", "Selected work", "03"),
    sec("projects", "Projects (DCU coursework)", "04"),
    sec("writing", "Writing", "05"),
    sec("media", "Media (videos)", "06"),
    sec("reading", "Reading: books & podcasts", "07"),
    sec("credentials", "Education & credentials", "08"),
    sec("more-about-me", "More", "09"),
    sec("contact", "Contact", "10"),
    { label: "All posts", key: "BL", hint: "Page", href: ROOT + "blog/" },
    { label: "Bond Portfolio Centre", key: "W1", hint: "Case study", href: ROOT + "work/bond-portfolio-centre.html" },
    { label: "Weekly Market Update", key: "W2", hint: "Case study", href: ROOT + "work/weekly-market-update.html" },
    { label: "Phishing email classification", key: "P1", hint: "Project", href: ROOT + "work/phishing-email-classification.html" },
    { label: "Telegram BI bot", key: "P2", hint: "Project", href: ROOT + "work/telegram-bi-bot.html" },
    { label: "Time-series features", key: "P3", hint: "Project", href: ROOT + "work/time-series-features.html" },
    { label: "Daft.ie data analysis app", key: "P4", hint: "Project", href: ROOT + "work/daft-data-analysis-app.html" },
    { label: "Power BI sales analysis", key: "P5", hint: "Project", href: ROOT + "work/power-bi-sales-analysis.html" },
    { label: "Bank customer churn prediction", key: "P6", hint: "Project", href: ROOT + "work/bank-churn-prediction.html" },
    { label: "Bond Portfolio Centre: live demo", key: "D1", hint: "Demo", href: ROOT + "demo/bond/" },
    { label: "Weekly Market Update: live demo", key: "D2", hint: "Demo", href: ROOT + "demo/weekly/" },
    { label: "Replay intro", key: "&gt;_", hint: "Command", action: "replay" },
    { label: "Download CV (PDF)", key: "CV", hint: "File", href: ROOT + "assets/Catalin_Bondari_CV.pdf", download: true },
    { label: "LinkedIn", key: "IN", hint: "External", href: "https://www.linkedin.com/in/catalinbondari/" },
    { label: "GitHub", key: "GH", hint: "External", href: "https://github.com/catalinbondari" },
    { label: "Building a Desktop Tool Your Colleagues Can Use with Python's tkinter", key: "01", hint: "Post", href: ROOT + "blog/python-tkinter-intermediate.html" },
    { label: "How to Choose a Machine Learning Algorithm for Tabular Data", key: "02", hint: "Post", href: ROOT + "blog/choosing-machine-learning-algorithm.html" },
    { label: "Quantum Computing and Data Science: What May Change, and What Already Needs Attention", key: "03", hint: "Post", href: ROOT + "blog/quantum-computing-data-science.html" },
    { label: "BERT in Practice: Tokens, Embeddings and Fine-Tuning a Text Classifier", key: "04", hint: "Post", href: ROOT + "blog/mastering-bert-guide.html" },
    { label: "Managing Large Datasets Well: Six Habits from Raw Files to Reports", key: "05", hint: "Post", href: ROOT + "blog/big-data-management-strategies.html" },
    { label: "Free Python and Data Science Courses Worth Your Time", key: "06", hint: "Post", href: ROOT + "blog/free-courses-python-data-science.html" },
    { label: "Why BERT Mattered: From Static Word Vectors to Contextual Language Models", key: "07", hint: "Post", href: ROOT + "blog/bert-revolutionizing-nlp.html" },
    { label: "Reading a Confusion Matrix When the Positive Class Is Rare", key: "08", hint: "Post", href: ROOT + "blog/confusion-matrices-classification-reports.html" },
    { label: "Machine Learning Without the Mystique: Supervised, Unsupervised and Overfitting", key: "09", hint: "Post", href: ROOT + "blog/demystifying-machine-learning.html" },
    { label: "How Readers See Charts: Perception Principles for Reporting Visuals", key: "10", hint: "Post", href: ROOT + "blog/psychology-of-data-visualization.html" },
    { label: "Power BI vs Tableau: A Practical Comparison of Data Engines, Calculations and Analytics", key: "11", hint: "Post", href: ROOT + "blog/power-bi-vs-tableau.html" },
    { label: "Web Scraping Techniques: From HTML Parsing to Headless Browsers", key: "12", hint: "Post", href: ROOT + "blog/web-scraping-techniques.html" },
    { label: "Principal Component Analysis Explained, with a Python Example", key: "13", hint: "Post", href: ROOT + "blog/principal-component-analysis.html" },
    { label: "How Linear Regression Works: Least Squares, Normal Equations and Gradient Descent", key: "14", hint: "Post", href: ROOT + "blog/linear-regression-statistics.html" },
    { label: "Boosting Algorithms for Phishing Detection: Features, Tuning and Evaluation", key: "15", hint: "Post", href: ROOT + "blog/boosting-algorithms-phishing.html" },
    ...(onHome ? [] : [{ label: "Home", key: "~", hint: "Page", href: ROOT }]),
  ];
}

function initPalette() {
  const openers = $$("[data-palette-open]");
  if (!openers.length || typeof HTMLDialogElement !== "function") return;
  const kbd = isMac ? "⌘K" : "Ctrl K";
  openers.forEach((b) => { b.hidden = false; const k = $("[data-kbd]", b); if (k) k.textContent = kbd; });
  const hint = $("[data-footer-hint]");
  if (hint) hint.innerHTML = `Press <kbd>${kbd}</kbd> to jump anywhere`;

  const items = paletteItems();
  const dlg = document.createElement("dialog");
  dlg.className = "palette";
  dlg.setAttribute("aria-labelledby", "pal-title");
  dlg.innerHTML = `
    <h2 id="pal-title" class="visually-hidden">Search</h2>
    <div class="palette-head">
      <span class="p-prompt" aria-hidden="true">&gt;</span>
      <input id="pal-input" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list"
        aria-label="Search sections and pages" placeholder="Search sections, projects and posts…" autocomplete="off" spellcheck="false">
      <button type="button" class="palette-close">Esc<span class="visually-hidden"> (close)</span></button>
    </div>
    <ul id="pal-list" class="palette-list" role="listbox" aria-label="Results"></ul>
    <p class="palette-empty" hidden role="status">No matches</p>
    <div class="palette-foot" aria-hidden="true"><span>&uarr;&darr; Move</span><span>&crarr; Open</span><span>Esc Close</span></div>`;
  body.append(dlg);
  const input = $("#pal-input", dlg);
  const list = $("#pal-list", dlg);
  const empty = $(".palette-empty", dlg);
  const closeBtn = $(".palette-close", dlg);
  let shown = [];
  let active = 0;
  let opener = null;

  const render = (q) => {
    const needle = q.trim().toLowerCase();
    shown = items.filter((it) => !needle || (it.label + " " + it.hint + " " + (it.action ? "" : it.key)).toLowerCase().includes(needle));
    list.innerHTML = shown.map((it, i) =>
      `<li class="palette-opt" role="option" id="pal-opt-${i}" aria-selected="false" data-i="${i}">` +
      `<span class="po-key" aria-hidden="true">${it.key}</span><span class="po-label">${it.label.replace(/&/g, "&amp;")}</span>` +
      `<span class="po-hint">${it.hint}</span></li>`).join("");
    empty.hidden = shown.length > 0;
    setActive(0);
  };
  const setActive = (i) => {
    if (!shown.length) { input.removeAttribute("aria-activedescendant"); return; }
    active = (i + shown.length) % shown.length;
    $$(".palette-opt", list).forEach((o, j) => o.setAttribute("aria-selected", String(j === active)));
    const el = document.getElementById("pal-opt-" + active);
    input.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  };
  const open = () => {
    if (dlg.open) return;
    opener = document.activeElement;
    input.value = "";
    render("");
    dlg.showModal();
    input.focus();
  };
  const close = (restore = true) => {
    if (!dlg.open) return;
    dlg.close();
    if (restore && opener && opener.focus) opener.focus();
  };
  const go = (it) => {
    if (!it) return;
    if (it.action === "replay") { close(false); replayIntro(); return; }
    if (it.local) {
      close(false);
      const target = document.getElementById(it.local);
      if (!target) return;
      history.pushState(null, "", "#" + it.local);
      target.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
      const h = $("h2", target) || target;
      h.setAttribute("tabindex", "-1");
      h.focus({ preventScroll: true });
      return;
    }
    close(false);
    if (it.download) {
      const a = document.createElement("a");
      a.href = it.href; a.download = ""; body.append(a); a.click(); a.remove();
      opener?.focus?.();
      return;
    }
    location.href = it.href;
  };

  input.addEventListener("input", () => render(input.value));
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Home" && document.activeElement !== input) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && document.activeElement !== input) { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === "Enter" && document.activeElement === input) { e.preventDefault(); go(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") { // focus trap: input <-> close button
      e.preventDefault();
      (document.activeElement === input ? closeBtn : input).focus();
    }
  });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => {
    const opt = e.target.closest(".palette-opt");
    if (opt) { go(shown[+opt.dataset.i]); return; }
    if (e.target === dlg) close(); // backdrop click
  });
  list.addEventListener("mousemove", (e) => {
    const opt = e.target.closest(".palette-opt");
    if (opt && +opt.dataset.i !== active) setActive(+opt.dataset.i);
  });
  closeBtn.addEventListener("click", () => close());
  openers.forEach((b) => b.addEventListener("click", open));
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      dlg.open ? close() : open();
    }
  });
}

/* ---------------------------------------------------------------- ticker */
function initTicker() {
  const t = $("[data-ticker]");
  if (!t) return;
  const btn = $("[data-ticker-toggle]", t);
  if (!btn || reduced()) return;
  btn.hidden = false;
  btn.addEventListener("click", () => {
    const paused = !t.classList.contains("is-paused");
    t.classList.toggle("is-paused", paused);
    btn.setAttribute("aria-pressed", String(paused));
  });
  // stop the animation entirely while offscreen
  if ("IntersectionObserver" in window) {
    const track = $(".ticker-track", t);
    new IntersectionObserver(([e]) => { track.style.animationPlayState = e.isIntersecting ? "" : "paused"; }).observe(t);
  }
}

/* ------------------------------------------------------------------ boot */
function bootSequence({ quick = false, replay = false } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "boot";
    el.innerHTML = `
      <div class="boot-screen" aria-hidden="true">
        <div data-l></div><div data-l></div><div data-l></div><span class="hl" data-l></span>
        <div class="boot-bar"><span></span></div>
      </div>
      <button type="button" class="boot-skip">Skip intro</button>`;
    body.append(el);
    const [l1, l2, l4, l3] = $$("[data-l]", el);
    const bar = $(".boot-bar span", el);
    const script = [
      [l1, "TERMINAL/2035 · SECURE SESSION", " [OK]", 11],
      [l2, "LOADING SQL · PYTHON · SNOWFLAKE · CLAUDE", " [OK]", 9],
      [l4, "MOUNTING 4 STATIONS · RIGHT RAIL", " [OK]", 8],
      [l3, "INITIALISING… CATALIN BONDARI QFA", "", 24],
    ];
    const total = script.reduce((s, [, t, , ms]) => s + t.length * ms, 0);
    let done = false, elapsed = 0, timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sessionStorage.setItem(BOOT_KEY, "1"); } catch {}
      removeEventListener("keydown", finish, true);
      removeEventListener("wheel", finish, { passive: true });
      removeEventListener("touchstart", finish, { passive: true });
      if (quick) {
        // reduced motion: a short opacity fade (WAAPI, so the global 0ms transition rule does not apply)
        const a = el.animate ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "linear", fill: "forwards" }) : null;
        const end = () => { el.remove(); resolve(); };
        a ? a.finished.then(end, end) : end();
        return;
      }
      el.classList.add("is-out");
      setTimeout(() => { el.remove(); resolve(); }, 420);
    };
    el.addEventListener("pointerdown", finish);
    $(".boot-skip", el).addEventListener("click", finish);
    // listeners attach after the current event, so the click/key that started a replay does not skip it
    setTimeout(() => {
      if (done) return;
      addEventListener("keydown", finish, true);
      addEventListener("wheel", finish, { passive: true });
      addEventListener("touchstart", finish, { passive: true });
    }, 0);
    if (replay) $(".boot-skip", el).focus({ preventScroll: true });

    if (quick) {
      script.forEach(([node, text, suffix]) => { node.innerHTML = text.replace(/&/g, "&amp;") + (suffix ? `<span class="ok">${suffix}</span>` : ""); });
      bar.style.transform = "scaleX(1)";
      if (el.animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "linear" });
      timer = setTimeout(finish, 900);
      return;
    }
    let line = 0, ch = 0;
    const step = () => {
      if (done) return;
      const [node, text, suffix, ms] = script[line];
      ch++;
      node.innerHTML = text.slice(0, ch).replace(/&/g, "&amp;") + '<span class="cur"></span>';
      elapsed += ms;
      bar.style.transform = `scaleX(${Math.min(1, elapsed / total)})`;
      if (ch >= text.length) {
        node.innerHTML = text.replace(/&/g, "&amp;") + (suffix ? `<span class="ok">${suffix}</span>` : '<span class="cur"></span>');
        line++; ch = 0;
        if (line >= script.length) { timer = setTimeout(finish, 380); return; }
        timer = setTimeout(step, 90);
        return;
      }
      timer = setTimeout(step, ms);
    };
    timer = setTimeout(step, 120);
  });
}

/* Replay intro (footer button + palette command): clears the once-per-session flag, goes to the
   top and plays the boot again. Off the home page it navigates home, where the boot runs. */
let replaying = false;
function replayIntro() {
  try { sessionStorage.removeItem(BOOT_KEY); } catch {}
  if (PAGE !== "home") { location.href = ROOT; return; }
  if (replaying || $(".boot")) return;
  replaying = true;
  history.replaceState(null, "", location.pathname + location.search);
  scrollTo({ top: 0, behavior: "instant" });
  bootSequence({ quick: reduced(), replay: true }).then(() => {
    replaying = false;
    heroIntro(!reduced());
    const main = $("#main");
    if (main) main.focus({ preventScroll: true });
  });
}
function initReplay() {
  $$("[data-replay-intro]").forEach((b) => { b.hidden = false; b.addEventListener("click", replayIntro); });
}

/* --------------------------------------------------------- hero + reveal */
function heroIntro(afterBoot) {
  if (afterBoot && window.gsap && !reduced()) {
    gsap.from([".hero .eyebrow", ".hero .lede", ".hero-actions", ".ledger"], {
      // transform only: text never drops below full contrast mid-animation
      y: 18, duration: 0.8, ease: "expo.out", stagger: 0.07, clearProps: "transform",
    });
  }
}

/* sound-free "scan" sweep when a section first enters (once, transform + opacity only) */
function scan(sec) {
  if (reduced() || !sec || !sec.animate) return;
  const line = document.createElement("div");
  line.className = "scan";
  line.setAttribute("aria-hidden", "true");
  if (getComputedStyle(sec).position === "static") sec.style.position = "relative";
  sec.append(line);
  const h = sec.offsetHeight + 140;
  line.animate(
    [{ transform: "translate3d(0,0,0)", opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.8 }, { transform: `translate3d(0,${h}px,0)`, opacity: 0 }],
    { duration: Math.min(1600, 700 + h * 0.4), easing: "cubic-bezier(0.77, 0, 0.175, 1)" }
  ).finished.then(() => line.remove(), () => line.remove());
}

function initReveals() {
  const sections = $$(".section, .case-section").filter((s) => !s.hasAttribute("data-chapter"));
  const gsap = window.gsap, ST = window.ScrollTrigger;
  if (reduced() || !gsap || !ST) return; // content is already fully visible
  gsap.registerPlugin(ST);
  const vh = innerHeight;
  for (const sec of sections) {
    const panels = $$("[data-panel]", sec);
    if (sec.getBoundingClientRect().top < vh * 0.85) continue;
    if (!panels.length) continue; // nothing to reveal (e.g. plain card grids)
    // opacity only (never visibility), so hidden panels stay keyboard-focusable
    gsap.set(panels, { opacity: 0, y: 18, clipPath: "inset(0 0 100% 0)" });
    let fired = false;
    const reveal = () => {
      if (fired) return;
      fired = true;
      scan(sec);
      gsap.to(panels, {
        opacity: 1, y: 0, clipPath: "inset(0 0 0% 0)", duration: 0.85, ease: "expo.out", stagger: 0.07,
        clearProps: "opacity,transform,clipPath",
      });
    };
    ST.create({ trigger: sec, start: "top 80%", once: true, onEnter: reveal });
    sec.addEventListener("focusin", reveal, { once: true });
  }
}

/* --------------------------------------------------------------- surface */
function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    // Software renderers (SwiftShader, llvmpipe, WARP) get the static poster instead.
    const gl = window.WebGL2RenderingContext && c.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch { return false; }
}
/* Quality tier: 0 = no WebGL (posters), 1 = mobile / low-power, 2 = desktop, 3 = desktop with a
   strong GPU (adds bloom). ?tier=N overrides for testing. */
function gpuTier() {
  const q = new URLSearchParams(location.search).get("tier");
  if (q !== null && /^[0-3]$/.test(q)) return +q;
  if (!hasWebGL()) return 0;
  const mobile = matchMedia("(max-width: 899px), (pointer: coarse)").matches;
  if (mobile || (navigator.hardwareConcurrency || 4) < 4) return 1;
  let name = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
    name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {}
  if (/intel|uhd|iris|mali|adreno|powervr|vivante/i.test(name)) return 2;
  return (navigator.hardwareConcurrency || 4) >= 8 ? 3 : 2;
}

/* ------------------------------------------------------- micro-interactions */
function initGridGlow() {
  if (!mqFine.matches || reduced()) return;
  const g = document.createElement("div");
  g.className = "grid-glow";
  g.setAttribute("aria-hidden", "true");
  body.append(g);
  let x = -999, y = -999, queued = false;
  const draw = () => { queued = false; g.style.setProperty("--x", x + "px"); g.style.setProperty("--y", y + "px"); };
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    x = e.clientX; y = e.clientY;
    g.classList.add("is-on");
    if (!queued) { queued = true; raf(draw); }
  }, { passive: true });
  document.addEventListener("pointerleave", () => g.classList.remove("is-on"));
}

/* magnetic pull on the one or two focal CTAs per screen; press feedback scale .97 */
function initMagnetic() {
  const gsap = window.gsap;
  if (!gsap || !mqFine.matches || reduced()) return;
  $$("[data-magnetic]").forEach((el) => {
    const xTo = gsap.quickTo(el, "x", { duration: 0.45, ease: "power3.out" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.45, ease: "power3.out" });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      xTo(Math.max(-10, Math.min(10, (e.clientX - r.left - r.width / 2) * 0.22)));
      yTo(Math.max(-8, Math.min(8, (e.clientY - r.top - r.height / 2) * 0.3)));
    });
    el.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
    el.addEventListener("pointerdown", () => gsap.to(el, { scale: 0.97, duration: 0.12, ease: "power2.out" }));
    const up = () => gsap.to(el, { scale: 1, duration: 0.2, ease: "power2.out" });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
}

/* click ripple on HUD panels: feedback that the surface registered the press */
function initRipples() {
  if (reduced()) return;
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const panel = e.target.closest?.(".panel, .stn-viz");
    if (!panel || !panel.animate) return;
    let host = panel.querySelector(":scope > .ripple-host");
    if (!host) { host = document.createElement("span"); host.className = "ripple-host"; host.setAttribute("aria-hidden", "true"); panel.prepend(host); }
    const r = panel.getBoundingClientRect();
    const sx = r.width / panel.offsetWidth || 1, sy = r.height / panel.offsetHeight || 1;
    const dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.left = (e.clientX - r.left) / sx + "px";
    dot.style.top = (e.clientY - r.top) / sy + "px";
    host.append(dot);
    const reach = Math.max(r.width, r.height) / 8;
    dot.animate([{ transform: "scale(.9)", opacity: 0.7 }, { transform: `scale(${Math.min(reach, 40)})`, opacity: 0 }], { duration: 560, easing: "cubic-bezier(0.23, 1, 0.32, 1)" })
      .finished.then(() => dot.remove(), () => dot.remove());
  }, { passive: true });
}

/* ------------------------------------------------- lite YouTube facades */
/* The thumbnail is a link to YouTube (works with JS off). With JS, pressing it swaps in the
   youtube-nocookie player; nothing from YouTube's player loads before that. */
function initLiteYT() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.(".yt-link");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const box = a.closest("[data-yt]");
    const id = box && box.dataset.yt;
    if (!id || !/^[\w-]{11}$/.test(id)) return;
    e.preventDefault();
    const f = document.createElement("iframe");
    f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    f.title = box.dataset.ytTitle || "YouTube video";
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    f.allowFullscreen = true;
    f.referrerPolicy = "strict-origin-when-cross-origin";
    box.replaceChildren(f);
    f.focus();
  });
}

/* ---------------------------------------------------- horizontal tracks */
/* Media / books / podcasts rows. The track is a native scroll-snap list (works with JS off);
   this adds HUD prev/next buttons, a live "1 / 6" readout, arrow keys on the focused track,
   mouse drag-to-scroll and edge fades. Reduced motion: every programmatic scroll is instant. */
const CHEVRON = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>`;
function initCarousels() {
  for (const root of $$("[data-carousel]")) {
    const track = $(".carousel-track", root);
    const bar = $(".carousel-bar", root);
    if (!track || !bar) continue;
    const items = $$(":scope > .carousel-item", track);
    const name = root.getAttribute("aria-label") || "items";
    const total = items.length;

    const controls = document.createElement("div");
    controls.className = "car-controls";
    controls.innerHTML =
      `<p class="car-pos" aria-live="polite" aria-atomic="true"></p>` +
      `<button class="car-btn" type="button" data-dir="-1" aria-label="Previous ${name.toLowerCase()}">${CHEVRON("M10 3 5 8l5 5")}</button>` +
      `<button class="car-btn" type="button" data-dir="1" aria-label="Next ${name.toLowerCase()}">${CHEVRON("M6 3l5 5-5 5")}</button>`;
    bar.append(controls);
    const pos = $(".car-pos", controls);
    const [prev, next] = $$(".car-btn", controls);
    if (track.id === "") track.id = "car-" + Math.random().toString(36).slice(2, 8);
    prev.setAttribute("aria-controls", track.id);
    next.setAttribute("aria-controls", track.id);

    const padL = () => parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
    const targets = () => { const p = padL(), m = maxScroll(); return items.map((li) => Math.min(m, Math.max(0, li.offsetLeft - p))); };
    const go = (left) => track.scrollTo({ left, behavior: reduced() ? "auto" : "smooth" });
    const step = (dir) => {
      const x = track.scrollLeft, t = targets();
      if (dir > 0) go(t.find((v) => v > x + 4) ?? maxScroll());
      else go([...t].reverse().find((v) => v < x - 4) ?? 0);
    };

    let lastText = "";
    const update = () => {
      const x = track.scrollLeft, m = maxScroll();
      const atStart = x <= 2, atEnd = x >= m - 2;
      track.dataset.atStart = String(atStart);
      track.dataset.atEnd = String(atEnd);
      // keep focus on a live control when the focused one hits an end
      const focused = document.activeElement;
      if (atStart && focused === prev && !atEnd) next.focus();
      if (atEnd && focused === next && !atStart) prev.focus();
      prev.disabled = atStart;
      next.disabled = atEnd;
      // readout: the cards fully in view ("1 / 6" on phones, "1–2 / 6" on desktop)
      const r = track.getBoundingClientRect(), p = padL();
      const lo = r.left + p - 2, hi = r.right - p + 2;
      let first = 0, last = 0;
      items.forEach((li, i) => { const b = li.getBoundingClientRect(); if (b.left >= lo && b.right <= hi) { if (!first) first = i + 1; last = i + 1; } });
      if (!first) { // nothing fully visible (very narrow): nearest card
        const t = targets(); let best = 0;
        t.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(t[best] - x)) best = i; });
        first = last = best + 1;
      }
      const shown = first === last ? `${first}` : `${first}–${last}`;
      const text = `${shown} / ${total}`;
      if (text === lastText) return;
      lastText = text;
      pos.innerHTML = `<span aria-hidden="true"><span class="cur">${shown}</span> / ${total}</span>` +
        `<span class="visually-hidden">${name}: ${first === last ? `item ${first}` : `items ${first} to ${last}`} of ${total}</span>`;
    };
    let ticking = false;
    const queue = () => { if (!ticking) { ticking = true; raf(() => { ticking = false; update(); }); } };
    track.addEventListener("scroll", queue, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(queue).observe(track);
    else addEventListener("resize", queue, { passive: true });

    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    track.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === "ArrowRight") step(1);
      else if (k === "ArrowLeft") step(-1);
      else if (k === "Home" && e.target === track) go(0);
      else if (k === "End" && e.target === track) go(maxScroll());
      else return;
      e.preventDefault();
    });

    // mouse drag-to-scroll (touch and trackpads already scroll natively)
    if (mqFine.matches) {
      track.classList.add("is-draggable");
      let startX = 0, startLeft = 0, down = false, moved = false;
      track.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest("iframe")) return;
        down = true; moved = false; startX = e.clientX; startLeft = track.scrollLeft;
      });
      track.addEventListener("pointermove", (e) => {
        if (!down) return;
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) < 6) return;
        if (!moved) { moved = true; track.classList.add("is-dragging"); track.setPointerCapture?.(e.pointerId); }
        track.scrollLeft = startLeft - dx;
      });
      const end = () => {
        if (!down) return;
        down = false;
        if (!moved) return;
        setTimeout(() => { moved = false; }, 0); // after the click that ends this drag
        const x = track.scrollLeft, t = [...targets(), maxScroll()];
        const near = t.reduce((a, v) => (Math.abs(v - x) < Math.abs(a - x) ? v : a), t[0]);
        track.classList.remove("is-dragging");
        go(near);
      };
      track.addEventListener("pointerup", end);
      track.addEventListener("pointercancel", end);
      // a drag is not a click: stop it before the lite-YouTube handler or a link sees it
      track.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
      track.addEventListener("dragstart", (e) => e.preventDefault());
    }
    update();
  }
}

/* ---------------------------------------------------------- blog filter */
function initBlogFilter() {
  const ui = $("[data-blog-filter]");
  const list = $("[data-post-list]");
  if (!ui || !list) return;
  ui.hidden = false;
  const q = $("[data-filter-q]", ui), count = $("[data-filter-count]", ui), empty = $("[data-filter-empty]");
  const tagBtns = $$("[data-filter-tag]", ui);
  const items = $$(".post-item", list);
  let tag = null, t = 0;
  const apply = () => {
    const needle = q.value.trim().toLowerCase();
    let n = 0;
    items.forEach((li) => {
      const ok = (!tag || li.dataset.tags.split("|").includes(tag))
        && (!needle || li.textContent.toLowerCase().includes(needle));
      li.hidden = !ok; if (ok) n++;
    });
    count.textContent = n === items.length ? `${n} posts` : `${n} of ${items.length} posts`;
    empty.hidden = n > 0;
  };
  tagBtns.forEach((b) => b.addEventListener("click", () => { tag = tag === b.dataset.filterTag ? null : b.dataset.filterTag; tagBtns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.filterTag === tag))); apply(); }));
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 120); });
}

/* ------------------------------------------------------------ contact form */
function initForm() {
  const form = $("[data-contact-form]");
  if (!form || !window.fetch || !window.FormData) return;
  const status = $("[data-form-status]", form);
  const submit = $("[type=submit]", form);
  const submitLabel = submit ? submit.textContent : "";
  let sending = false;
  const rules = {
    name: (v) => (v.trim() ? "" : "Enter your name."),
    email: (v) => {
      if (!v.trim()) return "Enter your email address.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "" : "Enter an email address like name@example.com.";
    },
    message: (v) => (v.trim().length >= 10 ? "" : "Enter a message of at least 10 characters."),
  };
  const showError = (field, msg) => {
    const err = document.getElementById(field.id + "-error");
    if (msg) field.setAttribute("aria-invalid", "true"); else field.removeAttribute("aria-invalid");
    if (err) err.textContent = msg;
  };
  const validate = (field) => {
    const rule = rules[field.name];
    if (!rule) return true;
    const msg = rule(field.value);
    showError(field, msg);
    return !msg;
  };
  const setStatus = (state, msg) => { status.setAttribute("data-state", state); status.textContent = msg; };
  form.setAttribute("novalidate", "");
  form.addEventListener("blur", (e) => { const f = e.target; if (f.name in rules && f.value) validate(f); }, true);
  form.addEventListener("input", (e) => { const f = e.target; if (f.getAttribute("aria-invalid") === "true") validate(f); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (sending) return;
    let firstInvalid = null;
    Object.keys(rules).forEach((name) => {
      const f = form.elements[name];
      if (f && !validate(f) && !firstInvalid) firstInvalid = f;
    });
    if (firstInvalid) {
      setStatus("error", "Please fix the highlighted fields and try again.");
      firstInvalid.focus();
      return;
    }
    sending = true;
    submit.setAttribute("aria-disabled", "true");
    submit.textContent = "Sending…";
    setStatus("pending", "Sending your message…");
    fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error("Request failed"); form.reset(); setStatus("success", "Thanks, your message has been sent. I'll reply by email."); })
      .catch(() => setStatus("error", "Sorry, your message could not be sent. Please try again, or reach me on LinkedIn."))
      .finally(() => { sending = false; submit.removeAttribute("aria-disabled"); submit.textContent = submitLabel; });
  });
}

/* ------------------------------------------------------------------ init */
initClock();
initScrollSpy();
initNav();
initPalette();
initTicker();
initForm();
initReplay();
initLiteYT();
initCarousels();
initBlogFilter();
// non-essential layers wait for an idle slot so they stay out of the load window
idle(() => { initReveals(); initGridGlow(); initMagnetic(); initRipples(); }, 1000);

if (PAGE === "home") {
  let booted = true;
  try { booted = sessionStorage.getItem(BOOT_KEY) === "1"; } catch {}
  const deepLink = location.hash && location.hash.length > 1;
  const ctx = {
    reduced, isMac, scan,
    fine: () => mqFine.matches,
    tier: reduced() ? 0 : gpuTier(),
    gutter: () => parseFloat(getComputedStyle(doc).getPropertyValue("--gutter")) || 16,
    headerH: () => $(".site-header")?.offsetHeight || 56,
    // hero WebGL starts once the page has loaded and the main thread is idle
    idle: (fn, t) => { const go = () => idle(fn, t); document.readyState === "complete" ? go() : addEventListener("load", go, { once: true }); },
  };
  const home = import("./home.js?v=7");
  home.then((m) => m.initHome(ctx)).catch(() => {});
  if (!booted && !reduced() && !deepLink && scrollY < 40) bootSequence().then(() => heroIntro(true));
  else heroIntro(false);
}
