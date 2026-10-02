function renderMacro() {
  const panel = document.getElementById("macroPanel");
  const box = document.getElementById("macroTable");
  const curveBox = document.getElementById("macroCurve");
  const note = document.getElementById("macroNote");
  if (!panel || !box) return;

  const macro = DATA.macro;
  const readings = (macro && macro.readings) || {};
  const keys = Object.keys(readings);
  if (!keys.length) { panel.style.display = "none"; return; }
  panel.style.display = "";

  box.replaceChildren(table(["Reading", "Level", "Change", "As at"],
    keys.map(key => {
      const r = readings[key];
      return { cells: [
        { node: el("span", {}, el("strong", {}, r.label),
                   el("div", { class: "muted", style: "font-size:13px;margin-top:2px" }, r.why)) },
        fmtPct(r.value),
        { text: !ok(r.change) ? "–" : r.change === 0 ? "0.00" : signed(r.change),
          cls: !ok(r.change) || r.change === 0 ? "muted" : r.change > 0 ? "neg" : "pos" },

        { node: el("span", { class: r.stale ? "amber" : "" },
            r.asOf + (ok(r.ageDays) && r.stale
              ? ` — ${Math.round(r.ageDays / 30)} months old` : ""))},
      ] };
    }), { numFrom: 1 }));

  const curve = macro.curve;
  const exposure = macro.exposure;
  if (curveBox) {
    const parts = [];
    if (curve) {
      parts.push(el("div", { class: curve.spreadPct < 0.5 ? "warnbox" : "goodbox" },
        el("strong", {}, "The curve. "), curve.verdict));
    }
    if (exposure && exposure.holdings && exposure.holdings.length) {
      parts.push(el("div", { class: "note", style: "margin-top:10px" },
        `${fmtEur(exposure.valueEur)} of this book — ${fmtPct1(exposure.pctOfBook)} — ` +
        "is a rate position rather than a company position: " +
        exposure.holdings.map(h => `${h.ticker} (${h.why})`).join("; ") + "."));
    }
    curveBox.replaceChildren(...parts);
  }

  if (note) {
    note.textContent = (macro.stale
      ? "These are the last readings that came back; the source did not answer on this build. "
      : "") + (macro.source || "");
  }
}

const EVENT_LABEL = { earnings: "Earnings", "ex-dividend": "Ex-dividend",
                      dividend: "Dividend paid" };

function renderEvents() {
  const panel = document.getElementById("eventsPanel");
  const box = document.getElementById("eventsTable");
  const imminentBox = document.getElementById("eventsImminent");
  const note = document.getElementById("eventsNote");
  if (!panel || !box) return;

  const data = DATA.events;
  const rows = (data && data.events) || [];

  const held = new Set(holdings.map(h => h.ticker));
  const mine = rows.filter(e => held.has(e.ticker));

  if (!mine.length) { panel.style.display = "none"; return; }
  panel.style.display = "";

  const soon = mine.filter(e => e.sessionsAway <= 5);
  if (imminentBox) {
    imminentBox.replaceChildren(soon.length
      ? el("div", { class: "warnbox" },
          el("strong", {}, soon.length === 1 ? "One date inside the week. "
                                             : `${soon.length} dates inside the week. `),
          soon.map(e => `${e.ticker} ${EVENT_LABEL[e.kind].toLowerCase()} in ` +
                        `${e.sessionsAway} session${e.sessionsAway === 1 ? "" : "s"}`)
              .join(", ") +
          ". Worth reading before placing anything that rests past them.")
      : el("div", { class: "note" },
          "Nothing inside the next five sessions."));
  }

  box.replaceChildren(table(["Ticker", "What", "Date", "Sessions away", "Why it matters"],
    mine.map(e => ({
      cls: e.sessionsAway <= 5 ? "" : "muted",
      cells: [
        e.ticker,
        EVENT_LABEL[e.kind] || e.kind,
        e.date,
        e.sessionsAway,
        { node: el("span", { class: "muted" }, e.note) },
      ],
    })), { numFrom: 3 }));

  if (note) {
    note.textContent = (data.caveat || "") +
      (data.failed && data.failed.length
        ? ` No calendar came back for ${data.failed.join(", ")}.` : "");
  }
}

function renderContext() {
  renderMacro();
  renderEvents();
}
