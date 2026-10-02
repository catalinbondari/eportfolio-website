function renderResearchViews() {
  const box = document.getElementById("viewsBox");
  if (!box) return;
  box.innerHTML = "";
  const r = (view() || {}).researchViews;
  if (!r || !r.applied) {
    box.append(el("p", { class: "muted" },
      "No research view is firing on this book: nothing in the accounts, the insider filings or "
      + "the valuation gap is far enough from neutral to move an expected return."));
    return;
  }
  box.append(el("p", { style: "margin:0 0 12px" },
    `${r.views} view(s) on ${Object.keys(r.signalCounts || {}).length} signal type(s) are blended into `
    + `the expected returns behind every mix on this page. `
    + (r.biggest ? `The largest is ${r.biggest.ticker}, moved ${signed(r.biggest.movePct)} points a year.` : "")));

  box.append(el("div", { class: "tablewrap" }, table(
    ["Line", "CAPM says", "The research says", "Used", "Move", "Why"],
    (r.moved || []).map(m => ({ cells: [
      { node: el("strong", {}, tickerLink(m.ticker)) },
      m.priorPct.toFixed(2) + "%",
      { text: signed(m.viewPct) + "%", cls: m.viewPct < 0 ? "neg" : "pos" },
      { node: el("strong", {}, m.posteriorPct.toFixed(2) + "%") },
      { text: signed(m.movePct) + "pp" + (m.throughCorrelation ? " *" : ""),
        cls: m.movePct < 0 ? "neg" : "pos" },
      { text: (m.signals || []).map(s => s.why).filter(Boolean).join("; "), cls: "muted" },
    ] })), { numFrom: 1 })));
  if ((r.moved || []).some(m => m.throughCorrelation)) {
    box.append(el("p", { class: "note muted", style: "padding-top:6px" },
      "* moved further than its own view: the blend runs through the covariance, so several "
      + "bearish views on correlated names push each other further than any one would alone."));
  }

  const priors = Object.entries(r.priors || {});
  if (priors.length) {
    box.append(el("h4", { style: "margin:18px 0 6px" }, "Where each number comes from"));
    box.append(el("div", { class: "tablewrap" }, table(
      ["Signal", "Effect used", "Scored here", "Weight on this book", "Published source"],
      priors.map(([k, p]) => ({ cells: [
        { node: el("span", {}, el("strong", {}, k), el("br"),
            el("span", { class: "muted", style: "font-size:13px" }, p.what)) },
        { text: signed(p.effectPct) + "%", cls: p.effectPct < 0 ? "neg" : "pos" },
        String(p.scoredLocally || 0),
        (p.weightOnLocal * 100).toFixed(0) + "%",
        { text: p.source, cls: "muted" },
      ] })), { numFrom: 1 })));
  }
  const note = document.getElementById("viewsNote");
  if (note) note.textContent = r.caveat;
}
