const DESK_GOAL_MONTHS_URGENT = 6;

let DESK_LIVE = { at: null, prices: {} };
const DESK_REFRESH_MS = 5 * 60 * 1000;

function deskTickers() {
  const out = new Set();
  for (const name of deskBookNames()) {
    for (const h of (DATA.bookViews[name].holdings || [])) {
      if (h.tradable !== false && h.shares > 0) out.add(h.ticker);
    }
  }
  if (DATA.benchmarkTicker) out.add(DATA.benchmarkTicker);
  return [...out];
}

async function loadDeskPrices() {
  if (!API || typeof apiGet !== "function") return false;
  const tickers = deskTickers();
  if (!tickers.length) return false;
  try {
    const data = await apiGet(`/api/prices?tickers=${encodeURIComponent(tickers.join(","))}`);
    DESK_LIVE = { at: new Date(), prices: data.prices || {} };
    return true;
  } catch (e) {
    return false;
  }
}

function deskLiveToday(v) {
  if (!DESK_LIVE.at) return null;
  let eur = 0, base = 0, priced = 0;
  for (const h of v.holdings || []) {
    if (h.tradable === false || !(h.shares > 0)) continue;
    const q = DESK_LIVE.prices[h.ticker];
    if (!q || !q.eur || !q.prevEur) continue;
    eur += h.shares * (q.eur - q.prevEur);
    base += h.shares * q.prevEur;
    priced++;
  }
  if (!priced || !base) return null;
  const b = DESK_LIVE.prices[DATA.benchmarkTicker];
  const benchmarkPct = b && b.eur && b.prevEur ? (b.eur / b.prevEur - 1) * 100 : null;
  const pct = eur / base * 100;
  return { live: true, eur, pct, benchmarkPct, excess: ok(benchmarkPct) ? pct - benchmarkPct : null,
           value: base + eur + (v.parked || 0) };
}

function deskAutoRefresh() {
  if (window._deskTimer) return;
  window._deskTimer = setInterval(async () => {
    if (document.hidden || !API) return;
    const open = typeof marketStatus === "function"
      && ["US", "EU"].some(code => (marketStatus(code) || {}).open);
    if (!open) return;
    if (await loadDeskPrices()) { renderDesk(); if (typeof renderFreshness === "function") renderFreshness(); }
  }, DESK_REFRESH_MS);
}

function deskBookNames() {
  const names = Object.keys(DATA.bookViews || {}).filter(n => n !== DATA.demoBook);

  return [...names.filter(n => n !== "Combined"), ...names.filter(n => n === "Combined")];
}

function deskValue(v) {

  const live = deskLiveToday(v);
  if (live && live.value) return live.value;
  return (v.priced || 0) + (v.parked || 0);
}

function deskOrders(v) {
  const orders = (v.orders || []).filter(o => !o.skipped);
  const sells = orders.filter(o => o.side === "sell");
  const buys = orders.filter(o => o.side === "buy");
  const deadlines = orders.map(o => o.deadline).filter(Boolean).sort();
  return {
    orders, sells, buys,
    sellEur: sells.reduce((a, o) => a + (o.euros || 0), 0),
    buyEur: buys.reduce((a, o) => a + (o.euros || 0), 0),
    deadline: deadlines[0] || null,
  };
}

function deskMarketsLine() {
  if (!DATA.markets || typeof marketStatus !== "function") return null;
  const states = ["US", "EU"].map(code => marketStatus(code)).filter(Boolean);
  if (!states.length) return null;
  const shut = states.filter(s => !s.open);
  if (!shut.length) return { open: true, text: "Markets are open — orders can be placed now." };
  const next = shut.map(s => s.nextOpen).sort((a, b) => a - b)[0];
  return { open: false,
           text: `Markets closed (${shut[0].why}) — queue the orders as good-till-cancelled; ` +
                 `first open ${whenLocal(next)}.` };
}

function openOrders(name) {
  if (BOOK !== name) selectBook(name);
  selectTab("advice");

  setTimeout(() => {
    const anchor = document.getElementById("thisMonth");
    if (anchor) anchor.scrollIntoView({ block: "start" });
  }, 0);
}

