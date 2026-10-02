const FOLD_PX = 1000;
const TIDY_TABS = new Set(["research", "advice", "holdings", "protection", "performance",
                           "compare", "escape", "forecast"]);

function tidyTab(id) {
  if (!TIDY_TABS.has(id)) return;
  const view = document.getElementById("view-" + id);
  if (!view || !view.classList.contains("on")) return;
  const blocks = [...view.children].filter(c =>
    !c.classList.contains("section-head") && !c.classList.contains("jump") &&
    !c.classList.contains("fold-toggle") && c.querySelector("h3, h2"));

  view.querySelector(":scope > nav.jump")?.remove();
  const chips = blocks.map(b => {
    const h = b.querySelector("h3, h2");
    const text = (h.innerText || "").split(/\s+[—–-]\s+/)[0].trim();
    if (!text || b.offsetHeight < 40) return null;
    return el("button", { type: "button", class: "jump-chip", onclick: () => {
      const top = b.getBoundingClientRect().top + window.scrollY - 110;
      window.scrollTo({ top, behavior: "smooth" });
    } }, text.length > 38 ? text.slice(0, 36) + "…" : text);
  }).filter(Boolean);
  if (chips.length >= 4) {
    const head = view.querySelector(":scope > .section-head");
    const nav = el("nav", { class: "jump", "aria-label": "On this page" }, chips);
    head ? head.after(nav) : view.prepend(nav);
  }

  view.querySelectorAll(":scope > .fold-toggle").forEach(b => b.remove());
  for (const block of blocks) {

    if (block.querySelector(".orders") || block.id === "verdictBox" || block.id === "committeePanel") continue;
    const open = block.classList.contains("fold-open");
    block.classList.remove("folded");
    if (block.scrollHeight <= FOLD_PX * 1.3) continue;
    if (!open) block.classList.add("folded");
    const button = el("button", { type: "button", class: "fold-toggle" },
      open ? "Show less ▴" : "Show all ▾");
    button.addEventListener("click", () => {
      const nowOpen = !block.classList.contains("fold-open");
      block.classList.toggle("fold-open", nowOpen);
      block.classList.toggle("folded", !nowOpen);
      button.textContent = nowOpen ? "Show less ▴" : "Show all ▾";
      if (!nowOpen) window.scrollTo({ top: block.getBoundingClientRect().top + window.scrollY - 110 });
    });
    block.after(button);
  }
}

function foldMethod(root = document) {
  for (const panel of root.querySelectorAll(".panel")) {
    const body = panel.querySelector(":scope > .body");
    const texts = [...panel.querySelectorAll(":scope > .hint, :scope > .note, :scope > .body > .hint, :scope > .body > .note")]
      .filter(p => !p.classList.contains("warnbox") && !p.closest("details.how"));
    if (!texts.length) continue;
    const rest = [...panel.children].filter(c => c.tagName !== "H3" && !texts.includes(c)
      && !(c === body && [...body.children].every(k => texts.includes(k))));
    if (!rest.length) continue;
    let fold = panel.querySelector(":scope > details.how");
    if (!fold) {
      fold = el("details", { class: "how" }, el("summary", {}, "How this is worked out"));
      panel.append(fold);
    }
    texts.forEach(t => fold.append(t));
  }
}
