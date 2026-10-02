function cioFactors() {
  const f = (view() || {}).factors;
  if (!f || !f.current) return null;
  const c = f.current;
  const rows = c.loadings.map(l => ({
    cls: l.meaningful ? "" : "muted",
    cells: [
      { node: el("span", {}, el("strong", {}, l.factor), " ",
          el("span", { class: "muted", style: "font-size:13px" }, l.what)) },
      { text: (l.beta >= 0 ? "+" : "") + l.beta.toFixed(2),
        cls: !l.meaningful ? "muted" : Math.abs(l.beta) > 0.3 && l.factor !== "market" ? "amber" : "" },
      ok(l.tStat) ? l.tStat.toFixed(1) : "–",
      l.meaningful ? "real" : "noise",
    ],
  }));
  rows.push({ cls: c.alphaMeaningful ? "" : "muted", cells: [
    { node: el("span", {}, el("strong", {}, "residual"), " ",
        el("span", { class: "muted", style: "font-size:13px" }, "what the factors do not explain — selection, and luck")) },
    signed(c.alphaAnnualPct) + "%/yr",
    ok(c.alphaTStat) ? c.alphaTStat.toFixed(1) : "–",
    c.alphaMeaningful ? "real" : "noise",
  ] });
  return el("div", { class: "panel" },
    el("h3", {}, "1. What this book actually is"),
    el("div", { class: "body" },
      el("div", { class: "goodbox" }, c.verdict),
      table(["Factor", "Loading", "t", "Verdict"], rows, { numFrom: 1 }),
      cioDollar(c),
      cioAlignment(c.alignment),
      el("p", { class: "note muted", style: "padding-top:8px" },
        `${c.observations} weeks, ${c.from} to ${c.to}. Market alone explains ` +
        `${(c.rSquaredMarketOnly * 100).toFixed(0)}% of weekly variance; with style and the dollar, ` +
        `${(c.rSquared * 100).toFixed(0)}%. Book volatility ${fmtPct1(c.bookVolPct)}, of which ` +
        `${fmtPct1(c.residualVolPct)} is unexplained. ${f.caveat}`)));
}

function cioDollar(c) {

  const rows = (view().holdings || []).filter(h => h.tradable);
  const usd = rows.filter(h => h.currency === "USD").reduce((a, h) => a + h.value_eur, 0);
  const total = rows.reduce((a, h) => a + h.value_eur, 0);
  if (!total) return null;
  const share = usd / total;
  const load = (c.loadings.find(l => l.factor === "dollar") || {});
  return el("div", { class: share > 0.5 ? "warnbox" : "note", style: "margin-top:12px" },
    el("strong", {}, `${fmtPct1(share * 100)} of the equity is dollar-denominated. `),
    `A 10% fall in the dollar against the euro takes about ${fmtEur(usd * 0.10)} off this book ` +
    `before anything else moves` +
    (load.meaningful
      ? `; on top of that the holdings themselves load ${load.beta >= 0 ? "+" : ""}${load.beta.toFixed(2)} ` +
        `on dollar strength beyond what the world index carries.`
      : ".") +
    ` For money that will be spent in euro, that is a position - and the safe sleeve is the ` +
    `only part of the book that has been told so.`);
}

function cioAlignment(a) {
  if (!a || !ok(a.ratio)) return null;
  const hidden = a.hiddenPct;
  if (hidden < 8) return null;
  return el("div", { class: "warnbox", style: "margin-top:12px" },
    el("strong", {}, "The daily numbers understate this book's risk. "),
    `Measured on daily returns the book's volatility is ${fmtPct1(a.volDailyPct)}; on weekly ` +
    `returns it is ${fmtPct1(a.volWeeklyPct)} — ${fmtPct1(hidden)} higher. The gap is the ` +
    `European fund lines closing hours before the US names, so a day's co-movement is split ` +
    `across two bars and the daily covariance sees less of it than exists. Every figure built ` +
    `on that covariance — VaR, the optimiser's volatility, the risk contributions — is ` +
    `optimistic by roughly that margin. Read them as a floor.`);
}