function deskCommitteeLine(name, v) {
  const c = v && v.committee;
  if (!c || !(c.final || []).length && !c.cio) return null;
  const trades = (c.final || []).map(t => el("span", { class: t.action === "buy" ? "pos" : "neg" },
    `${t.action} `, tickerLink(t.ticker), ` ${fmtEur(t.eur)}`));
  const link = el("button", { class: "desk-go", type: "button" }, "See the committee →");
  link.addEventListener("click", () => openCommittee(name));
  const who = /claude/i.test(c.engine || "") ? "the committee (Claude)" : "the committee";
  return el("p", { class: "desk-line" },
    el("strong", {}, name), ": ",
    trades.length ? trades.flatMap((n, i) => i ? [", ", n] : [n]) : el("span", { class: "muted" }, "no trade"),
    el("span", { class: "muted" }, ` · ${who}, sat ${c.asOf || "?"}`),
    " ", link);
}

function openCommittee(name) {
  if (name && BOOK !== name) selectBook(name);
  selectTab("advice");
  const panel = document.getElementById("committeePanel");
  if (panel) window.scrollTo({ top: panel.getBoundingClientRect().top + window.scrollY - 110 });
}

function deskActions(names) {
  const box = el("div", { class: "desk-block" }, el("div", { class: "lbl" }, "Do now"));
  let any = false;
  for (const name of names) {
    if (name === "Combined") continue;
    const v = DATA.bookViews[name];
    const o = deskOrders(v);

    const minutes = deskCommitteeLine(name, v);
    if (minutes) { box.append(minutes); any = true; }
    if (!o.orders.length) {
      box.append(el("p", { class: "desk-line muted" }, el("strong", {}, name), ": nothing to place."));
      continue;
    }
    any = true;

    const joined = nodes => nodes.flatMap((n, i) => i ? [", ", n] : [n]);
    const sellList = joined(o.sells.map(s => tickerLink(s.ticker)));
    const buyList = joined(o.buys.map(b => el("span", {}, `${fmtEur(b.euros)} into `, tickerLink(b.ticker),
      typeof trustedBadge === "function" ? trustedBadge(b.ticker) : null)));
    const button = el("button", { class: "desk-go", type: "button" }, "Open the orders →");
    button.addEventListener("click", () => openOrders(name));
    const kept = (((v.plan || {}).thisMonth) || {}).keptAsCash || 0;
    box.append(el("p", { class: "desk-line" + (minutes ? " muted" : "") },
      minutes ? el("span", {}, "The full plan: ") : [el("strong", {}, name), ": "],
      o.sells.length ? el("span", { class: "neg" }, `sell ${o.sells.length} (`, sellList, `, ${fmtEur(o.sellEur)})`) : null,
      o.sells.length && (o.buys.length || kept) ? " → " : "",
      kept ? el("strong", {}, `${fmtEur(kept)} kept as cash`) : null,
      kept && o.buys.length ? ", " : "",
      o.buys.length ? el("span", { class: "pos" }, "buy ", buyList) : null,
      o.deadline ? el("span", { class: "muted" }, ` · by ${o.deadline}`) : null,
      " ", button));
    if (typeof trustedDeskLine === "function") {
      const line = trustedDeskLine(o.buys);
      if (line) box.append(line);
    }
  }
  const market = deskMarketsLine();
  if (any && market) box.append(el("p", { class: "desk-line " + (market.open ? "pos" : "muted") }, market.text));
  const unreconciled = (DATA.corrections || []).length;
  if (unreconciled) {
    box.append(el("p", { class: "desk-line neg" },
      `${unreconciled} position(s) do not reconcile with the broker statements — check before placing anything (Advice → working).`));
  }
  const board = ((DATA.adviceRecord || {}).scoreboard) || null;
  if (board) {
    const month = (board.horizons || {}).month || {};
    box.append(el("p", { class: "desk-line muted" }, month.count
      ? `Record: over ${month.count} marked call(s), the advice ${month.meanPct >= 0 ? "beat" : "trailed"} ` +
        `the S&P 500 by ${Math.abs(month.meanPct).toFixed(1)}% at one month.`
      : `Record: ${board.banked || 0} call(s) banked, none old enough to mark — the first verdicts land ` +
        `${month.sessions || 21} sessions after they were made.`));
  }
  return box;
}

