function renderLeaks() {
  const box = document.getElementById("leaksBox");
  if (!box) return;
  box.innerHTML = "";
  const l = (view() || {}).leaks;
  if (!l || !l.rows || !l.rows.length) {
    box.append(el("p", { class: "muted" }, "Nothing priced in this book to measure."));
    return;
  }
  box.append(el("div", { class: "warnbox", style: "margin-bottom:14px" }, l.verdict));
  for (const row of l.rows) {
    const amount = el("span", { class: row.annualEur < 0 ? "neg" : "pos" },
      `${signedEur(row.annualEur)} a year`);
    box.append(el("div", { class: "goal" },
      el("div", { class: "goal-head" },
        el("strong", {}, row.title),
        el("span", {}, amount, el("span", { class: "muted" }, ` · ${row.confidence}`))),
      el("p", { class: "desk-line" }, row.what),
      el("p", { class: "desk-line" }, el("strong", {}, "What to do: "),
        el("span", { class: "muted" }, row.fix))));
  }
  const note = document.getElementById("leaksNote");
  if (note) note.textContent = l.caveat;
}
