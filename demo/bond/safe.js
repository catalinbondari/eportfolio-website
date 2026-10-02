const SAFE = () => (view() || {}).safe || null;

function safeVerdictBox(plan) {
  const tone = !plan.dated ? "note" : plan.fundsAllowed ? "goodbox" : "warnbox";
  return el("div", { class: tone },
    el("strong", {}, plan.dated
      ? `${plan.goalName}: ${fmtEur(plan.goalHeldEur)} of ${fmtEur(plan.goalTargetEur)} ` +
        `saved, ${fmtEur(plan.bookHeldEur)} of it in this book, ` +
        `${plan.monthsToGoal} months to go. `
      : "No dated goal inside two years. "),
    plan.verdict);
}

function safeRows(block) {
  const rows = [];
  const horizon = String(block.horizons[block.horizons.length - 1]);
  for (const inst of block.outlook[horizon] || []) {
    const eligible = inst.eligible;
    rows.push({
      cls: eligible ? "" : "muted",
      cells: [
        { node: el("span", {},
            el("strong", {}, inst.ticker || inst.name),
            inst.ticker ? el("div", { class: "muted", style: "font-size:13px" }, inst.name) : null,
            el("div", { class: "muted", style: "font-size:13px;margin-top:3px" }, inst.why)) },
        inst.currency,
        ok(inst.annualPct) ? fmtPct(inst.annualPct) : "–",
        ok(inst.expectedPct) ? fmtPct(inst.expectedPct) : "–",
        { text: ok(inst.fxRiskPct)
            ? `±${fmtPct(inst.fxRiskPct)}` + (inst.fxRiskMultiple ? ` (${inst.fxRiskMultiple}× the yield)` : "")
            : "none",
          cls: ok(inst.fxRiskPct) ? "neg" : "" },
        { node: el("span", { class: eligible ? "pos" : "muted" },
            eligible ? `Eligible · ${inst.minimum} · ${inst.venue}` : inst.excluded) },
      ],
    });
  }
  return { rows, horizon };
}

function renderSafe() {
  const panel = document.getElementById("safePanel");
  const verdict = document.getElementById("safeVerdict");
  const tableBox = document.getElementById("safeTable");
  const noteBox = document.getElementById("safeNote");
  const caveat = document.getElementById("safeCaveat");
  if (!panel || !verdict) return;

  const block = SAFE();
  if (!block || !block.plan) { panel.style.display = "none"; return; }
  panel.style.display = "";

  verdict.replaceChildren(safeVerdictBox(block.plan));

  const { rows, horizon } = safeRows(block);
  tableBox.replaceChildren(table(
    ["Instrument", "Ccy", "Rate now", `Over ${horizon} months`, "Currency risk", "Fit"],
    rows, { numFrom: 2 }));

  const parts = [];
  if (ok(block.eurShortRatePct)) {
    parts.push(el("div", { class: "note", style: "padding:0 0 10px" },
      `Euro overnight rate ${fmtPct(block.eurShortRatePct)} (ECB policy less the ` +
      `deposit spread)` +
      (ok(block.usdBillPct) ? ` · US 3-month bill ${fmtPct(block.usdBillPct)}` : "") +
      (ok(block.eurusdVolPct) ? ` · EUR/USD moved ${fmtPct(block.eurusdVolPct)} a year` : "") +
      "."));
  }

  const note = block.note;
  if (note && ok(note.participationPct)) {
    parts.push(el("div", { class: note.participationPct < 35 ? "warnbox" : "goodbox" },
      el("strong", {}, "A structured product, rebuilt from its parts. "),
      `A capital-protected note on ${fmtEur(note.amountEur)} over ${note.months} months is ` +
      `${fmtEur(note.protectedEur)} in a bill that grows back to the full amount, and ` +
      `${fmtEur(note.optionBudgetEur)} (${fmtPct(note.optionBudgetPct)}) left to buy an ` +
      `at-the-money index call costing ${fmtPct(note.callCostPct)} of notional. That buys ` +
      `${fmtPct1(note.participationPct)} of the index's upside — ` +
      `${fmtPct1(note.participationAfterFeePct)} after a typical ${fmtPct1(note.retailFeePct)} ` +
      `retail fee. ` + note.verdict));
  }
  noteBox.replaceChildren(...parts);

  if (caveat) caveat.textContent = block.caveat || "";
}