function deskBooks(names) {
  const rows = [];
  for (const name of names) {
    const v = DATA.bookViews[name];
    const today = deskLiveToday(v) || (v.daily || {}).today || null;
    const ytd = ((v.daily || {}).periods || []).find(p => p.label === "YTD") || null;
    const mwr = v.moneyWeighted || null;
    const cell = (x, d = 2) => ok(x) ? { text: signedPct(x, d), cls: x >= 0 ? "pos" : "neg" } : "–";
    const pp = x => ok(x) ? { text: signed(x) + "pp", cls: x >= 0 ? "pos" : "neg" } : "–";
    const label = el("span", { class: "desk-book" + (name === BOOK ? " on" : "") }, name);
    rows.push({ cls: name === "Combined" ? "muted" : "", name, cells: [
      { node: label },
      fmtEur(deskValue(v)),
      today ? cell(today.pct) : "–",
      today ? { text: signedEur(today.eur), cls: today.eur >= 0 ? "pos" : "neg" } : "–",
      today ? pp(today.excess) : "–",
      ytd ? cell(ytd.book, 1) : "–",
      ytd ? pp(ytd.excess) : "–",
      mwr && ok(mwr.irrPct) && mwr.inRange !== false
        ? { text: signedPct(mwr.irrPct, 1) + (mwr.estimated ? " ~" : ""), cls: mwr.irrPct >= 0 ? "pos" : "neg" } : "–",
    ] });
  }
  const t = table(["Book", "Value", "%", "€", "vs S&P", "%", "vs S&P", "p.a."], rows, { numFrom: 1 });

  const head = t.querySelector("thead");
  if (head) head.prepend(el("tr", { class: "grouphead" },
    el("th", { colspan: "2" }, ""), el("th", { colspan: "3", class: "num" }, "Today"),
    el("th", { colspan: "2", class: "num" }, "YTD"), el("th", { class: "num" }, "Since start")));

  [...t.querySelectorAll("tbody tr")].forEach((tr, i) => {
    tr.style.cursor = "pointer";
    tr.title = `Look at ${rows[i].name}`;
    tr.addEventListener("click", () => { if (BOOK !== rows[i].name) selectBook(rows[i].name); });
  });
  const asOf = names.map(n => ((DATA.bookViews[n].daily || {}).today || {}).asOf).filter(Boolean).sort().pop();
  const stamp = DESK_LIVE.at
    ? `live ${DESK_LIVE.at.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}`
    : (asOf ? "session of " + asOf : "latest session");
  return el("div", { class: "desk-block" },
    el("div", { class: "lbl" }, `The books · ${stamp}`),
    el("div", { class: "tablewrap" }, t),
    el("p", { class: "desk-line muted" },
      "Today and YTD are this mix back-cast; since-start is the money-weighted return on what was actually " +
      "put in (~ marks an estimated cost basis). The S&P 500 column is the line you hold, so ahead means ahead of doing nothing."));
}

function deskGoals() {
  const f = DATA.factFind;
  if (!f || !f.goals) return null;
  const savings = f.goals.filter(g => g.targetEur);
  if (!savings.length) return null;
  const line = g => el("p", { class: "desk-line" },
    el("strong", {}, g.name), ": ",
    el("span", { class: g.done ? "pos" : g.onTrack === false ? "neg" : "" },
      typeof goalHeadline === "function" ? goalHeadline(g)
        : `${fmtEur(g.fundedEur)} of ${fmtEur(g.targetEur)} · ${(g.pct || 0).toFixed(0)}%`),
    ok(g.securedEur) ? el("span", { class: "muted" }, `, ${fmtEur(g.atMarketEur)} more still in the market`) : null,
    el("span", { class: "muted" }, " — " +
      (g.done ? "funded."
        : g.targetDate ? (g.onTrack ? `on track for ${g.targetDate}.`
            : `needs ${fmtEur(g.monthlyNeededEur)} a month to land by ${g.targetDate}.`)
        : ok(g.monthsAtPace) ? `about ${g.monthsAtPace.toFixed(0)} months away at this pace.`
        : "nothing going in each month.")));
  const cover = f.goals.find(g => g.kind === "protection");

  const glides = savings.filter(g => g.glidePath && g.glidePath.fromMarketEur > 0);
  const glideLine = g => el("p", { class: "desk-line" },
    el("strong", { class: "neg" }, `${g.name.split(" - ").pop()}: `),
    `move about ${fmtEur(g.glidePath.perMonthEur)} a month out of the market into `,
    tickerLink(g.glidePath.parkIn || "DONR.DE"),
    ` (overnight-rate fund, no monthly cap), last step by ${g.glidePath.sellBy || g.targetDate}; the rest waits in equity funds`,
    el("span", { class: "muted" }, ` — ${fmtEur(g.glidePath.fromMarketEur)} in all` +
      (ok(g.glidePath.expectedExtraEur) && g.glidePath.expectedExtraEur > 0
        ? `. Staying invested until each step: about +${fmtEur(g.glidePath.expectedExtraEur)} expected, up to −${fmtEur(g.glidePath.badCaseEur)} in a bad year` : "") +
      (g.glidePath.shortfallEur > 0 ? `, and still ${fmtEur(g.glidePath.shortfallEur)} short after selling everything.` : ".")));
  return el("div", { class: "desk-block" },
    el("div", { class: "lbl" }, `The goals · ${fmtEur(f.totalFundedEur)} of ${fmtEur(f.totalTargetEur)}`),
    glides.length ? el("div", { class: "warnbox", style: "margin:4px 0 10px" },
      el("strong", {}, "Deposit due in " + Math.round(glides[0].monthsToDate) + " months — most of it is still in shares. "),
      "A fall the week before is not a fluctuation, it is the deposit. Monthly savings go to the deposit account; everything else waits in the fund below, which takes any amount.", glides.map(glideLine)) : null,
    savings.map(line),
    cover ? el("p", { class: "desk-line muted" },
      "Protection: a cover requirement, not a pot — see the Protection tab.") : null);
}

