function textbookCell(row, side) {
  const v = row[side];
  if (v === null || v === undefined) return { text: "–", cls: "muted" };
  const unit = row.unit;
  const text = unit === "%" ? `${v >= 0 && ["jensen", "m2"].includes(row.id) ? "+" : ""}${v.toFixed(2)}%`
    : unit === "pp" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}pp`
    : unit === "x" ? `${v.toFixed(2)}x`
    : v.toFixed(2);
  return { text, cls: side === "market" ? "muted" : "" };
}

function renderTextbook() {
  const box = document.getElementById("textbookBox");
  if (!box) return;
  box.innerHTML = "";
  const block = (view() || {}).textbook;
  if (!block) {
    box.append(el("p", { class: "muted" }, "Not enough shared history with the benchmark to compute the measures."));
    return;
  }
  box.append(el("p", { style: "margin:0 0 12px" }, block.verdict));
  const groups = [...new Set(block.rows.map(r => r.group))];
  const rows = [];
  for (const g of groups) {
    rows.push({ cls: "grp", cells: [{ node: el("strong", {}, g) }, "", "", ""] });
    for (const r of block.rows.filter(r => r.group === g)) {
      rows.push({ cells: [
        { node: el("span", {}, r.label, el("br"), el("span", { class: "muted", style: "font-size:13px" }, r.ref)) },
        textbookCell(r, "book"), textbookCell(r, "market"),
        { text: r.what, cls: "muted" },
      ] });
    }
  }
  box.append(el("div", { class: "tablewrap" },
    table(["Measure", BOOK, "S&P 500", "What it says"], rows, { numFrom: 1 })));
  const note = document.getElementById("textbookNote");
  if (note) note.textContent =
    `${block.observations} daily observations, ${block.from} to ${block.to} (${block.years} years). ` +
    `Cash ${block.riskFreePct}%, inflation ${block.inflationPct}%. ${block.caveat}`;
}