function cioAttribution() {
  const a = (view() || {}).attribution;
  if (!a || !a.positions || !a.positions.length) return null;
  const rows = a.positions.map(p => ({
    cls: p.closed ? "muted" : "",
    cells: [
      { node: el("span", {}, el("strong", {}, tickerLink(p.ticker)),
          p.closed ? el("span", { class: "muted" }, " · sold") : null,
          p.estimatedBasis ? el("span", { class: "amber" }, " · est.") : null) },
      fmtEur(p.investedEur),
      { text: fmtEur(p.realisedEur), cls: p.realisedEur < 0 ? "neg" : p.realisedEur > 0 ? "pos" : "muted" },
      { text: fmtEur(p.unrealisedEur), cls: p.unrealisedEur < 0 ? "neg" : p.unrealisedEur > 0 ? "pos" : "muted" },
      { text: p.dividendsEur ? fmtEur(p.dividendsEur) : "–", cls: p.dividendsEur ? "pos" : "muted" },
      { text: fmtEur(p.totalEur), cls: p.totalEur < 0 ? "neg" : "pos" },
      ok(p.returnOnCostPct) ? signed(p.returnOnCostPct) + "%" : "–",
    ],
  }));
  const c = a.concentration || {};
  return el("div", { class: "panel" },
    el("h3", {}, "2. Which positions made the money"),
    el("div", { class: "body" },
      el("div", { class: c.netEur >= 0 ? "goodbox" : "warnbox" }, a.verdict),
      table(["Position", "Invested", "Realised", "Unrealised", "Income", "Total", "On cost"], rows, { numFrom: 1 }),
      el("p", { class: "note muted", style: "padding-top:8px" }, a.caveat)));
}

function cioInsurance() {
  const d = (view() || {}).derivatives || {};
  const ins = d.insurance;
  if (!ins) return null;
  const priced = ins.annualCostPct;
  const worst = ins.worstDrawdownPct;
  const every = ins.breakEvenEveryYears;
  const verdict = ok(ins.stressNetEur) && ok(every)
    ? `Rolling this put costs ${fmtEur(ins.annualCostEur)} a year — ${fmtPct1(priced)} of the ` +
      `equity, every year, whether or not anything happens. In a repeat of this book's worst fall ` +
      `(${fmtPct1(worst)}) it pays ${fmtEur(ins.stressPayoutEur)}. So it earns its keep only if a ` +
      `fall that size comes more often than every ${every.toFixed(1)} years` +
      (every < 8
        ? ` — and for equities that is roughly history's rate, which is what "fairly priced" looks like.`
        : ` — rarer than history has delivered, which is what "expensive" looks like.`) +
      ` For money with a twenty-year horizon the usual answer is to know the price and not pay it; ` +
      `money with a date on it belongs in the safe sleeve, not behind a put.`
    : `Rolling this put costs ${fmtEur(ins.annualCostEur)} a year, ${fmtPct1(priced)} of the equity.`;
  return el("div", { class: "panel" },
    el("h3", {}, "3. What it costs to sleep"),
    el("div", { class: "body" },
      el("div", { class: "note" }, verdict),
      table(["", "Value"], [
        ["Instrument", `${ins.index} put, ${ins.otmPct}% below spot, ${ins.months} months, rolled`],
        ["Strike", `$${ins.strike} against $${(ins.strike / (1 - ins.otmPct / 100)).toFixed(0)} spot`],
        ["Priced at", `${fmtPct1(ins.pricedAtVolPct)} implied volatility — the market's own quote`],
        ["Premium per roll", `${fmtPct(ins.premiumPctOfSpot)} of notional`],
        ["Annual cost", `${fmtPct(ins.annualCostPct)} · ${fmtEur(ins.annualCostEur)} on ${fmtEur(ins.exposureEur)} of equity`],
        ["Contracts", `${ins.contractsNeeded} needed; ${ins.wholeContracts} whole cover ${fmtEur(ins.coveredEur)}`],
        ["Pays out below", `a ${fmtPct1(ins.payoutStartsBelowPct)} fall; breaks even at ${fmtPct1(ins.breakEvenFallPct)} after premium`],
        ["Priced from", ins.pricedFrom || "–"],
      ].map(([k, v]) => ({ cells: [k, { text: v, cls: "num" }] })), { numFrom: 1 })));
}

function renderCio() {
  const box = document.getElementById("cioBox");
  if (!box) return;
  box.innerHTML = "";
  const parts = [cioFactors(), cioAttribution(), cioInsurance()].filter(Boolean);
  if (!parts.length) return;
  box.append(el("div", { class: "section-head", style: "margin-top:0" },
    el("h2", {}, "The CIO view"),
    el("p", {}, "Three questions a chief investment officer asks before opening the position list. " +
      "What is this book once the names come off. Which positions actually made the money. " +
      "What it would cost to insure. None of it is advice; all of it is what the advice below is standing on.")));
  const grid = el("div", { class: "panels" });
  parts.forEach(p => { p.classList.add("wide"); grid.append(p); });
  box.append(grid);
}