function deskGoal() {
  const goal = DATA.goal;
  if (!goal || !goal.target) return null;
  const plan = ((DATA.bookViews[BOOK] || {}).safe || {}).plan
    || ((DATA.bookViews.Combined || {}).safe || {}).plan || {};
  const months = ok(plan.monthsToGoal) ? plan.monthsToGoal : goal.monthsRemaining;
  const gap = ok(plan.goalGapEur) ? plan.goalGapEur : goal.gap;
  const need = plan.requiredMonthlyEur, saving = plan.contributionMonthlyEur, diverted = plan.divertedEur;
  const short = plan.stillShortMonthlyEur;
  const covered = ok(short) ? short <= 0.5 : !!goal.onTrack;
  const urgent = ok(months) && months <= DESK_GOAL_MONTHS_URGENT;
  const parts = [
    `${fmtEur(goal.held)} of ${fmtEur(goal.target)} held · ${fmtEur(gap)} to find`,
    goal.targetDate ? `due ${goal.targetDate}` + (ok(months) ? ` (${months.toFixed(1)} months)` : "") : null,
  ].filter(Boolean);
  const how = ok(need)
    ? `needs ${fmtEur(need)} a month: ${fmtEur(saving || 0)} saved` +
      (diverted > 0 ? ` + ${fmtEur(diverted)} diverted from the monthly buy` : "") +
      (covered ? " — covered." : ` — still ${fmtEur(short)} a month short.`)
    : (covered ? "on track." : `short by ${fmtEur(goal.shortfallMonthly || 0)} a month.`);
  return el("div", { class: "desk-block" },
    el("div", { class: "lbl" }, `The goal · ${goal.lines && goal.lines[0] ? goal.lines[0].name : "deposit"}`),
    el("p", { class: "desk-line" },
      el("strong", { class: covered ? "pos" : "neg" }, covered ? "On track. " : "Behind. "),
      parts.join(" · "), " · ", how,
      urgent ? el("span", { class: "muted" }, " Nothing for this may sit in equities now.") : null));
}

function deskUnitFixes() {
  const fixes = (DATA.unitFixes || []).filter(f => BOOK === "Combined" || f.portfolio === BOOK);
  if (!fixes.length) return null;
  return el("div", { class: "warnbox", style: "margin-bottom:10px" },
    el("strong", {}, "The sheet misprices a line. "),
    fixes.map(f => `${f.ticker}: the sheet says ${fmtEur(f.sheetValue)}, the market ${fmtEur(f.newValue)} ` +
      `(${f.ratio}x) — this page uses the market figure.`).join(" "),
    " Fix the sheet's Price (EUR) formula so it stops recurring.");
}

function renderDesk() {
  const box = document.getElementById("deskBox");
  if (!box || !DATA || !DATA.bookViews) return;
  box.innerHTML = "";
  if (isDemo()) return;
  const names = deskBookNames();
  if (!names.length) return;
  const goal = deskGoal();

  const factFindGoals = deskGoals();
  box.append(el("div", { class: "desk" }, deskUnitFixes(), deskActions(names), deskBooks(names),
                factFindGoals, factFindGoals ? null : goal));

  if (!DESK_LIVE.at && API) loadDeskPrices().then(got => {
    if (got) { renderDesk(); if (typeof renderFreshness === "function") renderFreshness(); }
  });
  deskAutoRefresh();
}
