const TRADING_DAYS = 252, LAMBDA = 0.94, Z95 = 1.6448536269514722;

const cssVar = name =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const PALETTE = () => Array.from({ length: 10 }, (_, i) => cssVar(`--c${i + 1}`));
const INK = () => cssVar("--ink");
const SLATE = () => cssVar("--slate");
const LINE = () => cssVar("--line");
const THEME_KEY = "bond.theme";

let DATA = null, holdings = [], charts = {}, worldGeo = null;
let BOOK = null;
let API = false;

const view = () => DATA.bookViews[BOOK];
const STORE_KEY_FOR = book => `bond.holdings.${book}.v1`;

const columnFor = t => DATA.returns.series[t] || null;

function alignedRows(tickers, restrict) {
  const cols = tickers.map(columnFor);
  if (cols.some(c => !c)) return { rows: [], index: [] };
  const rows = [], index = [], dates = DATA.returns.dates;
  for (let i = 0; i < dates.length; i++) {
    if (restrict && !restrict.has(dates[i])) continue;
    let ok = true; const row = new Array(cols.length);
    for (let j = 0; j < cols.length; j++) {
      const v = cols[j][i];
      if (v === null || v === undefined || !isFinite(v)) { ok = false; break; }
      row[j] = v;
    }
    if (ok) { rows.push(row); index.push(dates[i]); }
  }
  return { rows, index };
}

function ewmaVol(series) {
  const n = series.length; if (n < 30) return NaN;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let weight = 1, total = 0, acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = series[i] - mean; acc += weight * d * d; total += weight; weight *= LAMBDA;
  }
  return Math.sqrt((acc / total) * TRADING_DAYS);
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length); if (n < 30) return NaN;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb);
}

function beta(series, bench) {
  const n = Math.min(series.length, bench.length); if (n < 30) return NaN;
  let ms = 0, mb = 0;
  for (let i = 0; i < n; i++) { ms += series[i]; mb += bench[i]; }
  ms /= n; mb /= n;
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) {
    const db = bench[i] - mb;
    cov += (series[i] - ms) * db; varb += db * db;
  }
  return varb ? cov / varb : NaN;
}

function drawdownCurve(series) {
  let level = 1, peak = 1; const out = [];
  for (const r of series) {
    level *= 1 + r; if (level > peak) peak = level;
    out.push((level / peak - 1) * 100);
  }
  return out;
}

function levelCurve(series, base = 100) {
  let level = base; const out = [];
  for (const r of series) { level *= 1 + r; out.push(level); }
  return out;
}

function statsFor(tickers, weights, value, restrict) {
  const { rows, index } = alignedRows([...tickers, DATA.benchmarkTicker], restrict);
  if (!rows.length) return null;
  const w = weights.concat([0]);
  const series = rows.map(row => row.reduce((a, v, j) => a + v * w[j], 0));
  const bench = rows.map(r => r[r.length - 1]);
  const vol = ewmaVol(series);
  const years = rows.length / TRADING_DAYS;
  const total = series.reduce((a, r) => a * (1 + r), 1) - 1;
  const cagr = years >= 1 ? Math.pow(1 + total, 1 / years) - 1 : total;
  const sorted = [...series].sort((a, b) => a - b);
  const tailIdx = Math.max(0, Math.floor(sorted.length * 0.05) - 1);
  return {
    vol: vol * 100, beta: beta(series, bench),
    maxDrawdown: Math.min(...drawdownCurve(series)),
    sharpe: vol ? (cagr - 0.02) / vol : NaN,
    var95: value * Z95 * vol / Math.sqrt(TRADING_DAYS),
    varHist: -sorted[tailIdx] * value,
    cagr: cagr * 100, total: total * 100,
    series, bench, index, days: rows.length,
    from: index[0], to: index[index.length - 1],
  };
}

const sheetHoldings = () => view().holdings
  .filter(h => h.tradable && columnFor(h.ticker))
  .map(h => ({ ticker: h.ticker, name: h.name, value: h.value_eur }));

function loadHoldings() {
  try { const s = localStorage.getItem(STORE_KEY_FOR(BOOK)); if (s) return JSON.parse(s); }
  catch (e) {  }
  return null;
}
function saveHoldings() {
  try { localStorage.setItem(STORE_KEY_FOR(BOOK), JSON.stringify(holdings)); } catch (e) {}
}
function resetHoldings() {
  holdings = sheetHoldings();
  try { localStorage.removeItem(STORE_KEY_FOR(BOOK)); } catch (e) {}
  renderAll();
}
function isEdited() {
  const base = sheetHoldings();
  if (base.length !== holdings.length) return true;
  const byTicker = Object.fromEntries(base.map(h => [h.ticker, h.value]));
  return holdings.some(h => Math.abs((byTicker[h.ticker] ?? -1) - h.value) > 0.005);
}
function currentWeights() {
  const live = holdings.filter(h => h.value > 0 && columnFor(h.ticker));
  const total = live.reduce((a, h) => a + h.value, 0);
  return { tickers: live.map(h => h.ticker), weights: live.map(h => h.value / total), value: total };
}

const ok = v => v !== null && v !== undefined && isFinite(v);
const fmtPct = v => ok(v) ? `${v.toFixed(2)}%` : "–";
const fmtPct1 = v => ok(v) ? `${v.toFixed(1)}%` : "–";
const fmtNum = v => ok(v) ? v.toFixed(2) : "–";
const fmtEur = v => ok(v) ? "€" + Math.round(v).toLocaleString("en-IE") : "–";
const signed = v => (v >= 0 ? "+" : "") + v.toFixed(2);

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const STACK_TEXT_LENGTH = 38;

function table(headers, rows, opts = {}) {
  const t = el("table", { class: "grid" });
  t.append(el("thead", {}, el("tr", {}, headers.map((h, i) =>
    el("th", { class: opts.numFrom !== undefined && i >= opts.numFrom ? "num" : "" }, h)))));
  const body = el("tbody");
  let longest = 0;
  for (const row of rows) {
    const tr = el("tr", { class: row.cls || "" });
    row.cells.forEach((c, i) => {
      const td = el("td", {
        class: (opts.numFrom !== undefined && i >= opts.numFrom ? "num " : "") + (c.cls || ""),
        "data-label": typeof headers[i] === "string" ? headers[i] : "",
      }, c.node !== undefined ? c.node : c.text !== undefined ? c.text : c);
      const length = (td.textContent || "").trim().length;
      if (i > 0 && length > STACK_TEXT_LENGTH) td.classList.add("long");
      if (i > 0) longest = Math.max(longest, length);
      tr.append(td);
    });
    body.append(tr);
  }
  t.append(body);
  if (opts.stack === true || (opts.stack !== false && headers.length >= 3 && longest > STACK_TEXT_LENGTH)) {
    t.classList.add("stack");
  }

  return el("div", { class: "tscroll" }, t);
}

document.addEventListener("click", e => {
  const p = e.target.closest(".section-head p, .panel .hint");
  if (!p || e.target.closest("a, button, select, input")) return;

  if (p.matches(".section-head p") || window.matchMedia("(max-width: 760px)").matches) p.classList.toggle("open");
});

function tickerLink(ticker, cls = "") {
  if (!ticker) return el("span", {}, "–");
  return el("span", { class: "tkr " + cls, title: `${ticker} - a fictional demo instrument` }, ticker);
}

const pendingCharts = new Map();

function chart(id, config) {
  const el_ = document.getElementById(id);
  if (!el_) return;
  if (charts[id]) charts[id].destroy();
  delete charts[id];

  if (!el_.getClientRects().length) {
    pendingCharts.set(id, config);
    return;
  }
  pendingCharts.delete(id);

  Chart.defaults.font.family = '"Segoe UI",-apple-system,Helvetica,Arial,sans-serif';
  Chart.defaults.color = SLATE();
  Chart.defaults.font.size = 13;
  charts[id] = new Chart(el_, config);
}

function remeasureBlankCharts() {
  for (const [id, inst] of Object.entries(charts)) {
    const canvas = document.getElementById(id);
    if (canvas && canvas.getClientRects().length && canvas.width === 0) inst.resize();
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) remeasureBlankCharts(); });
window.addEventListener("resize", remeasureBlankCharts);
window.addEventListener("pageshow", remeasureBlankCharts);

function buildPendingCharts(id) {
  const view = document.getElementById("view-" + id);
  if (!view || !pendingCharts.size) return;
  for (const [canvasId, config] of [...pendingCharts]) {
    const el_ = document.getElementById(canvasId);
    if (el_ && view.contains(el_)) chart(canvasId, config);
  }
}

const gridScale = (extra = {}) => Object.assign({
  grid: { color: LINE(), drawTicks: false }, border: { display: false },
}, extra);

function ageInDays(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

function renderLiveStamp() {
  const box = document.getElementById("liveStamp");
  if (!box) return;
  const live = liveValuation();
  if (!live) { box.textContent = ""; return; }
  box.innerHTML = `live prices <strong>${live.at}</strong>` +
    (live.oldest ? ` <span class="muted">(oldest print ${live.oldest})</span>` : "");
}

function renderFreshness() {
  if (DATA.demoMode) {
    document.getElementById("asof").innerHTML =
      `Synthetic prices to <strong>${DATA.asOf}</strong><br><span class="asat-dot"> · </span>demo build, not live`;
    return;
  }
  const f = DATA.freshness || {};
  const built = f.builtAt || DATA.generated;
  const age = ageInDays(built);
  const stale = age !== null && age > 1.5;
  const label = age === null ? ""
    : age < 1 / 24 ? "just now"
    : age < 1 ? `${Math.round(age * 24)}h ago`
    : `${Math.round(age)} days ago`;

  const live = (typeof DESK_LIVE !== "undefined" && DESK_LIVE.at)
    ? DESK_LIVE.at : (LIVE && LIVE.at) ? LIVE.at : null;
  document.getElementById("asof").innerHTML = (live
    ? `Prices <strong>live ${live.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</strong>`
    : `Prices as at <strong>${DATA.asOf}</strong>`) +
    `<br><span class="asat-dot"> · </span>` +
    `analytics built <span class="${stale ? "stale" : "fresh"}">${label}</span>` +
    (stale ? " — advice may be out of date" : "");
}

function currentTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
  } catch (e) {  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const button = document.getElementById("themeToggle");
  if (button) {
    button.textContent = theme === "dark" ? "☀" : "☾";
    button.title = theme === "dark" ? "Switch to light" : "Switch to dark";
  }
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark"
    ? "light" : "dark";
  applyTheme(next);

  if (DATA) {
    renderDerived();
    if (document.getElementById("view-map").classList.contains("on")) renderMap();
    if (document.getElementById("view-cube").classList.contains("on")) renderCube();
  }
}

function effectiveHoldings() {
  const { weights } = currentWeights();
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  return hhi ? 1 / hhi : 0;
}

const realRate = pct => ((1 + pct / 100) / (1 + (DATA.inflation ?? 0.03)) - 1) * 100;

function renderKpis(stats, value) {
  const box = document.getElementById("kpis");
  box.innerHTML = "";
  box.classList.add("eight");

  const bench = statsFor([DATA.benchmarkTicker], [1], value, new Set(stats.index));
  const parked = view().parked;
  const mwr = view().moneyWeighted || null;
  const live = isEdited() ? null : liveValuation();

  const record = (!isEdited() && view().actual && view().actual.actual
                  && ok(view().actual.actual.cagrPct)) ? view().actual : null;
  const r = record ? record.actual : null;
  const b = record ? record.benchmark : null;
  const lookBack = "today's mix, looking back";
  const cards = [
    live
      ? ["Total, live", fmtEur(live.total + parked), `${fmtEur(parked)} of it cash & deposits`,
         `${fmtEur(live.total)} at ${live.at} prices + ${fmtEur(parked)} cash & deposits; ` +
         `${live.total - value >= 0 ? "+" : "−"}${fmtEur(Math.abs(live.total - value))} since the build` +
         (live.unpriced.length ? `; ${live.unpriced.join(", ")} not repriced` : "")]
      : ["Total", fmtEur(value + parked), `${fmtEur(parked)} of it cash & deposits`,
         `${fmtEur(value)} priced + ${fmtEur(parked)} cash & deposits`],
    r ? ["Return p.a.", fmtPct(r.cagrPct), `S&P 500 ${fmtPct(b.cagrPct)} · the record`,
         `Time-weighted, rebuilt from the ledger over ${r.years} years. ` +
         (mwr && ok(mwr.irrPct) && mwr.inRange !== false ? `Money-weighted ${fmtPct(mwr.irrPct)}. ` : "") +
         `${lookBack}: ${fmtPct(stats.cagr)}.`]
      : ["Return p.a.", fmtPct(stats.cagr), bench ? `S&P 500 ${fmtPct(bench.cagr)} · ${lookBack}` : lookBack,
         "No ledger record for this book, so this is today's weights applied to past prices."],

    ["Volatility now", fmtPct(stats.vol), bench ? `S&P 500 ${fmtPct(bench.vol)} · what you hold today` : "what you hold today",
     `Annualised, EWMA, for the holdings as they stand.` + (r ? ` The record over ${r.years} years: ${fmtPct(r.volPct)}.` : "")],
    r ? ["Worst drawdown", fmtPct(r.maxDrawdownPct), `S&P 500 ${fmtPct(b.maxDrawdownPct)} · the record`,
         `Deepest fall from a peak in the record. ${lookBack}: ${fmtPct(stats.maxDrawdown)}.`]
      : ["Worst drawdown", fmtPct(stats.maxDrawdown), bench ? `S&P 500 ${fmtPct(bench.maxDrawdown)} · ${lookBack}` : lookBack, "Peak to trough."],
    r ? ["Sharpe", fmtNum(r.sharpe), `S&P 500 ${fmtNum(b.sharpe)} · the record`,
         `Return per unit of risk, both from the record. ${lookBack}: ${fmtNum(stats.sharpe)}.`]
      : ["Sharpe", fmtNum(stats.sharpe), bench ? `S&P 500 ${fmtNum(bench.sharpe)} · ${lookBack}` : lookBack, "Return per unit of risk."],

    ["Beta", fmtNum(stats.beta), "today's mix · S&P 500 = 1.00",
     `Sensitivity to the S&P 500 line you hold (${DATA.benchmarkTicker}), for the book as it stands.`],
    ["1-day VaR 95%", fmtEur(stats.var95), bench ? `same money in the S&P 500 ${fmtEur(bench.var95)}` : "today's mix",
     "The loss exceeded on one day in twenty, for the book as it stands."],
    ["Income", fmtEur(view().income.annual_eur), `${view().income.portfolio_yield}% yield`,
     `Dividends a year at today's holdings. Diversification: behaves like ${effectiveHoldings().toFixed(1)} equal lines.`],
  ];
  for (const [k, v, s, more] of cards) {
    box.append(el("div", { class: "kpi", title: more || "" },
      el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "s" }, s)));
  }
}

function bookHeadline(mine) {
  const a = (!isEdited() && view().actual && view().actual.actual && ok(view().actual.actual.cagrPct))
    ? view().actual.actual : null;
  return a ? { cagr: a.cagrPct, vol: a.volPct, sharpe: a.sharpe, maxDrawdown: a.maxDrawdownPct,
               label: "My book (the record)" }
           : { cagr: mine.cagr, vol: mine.vol, sharpe: mine.sharpe, maxDrawdown: mine.maxDrawdown,
               label: "My book (today's mix, looking back)" };
}

function renderGrowth(mine) {
  const window_ = new Set(mine.index);
  const datasets = [{
    label: "My book (today's mix, looking back)", data: levelCurve(mine.series), borderColor: INK(),
    borderWidth: 2.4, pointRadius: 0, tension: .18, order: 0,
  }];

  const benchStats = statsFor([DATA.benchmarkTicker], [1], 1, window_);
  if (benchStats) {
    datasets.push({
      label: `${DATA.benchmarkTicker} (benchmark)`, data: levelCurve(benchStats.series),
      borderColor: "#B9002F", borderWidth: 1.8, borderDash: [6, 3],
      pointRadius: 0, tension: .18, order: 1,
    });
  }
  const picks = ["awld", "ausl", "aagg", "agld"];
  picks.forEach((id, i) => {
    const fund = DATA.funds.find(f => f.id === id);
    if (!fund || fund.ticker === DATA.benchmarkTicker) return;
    const s = statsFor([fund.ticker], [1], 1, window_);
    if (!s) return;

    datasets.push({
      label: fund.name.replace(/ UCITS ETF.*| ETC.*/, ""), short: fund.ticker.split(".")[0],
      data: levelCurve(s.series), context: true,
      borderColor: cssVar("--line-strong") || "#6B6F7B", borderWidth: 1, pointRadius: 0, tension: .18,
    });
  });
  chart("chartGrowth", {
    type: "line",
    data: { labels: mine.index, datasets },
    options: {
      maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, padding: 14,
                  filter: item => !datasets[item.datasetIndex].context } },
        datalabels: {
          display: c => !!c.dataset.context && c.dataIndex === c.dataset.data.length - 1,
          formatter: (v, c) => c.dataset.short, align: "right", anchor: "end", offset: 2,
          clip: false, color: SLATE(), font: { size: 13 },
        },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: €${c.parsed.y.toFixed(1)}` } },
      },
      layout: { padding: { right: 48 } },
      scales: {
        x: gridScale({ type: "time" in Chart.registry.scales ? "category" : "category",
                       ticks: { maxTicksLimit: 8, autoSkip: true }, grid: { display: false } }),
        y: gridScale({ ticks: { callback: v => "€" + v } }),
      },
    },
  });
  document.getElementById("growthNote").textContent =
    `€100 invested on ${mine.from}, rebased. All lines share the book's window ` +
    `(${(mine.days / TRADING_DAYS).toFixed(1)} years) — the shortest holding decides how far back the ` +
    `comparison can honestly go. Every fund line is already net of its own ongoing charge: the fee comes ` +
    `out of NAV daily, so these are what a holder actually received, not what the fund earned before paying itself.`;
}

function donut(id, entries, note) {
  const labels = entries.map(e => e[0]), values = entries.map(e => e[1]);
  chart(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE(),
            borderColor: "#fff", borderWidth: 2 }] },
    options: {
      maintainAspectRatio: false, cutout: "56%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 10, boxHeight: 10, padding: 9,
                  font: { size: 13 } } },
        datalabels: {
          color: "#fff", font: { size: 13, weight: 600 },
          formatter: (v, c) => v >= 7 ? v.toFixed(0) + "%" : "",
        },
        tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed.toFixed(1)}%` } },
      },
    },
    plugins: [ChartDataLabels],
  });
}

function topN(obj, n) {
  const entries = Object.entries(obj);
  const head = entries.slice(0, n);
  const rest = entries.slice(n).reduce((a, e) => a + e[1], 0);
  if (rest > 0.05) head.push(["Other", rest]);
  return head;
}

function renderRiskBars() {
  const rows = view().riskContributions.slice(0, 10);
  chart("chartRisk", {
    type: "bar",
    data: {
      labels: rows.map(r => r.ticker),
      datasets: [
        { label: "Weight", data: rows.map(r => r.weight), backgroundColor: "#B8C4CC" },
        { label: "Risk share", data: rows.map(r => r.riskShare), backgroundColor: "#0F7E82" },
      ],
    },
    options: {
      maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
                 datalabels: { display: false },
                 tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.x.toFixed(1)}%` } } },
      scales: { x: gridScale({ ticks: { callback: v => v + "%" } }),
                y: gridScale({ grid: { display: false } }) },
    },
  });
}

function renderYears(mine) {
  const line = DATA.lines.find(l => l.id === "me");
  const rows = line ? line.performance.discrete : [];
  chart("chartYears", {
    type: "bar",
    data: {
      labels: rows.map(r => r.year),
      datasets: [{ label: "My book", data: rows.map(r => r.value),
        backgroundColor: rows.map(r => r.value >= 0 ? "#1E7A46" : "#B9002F") }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false },
        datalabels: { anchor: "end", align: "end", color: SLATE(), font: { size: 13 },
                      formatter: v => v.toFixed(1) + "%" },
        tooltip: { callbacks: { label: c => c.parsed.y.toFixed(2) + "%" } } },
      scales: { x: gridScale({ grid: { display: false } }),
                y: gridScale({ ticks: { callback: v => v + "%" } }) },
    },
    plugins: [ChartDataLabels],
  });
}

function renderHoldings() {
  const box = document.getElementById("holdings");
  box.innerHTML = "";
  const { value } = currentWeights();

  const sheetRows = Object.fromEntries((view().holdings || []).map(h => [h.ticker, h]));
  const hasLive = !!liveValuation();
  const rows = holdings.map((h, i) => {
    const sheet = sheetRows[h.ticker];
    const q = sheet && sheet.shares > 0 ? livePriceFor(h.ticker) : null;
    const liveValue = q ? sheet.shares * q.eur : null;
    return {
      cells: [
        h.name || h.ticker,
        { node: tickerLink(h.ticker, "mono") },
        { node: el("input", { type: "number", value: h.value.toFixed(2), step: "10", min: "0",
            class: "val", "aria-label": `Value in euro for ${h.name || h.ticker}`, oninput: e => {
              holdings[i].value = parseFloat(e.target.value) || 0;
              saveHoldings(); renderDerived(); refreshWeights();
            } }) },
        ...(hasLive ? [{
          node: liveValue === null
            ? el("span", { class: "muted" }, "–")
            : el("span", { title: `${sheet.shares} × ${q.eur.toFixed(2)} · ${q.asOf}` },
                fmtEur(liveValue),
                el("div", { class: liveValue >= h.value ? "pos" : "neg", style: "font-size:13px" },
                  (liveValue >= h.value ? "+" : "−") + fmtEur(Math.abs(liveValue - h.value)))),
        }] : []),
        { text: value ? fmtPct((h.value / value) * 100) : "–", cls: "weight" },
        { node: el("button", { class: "link", onclick: () => {
            holdings.splice(i, 1); saveHoldings(); renderAll(); } }, "remove") },
      ],
    };
  });
  box.append(table(
    hasLive ? ["Holding", "Ticker", "Value at build (€)", "Live (€)", "Weight", ""]
            : ["Holding", "Ticker", "Value (€)", "Weight", ""],
    rows, { numFrom: 2 }));

  const options = Object.keys(DATA.returns.series)
    .filter(t => t !== "__benchmark__" && !holdings.some(h => h.ticker === t));
  const select = el("select", { "aria-label": "Add a line to the book" }, el("option", { value: "" }, "add a line…"),
    options.map(t => {
      const fund = DATA.funds.find(f => f.ticker === t);
      return el("option", { value: t }, fund ? `${t} — ${fund.name}` : t);
    }));
  const amount = el("input", { type: "number", value: "1000", step: "100", class: "val", "aria-label": "Amount in euro for the new line" });
  box.append(el("div", { class: "controls", style: "margin-top:14px" }, select, amount,
    el("button", { class: "btn", onclick: () => {
      if (!select.value) return;
      const fund = DATA.funds.find(f => f.ticker === select.value);
      holdings.push({ ticker: select.value, name: fund ? fund.name : select.value,
                      value: parseFloat(amount.value) || 0 });
      saveHoldings(); renderAll();
    } }, "add"),
    el("button", { class: "btn ghost", onclick: resetHoldings }, "reset to sheet")));
}

function refreshWeights() {
  const { value } = currentWeights();
  document.querySelectorAll("#holdings tbody tr").forEach((row, i) => {
    const cell = row.querySelector(".weight");
    if (cell && holdings[i]) cell.textContent = value ? fmtPct((holdings[i].value / value) * 100) : "–";
  });
}

function renderConcentration(value) {
  const sorted = [...holdings].filter(h => h.value > 0).sort((a, b) => b.value - a.value).slice(0, 12);
  chart("chartWeights", {
    type: "bar",
    data: { labels: sorted.map(h => h.ticker),
      datasets: [{ data: sorted.map(h => 100 * h.value / value), backgroundColor: "#14527A" }] },
    options: {
      maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false }, datalabels: { display: false },
                 tooltip: { callbacks: { label: c => c.parsed.x.toFixed(1) + "%" } } },
      scales: { x: gridScale({ ticks: { callback: v => v + "%" } }),
                y: gridScale({ grid: { display: false } }) },
    },
  });
  const weights = holdings.filter(h => h.value > 0).map(h => h.value / value);
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  document.getElementById("concNote").textContent =
    `Inverse Herfindahl: this book of ${weights.length} lines behaves like ${(1 / hhi).toFixed(1)} equally-sized positions.`;
}

function renderHeatmap() {
  const box = document.getElementById("heatmapBox");
  box.innerHTML = "";
  const { tickers } = view().correlations;
  const present = tickers.filter(t => holdings.some(h => h.ticker === t && h.value > 0));
  const use = present.length >= 3 ? present : tickers;
  const window_ = new Set(alignedRows(use).index);
  const series = {};
  for (const t of use) {
    const s = statsFor([t], [1], 1, window_);
    if (s) series[t] = s.series;
  }
  const live = use.filter(t => series[t]);

  const t = el("table", { id: "heatmap" });
  t.append(el("thead", {}, el("tr", {}, el("th", {}, ""), live.map(x => el("th", {}, x)))));
  const body = el("tbody");
  for (const a of live) {
    const tr = el("tr", {}, el("th", {}, a));
    for (const b of live) {
      const c = a === b ? 1 : correlation(series[a], series[b]);
      const shade = Math.max(0, Math.min(1, (c + 0.2) / 1.2));
      tr.append(el("td", {
        class: "cell",
        style: `background:rgba(15,126,130,${(0.08 + shade * 0.9).toFixed(2)})`,
        title: `${a} / ${b}: ${c.toFixed(2)}`,
      }, c.toFixed(1)));
    }
    body.append(tr);
  }
  t.append(body);
  box.append(t);
}

function renderIncome() {
  const box = document.getElementById("incomeBox");
  box.innerHTML = "";
  const rows = view().income.top.map(r => ({
    cells: [r.name || r.ticker, { node: tickerLink(r.ticker, "mono") },
            fmtPct(r.yield), fmtEur(r.annual_eur)],
  }));
  box.append(el("p", { class: "muted", style: "margin-bottom:12px" },
    `${fmtEur(view().income.annual_eur)} a year at today's yields — a ${view().income.portfolio_yield}% book yield. That is ${(view().income.annual_eur / (20000 * 12) * 100).toFixed(2)}% of a €20k-a-month retirement income.`));
  box.append(table(["Payer", "Ticker", "Yield", "Annual €"], rows, { numFrom: 2 }));
}

function fundRows(mine, value) {
  const window_ = new Set(mine.index);
  const head = bookHeadline(mine);
  const rows = [{ id: "me", asset: "Your holdings", kind: "portfolio",
                  ...mine, cagr: head.cagr, vol: head.vol, sharpe: head.sharpe,
                  maxDrawdown: head.maxDrawdown, name: head.label, corr: 1 }];
  for (const fund of DATA.funds) {
    const s = statsFor([fund.ticker], [1], value, window_);
    if (!s || s.days < 60) continue;
    rows.push({ id: fund.id, ticker: fund.ticker, benchmark: fund.benchmark, ter: fund.ter,
                name: fund.name, asset: fund.asset, kind: "fund",
                ...s, corr: correlation(s.series, mine.series) });
  }
  return rows;
}

function renderScatter(rows) {
  const funds = rows.filter(r => r.kind === "fund");
  const me = rows.find(r => r.kind === "portfolio");
  const inPlan = new Set(Object.keys((view() || {}).target || {}));
  const near = [...funds].sort((a, b) =>
    Math.hypot(a.vol - me.vol, a.cagr - me.cagr) - Math.hypot(b.vol - me.vol, b.cagr - me.cagr))
    .slice(0, 5).map(r => r.ticker);
  const labelled = new Set([...near, ...funds.filter(r => inPlan.has(r.ticker)).map(r => r.ticker)]);
  const point = r => ({ x: r.vol, y: r.cagr, n: r.name, short: r.ticker, show: labelled.has(r.ticker) });
  chart("chartScatter", {
    type: "scatter",
    data: {
      datasets: [
        { label: "Funds", data: funds.filter(r => !(typeof trustedLine === "function" && trustedLine(r.ticker)))
            .map(point),
          backgroundColor: "#4A7FA5", pointRadius: 6, pointHoverRadius: 8 },
        { label: "Trusted list", data: funds.filter(r => typeof trustedLine === "function" && trustedLine(r.ticker))
            .map(point),
          backgroundColor: "#0F7E82", pointRadius: 7, pointHoverRadius: 9, pointStyle: "triangle" },
        { label: "My book", data: [{ x: me.vol, y: me.cagr, n: me.name }],
          backgroundColor: INK(), pointRadius: 9, pointStyle: "rectRot" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },

        datalabels: {
          display: c => !!(c.dataset.data[c.dataIndex] || {}).show,
          formatter: v => v.short, align: "right", offset: 6, clip: false,
          color: SLATE(), font: { size: 13 },
        },
        tooltip: { callbacks: { label: c =>
          `${c.raw.n}: ${c.parsed.y.toFixed(1)}% return at ${c.parsed.x.toFixed(1)}% vol` } },
      },
      scales: {
        x: gridScale({ title: { display: true, text: "Volatility (annualised)", color: SLATE() },
                       ticks: { callback: v => v + "%" } }),
        y: gridScale({ title: { display: true, text: "Return p.a.", color: SLATE() },
                       ticks: { callback: v => v + "%" } }),
      },
    },
  });
}

let COMPARE_ROWS = [];
function renderComparison(rows) {
  const box = document.getElementById("comparison");
  box.innerHTML = "";
  const only = document.getElementById("trustedOnly");
  if (only && !only._wired) {
    only._wired = true;
    only.addEventListener("change", () => renderComparison(COMPARE_ROWS));
  }
  COMPARE_ROWS = rows;
  if (only && only.checked && typeof trustedLine === "function") {
    rows = rows.filter(r => r.kind === "portfolio" || trustedLine(r.ticker));
  }
  const sorted = [...rows].sort((a, b) =>
    a.kind === "portfolio" ? -1 : b.kind === "portfolio" ? 1 : b.sharpe - a.sharpe);
  box.append(table(
    ["Line", "Asset class", "Return p.a.", "Vol", "Sharpe", "Beta", "Max DD", "Corr. to book"],
    sorted.map(r => ({
      cls: r.kind === "portfolio" ? "me" : "",
      cells: [{ node: el("span", {}, r.name, typeof trustedBadge === "function" ? trustedBadge(r.ticker) : null) },
              { text: r.asset, cls: "muted" }, fmtPct(r.cagr), fmtPct(r.vol),
              fmtNum(r.sharpe), fmtNum(r.beta),
              { text: fmtPct(r.maxDrawdown), cls: "neg" }, fmtNum(r.corr)],
    })), { numFrom: 2 }));
}

function renderAdditions(tickers, weights, value, mine) {
  const allocation = parseFloat(document.getElementById("alloc").value) / 100;
  const box = document.getElementById("additions");
  box.innerHTML = "";
  const window_ = new Set(mine.index);
  const out = [];
  for (const fund of DATA.funds) {
    if (tickers.includes(fund.ticker)) continue;
    const after = statsFor([...tickers, fund.ticker],
      [...weights.map(w => w * (1 - allocation)), allocation], value, window_);
    if (!after || after.days < 60) continue;

    const shared = new Set(after.index);
    const base = statsFor(tickers, weights, value, shared);
    const solo = statsFor([fund.ticker], [1], value, shared);
    if (!base || !solo) continue;
    out.push({ fund, newVol: after.vol, volChange: after.vol - base.vol,
               newBeta: after.beta, betaChange: after.beta - base.beta,
               retChange: after.cagr - base.cagr,
               corr: correlation(solo.series, base.series) });
  }
  out.sort((a, b) => a.volChange - b.volChange);
  box.append(table(
    [`Add at ${(allocation * 100).toFixed(0)}%`, "Corr.", "New vol", "Δ vol", "Δ return", "Δ beta"],
    out.map(r => ({
      cells: [r.fund.name, fmtNum(r.corr), fmtPct(r.newVol),
        { text: signed(r.volChange) + "pp", cls: r.volChange < 0 ? "pos" : "neg" },
        { text: signed(r.retChange) + "pp", cls: r.retChange >= 0 ? "pos" : "neg" },
        signed(r.betaChange)],
    })), { numFrom: 1 }));
}

function renderFrontier() {
  const select = document.getElementById("frontierFund");
  const curve = DATA.frontiers[select.value];
  if (!curve) return;
  chart("chartFrontier", {
    type: "scatter",
    data: {
      datasets: [{
        label: "Mix", data: curve.map(p => ({ x: p.vol, y: p.return, w: p.fundWeight })),
        showLine: true, borderColor: "#0F7E82", borderWidth: 2,
        backgroundColor: curve.map(p => p.fundWeight === 0 ? "#000" : "#0F7E82"),
        pointRadius: curve.map(p => p.fundWeight === 0 ? 7 : 3),
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }, datalabels: { display: false },
        tooltip: { callbacks: { label: c =>
          `${c.raw.w}% fund: ${c.parsed.y.toFixed(1)}% return at ${c.parsed.x.toFixed(1)}% vol` } },
      },
      scales: {
        x: gridScale({ title: { display: true, text: "Volatility", color: SLATE() },
                       ticks: { callback: v => v + "%" } }),
        y: gridScale({ title: { display: true, text: "Return p.a.", color: SLATE() },
                       ticks: { callback: v => v + "%" } }),
      },
    },
  });
}

function project([lon, lat]) {
  return [(lon + 180) * (1000 / 360), (85 - lat) * (500 / 145)];
}

function pathFor(geometry) {
  const rings = geometry.type === "Polygon" ? [geometry.coordinates]
              : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  let d = "";
  for (const polygon of rings) {
    for (const ring of polygon) {
      let previousLon = null, open = false;
      for (const pt of ring) {

        const jumped = previousLon !== null && Math.abs(pt[0] - previousLon) > 180;
        const [x, y] = project(pt);
        d += (open && !jumped ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        open = true;
        previousLon = pt[0];
      }
      d += "Z";
    }
  }
  return d;
}

function mapColour(weight, max) {
  if (!weight) return "#E4E1DC";
  const t = Math.sqrt(weight / max);
  const stops = ["#D6E5E5", "#9BC7C8", "#4A9EA1", "#0F7E82", "#0A5C5F"];
  return stops[Math.min(stops.length - 1, Math.floor(t * stops.length))];
}

async function renderMap() {
  const svg = document.getElementById("worldmap");
  if (!worldGeo) {
    const topo = await (await fetch("vendor/countries-110m.json")).json();
    worldGeo = topojson.feature(topo, topo.objects.countries);
  }
  const weights = view().exposure.countries;
  const max = Math.max(...Object.values(weights), 1);
  svg.innerHTML = "";
  const tip = document.getElementById("maptip");

  for (const feature of worldGeo.features) {
    const name = feature.properties.name;
    const weight = weights[name] || 0;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathFor(feature.geometry));
    path.setAttribute("fill", mapColour(weight, max));
    path.setAttribute("class", "hit");
    path.addEventListener("mousemove", ev => {
      tip.textContent = weight ? `${name} — ${weight.toFixed(1)}%` : `${name} — no exposure`;
      const box = svg.getBoundingClientRect();
      tip.style.left = (ev.clientX - box.left + 12) + "px";
      tip.style.top = (ev.clientY - box.top + 12) + "px";
      tip.style.opacity = 1;
    });
    path.addEventListener("mouseleave", () => { tip.style.opacity = 0; });
    svg.append(path);
  }

  const legend = document.getElementById("mapLegend");
  legend.innerHTML = "";
  const stops = ["#E4E1DC", "#D6E5E5", "#9BC7C8", "#4A9EA1", "#0F7E82", "#0A5C5F"];
  const labels = ["none", "small", "", "", "", `largest (${max.toFixed(0)}%)`];
  stops.forEach((c, i) => legend.append(el("span", {},
    el("i", { style: `background:${c}` }), labels[i] || "")));

  document.getElementById("mapNote").textContent =
    `${view().exposure.lookThroughWeight.toFixed(0)}% of the book sits in funds and has been exploded through its index's published country weights. Those are hand-entered and approximate — read the shape, not the decimals.`;

  const rows = Object.entries(weights).map(([k, v]) => ({ cells: [k, fmtPct1(v)] }));
  document.getElementById("countryTable").replaceChildren(
    table(["Country", "Weight"], rows, { numFrom: 1 }));
  const sectors = Object.entries(view().exposure.sectors).map(([k, v]) => ({ cells: [k, fmtPct1(v)] }));
  document.getElementById("sectorTable").replaceChildren(
    table(["Sector", "Weight"], sectors, { numFrom: 1 }));
}

function bootstrapPaths(daily, startValue, months, monthly, paths, driftShift) {
  const step = Math.floor(TRADING_DAYS / 12), block = 21;
  const totalDays = months * step;
  const nBlocks = Math.ceil(totalDays / block);
  const maxStart = daily.length - block;
  const track = new Float64Array(paths * months);
  const dailyShift = driftShift / TRADING_DAYS;

  for (let p = 0; p < paths; p++) {
    let value = startValue, day = 0, month = 0, growth = 1;
    for (let b = 0; b < nBlocks && day < totalDays; b++) {
      const start = Math.floor(Math.random() * (maxStart + 1));
      for (let i = 0; i < block && day < totalDays; i++, day++) {
        growth *= 1 + daily[start + i] + dailyShift;
        if ((day + 1) % step === 0 && month < months) {
          value = value * growth + monthly;
          growth = 1;
          track[p * months + month] = value;
          month++;
        }
      }
    }
    for (; month < months; month++) track[p * months + month] = value;
  }
  return track;
}

function percentile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const RISK_FREE = 0.025, EQUITY_RISK_PREMIUM = 0.045;
const capmReturn = beta => RISK_FREE + Math.max(0, beta) * EQUITY_RISK_PREMIUM;

function runSimulation(mine, value) {
  const years = parseInt(document.getElementById("mcYears").value, 10);
  const monthly = parseFloat(document.getElementById("mcMonthly").value) || 0;
  const startInput = parseFloat(document.getElementById("mcStart").value);
  const start = isFinite(startInput) && startInput > 0 ? startInput : value;
  const basis = document.getElementById("mcBasis").value;

  const months = years * 12, paths = 6000;

  const daily = mine.series;
  const sampleDrift = daily.reduce((a, b) => a + b, 0) / daily.length * TRADING_DAYS;
  const capm = capmReturn(mine.beta);

  const cmaBlock = DATA.cma;
  const cmaIndex = cmaBlock ? cmaBlock.expectedPct / 100 : null;
  const cmaDrift = cmaIndex === null ? null
    : RISK_FREE + Math.max(0, mine.beta) * (cmaIndex - RISK_FREE);

  let target = basis === "cma" && cmaDrift !== null ? cmaDrift : capm;
  if (basis === "sample") target = sampleDrift;
  if (basis === "custom") {
    const typed = parseFloat(document.getElementById("mcDrift").value);
    target = isFinite(typed) ? typed / 100 : capm;
  }
  const track = bootstrapPaths(daily, start, months, monthly, paths, target - sampleDrift);

  const fan = [];
  const stepMonths = Math.max(1, Math.round(months / 20));
  for (let m = stepMonths - 1; m < months; m += stepMonths) {
    const col = new Float64Array(paths);
    for (let p = 0; p < paths; p++) col[p] = track[p * months + m];
    col.sort();
    fan.push({ month: m + 1, p05: percentile(col, .05), p25: percentile(col, .25),
               median: percentile(col, .5), p75: percentile(col, .75), p95: percentile(col, .95) });
  }

  const boxes = [];
  for (const y of [1, 3, 5, 10, 20]) {
    if (y > years) continue;
    const m = y * 12 - 1;
    const col = new Float64Array(paths);
    for (let p = 0; p < paths; p++) col[p] = track[p * months + m];
    col.sort();
    const paidIn = start + monthly * (m + 1);
    let losses = 0;
    for (let p = 0; p < paths; p++) if (col[p] < paidIn) losses++;
    boxes.push({ label: `${y} yr`, p05: percentile(col, .05), p25: percentile(col, .25),
                 median: percentile(col, .5), p75: percentile(col, .75),
                 p95: percentile(col, .95), paidIn, probLoss: losses / paths });
  }

  renderFan(fan, start, monthly, months);
  renderBoxes(boxes);
  renderMcSummary(boxes, start, monthly, months, target, sampleDrift, capm,
                  basis, mine, daily.length, cmaDrift);
}

function renderFan(fan, startValue, monthly, months) {
  const labels = fan.map(f => (f.month / 12).toFixed(1) + "y");
  const band = (from, to, colour) => ({
    label: "", data: fan.map(f => f[to]), fill: { target: "-1" },
    backgroundColor: colour, borderWidth: 0, pointRadius: 0, tension: .2, order: 3,
  });
  chart("chartFan", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "5th percentile", data: fan.map(f => f.p05), borderColor: "#9BC7C8",
          borderWidth: 1, pointRadius: 0, tension: .2, fill: false },
        band("p05", "p25", "rgba(155,199,200,.35)"),
        band("p25", "median", "rgba(74,158,161,.35)"),
        band("median", "p75", "rgba(74,158,161,.35)"),
        band("p75", "p95", "rgba(155,199,200,.35)"),
        { label: "Median", data: fan.map(f => f.median), borderColor: INK(),
          borderWidth: 2.4, pointRadius: 0, tension: .2, order: 0, fill: false },
        { label: "Paid in", data: fan.map(f => startValue + monthly * f.month),
          borderColor: cssVar("--amber") || "#8A5A00", borderWidth: 1.5, borderDash: [5, 4],
          pointRadius: 0, tension: 0, order: 1, fill: false },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10,
          filter: item => item.text && item.text !== "" } },
        datalabels: { display: false },
        tooltip: { filter: i => i.dataset.label !== "",
                   callbacks: { label: c => `${c.dataset.label}: ${fmtEur(c.parsed.y)}` } },
      },
      scales: { x: gridScale({ grid: { display: false } }),
                y: gridScale({ ticks: { callback: v => "€" + (v / 1000).toFixed(0) + "k" } }) },
    },
  });
}

function renderBoxes(boxes) {
  chart("chartBox", {
    type: "bar",
    data: {
      labels: boxes.map(b => b.label),
      datasets: [
        { label: "5th–95th", data: boxes.map(b => [b.p05, b.p95]),
          backgroundColor: "rgba(155,199,200,.45)", barPercentage: .35, order: 3 },
        { label: "Middle half", data: boxes.map(b => [b.p25, b.p75]),
          backgroundColor: "#4A9EA1", barPercentage: .7, order: 2 },
        { label: "Median", data: boxes.map(b => [b.median * 0.998, b.median * 1.002]),
          backgroundColor: INK(), barPercentage: .78, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: c => {
          const b = boxes[c.dataIndex];
          return c.datasetIndex === 2 ? `Median ${fmtEur(b.median)}`
               : c.datasetIndex === 1 ? `${fmtEur(b.p25)} to ${fmtEur(b.p75)}`
               : `${fmtEur(b.p05)} to ${fmtEur(b.p95)}`;
        } } },
      },
      scales: { x: gridScale({ stacked: false, grid: { display: false } }),
                y: gridScale({ ticks: { callback: v => "€" + (v / 1000).toFixed(0) + "k" } }) },
    },
  });
}

function renderMcSummary(boxes, start, monthly, months, target, sampleDrift,
                        capm, basis, mine, sampleDays, cmaDrift = null) {
  const cmaBlock = DATA.cma;
  const last = boxes[boxes.length - 1];
  const box = document.getElementById("mcSummary");
  box.innerHTML = "";
  if (!last) return;

  const vol = mine.vol / 100;
  const drag = vol * vol / 2;

  const head = document.getElementById("mcHeadline");
  if (head) {
    const below = last.median < last.paidIn;
    head.textContent = below
      ? `At these assumptions the median ends below what you put in: ${fmtEur(last.median)} against ${fmtEur(last.paidIn)} paid in, and a ${fmtPct(last.probLoss * 100)} chance of a loss.`
      : `The median ends at ${fmtEur(last.median)} against ${fmtEur(last.paidIn)} paid in; a ${fmtPct(last.probLoss * 100)} chance of ending below it.`;
    head.className = below ? "neg" : "";
  }
  box.append(table(["At " + last.label, ""], [
    { cells: ["Paid in", fmtEur(last.paidIn)] },
    { cells: ["Median outcome", fmtEur(last.median)] },
    { cells: ["Bad case (5th pct)", fmtEur(last.p05)] },
    { cells: ["Good case (95th pct)", fmtEur(last.p95)] },
    { cells: ["Chance of ending below what you paid in", fmtPct(last.probLoss * 100)] },
    { cells: ["Assumed return p.a.", fmtPct(target * 100)] },
    { cells: ["Less volatility drag", "−" + fmtPct(drag * 100)] },
    { cells: ["Median compounds at", fmtPct((target - drag) * 100)] },
  ], { numFrom: 1 }));

  const note = document.getElementById("mcBasisNote");
  if (note) {
    note.textContent = basis === "cma" && cmaDrift !== null
      ? `index ${cmaBlock.expectedPct.toFixed(1)}% from the blocks, at beta ${fmtNum(mine.beta)} = ${(cmaDrift * 100).toFixed(1)}%`
      : basis === "capm"
      ? `${(RISK_FREE * 100).toFixed(1)}% cash + beta ${fmtNum(mine.beta)} × ${(EQUITY_RISK_PREMIUM * 100).toFixed(1)}% = ${(capm * 100).toFixed(1)}%`
      : basis === "sample"
        ? `the sample's ${(sampleDrift * 100).toFixed(0)}% — an extrapolation, not a forecast`
        : "";
  }

  const lines = [];
  if (basis === "cma" && cmaBlock) {
    lines.push("<strong>" + cmaBlock.verdict + "</strong> " +
      cmaBlock.blocks.map(b => `${b.label} ${signed(b.pct)}%`).join(", ") + ".");
  }
  lines.push(basis === "sample"
    ? `<strong>You are projecting this book's own ${(sampleDrift * 100).toFixed(0)}% a year forward.</strong> Nothing about ${(sampleDays / TRADING_DAYS).toFixed(1)} bullish years entitles the next ${months / 12} to repeat them; no asset class has sustained that over a decade.`
    : `Drift is an assumption of ${(target * 100).toFixed(1)}% a year, not a measurement. The book's own ${(sampleDays / TRADING_DAYS).toFixed(1)} years annualise to ${(sampleDrift * 100).toFixed(0)}%, which is a bull market being mistaken for an expected return.`);
  lines.push(`At ${fmtPct(mine.vol)} volatility the drag is ${fmtPct(drag * 100)} a year, so the median compounds at ${fmtPct((target - drag) * 100)} rather than ${fmtPct(target * 100)}. On a book this volatile that gap is most of the return.`);
  lines.push(`The spread is resampled from this book's own returns, and those ${(sampleDays / TRADING_DAYS).toFixed(1)} years contain no 2008 and no 2020 — so the bad case shown is optimistic. There is no true crash in the sample to resample from.`);
  document.getElementById("mcWarning").innerHTML = lines.join("<br><br>");
}

function renderStress(mine) {
  const curve = drawdownCurve(mine.series);
  chart("chartDrawdown", {
    type: "line",
    data: {
      labels: mine.index,
      datasets: [{ label: "Below previous peak", data: curve, borderColor: "#B9002F",
        backgroundColor: "rgba(185,0,47,.13)", fill: true, borderWidth: 1.6,
        pointRadius: 0, tension: .1 }],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, datalabels: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y.toFixed(1) + "% below peak" } } },
      scales: { x: gridScale({ ticks: { maxTicksLimit: 8 }, grid: { display: false } }),
                y: gridScale({ ticks: { callback: v => v + "%" } }) },
    },
  });

  document.getElementById("windowsBox").replaceChildren(table(
    ["Rolling window", "Worst", "Best", "Worst ended"],
    view().stress.worstWindows.map(w => ({
      cells: [w.window, { text: fmtPct(w.return), cls: w.return < 0 ? "neg" : "" },
              { text: fmtPct(w.best), cls: "pos" }, w.ended],
    })), { numFrom: 1 }));

  const episodes = view().stress.episodes;
  const box = document.getElementById("episodeBox");
  box.innerHTML = "";
  if (!episodes.length) {
    box.append(el("p", { class: "muted" },
      "None of the named episodes fall inside this book's history."));
  } else {
    box.append(table(["Episode", "Window", "Book"], episodes.map(e => ({
      cells: [e.name + (e.partial ? " (partial)" : ""), `${e.from} → ${e.to}`,
              { text: fmtPct(e.return), cls: e.return < 0 ? "neg" : "pos" }],
    })), { numFrom: 2 }));
    box.append(el("p", { class: "note muted", style: "padding:12px 0 0" },
      "A book that only starts in 2025 cannot be shown a number for a stress that began before it, and splicing index returns onto it to fill the gap would be a fabrication dressed as a stress test."));
  }
}

const TABS = [
  ["overview", "Overview"], ["advice", "Advice"], ["performance", "Performance"],
  ["research", "Research"], ["holdings", "Fact find"], ["goal", "Mortgage"],
  ["pension", "Pension"], ["protection", "Protection"], ["transactions", "Transactions"],
  ["compare", "Against the funds"], ["map", "Map & exposure"], ["simulate", "Simulate"],
  ["stress", "Stress"], ["cube", "Risk surfaces"],
  ["explore", "Explore"], ["escape", "Escape velocity"],
];

const TAB_GROUPS = [
  ["today", "Today", ["overview"]],
  ["advice", "Advice", ["advice"]],
  ["performance", "Performance", ["performance"]],
  ["research", "Research", ["research"]],
  ["plan", "Plan", ["holdings", "goal", "pension", "protection"]],
  ["tools", "Tools", ["transactions", "compare", "map", "simulate", "stress",
                      "cube", "explore", "escape"]],
];
const groupOf = id => TAB_GROUPS.find(g => g[2].includes(id)) || TAB_GROUPS[0];
const LAST_IN_GROUP = {};

function renderTabs() {
  const box = document.getElementById("tabs");
  box.innerHTML = "";
  const current = (location.hash || "#overview").slice(1);
  const label = Object.fromEntries(TABS);
  const [groupId, , members] = groupOf(current);
  const main = el("div", { class: "tabrow", role: "tablist" });
  for (const [gid, glabel, ids] of TAB_GROUPS) {
    const button = el("button", {
      role: "tab", "aria-selected": gid === groupId ? "true" : "false",
      onclick: () => selectTab(LAST_IN_GROUP[gid] || ids[0]),
    }, glabel);
    button.dataset.group = gid;
    main.append(button);
  }
  box.append(main);
  if (members.length > 1) {
    const sub = el("div", { class: "subrow", role: "tablist", "aria-label": "Section views" });
    for (const id of members) {
      const chip = el("button", { class: "subtab", role: "tab", "aria-selected": id === current ? "true" : "false",
                                  onclick: () => selectTab(id) }, label[id]);
      chip.dataset.tab = id;
      sub.append(chip);
    }
    box.append(sub);
  }
}

function selectTab(id) {
  const target = document.getElementById("view-" + id);
  const changed = !!target && !target.classList.contains("on");
  document.querySelectorAll(".view").forEach(v =>
    v.classList.toggle("on", v.id === "view-" + id));
  if (target) LAST_IN_GROUP[groupOf(id)[0]] = id;

  if (history.replaceState) history.replaceState(null, "", "#" + id);
  else location.hash = id;

  renderTabs();

  if (changed) window.scrollTo(0, 0);
  if (id === "map") renderMap();
  if (id === "transactions") renderTransactions();
  if (id === "pension") renderPension();
  if (id === "goal") renderGoal();
  if (id === "cube") renderCube();
  if (id === "explore") renderExplore();
  if (id === "escape") { wireEscape(); renderEscape(); }
  if (id === "protection") renderProtection();
  if (id === "forecast") renderForecastModel();
  if (id === "advice") { renderTrack(); renderSafe(); }
  if (id === "research") renderCio();

  buildPendingCharts(id);
  if (typeof foldMethod === "function") foldMethod(document.getElementById("view-" + id) || document);
  if (typeof tidyTab === "function") requestAnimationFrame(() => tidyTab(id));
  if (id === "simulate") {
    const { tickers, weights, value } = currentWeights();
    const start = document.getElementById("mcStart");

    if (!start.value) start.value = Math.round(value);
    runSimulation(statsFor(tickers, weights, value), value);
  }
}

function renderDerived() {
  const { tickers, weights, value } = currentWeights();
  const mine = statsFor(tickers, weights, value);
  document.getElementById("editBanner").style.display = isEdited() ? "" : "none";
  if (!mine) return;

  renderDesk();
  if (typeof renderNews === "function") renderNews();
  renderTextbook();
  renderActual();
  renderToday();
  renderKpis(mine, value);
  renderBench();
  renderCalls();
  renderGrowth(mine);
  donut("chartSector", topN(view().exposure.sectors, 9));
  donut("chartCurrency", topN(view().exposure.currencies, 6));
  renderRiskBars();
  renderYears(mine);
  renderConcentration(value);
  renderHeatmap();
  renderIncome();

  const rows = fundRows(mine, value);
  renderScatter(rows);
  renderComparison(rows);
  if (typeof renderTrustedCompare === "function") renderTrustedCompare(rows);
  renderAdditions(tickers, weights, value, mine);
  renderFrontier();
  renderStress(mine);
  renderDemoBanner();
  renderMarketBanner();
  renderDiscrepancies();
  renderOrders();
  renderDerivativesAdvice();
  renderCfdAdvice();
  renderAudit();
  renderDeadlines();
  renderLevers();
  renderMilestones();
  renderAchievements(value);
  renderTheories();
  renderPlan();
  renderHedges();
  renderVerdict();
  renderFundsAdd(rows, mine, value);
  renderConviction(value);
  renderWatch();
  renderInsiders();
  renderAccounts();
  renderValuation();
  renderOutside();
  renderPrediction();
  if (typeof renderTrusted === "function") renderTrusted();
  if (typeof renderCommittee === "function") renderCommittee();
  renderLeaks();
  renderResearchViews();
  renderFactFind();
  renderRules();
  renderAdvice(mine, value);

  if (document.getElementById("view-simulate").classList.contains("on")) {
    runSimulation(mine, value);
  }
}

function renderAll() { renderHoldings(); renderDerived(); }

function selectBook(name) {
  BOOK = name;
  const picker = document.getElementById("bookSelect");
  if (picker && picker.value !== name) picker.value = name;
  holdings = (loadHoldings() || sheetHoldings()).filter(h => columnFor(h.ticker));
  document.getElementById("strapline").textContent =
    isDemo()
      ? `${BOOK} — a fictional book on synthetic prices, real arithmetic`
      : BOOK === "Combined"
        ? "both books together — a reporting view, never a book you can trade against"
        : `${BOOK}'s book, measured against the funds you could buy instead`;
  const start = document.getElementById("mcStart");
  if (start) start.value = Math.round(currentWeights().value);
  renderAll();
  if (typeof tidyTab === "function") requestAnimationFrame(() => tidyTab((location.hash || "#overview").slice(1)));
  if (typeof loadNews === "function" && !NEWS_LIVE[name]) loadNews();

  loadLivePrices().then(ok => {
    if (!ok || BOOK !== LIVE.book) return;
    const { tickers, weights, value } = currentWeights();
    const mine = statsFor(tickers, weights, value);
    if (mine) renderKpis(mine, value);
    renderToday();
    renderHoldings();
    renderLiveStamp();
    renderFreshness();
  });

  const on = id => !!document.getElementById("view-" + id)?.classList.contains("on");

  buildPendingCharts((location.hash || "#overview").slice(1));
  if (on("map")) renderMap();
  if (on("transactions")) renderTransactions();
  if (on("goal")) renderGoal();
  if (on("pension")) renderPension();
  if (on("cube")) renderCube();
  if (on("escape")) renderEscape();
  if (on("protection")) renderProtection();
  if (on("forecast")) renderForecastModel();
  renderTrack();
  renderHistory();
  renderMoneyWeighted();
  renderContext();
  renderSafe();
  renderCio();
  renderTextbook();
  renderActual();
  renderValuation();
  renderOutside();
  renderPrediction();
  renderLeaks();
  renderResearchViews();
  renderFactFind();
}

let LIVE_HEALTH = null;

const JOB_SHORT = { refresh: "Rebuild", forecastModel: "Forecast", brief: "Digest", selftest: "Self-test",
                    doctor: "Checks", backup: "Backup" };

function renderHealthBanner() {
  const chip = document.getElementById("healthChip");
  const old = document.getElementById("healthBanner");
  if (old) old.style.display = "none";
  if (!chip) return;
  const health = LIVE_HEALTH || DATA.health;
  const problems = [...((health && health.problems) || [])];
  const priceStatus = DATA.priceStatus || {};
  const late = problems.filter(p => p.severity === "error").map(p =>
    `${JOB_SHORT[p.job] || p.label} ${ok(p.ageHours) ? spellHours(p.ageHours) + " late" : "not run"}`);
  if (priceStatus.stale && priceStatus.source === "cache") {
    late.unshift(`Prices ${spellHours(priceStatus.cacheAgeHours || 0)} old`);
  }
  document.getElementById("healthPop")?.remove();
  if (!late.length) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.className = "healthchip" + (problems.some(p => p.severity === "error" && p.job === "refresh") ? " bad" : "");
  chip.textContent = late.join(" · ");
  chip.onclick = () => {
    const open = document.getElementById("healthPop");
    if (open) { open.remove(); return; }
    const pop = el("div", { class: "healthpop", id: "healthPop", role: "dialog" },
      problems.map(p => el("p", { class: p.severity === "error" ? "neg" : "muted" }, p.message)),
      problems.some(p => p.severity === "error")
        ? el("p", { class: "muted" }, "Scheduled jobs are not part of the demo.") : null);
    document.body.append(pop);
  };
}

function spellHours(h) {
  return h >= 48 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
}

function renderCaveats() {
  const list = el("ul");
  for (const c of DATA.caveats) list.append(el("li", {}, c));
  document.getElementById("caveats").replaceChildren(list);
}

async function boot() {

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  DATA = await (await fetch("data.json")).json();
  renderFreshness();
  const picker = document.getElementById("bookSelect");
  for (const name of DATA.books) picker.append(el("option", { value: name }, name));
  picker.value = DATA.defaultBook;
  picker.addEventListener("change", e => selectBook(e.target.value));
  BOOK = DATA.defaultBook;
  holdings = (loadHoldings() || sheetHoldings()).filter(h => columnFor(h.ticker));

  renderTabs();
  const select = document.getElementById("frontierFund");
  for (const fund of DATA.funds) {
    if (DATA.frontiers[fund.id]) select.append(el("option", { value: fund.id }, fund.name));
  }
  select.value = "aagg" in DATA.frontiers ? "aagg" : select.options[0]?.value;
  select.addEventListener("change", renderFrontier);

  document.getElementById("alloc").addEventListener("input", e => {
    document.getElementById("allocLabel").textContent = e.target.value + "%";
    const { tickers, weights, value } = currentWeights();
    renderAdditions(tickers, weights, value, statsFor(tickers, weights, value));
  });

  const rerun = () => {
    const { tickers, weights, value } = currentWeights();
    runSimulation(statsFor(tickers, weights, value), value);
  };
  document.getElementById("mcYears").addEventListener("change", e => {
    document.getElementById("mcYearsLabel").textContent = e.target.value + " yrs";
    rerun();
  });
  document.getElementById("mcYears").addEventListener("input", e => {
    document.getElementById("mcYearsLabel").textContent = e.target.value + " yrs";
  });
  document.getElementById("mcMonthly").addEventListener("change", rerun);
  document.getElementById("mcDrift").addEventListener("change", rerun);
  document.getElementById("mcStart").addEventListener("change", rerun);
  document.getElementById("mcStartReset").addEventListener("click", () => {
    document.getElementById("mcStart").value = Math.round(currentWeights().value);
    rerun();
  });
  document.getElementById("mcBasis").addEventListener("change", e => {
    document.getElementById("mcDrift").style.display =
      e.target.value === "custom" ? "" : "none";
    if (e.target.value === "custom" && !document.getElementById("mcDrift").value) {
      const { tickers, weights, value } = currentWeights();
      const mine = statsFor(tickers, weights, value);
      document.getElementById("mcDrift").value = (capmReturn(mine.beta) * 100).toFixed(1);
    }
    rerun();
  });
  document.getElementById("mcDrift").style.display = "none";

  applyTheme(currentTheme());
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);

  const refresh = document.getElementById("refreshNow");
  checkApi().then(health => {
    if (!API) return;

    if (typeof renderDesk === "function") renderDesk();
    if (typeof renderOutside === "function") renderOutside();
    if (typeof renderFactFind === "function") renderFactFind();
    if (typeof loadSavingsRows === "function") loadSavingsRows();
    if (typeof renderPrediction === "function") renderPrediction();
    if (typeof loadNews === "function") { loadNews(); newsAutoRefresh(); }

    if (health && health.canRebuild === false) {
      refresh.style.display = "";
      refresh.disabled = true;
      refresh.textContent = "rebuild unavailable";
      refresh.title = (health.rebuildBlockers || []).join("; ")
        || "this machine cannot rebuild";
      return;
    }
    refresh.style.display = "";
    if (health && health.rebuildMode === "last synced holdings") {

      refresh.title = "reprices the holdings as of the last full build — "
        + "this machine cannot read the live sheet";
      refresh.textContent = "refresh prices";
    }
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      refresh.textContent = "rebuilding…";
      try {
        await fetch("/api/rebuild", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: "{}" });
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const state = await apiGet("/api/rebuild");
          if (!state.running) {
            if (state.status && (state.status.startsWith("failed")
                                 || state.status.startsWith("cannot rebuild"))) {

              refresh.textContent = "rebuild failed";
              refresh.title = state.status;
              alert("Rebuild failed:\n\n" + state.status);
              return;
            }
            location.reload();
            return;
          }
        }
        refresh.textContent = "still going…";
      } catch (e) {
        refresh.textContent = "rebuild failed";
      } finally {
        refresh.disabled = false;
      }
    });
  });

  document.getElementById("exploreGo").addEventListener("click", () => renderExplore());
  document.getElementById("exploreTicker").addEventListener("keydown", e => {
    if (e.key === "Enter") renderExplore();
  });
  document.getElementById("exploreWeight").addEventListener("input", e => {
    document.getElementById("exploreWeightLabel").textContent = e.target.value + "%";
  });
  document.getElementById("exploreWeight").addEventListener("change", () => {
    if (document.getElementById("exploreTicker").value.trim()) renderExplore();
  });
  renderHealthBanner();
  renderCaveats();
  selectBook(DATA.defaultBook);
  const hash = location.hash.replace("#", "");
  if (TABS.some(t => t[0] === hash)) selectTab(hash);

  checkApi().then(() => {
    if (!API) return;
    loadLivePrices().then(ok => {
      if (!ok || BOOK !== LIVE.book) return;
      const { tickers, weights, value } = currentWeights();
      const mine = statsFor(tickers, weights, value);
      if (mine) renderKpis(mine, value);
      renderToday();
      renderHoldings();
      renderLiveStamp();
    });
  });
}

boot();

async function apiGet(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

async function checkApi() {
  if (DATA && DATA.demoMode) { API = false; return null; }
  try {
    const health = await apiGet("/api/health");
    API = true;

    if (health && health.jobs) {
      LIVE_HEALTH = health.jobs;
      renderHealthBanner();
    }
    return health;
  } catch (e) { API = false; return null; }
}

function tradeForm() {
  return el("p", { class: "muted" }, "Read-only demo: trades cannot be recorded here.");
}

async function renderTransactions() {
  const box = document.getElementById("txBox");
  box.innerHTML = "";
  await checkApi();
  box.append(el("p", { class: "muted" },
    "Read-only demo: trades cannot be recorded here. The history below is fictional, generated from a seed."));

  const listBox = document.getElementById("txList");
  listBox.innerHTML = "";

  const demoLedger = isDemo() ? G("ledger") : null;
  if (!API && !demoLedger) {
    listBox.append(el("p", { class: "muted" }, "No ledger available without the API."));
    return;
  }
  const data = demoLedger
    ? { trades: (G("trades") || []), summary: demoLedger }
    : await apiGet(`/api/transactions?portfolio=${encodeURIComponent(BOOK)}`);
  const { trades, summary } = data;

  const fxNote = (summary.converted || []).length
    ? `; ${summary.converted.join(", ")} at today's rate` : "";
  const cards = el("div", { class: "kpis", style: "margin-bottom:18px" });
  for (const [k, v, s] of [
    ["Trades recorded", String(summary.count), summary.first ? `since ${summary.first}` : "none yet"],
    ["Cost of open positions", fmtEur(summary.invested), "average cost, per the ledger" + fxNote],
    ["Realised", fmtEur(summary.realised), "closed out, before tax" + fxNote],
    ["Fees paid", fmtEur(summary.fees), "as entered"],
  ]) {
    cards.append(el("div", { class: "kpi" }, el("div", { class: "k" }, k),
      el("div", { class: "v" }, v), el("div", { class: "s" }, s)));
  }
  listBox.append(cards);

  if (!trades.length) {
    listBox.append(el("p", { class: "muted" },
      "Nothing recorded yet. The sheet holds share counts but no history, so this ledger starts the day you log your first trade — earlier positions will show no cost basis until you backfill them."));
    return;
  }

  listBox.append(table(["Date", "Book", "Action", "Ticker", "Shares", "Price", "Value", "Sheet", "Note"],
    [...trades].reverse().map(t => ({
      cells: [t.date, t.portfolio,
        { text: t.action === "buy" ? "Bought" : "Sold", cls: t.action === "buy" ? "pos" : "neg" },
        { node: el("span", { class: "mono" }, t.ticker) },
        t.shares, fmtMoney(t.price, t.currency), fmtMoney(t.shares * t.price, t.currency),
        { text: t.applied_to_sheet ? "yes" : "ledger only", cls: "muted" },
        { text: t.note || "", cls: "muted" }],
    })), { numFrom: 4 }));

  const open = Object.values(summary.positions).filter(p => p.shares > 0);
  if (open.length) {
    listBox.append(el("h3", { style: "margin:22px 0 10px;font-size:15px" }, "Cost basis from the ledger"));
    listBox.append(table(["Ticker", "Shares", "Avg cost", "Book cost", "Realised"],
      open.map(p => ({
        cells: [{ node: el("span", { class: "mono" }, p.ticker) }, p.shares,
                fmtMoney(p.avg_cost, p.currency), fmtMoney(p.cost, p.currency),
                { text: fmtMoney(p.realised, p.currency), cls: p.realised >= 0 ? "pos" : "neg" }],
      })), { numFrom: 1 }));
    listBox.append(el("p", { class: "note muted", style: "padding-top:10px" },
      "Average cost, not FIFO. Irish CGT wants FIFO with a four-week rule, so read this as what a position cost you, not as a tax figure."));
  }
}

function todayMoves() {
  const v = view(), built = (v.daily || {}).today;
  if (!isEdited() && LIVE.at && LIVE.book === BOOK) {
    const rows = [];
    for (const h of v.holdings || []) {
      if (h.tradable === false || !(h.shares > 0)) continue;
      const q = LIVE.prices[h.ticker];
      if (!q || !q.eur || !q.prevEur) continue;
      rows.push({ ticker: h.ticker, pct: (q.eur / q.prevEur - 1) * 100,
                  eur: h.shares * (q.eur - q.prevEur), value: h.shares * q.eur, asOf: q.asOf });
    }
    if (rows.length) {
      const eur = rows.reduce((a, r) => a + r.eur, 0);
      const base = rows.reduce((a, r) => a + r.value, 0) - eur;
      const pct = base ? eur / base * 100 : 0;
      const b = LIVE.prices[DATA.benchmarkTicker];
      const benchmarkPct = b && b.eur && b.prevEur ? (b.eur / b.prevEur - 1) * 100
        : built ? built.benchmarkPct : null;
      return { live: true, eur, pct, benchmarkPct,
               excess: ok(benchmarkPct) ? pct - benchmarkPct : null,
               up: rows.filter(r => r.pct > 0).length, down: rows.filter(r => r.pct < 0).length,
               holdings: rows, asOf: rows.map(r => r.asOf).filter(Boolean).sort().pop() };
    }
  }
  return built ? { ...built, live: false } : null;
}

const signedEur = v => (v >= 0 ? "+" : "−") + fmtEur(Math.abs(v));
const signedPct = (v, d = 2) => ok(v) ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + "%" : "–";

function renderToday() {
  const box = document.getElementById("todayBox");
  if (!box) return;
  box.innerHTML = "";
  const t = todayMoves();
  if (!t) return;
  const infl = DATA.inflation ?? 0.03;
  const value = t.holdings.reduce((a, r) => a + r.value, 0);
  const dailyInflation = value * (Math.pow(1 + infl, 1 / 365) - 1);

  const head = el("div", {},
    el("div", { class: "lbl" }, t.live
      ? `Today · live ${LIVE.at.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}`
      : `Latest session · ${t.asOf}`),
    el("div", { class: "big " + (t.eur >= 0 ? "pos" : "neg") },
      `${signedEur(t.eur)}  ${signedPct(t.pct)}`),
    el("div", { class: "sub" }, ok(t.benchmarkPct)
      ? [`S&P 500 ${signedPct(t.benchmarkPct)} — `,
         el("strong", { class: t.excess >= 0 ? "pos" : "neg" },
           t.excess >= 0 ? `ahead by ${t.excess.toFixed(2)}pp` : `behind by ${Math.abs(t.excess).toFixed(2)}pp`)]
      : "No benchmark print for this session"),
    el("div", { class: "sub muted" },
      `${t.up} up · ${t.down} down · inflation at ${(infl * 100).toFixed(0)}% costs about ${fmtEur(dailyInflation)} a day`));

  const sorted = [...t.holdings].sort((a, b) => b.eur - a.eur);
  const list = (title, rows) => el("div", {}, el("div", { class: "lbl" }, title),
    rows.length
      ? el("ul", {}, rows.map(r => el("li", {}, el("strong", {}, tickerLink(r.ticker)),
          el("span", { class: r.eur >= 0 ? "pos" : "neg" },
            `${signedEur(r.eur)} · ${signedPct(r.pct, 1)}`))))
      : el("p", { class: "muted", style: "font-size:13px" }, "None today"));
  box.append(el("div", { class: "today" }, head,
    list("Biggest winners", sorted.filter(r => r.eur > 0).slice(0, 3)),
    list("Biggest losers", sorted.filter(r => r.eur < 0).reverse().slice(0, 3))));
}

function renderBench() {
  const box = document.getElementById("benchTable");
  if (!box) return;
  box.innerHTML = "";
  const infl = DATA.inflation ?? 0.03;
  const t = todayMoves();
  const rows = [];
  if (t) {
    const dayInfl = (Math.pow(1 + infl, 1 / 365) - 1) * 100;
    rows.push({ label: t.live ? "Today (live)" : "Latest session", book: t.pct, benchmark: t.benchmarkPct,
                excess: t.excess, inflation: dayInfl, real: ((1 + t.pct / 100) / (1 + dayInfl / 100) - 1) * 100 });
  }
  rows.push(...(((view().daily || {}).periods) || []));
  const cell = v => ok(v) ? { text: signedPct(v), cls: v >= 0 ? "pos" : "neg" } : "–";
  box.append(table(["Period", "Your book", "S&P 500", "vs S&P 500", "Inflation", "Book after inflation"],
    rows.map(r => ({ cells: [r.label, cell(r.book), cell(r.benchmark),
      ok(r.excess) ? { text: signed(r.excess) + "pp", cls: r.excess >= 0 ? "pos" : "neg" } : "–",
      { text: fmtPct(r.inflation), cls: "muted" }, cell(r.real)] })), { numFrom: 1 }));
  document.getElementById("benchNote").textContent =
    `Benchmark: ${DATA.benchmarkTicker}, the S&P 500 line you hold — so beating the market means beating what you could ` +
    `simply have held. Inflation at ${(infl * 100).toFixed(0)}% a year. Periods longer than today apply today's weights ` +
    `to past returns: what this mix would have done, not what the book did (see "What it was actually worth").`;
}

const CALL_ORDER = { Sell: 0, Trim: 1, Hold: 2, Buy: 3 };
const CALL_CLASS = { Sell: "neg", Trim: "neg", Hold: "muted", Buy: "pos" };

function renderCalls() {
  const box = document.getElementById("callsBox");
  if (!box) return;
  box.innerHTML = "";
  const v = view();
  const calls = v.verdicts || {};
  const weights = ((v.optimisation || {}).theories || {}).current?.weights || {};
  const tickers = Object.keys(calls).sort((a, b) =>
    CALL_ORDER[calls[a].call] - CALL_ORDER[calls[b].call] || (weights[b] || 0) - (weights[a] || 0));
  if (!tickers.length) return;
  const count = c => tickers.filter(t => calls[t].call === c).length;
  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "Buy · Hold · Trim · Sell — every holding against its outlook and the S&P 500"));
  const body = el("div", { class: "body" });
  body.append(el("p", { class: "hint" },
    `${count("Buy")} buy · ${count("Hold")} hold · ${count("Trim")} trim · ${count("Sell")} sell. ` +
    "Each company's outlook — analysts, trend, earnings quality, valuation, the risk it adds, and twelve months against " +
    "the S&P 500 — sets a target weight: a good outlook means up to its conviction cap, a poor one means zero. The call " +
    "is the move to that target, which is exactly what the plan in Advice trades. So one outlook can read Buy in one " +
    "book and Trim in another: both mean \"get to the cap\", one from below and one from above. Funds are called on the " +
    "target mix. Morningstar ratings need a paid account, so the S&P 500 is the yardstick."));
  const nameOf = t => (DATA.funds.find(f => f.ticker === t) || {}).name || (DATA.heldFundNames || {})[t]
    || ((DATA.companyWatch || {})[t] || {}).name || ((v.holdings || []).find(h => h.ticker === t) || {}).name || t;
  const reasonTone = r => r.startsWith("+") ? "pos" : r.startsWith("−") ? "neg" : "muted";
  body.append(table(["Holding", "Call", "Why", "Now", "Target", "vs S&P 500, 12m"],
    tickers.map(t => {
      const c = calls[t];
      return { cells: [
        { node: el("span", {}, el("strong", {}, tickerLink(t)), el("br"), el("span", { class: "muted" }, nameOf(t))) },
        { node: el("span", {}, el("strong", { class: CALL_CLASS[c.call] }, c.call.toUpperCase()),
            c.outlook ? el("div", { class: "muted", style: "font-size:13px" }, `outlook: ${c.outlook.toLowerCase()}`) : null) },

        { node: c.reasons.length <= 2
            ? el("ul", { class: "flags", style: "list-style:none;padding-left:0" },
                c.reasons.map(r => el("li", { class: reasonTone(r) }, r)))
            : el("div", {},
                el("ul", { class: "flags", style: "list-style:none;padding-left:0" },
                  c.reasons.slice(0, 2).map(r => el("li", { class: reasonTone(r) }, r))),
                el("details", { class: "more-reasons" },
                  el("summary", { class: "muted" }, `${c.reasons.length - 2} more`),
                  el("ul", { class: "flags", style: "list-style:none;padding-left:0" },
                    c.reasons.slice(2).map(r => el("li", { class: reasonTone(r) }, r))))) },
        fmtPct1(weights[t] || 0),
        { node: el("strong", {}, fmtPct1(c.targetPct || 0)) },
        ok(c.vsBenchmark) ? { text: signed(c.vsBenchmark) + "pp", cls: c.vsBenchmark >= 0 ? "pos" : "neg" } : "–",
      ] };
    }), { numFrom: 3 }));
  body.append(el("p", { class: "note muted", style: "padding-top:8px" },
    "A call on the holding, not a trade: the plan in Advice decides size and order within your monthly budget and free sells. " +
    "Not investment advice."));
  panel.append(body);
  box.append(panel);
}

const ALT_LABELS = {
  keepers: ["Your calls + funds", "Each company at the weight its Buy / Hold / Sell call gives it (conviction caps, AI trade at most 25%); funds fill the rest"],
  growth: ["All funds: most growth", "No single companies; compounds fastest in the model; AI trade capped at 25%"],
  sharpe: ["All funds: smoothest ride", "No single companies; best return for each unit of risk"],
  global: ["All funds: less dollar", "No single companies and no US-only funds"],
  trusted: ["Trusted list only", "Only funds a professional desk holds (the trusted list); most growth among them, AI trade capped — check each before buying"],
};
let VERDICT_ALT = null;

function renderVerdict() {
  const box = document.getElementById("verdictBox");

  if (!box) return;
  box.innerHTML = "";
  const working = document.getElementById("adviceWorking");
  if (working && !working.dataset.wired) {
    working.dataset.wired = "1";
    working.addEventListener("toggle", () => { if (working.open) buildPendingCharts("advice"); });
  }
  const v = view();
  const opt = v.optimisation;
  const alts = v.alternatives || [];
  if (!opt || !alts.length || !v.plan) {
    box.append(el("div", { class: "panel wide", style: "margin-bottom:20px" },
      el("h3", {}, "The answer"),
      el("div", { class: "body" }, el("p", { class: "muted" },
        "Not enough price history in this book to run the optimiser. Open the working below for what can be shown."))));
    return;
  }
  const alt = alts.find(a => a.id === VERDICT_ALT) || alts.find(a => a.default) || alts[0];
  const allFunds = alts.find(a => a.id === "growth");
  const now = opt.theories.current;
  const research = v.research || {};
  const aiNow = (research.aiTrade || {}).pct;
  const nameOf = t => (DATA.funds.find(f => f.ticker === t) || {}).name
    || (DATA.heldFundNames || {})[t]
    || ((DATA.companyWatch || {})[t] || {}).name
    || ((v.holdings || []).find(h => h.ticker === t) || {}).name || t;
  const nowW = now.weights || {};

  const ordersPanel = el("div", { class: "panel wide key", style: "margin-bottom:20px", id: "thisMonth" },
    el("h3", {}, "This month — what to place"));
  const ordersBody = el("div", { class: "body" });
  ordersPanel.append(ordersBody);

  const panel = el("div", { class: "panel wide key", style: "margin-bottom:20px" },
    el("h3", {}, "The answer — the mix the orders walk towards"));
  const body = el("div", { class: "body" });

  const tabs = el("div", { class: "alt-tabs" });
  for (const a of alts) {
    const [label, blurb] = ALT_LABELS[a.id] || [a.id, ""];
    const button = el("button", { class: a.id === alt.id ? "on" : "", title: blurb },
      el("b", {}, label), el("span", {}, `${fmtPct1(a.growth)} growth · ${fmtPct1(a.vol)} volatility`));
    button.addEventListener("click", () => { VERDICT_ALT = a.id; renderVerdict(); });
    tabs.append(button);
  }
  body.append(tabs);
  body.append(el("p", { class: "muted", style: "margin:-6px 0 14px;font-size:13px" },
    (ALT_LABELS[alt.id] || ["", ""])[1] + "."));

  const kpi = (k, a, b) => el("div", {}, el("div", { class: "k" }, k),
    el("div", { class: "v" }, a, el("span", { class: "muted", style: "font-weight:400" }, " → "), b));
  const better = (a, b, lowerIsBetter) => el("span", { class: (lowerIsBetter ? b <= a : b >= a) ? "pos" : "neg" }, fmtPct1(b));
  body.append(el("div", { class: "verdict-kpis" },
    kpi("Expected growth / yr", fmtPct1(now.growth), better(now.growth, alt.growth)),
    kpi("Volatility", fmtPct1(now.vol), better(now.vol, alt.vol, true)),
    kpi("AI trade", ok(aiNow) ? fmtPct1(aiNow) : "–", better(aiNow, alt.aiPct, true)),
    kpi("Fund fees / yr", fmtPct(now.fee), fmtPct(alt.fee))));

  const target = Object.entries(alt.target).sort((a, b) => b[1] - a[1]);
  const convictions = v.convictions || {};
  body.append(el("h4", { style: "margin:4px 0 6px" }, "Hold this"));

  const deRisk = v.deRisk;

  const parkName = t => deRisk && t === deRisk.parkIn
    ? `${deRisk.parkName} · mortgage money, this month's step, until ${deRisk.byDate || "the date"}` : nameOf(t);
  body.append(table(["Line", "Target", "Now"],
    [].concat(target.map(([t, w]) => ({ cls: deRisk && t === deRisk.parkIn ? "grp" : "", cells: [
      { node: el("span", {}, el("strong", {}, tickerLink(t)), " ", el("span", { class: "muted" }, parkName(t)),
          convictions[t] ? el("span", { class: "muted" }, ` · ${convictions[t].level} conviction, cap ${convictions[t].capPct.toFixed(0)}%`) : null,
          typeof trustedBadge === "function" ? trustedBadge(t) : null) },
      el("strong", {}, fmtPct1(w)), { text: fmtPct1(nowW[t] || 0), cls: "muted" }] }))),
    { numFrom: 1 }));

  const queue = (v.plan.sells || []).map(t => t.ticker);
  const rank = t => (queue.indexOf(t) + 1) || queue.length + 1;
  const leaving = Object.keys(nowW).filter(t => !(t in alt.target) && nowW[t] > 0.5)
    .sort((a, b) => rank(a) - rank(b) || nowW[b] - nowW[a]);
  if (leaving.length) {
    body.append(el("p", { class: "note muted", style: "padding-top:8px" },
      `Sold down to zero over about ${alt.months} month${alt.months === 1 ? "" : "s"} at five free sells a month, ` +
      `exits first and largest first, what is still working last: ${leaving.join(", ")}.`));
  }

  {
  const body = ordersBody;
  if (alt.default) {

    const orders = (v.orders || []).filter(o => !o.skipped)
      .sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1));
    if (!orders.length) {
      body.append(el("p", { class: "muted" }, "Nothing to place this month."));
    } else {
      const limitText = o => ok(o.nativeLimit)
        ? (o.currency === "USD" ? "$" : "€") + o.nativeLimit.toFixed(2) : "market";

      body.append(el("div", { class: "orders" }, orders.map(o => el("div", { class: "order" },
        el("div", { class: "order-top" },
          el("span", { class: "order-side " + (o.side === "sell" ? "neg" : "pos") }, o.side.toUpperCase()),
          el("strong", {}, tickerLink(o.ticker)),
          el("span", { class: "muted order-name" }, nameOf(o.ticker)),
          el("strong", { class: "order-eur" }, fmtEur(o.euros))),
        el("div", { class: "order-how muted" },
          `${ok(o.shares) ? +o.shares.toFixed(2) : "–"} × ${limitText(o)} · `,
          o.broker ? el("span", {}, o.broker)
                   : el("span", { class: "neg" }, "broker missing — set it before placing"),
          o.deadline ? ` · ${o.urgency || ""}${o.urgency ? ", " : ""}by ${o.deadline}` : "")))));
      const sellAt = new Set(orders.filter(o => o.side === "sell" && o.broker).map(o => o.broker));
      const buyAt = [...new Set(orders.filter(o => o.side === "buy" && o.broker).map(o => o.broker))];
      if (sellAt.size && buyAt.some(b => !sellAt.has(b))) {
        body.append(el("p", { class: "note", style: "padding-top:8px" },
          `Sells settle at ${[...sellAt].join(", ")}; the buys are placed at ${buyAt.join(", ")}. ` +
          `Move the proceeds across first — the buys cannot fill on cash that is still at another broker.`));
      }
      const cost = (v.plan.tradingCost || {}).total;
      const month = v.plan.taxThisMonth || v.plan.tax || {};
      const whole = v.plan.tax || {};
      const coverage = month.coverage == null ? 100 : month.coverage;
      const parts = [`Dealing costs about ${fmtEur(cost)}`];
      if (DATA.taxMode === "none") {
        parts.push("tax is not modelled (Irish tax modelling is off)");
      } else {
        parts.push(`tax on this month's sells about ${fmtEur(month.tax || 0)}` +
          (month.shares && month.funds
            ? ` — CGT ${fmtEur(month.shares.tax)} on shares after the ${fmtEur(month.shares.exemption)} exemption, ` +
              `exit tax ${fmtEur(month.funds.tax)} on funds` : ""));
        if (coverage < 100) parts.push(`${100 - coverage}% of the sells have no cost basis in the ledger, so the true figure is higher`);
        if ((v.plan.months || 0) > 1 && whole.tax != null) parts.push(`the whole plan about ${fmtEur(whole.tax)}`);
      }
      body.append(el("p", { class: "note muted", style: "padding-top:8px" }, parts.join("; ") + "."));
      if (v.plan.taxYearSplit) {
        body.append(el("div", { class: "goodbox", style: "margin-top:8px" },
          el("strong", {}, `Save about ${fmtEur(v.plan.taxYearSplit.savingEur)} by splitting across tax years. `),
          v.plan.taxYearSplit.what));
      }
    }
  } else {
    const month = alt.thisMonth || { sells: [], buys: [] };
    const trades = [...month.sells, ...month.buys];
    if (!trades.length) {
      body.append(el("p", { class: "muted" }, "Nothing to place this month."));
    } else {
      body.append(table(["", "Line", "Amount", "Shares"],
        trades.map(o => ({ cells: [
          { text: o.action.toUpperCase() + (o.belowTrend ? " · below trend" : ""), cls: o.action === "sell" ? "neg" : "pos" },
          { node: el("span", {}, el("strong", {}, tickerLink(o.ticker)), " ", el("span", { class: "muted" }, nameOf(o.ticker))) },
          fmtEur(o.euros), ok(o.shares) ? String(+o.shares.toFixed(2)) : "–"] })), { numFrom: 2 }));
      body.append(el("p", { class: "note muted", style: "padding-top:8px" },
        "Priced orders with limits and deadlines are worked out for the default mix; if you pick this one instead, the list above is the order list to size by hand."));
    }
  }

  if (typeof trackVerdictBox === "function" && DATA.adviceRecord && DATA.adviceRecord.scoreboard) {
    body.append(el("div", { style: "margin-top:12px" }, trackVerdictBox(DATA.adviceRecord.scoreboard)));
  }
  }

  const why = el("ul", { style: "margin:6px 0 0 18px;font-size:13px" });
  why.append(el("li", { style: "margin-bottom:6px" }, el("strong", {}, "Less risk compounds faster. "),
    `At ${fmtPct1(now.vol)} volatility the book loses about ${fmtPct1(now.drag)} a year to volatility drag; ` +
    `this mix runs at ${fmtPct1(alt.vol)} and loses ${fmtPct1(alt.drag)}.`));
  if (ok(aiNow) && aiNow >= 25 && DATA.research) {
    why.append(el("li", { style: "margin-bottom:6px" }, el("strong", {}, "One theme is most of the book. "),
      `${fmtPct1(aiNow)} rides one theme; this mix holds ${fmtPct1(alt.aiPct)}.`));
  }
  if (alt.id === "keepers" && allFunds) {
    why.append(el("li", { style: "margin-bottom:6px" }, el("strong", {}, "Your calls, the model's funds. "),
      `Companies are held at the weight their outlook earns them (Fact find tab); funds fill the rest. ` +
      `The all-funds mix compounds faster in the model (${fmtPct1(allFunds.growth)} against ${fmtPct1(alt.growth)}) ` +
      `only because the model cannot see an edge in any single company — keep the companies if you trust the calls.`));
  }
  const tiltInfo = v.scenarioTilt;
  if (tiltInfo && tiltInfo.applied) {
    const moved = Object.entries(tiltInfo.tickers).filter(([t]) => (alt.target || {})[t] !== undefined);
    why.append(el("li", { style: "margin-bottom:6px" }, el("strong", {}, "The odds moved, so the mix moved. "),
      tiltInfo.what +
      (moved.length ? " In this mix: " + moved.map(([t, v2]) => `${t} ${signed(v2)}%`).join(", ") + "." : "")));
  }
  const budget = (DATA.factFind || {}).riskBudget;
  if (budget && budget.preferCalm) {
    why.append(el("li", { style: "margin-bottom:6px" }, el("strong", {}, "A goal with a date changed the mix. "),
      budget.why));
  }
  why.append(el("li", { style: "margin-bottom:6px" }, el("strong", {}, "Cut losers, let winners run. "),
    "Sells are queued exits first — the lines whose call is Sell, largest first, whether or not they are below trend — " +
    "then trims of what is still working, weakest first. No company goes above its conviction cap."));
  body.append(el("h4", { style: "margin:18px 0 6px" }, "Why"), why);

  const unreconciled = (DATA.corrections || []).length;
  if (unreconciled) {
    body.append(el("div", { class: "warnbox", style: "margin-top:14px" },
      `${unreconciled} position(s) do not reconcile with the broker statements — check them in the working below before placing anything.`));
  }
  panel.append(body);
  box.append(ordersPanel);
  panel.append(el("p", { class: "note" },
    `Model output, not a recommendation. Expected returns are CAPM over ${ok(DATA.historyYears) ? DATA.historyYears.toFixed(1) : "–"} ` +
    `years of prices: it sees risk, correlation and cost, but not a stock-picking edge or valuation beyond the AI cap. ` +
    `The mortgage deposit is outside all of this.`));
  box.append(panel);
}

function renderFundsAdd(rows, mine, value) {
  const box = document.getElementById("fundsAddBox");
  if (!box) return;
  box.innerHTML = "";
  const v = view();
  const target = v.target || {};
  if (!mine || !rows) return;
  const hedges = Object.fromEntries((v.hedges || []).map(h => [h.ticker, h]));
  const stress = Object.fromEntries((v.stressCorrelation || []).map(h => [h.ticker, h]));
  const bench = statsFor([DATA.benchmarkTicker], [1], value, new Set(mine.index));
  const themeOf = t => ((DATA.research || {}).tickerTheme || {})[t];
  const limit = ((v.optimisation || {}).themeCap || {}).limit || 25;
  const aiFull = (((v.research || {}).aiTradeTarget || {}).pct || 0) >= limit - 0.5;
  const indexOf = t => (DATA.funds.find(f => f.ticker === t) || {}).benchmark || (DATA.heldFundIndex || {})[t];
  const plannedIndex = Object.fromEntries(Object.keys(target).filter(t => indexOf(t)).map(t => [indexOf(t), t]));

  const aiRoom = Math.max(0, limit - (((v.research || {}).aiTradeTarget || {}).pct || 0));
  const planTheme = {};
  for (const t of Object.keys(target)) if (themeOf(t) && indexOf(t)) planTheme[themeOf(t)] = planTheme[themeOf(t)] || t;

  const candidates = rows.filter(r => r.kind === "fund").map(r => {
    const f = DATA.funds.find(x => x.id === r.id) || {};
    return { t: f.ticker, f, r, h: hedges[f.ticker] || {}, theme: themeOf(f.ticker) };
  }).sort((a, b) => (b.h.growthGain || 0) - (a.h.growthGain || 0));
  const offered = {};
  const funds = candidates.map(x => {
    const { t, f, h, theme } = x;
    const best = h.optimalWeightPct || 10;
    let status, cls, order;
    if ((target[t] || 0) > 0) {
      status = `In the plan · ${fmtPct1(target[t])}`; cls = "pos"; order = 0;
    } else if (plannedIndex[f.benchmark] && plannedIndex[f.benchmark] !== t) {
      status = `Same index as ${plannedIndex[f.benchmark]}, already in the plan`; cls = "muted"; order = 3;
    } else if (theme === "ai" || theme === "em") {
      if (aiRoom < 2) {
        status = `Not added: the ${limit.toFixed(0)}% AI budget is used`; cls = "muted"; order = 2;
      } else if (offered.__ai) {
        status = `Not added: what is left of the AI budget is offered to ${offered.__ai}`; cls = "muted"; order = 2;
      } else {
        offered.__ai = t;
        const size = Math.min(best, aiRoom);
        status = `Could add · up to ${size.toFixed(0)}% (${fmtEur(value * size / 100)}) — all that is left of the AI budget`;
        cls = "pos"; order = 1;
      }
    } else if (planTheme[theme] && ["global", "us_broad", "europe", "bonds"].includes(theme)) {
      status = `Similar to ${planTheme[theme]}, already in the plan`; cls = "muted"; order = 3;
    } else if (ok(h.growthGain) && h.growthGain > 0.2) {
      const key = theme || f.benchmark;
      if (offered[key]) {
        status = `Similar to ${offered[key]}`; cls = "muted"; order = 3;
      } else {
        offered[key] = t;
        const size = Math.min(best, 20);

        status = `Could add · up to ${size.toFixed(0)}% (${fmtEur(value * size / 100)})`;
        cls = "pos"; order = 1;
      }
    } else {
      status = "Adds little to this book"; cls = "muted"; order = 3;
    }
    return { ...x, status, cls, order,
             excess: ok(x.r.cagr) && bench ? x.r.cagr - bench.cagr : null,
             worst: (stress[t] || {}).stressCorrelation };
  });

  for (const t of Object.keys(target)) {
    if (!indexOf(t) || funds.some(x => x.t === t) || !columnFor(t)) continue;
    const r = statsFor([t], [1], value, new Set(mine.index));
    if (!r) continue;
    r.name = (DATA.heldFundNames || {})[t] || t;
    funds.push({ t, f: { name: r.name }, r, h: hedges[t] || {}, theme: themeOf(t),
                 status: `In the plan · ${fmtPct1(target[t])}`, cls: "pos", order: 0,
                 excess: bench ? r.cagr - bench.cagr : null, worst: (stress[t] || {}).stressCorrelation });
  }
  funds.sort((a, b) => a.order - b.order
    || (a.order === 0 ? (target[b.t] || 0) - (target[a.t] || 0)
        : a.order === 1 ? (b.h.growthGain || 0) - (a.h.growthGain || 0)
        : (b.r.cagr || 0) - (a.r.cagr || 0)));

  const shown = [...funds.filter(x => x.order === 0), ...funds.filter(x => x.order === 1).slice(0, 6)];
  const hotter = funds.filter(x => x.order >= 2 && ok(x.excess) && x.excess > 2).slice(0, 6);
  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "Funds — the ones in the plan, and more you could add"));
  const body = el("div", { class: "body" });
  body.append(el("p", { class: "hint" },
    `Every fund measured over the same ${(mine.days / TRADING_DAYS).toFixed(1)} years against ${DATA.benchmarkTicker}, ` +
    "the S&P 500 line used as the benchmark, and against this book. Ranked by what each does to compounding here, not by its past " +
    "return, because last period's top funds rarely stay on top."));
  const pct = v => ok(v) ? { text: signedPct(v, 1), cls: v >= 0 ? "pos" : "neg" } : "–";
  body.append(table(["Fund", "Status", "Return p.a.", "vs S&P 500", "Volatility", "Worst-day corr.", "Growth gain"],
    shown.map(x => ({ cells: [
      { node: el("span", {}, el("strong", {}, x.t), el("br"), el("span", { class: "muted" }, x.f.name || x.r.name)) },
      { text: x.status, cls: x.cls },
      fmtPct1(x.r.cagr), pct(x.excess), fmtPct1(x.r.vol),
      ok(x.worst) ? { text: fmtNum(x.worst), cls: x.worst < 0.3 ? "pos" : x.worst > 0.6 ? "neg" : "" } : "–",
      ok(x.h.growthGain) ? { text: signed(x.h.growthGain) + "pp", cls: x.h.growthGain > 0 ? "pos" : "neg" } : "–",
    ] })), { numFrom: 2 }));
  if (hotter.length) {
    body.append(el("p", { class: "note", style: "padding-top:10px" },
      el("strong", {}, "Performed better, not added: "),
      hotter.map(x => `${x.t} (${signedPct(x.excess, 1)} a year vs the S&P 500) — ${x.status.replace(/^Not added: /, "")}`)
        .join("; ") + "."));
  }
  body.append(el("p", { class: "note muted", style: "padding-top:6px" },
    "Worst-day corr. is the fund's correlation with this book on its worst tenth of days — lower means it actually " +
    "cushions a fall. Growth gain is the change in expected compound growth at the fund's own best size. Past returns " +
    "are what a holder received, net of the fund's charges. Not investment advice."));
  panel.append(body);
  box.append(panel);
}

let CONVICTION_EDIT = {};

function convictionTarget(levels) {
  const v = view();
  const verdicts = v.verdicts || {}, caps = DATA.convictionCaps || { high: 0.15, medium: 0.10, low: 0.05 };
  const current = ((v.optimisation || {}).theories || {}).current?.weights || {};
  const limit = ((v.optimisation || {}).themeCap || {}).limit || 25;
  const themeOf = t => ((DATA.research || {}).tickerTheme || {})[t];
  const companies = Object.keys(v.convictions || {}).filter(t => verdicts[t] && verdicts[t].outlook);
  const want = {};
  for (const t of companies) {
    const cap = (caps[levels[t]] || caps.medium) * 100, outlook = verdicts[t].outlook, w = current[t] || 0;
    want[t] = outlook === "Buy" ? cap : outlook === "Sell" ? 0 : Math.min(w, cap);
  }

  let budget = ok(v.aiCompanyBudget) ? v.aiCompanyBudget : limit;
  for (const t of companies.filter(t => themeOf(t) === "ai" && want[t] > 0)
                           .sort((a, b) => (verdicts[b].score || 0) - (verdicts[a].score || 0) || a.localeCompare(b))) {
    const give = Math.max(0, Math.min(want[t], budget));
    budget -= give; want[t] = give;
  }
  const companyTotal = Object.values(want).reduce((a, b) => a + b, 0);
  const aiCompanies = companies.filter(t => themeOf(t) === "ai").reduce((a, t) => a + want[t], 0);

  const funds = Object.entries(v.target || {}).filter(([t]) => !(t in want));
  let aiFunds = funds.filter(([t]) => ["ai", "em"].includes(themeOf(t)));
  let other = funds.filter(([t]) => !["ai", "em"].includes(themeOf(t)));

  const residual = Math.max(0, 100 - Object.values(v.target || {}).reduce((a, b) => a + b, 0));
  const room = Math.max(0, 100 - companyTotal - residual);
  const sumOf = list => list.reduce((a, [, w]) => a + w, 0);
  const fundTotal = sumOf(funds) || 1;
  const out = { ...want };
  let aiRoom = Math.min(room * sumOf(aiFunds) / fundTotal, Math.max(0, limit - aiCompanies));
  for (const [t, w] of aiFunds) out[t] = sumOf(aiFunds) ? aiRoom * w / sumOf(aiFunds) : 0;
  for (const [t, w] of other) out[t] = sumOf(other) ? (room - aiRoom) * w / sumOf(other) : 0;
  return { weights: out, companyTotal, ai: aiCompanies + aiRoom, companies };
}

function renderConviction(value) {
  const box = document.getElementById("convictionBox");
  if (!box) return;
  box.innerHTML = "";
  const v = view();
  const saved = Object.fromEntries(Object.entries(v.convictions || {}).map(([t, c]) => [t, c.level]));
  const edit = CONVICTION_EDIT[BOOK] || (CONVICTION_EDIT[BOOK] = { ...saved });
  const before = convictionTarget(saved), after = convictionTarget(edit);
  if (!after.companies.length) return;
  const verdicts = v.verdicts || {};
  const caps = DATA.convictionCaps || { high: 0.15, medium: 0.10, low: 0.05 };
  const current = ((v.optimisation || {}).theories || {}).current?.weights || {};
  const statsOf = weights => {
    const pairs = Object.entries(weights).filter(([t, w]) => w > 0.05 && columnFor(t));
    const total = pairs.reduce((a, [, w]) => a + w, 0);
    return total ? statsFor(pairs.map(([t]) => t), pairs.map(([, w]) => w / total), value) : null;
  };
  const sb = statsOf(before.weights), sa = statsOf(after.weights);
  const changed = after.companies.filter(t => edit[t] !== saved[t]);

  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "Conviction — how sure you are sets how big each company can be"));
  const body = el("div", { class: "body" });
  body.append(el("p", { class: "hint" },
    "High conviction lets a company reach 15% of the book, medium 10%, low 5%. Conviction sizes a good call; it " +
    "never rescues a bad one — a Sell stays at zero whatever you set. Change one and the book below re-sizes at once."));

  const kpi = (k, a, b, lowerIsBetter, fmt = fmtPct1) => el("div", {}, el("div", { class: "k" }, k),
    el("div", { class: "v" }, fmt(a), el("span", { class: "muted", style: "font-weight:400" }, " → "),
      el("span", { class: !ok(a) || !ok(b) || Math.abs(a - b) < 0.05 ? "" : (lowerIsBetter ? b < a : b > a) ? "pos" : "neg" }, fmt(b))));
  body.append(el("div", { class: "verdict-kpis" },
    kpi("Companies in the book", before.companyTotal, after.companyTotal),
    kpi("AI trade", before.ai, after.ai, true),
    kpi("Volatility (history)", sb && sb.vol, sa && sa.vol, true),
    kpi("Worst drawdown (history)", sb && sb.maxDrawdown, sa && sa.maxDrawdown)));

  body.append(table(["Company", "Outlook", "Conviction", "Cap", "Target", "vs saved", "Now"],
    after.companies.sort((a, b) => (after.weights[b] || 0) - (after.weights[a] || 0) || (current[b] || 0) - (current[a] || 0))
      .map(t => {
        const select = el("select", { class: "conv-select", "aria-label": `Conviction for ${t}` },
          ["low", "medium", "high"].map(l => {
            const o = el("option", { value: l }, l);
            if (edit[t] === l) o.selected = true;
            return o;
          }));
        select.addEventListener("change", () => { edit[t] = select.value; renderConviction(value); });
        const delta = (after.weights[t] || 0) - (before.weights[t] || 0);
        const outlook = verdicts[t].outlook;
        return { cells: [
          { node: el("span", {}, el("strong", {}, t), " ", el("span", { class: "muted" },
              ((DATA.companyWatch || {})[t] || {}).name || "")) },
          { text: outlook, cls: outlook === "Buy" ? "pos" : outlook === "Sell" ? "neg" : "muted" },
          { node: select },
          `${((caps[edit[t]] || caps.medium) * 100).toFixed(0)}%`,
          el("strong", {}, fmtPct1(after.weights[t] || 0)),
          Math.abs(delta) < 0.05 ? { text: "–", cls: "muted" }
            : { text: `${signed(delta)}pp (${signedEur(delta / 100 * value)})`, cls: delta > 0 ? "pos" : "neg" },
          { text: fmtPct1(current[t] || 0), cls: "muted" },
        ] };
      }), { numFrom: 3, stack: true }));

  const note = el("p", { class: "note muted", style: "padding-top:8px" },
    "Volatility and drawdown are the target mix run over the book's own price history — how it would have moved, " +
    "not a forecast. Funds shrink or grow to make room, AI funds first held to what is left of the 25% AI budget.");
  body.append(note);
  if (changed.length) {
    const save = el("button", { class: "btn" }, `Save ${changed.length} change${changed.length === 1 ? "" : "s"} and rebuild the plan`);
    const reset = el("button", { class: "btn ghost", style: "margin-left:8px" }, "Undo");
    const status = el("span", { class: "muted", style: "margin-left:12px;font-size:13px" });
    reset.addEventListener("click", () => { CONVICTION_EDIT[BOOK] = { ...saved }; renderConviction(value); });
    save.addEventListener("click", async () => {
      if (!API) { status.textContent = "Saving needs the live site's API — this copy is read-only."; return; }
      save.disabled = true; status.textContent = "Saving…";
      try {
        for (const t of changed) {
          const r = await fetch("/api/conviction", { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker: t, level: edit[t] }) });
          if (!r.ok) throw new Error((await r.json()).error || r.status);
        }
        status.textContent = "Saved. The plan is rebuilding — refresh in about a minute to see the new orders.";
      } catch (e) {
        status.textContent = `Not saved: ${e.message}`; save.disabled = false;
      }
    });
    body.append(el("div", { style: "margin-top:12px" }, save, reset, status));
  }
  panel.append(body);
  box.append(panel);
}

const ACCOUNTS = () => (DATA.accounts && DATA.accounts.tickers) || {};

function accountsTag(ticker) {
  const a = ACCOUNTS()[ticker];
  if (!a) return null;
  const tags = [];
  for (const s of a.signals || []) {
    if (s.votes > 0) tags.push(el("span", { class: "tag pos" }, s.kind));
    else if (s.votes < 0) tags.push(el("span", { class: "tag neg" }, s.kind));
  }
  if ((a.severeEvents || []).length) tags.push(el("span", { class: "tag neg" }, "8-K flag"));
  return tags.length ? el("span", {}, ...tags) : null;
}

function renderAccounts() {
  const box = document.getElementById("accountsBox");
  if (!box) return;
  box.innerHTML = "";
  const block = DATA.accounts;
  if (!block) return;
  const held = new Set(holdings.map(h => h.ticker));
  const rows = Object.values(block.tickers || {}).filter(a => held.has(a.ticker));
  if (!rows.length) return;
  const board = block.scoreboard || {};
  const h = (board.horizons || {}).half || {};
  const money = v => ok(v) ? (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}bn` : `$${(v / 1e6).toFixed(0)}m`) : "–";

  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "The accounts — what the company does with its own shares and cash"));
  const body = el("div", { class: "body" });
  body.append(el("div", { class: h.count ? (h.meanPct > 0 ? "goodbox" : "warnbox") : "note" },
    h.count
      ? `${h.count} signal(s) marked at six months: ${signed(h.meanPct)}% in the direction called, ` +
        `${fmtPct1(h.helpedPct)} right.`
      : `${board.banked || 0} signal(s) banked from the latest accounts, none old enough to mark. ` +
        `The first verdicts land ${h.sessions || 126} sessions on.`));
  body.append(table(
    ["Ticker", "FY end", "Share count, 1y", "Buybacks", "Profit", "Cash from ops", "Cash conversion", "8-K", "Read"],
    rows.sort((a, b) => (b.score - a.score) || a.ticker.localeCompare(b.ticker)).map(a => {
      const n = a.numbers || {};
      const issuance = a.signals.find(s => ["buyback", "dilution", "issuance"].includes(s.kind));
      const accr = a.signals.find(s => s.kind === "accruals");
      const severe = (a.severeEvents || []);
      return { cells: [
        { node: tickerLink(a.ticker) },
        a.fiscalYearEnd || "–",
        { text: ok(n.netIssuancePct) ? signed(n.netIssuancePct) + "%" : "–",
          cls: !issuance ? "muted" : issuance.votes > 0 ? "pos" : issuance.votes < 0 ? "neg" : "" },
        money(n.buybacks),
        { text: money(n.netIncome), cls: ok(n.netIncome) && n.netIncome < 0 ? "neg" : "" },
        money(n.operatingCashFlow),
        { text: ok(n.cashConversion) ? `${Math.round(n.cashConversion * 100)}%` : "–",
          cls: accr && accr.votes < 0 ? "neg" : "" },
        { text: severe.length ? severe.map(e => e.item).join(", ")
              : (a.events || []).length ? `${a.events.length} routine` : "–",
          cls: severe.length ? "neg" : "muted" },
        { node: el("span", { class: "muted", style: "font-size:13px" },
            [...a.signals.filter(s => s.votes !== 0).map(s => s.text),
             ...severe.map(e => `8-K ${e.item} ${e.date}: ${e.label}`)].join(" · ") || "Nothing to flag") },
      ] };
    }), { numFrom: 2 }));
  body.append(el("p", { class: "note muted", style: "padding-top:8px" },
    (block.caveat || "") + ` Source: ${block.source || "SEC"}.` +
    (block.unknown && block.unknown.length ? ` Not on EDGAR: ${block.unknown.join(", ")}.` : "")));
  panel.append(body);
  box.append(panel);
}

const INSIDER = () => (DATA.insiders && DATA.insiders.tickers) || {};

function insiderTag(ticker) {
  const s = INSIDER()[ticker];
  if (!s || s.signal === "quiet") return null;
  const cls = s.signal === "cluster buy" ? "pos" : s.signal === "buying" ? "pos" : "muted";
  return el("span", { class: "tag " + cls }, "insiders " + s.signal);
}

function insiderLine(ticker) {
  const s = INSIDER()[ticker];
  if (!s || s.signal === "quiet") return null;
  const latest = (s.recent || [])[0];
  return el("div", { class: "muted", style: "font-size:13px;margin-top:4px" },
    s.why + (latest
      ? ` Latest: ${latest.role || latest.owner || "insider"} ${latest.side === "buy" ? "bought" : "sold"} ` +
        `${Math.round(latest.shares).toLocaleString("en-IE")} at $${latest.price} on ${latest.date}` +
        (latest.planned ? " (scheduled plan)" : "") + "."
      : ""));
}

function renderInsiders() {
  const box = document.getElementById("insidersBox");
  if (!box) return;
  box.innerHTML = "";
  const block = DATA.insiders;
  if (!block) return;
  const held = new Set(holdings.map(h => h.ticker));
  const rows = Object.values(block.tickers || {}).filter(s => held.has(s.ticker));
  if (!rows.length) return;
  const board = block.scoreboard || {};
  const q = (board.horizons || {}).quarter || {};

  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "Insiders — who is buying with their own money"));
  const body = el("div", { class: "body" });
  body.append(el("div", { class: q.count ? (q.meanExcessPct > 0 ? "goodbox" : "warnbox") : "note" },
    q.count
      ? `${q.count} buy signal(s) marked at three months: ${signed(q.meanExcessPct)}% against the ` +
        `benchmark on average, ${fmtPct1(q.helpedPct)} of them ahead.`
      : `${board.banked || 0} buy signal(s) banked, none old enough to mark. The first verdicts ` +
        `land ${q.sessions || 63} sessions after the buy.`));
  body.append(table(["Ticker", "Signal", "Buyers", "Bought", "Sold (open market)", "Scheduled sales", "Last buy"],
    rows.sort((a, b) => (b.votes - a.votes) || (b.buyValue - a.buyValue)).map(s => ({
      cls: s.votes ? "" : "muted",
      cells: [
        { node: tickerLink(s.ticker) },
        { text: s.signal, cls: s.votes ? "pos" : "muted" },
        s.buyers,
        s.buyValue ? "$" + Math.round(s.buyValue).toLocaleString("en-IE") : "–",
        (s.sellValue - s.plannedSellValue) ? "$" + Math.round(s.sellValue - s.plannedSellValue).toLocaleString("en-IE") : "–",
        s.plannedSellValue ? "$" + Math.round(s.plannedSellValue).toLocaleString("en-IE") : "–",
        s.lastBuy || "–",
      ],
    })), { numFrom: 2 }));
  body.append(el("p", { class: "note muted", style: "padding-top:8px" },
    (block.caveat || "") + ` Source: ${block.source || "SEC EDGAR"}, last ${block.windowDays || 180} days` +
    (block.unknown && block.unknown.length ? `; not on EDGAR: ${block.unknown.join(", ")}` : "") + "."));
  panel.append(body);
  box.append(panel);
}

function renderWatch() {
  const box = document.getElementById("watchBox");
  if (!box) return;
  box.innerHTML = "";
  const watch = DATA.companyWatch || {};
  const v = view();
  const weights = ((v.optimisation || {}).theories || {}).current?.weights || {};
  const convictions = v.convictions || {};
  const held = Object.keys(weights).filter(t => watch[t]).sort((a, b) => weights[b] - weights[a]);
  if (!held.length) return;
  const pct = x => ok(x) ? (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(0) + "%" : "–";
  const tone = x => !ok(x) ? "muted" : x >= 0 ? "pos" : "neg";

  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "Company watch — both sides of every holding"));
  const body = el("div", { class: "body" });
  body.append(el("p", { class: "hint" },
    "Analyst price targets as distance from today's price: the lowest is the bear case, the average the base case, " +
    "the highest the bull case. Red flags come first — what a short seller would look for — then the case for."));
  const grid = el("div", { class: "watch" });
  for (const t of held) {
    const w = watch[t], c = convictions[t] || {};
    const over = c.capPct && weights[t] > c.capPct + 0.05;
    const trendCls = w.trend === "winner" ? "pos" : w.trend === "loser" ? "neg" : "muted";
    const num = (label, node) => el("span", {}, el("span", { class: "muted" }, label + " "), node);
    grid.append(el("div", { class: "watch-card" },
      el("div", { class: "hd" },
        el("span", {}, el("strong", {}, tickerLink(t)), " ", el("span", { class: "muted" }, w.name || "")),
        el("span", { class: over ? "neg" : "muted" },
          `${fmtPct1(weights[t])}${c.capPct ? " of " + c.capPct.toFixed(0) + "% cap" : ""}`)),
      el("div", { style: "margin-top:4px" },
        (v.verdicts || {})[t] ? el("span", { class: "tag " + CALL_CLASS[v.verdicts[t].call] },
          v.verdicts[t].call.toLowerCase()) : null,
        el("span", { class: "tag " + trendCls }, w.trend),
        w.turnaround ? el("span", { class: "tag pos" }, "turnaround") : null,
        w.yieldTrap ? el("span", { class: "tag neg" }, "yield trap") : null,
        over ? el("span", { class: "tag neg" }, "over its cap") : null,
        insiderTag(t),
        accountsTag(t)),
      insiderLine(t),
      el("div", { class: "nums" },
        num("Bear", el("span", { class: tone(w.bear.pct) }, pct(w.bear.pct))),
        num("Base", el("span", { class: tone(w.base.pct) }, pct(w.base.pct))),
        num("Bull", el("span", { class: tone(w.bull.pct) }, pct(w.bull.pct))),
        num("Analysts", w.analysts ? `${w.analysts}${w.consensus && w.consensus !== "none" ? " · " + w.consensus : ""}` : "–"),
        num("Earnings", [ok(w.forwardPE) ? `${w.forwardPE.toFixed(0)}x fwd` : null,
                         ok(w.earningsGrowth) ? `EPS ${signedPct(w.earningsGrowth, 0)}` : null].filter(Boolean).join(" · ") || "–")),
      el("div", { class: "sides" },
        el("div", {}, el("div", { class: "lbl" }, "What could break it"),
          w.red.length ? el("ul", { class: "flags neg" }, w.red.map(r => el("li", {}, r)))
                       : el("span", { class: "muted", style: "font-size:13px" }, "No red flags found")),
        el("div", {}, el("div", { class: "lbl" }, "The case for it"),
          w.green.length ? el("ul", { class: "flags pos" }, w.green.map(r => el("li", {}, r)))
                         : el("span", { class: "muted", style: "font-size:13px" }, "Nothing in the numbers")))));
  }
  body.append(grid);
  body.append(el("p", { class: "note muted", style: "padding-top:8px" },
    "Analyst data is not part of the demo. A target is an opinion with a 12-month horizon, not a forecast you can bank; " +
    "the spread between bear and bull is the useful part. Caps follow conviction: 15% only when highly confident, 10% medium, 5% low " +
    "(set in data/convictions.json)."));
  panel.append(body);
  box.append(panel);
}

function renderRules() {
  const box = document.getElementById("rulesBox");
  if (!box) return;
  box.innerHTML = "";
  const checks = view().houseRules || [];
  const lessons = Object.fromEntries((DATA.lessons || []).map(l => [l.id, l]));
  if (!checks.length) return;
  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "House rules — lessons applied to this book"));
  const list = el("ul", { style: "list-style:none;margin:0;padding:0" });
  for (const c of checks) {
    const l = lessons[c.id] || {};
    list.append(el("li", { style: "padding:10px 0;border-bottom:1px solid var(--line-soft)" },
      el("div", {}, el("strong", { class: c.ok ? "pos" : "neg" }, c.ok ? "✓ " : "✗ "),
        el("strong", {}, l.title || c.id), el("span", { class: "muted" }, " — " + (l.rule || ""))),
      l.quote ? el("div", { class: "muted", style: "font-style:italic;font-size:13px;margin:3px 0 0 18px" },
        `“${l.quote}” — from your reading notes`) : null,
      el("div", { style: "font-size:13px;margin:4px 0 0 18px" }, c.detail)));
  }
  panel.append(el("div", { class: "body" }, list));
  box.append(panel);
}

function renderAdvice(mine, value) {
  const box = document.getElementById("adviceBox");
  box.innerHTML = "";
  const bookAdvice = view().advice;

  if (bookAdvice.notes.length) {
    const notes = el("div", { class: "panel wide", style: "margin-bottom:20px" },
      el("h3", {}, "What stands out about the shape of this book"));
    const body = el("div", { class: "body" });
    const list = el("ul", { style: "margin-left:18px" });
    for (const note of bookAdvice.notes) list.append(el("li", { style: "margin-bottom:8px" }, note));
    body.append(list);
    notes.append(body);
    box.append(notes);
  }

  const outside = renderResearch();
  if (outside) box.append(outside);

  const sells = bookAdvice.sell;
  const sellPanel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "Positions the numbers argue with"));
  const sellBody = el("div", { class: "body" });
  if (!sells.length) {
    sellBody.append(el("p", { class: "muted" },
      "Nothing flagged: no position costs materially more risk than its weight, nothing duplicates anything else above 0.85, and nothing is past the single-name cap."));
  } else {
    for (const row of sells) {
      const item = el("div", { style: "padding:12px 0;border-bottom:1px solid #EFEDE9" },
        el("div", {}, el("strong", {}, tickerLink(row.ticker)),
          el("span", { class: "muted" }, ` · ${row.name} · ${fmtEur(row.value)}`)));
      const reasons = el("ul", { style: "margin:8px 0 0 18px;font-size:13px" });
      for (const r of row.reasons) {
        reasons.append(el("li", { style: "margin-bottom:4px" },
          el("strong", {}, r.reason + ". "), r.detail));
      }
      item.append(reasons);
      sellBody.append(item);
    }
    sellBody.append(el("p", { class: "note muted", style: "padding-top:12px" },
      `These are mechanical consequences of the numbers, not reasons to sell. A position can cost more risk than its weight because it is the one thing actually working. You get ${bookAdvice.budgets.monthlyFreeSells} free sells a month.`));
  }
  sellPanel.append(sellBody);
  box.append(sellPanel);

  const buys = DATA.buyCandidates;
  const buyPanel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, `What would change the shape, bought at ${DATA.additions.allocation * 100}%`));
  const buyBody = el("div", { class: "body" });
  if (!buys.length) {
    buyBody.append(el("p", { class: "muted" }, "No fund in the universe would materially change this book."));
  } else {
    buyBody.append(table(["Fund", "Asset class", "Δ vol", "Δ beta", "Corr.", "Why"],
      buys.map(b => ({
        cells: [b.name, { text: b.asset, cls: "muted" },
          { text: signed(b.volChange) + "pp", cls: b.volChange < 0 ? "pos" : "neg" },
          signed(b.betaChange), fmtNum(b.correlation),
          b.themeWarning
            ? { node: el("span", {}, el("strong", { class: "neg" }, b.themeWarning + " "),
                el("span", { class: "muted" }, b.reasons.join("; "))) }
            : { text: b.reasons.join("; "), cls: "muted" }],
      })), { numFrom: 2 }));
    buyBody.append(el("p", { class: "note muted", style: "padding-top:12px" },
      `Cash budget is ${fmtEur(bookAdvice.budgets.monthlyBuyCashEur)} a month, and the single-name cap is ${bookAdvice.budgets.maxNameWeightPct}%.`));
  }
  buyPanel.append(buyBody);
  box.append(buyPanel);

  box.append(sizer(value));
}

function renderResearch() {
  const shared = DATA.research;
  const mine = view().research;
  if (!shared || !mine) return null;
  const panel = el("div", { class: "panel wide", style: "margin-bottom:20px" },
    el("h3", {}, "Theme notes — illustrative, written for the demo"));
  const body = el("div", { class: "body" });
  body.append(el("p", { class: "hint" },
    "The optimiser runs on CAPM, so it cannot see valuation, crowding or whether the driver " +
    "behind a fund's run is still there. This panel is that missing half, written down with " +
    "dates and sources. It is research, not a recommendation."));

  const ai = mine.aiTrade;
  if (ai && ai.pct > 0) {
    const theme = shared.themes.ai;
    const lines = el("ul", { style: "margin:6px 0 0 18px;font-size:13px" });
    for (const g of ai.groups) {
      lines.append(el("li", { style: "margin-bottom:4px" },
        el("strong", {}, `${fmtPct1(g.pct)} `), `${g.label}: `,
        el("span", { class: "muted" }, Object.keys(g.tickers).join(", "))));
    }
    body.append(el("div", { style: "margin:14px 0" },
      el("div", {}, el("strong", { class: ai.pct >= 25 ? "neg" : "" },
        `${fmtPct1(ai.pct)} of this book rides AI capital spending`)),
      lines,
      el("p", { class: "note muted", style: "margin-top:8px" }, theme.view)));
  }

  const named = t => (DATA.funds.find(f => f.ticker === t) || {}).name || t;
  body.append(el("h4", { style: "margin:18px 0 6px" }, "Passive shortlist, one line per job"));
  body.append(table(
    ["Fund", "Job", "For", "Against", "TER", "Growth gain", "Corr.", "Worst 10%"],
    mine.shortlist.map(r => ({
      cells: [
        { node: el("span", {}, el("strong", {}, r.ticker), el("br"),
            el("span", { class: "muted" }, r.name), r.held ? el("span", { class: "pos" }, " · held") : null) },
        r.job,
        { text: r.for, cls: "muted" },
        { text: r.against, cls: "muted" },
        ok(r.ter) ? (r.ter * 100).toFixed(2) + "%" : "–",
        ok(r.growthGain) ? { text: signed(r.growthGain) + "pp", cls: r.growthGain > 0 ? "pos" : "neg" } : "–",
        fmtNum(r.correlation),
        ok(r.stressCorrelation) ? { text: fmtNum(r.stressCorrelation), cls: r.stressCorrelation < 0 ? "pos" : "" } : "–",
      ],
    })), { numFrom: 4 }));
  body.append(el("p", { class: "note muted", style: "padding-top:8px" },
    "Growth gain is the change in expected compound growth at the fund's own best size (see Hedges). " +
    "Corr. is against this book on ordinary days; Worst 10% is on the book's worst tenth of days."));

  const out = el("ul", { style: "margin:6px 0 0 18px;font-size:13px" });
  for (const r of shared.ruledOut) {
    out.append(el("li", { style: "margin-bottom:4px" },
      el("strong", {}, r.tickers.map(named).join(", ") + ". "), r.why));
  }
  body.append(el("h4", { style: "margin:18px 0 6px" }, "What would repeat what the book already holds"), out);

  const themes = el("div", { style: "margin-top:18px" }, el("h4", { style: "margin-bottom:6px" }, "What the coverage says, by theme"));
  for (const [id, t] of Object.entries(shared.themes)) {
    if (id === "ai") continue;
    themes.append(el("details", { style: "margin-bottom:6px" },
      el("summary", { style: "cursor:pointer;font-weight:600" }, t.title),
      el("p", { style: "margin:6px 0 2px;font-size:13px" }, t.view),
      el("p", { class: "note muted" }, "Sources: " + t.sources.join("; "))));
  }
  body.append(themes);

  const review = shared.review;
  if (review) body.append(el("h4", { style: "margin:18px 0 6px" },
    `${review.title} — data to ${review.dataTo}, EUR, published basis`));
  const pctOrDash = v => ok(v) ? fmtPct1(v) : "–";
  if (review) body.append(table(["Fund", "As at", "1Y", "5Y p.a.", "10Y p.a."],
    review.figures.map(f => ({ cells: [f.fund, { text: f.asOf, cls: "muted" },
      pctOrDash(f.y1), pctOrDash(f.y5), pctOrDash(f.y10)] })), { numFrom: 2 }));
  const takeaways = el("ul", { style: "margin:10px 0 0 18px;font-size:13px" });
  for (const t of (review ? review.takeaways : [])) takeaways.append(el("li", { style: "margin-bottom:6px" }, t));
  body.append(takeaways);

  panel.append(body);
  panel.append(el("div", { class: "warnbox" }, shared.attribution +
    " Synthetic data; not investment advice."));
  return panel;
}

function sizer(value) {
  const panel = el("div", { class: "panel wide" }, el("h3", {}, "Size a position"));
  const body = el("div", { class: "body" });
  const budgets = view().advice.budgets;

  const side = el("select", { "aria-label": "Buy or sell" }, el("option", { value: "buy" }, "Buy"), el("option", { value: "sell" }, "Sell"));
  const tickers = [...new Set([...holdings.map(h => h.ticker), ...DATA.funds.map(f => f.ticker)])].sort();
  const ticker = el("select", { "aria-label": "Ticker" }, tickers.map(t => el("option", { value: t }, t)));
  const conviction = el("input", { type: "range", min: "1", max: "10", step: "1", value: "6", "aria-label": "Conviction, 1 to 10" });
  const convictionLabel = el("strong", {}, "6");
  const speculative = el("input", { type: "checkbox", "aria-label": "Speculative" });
  const price = el("input", { type: "number", step: "any", placeholder: "price", "aria-label": "Price", style: "width:110px" });
  const out = el("div", { style: "margin-top:14px" });

  function recompute() {
    convictionLabel.textContent = conviction.value;
    const held = holdings.find(h => h.ticker === ticker.value);
    const weight = held ? held.value / value : 0;
    const px = parseFloat(price.value) || 0;
    const body_ = {
      side: side.value, conviction: parseFloat(conviction.value), price: px,
      currentWeight: weight, positionValue: held ? held.value : 0,
      positionShares: null, speculative: speculative.checked,
    };
    const r = sizeLocally(body_, budgets);
    out.innerHTML = "";
    const rows = side.value === "buy"
      ? [["Suggested", fmtEur(r.euros)], ["Shares at that price", r.shares ?? "–"],
         ["Current weight", fmtPct(r.currentWeightPct)],
         ["Headroom to the cap", fmtNum(r.headroomFactor)],
         ["Monthly cash budget", fmtEur(r.cashBudget)]]
      : [["Suggested", fmtEur(r.euros)], ["Fraction of the position", fmtPct(r.trimFraction * 100)],
         ["Position value", fmtEur(r.positionValue)],
         ["Free sells a month", String(r.freeSellsPerMonth)]];
    out.append(table(["", ""], rows.map(c => ({ cells: c })), { numFrom: 1 }));
    out.append(el("p", { class: "note muted", style: "padding-top:10px" },
      (r.flag ? r.flag + " " : "") + (r.note || "")));
  }

  [side, ticker, price, speculative].forEach(c => c.addEventListener("change", recompute));
  conviction.addEventListener("input", recompute);

  body.append(el("div", { class: "controls" },
    side, ticker,
    el("span", { class: "muted" }, "conviction"), conviction, convictionLabel,
    el("span", { class: "muted" }, "price"), price,
    el("label", { style: "display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0" },
      speculative, "speculative")), out);
  panel.append(body);
  setTimeout(recompute, 0);
  return panel;
}

const convictionCap = c => Math.min(c >= 9 ? 0.15 : c >= 6 ? 0.10 : 0.05,
                                    (view().advice.budgets.maxNameWeightPct || 15) / 100);

function sizeLocally(body, budgets) {
  const cap = convictionCap(body.conviction);
  const fraction = Math.max(0, Math.min(1, body.conviction / 10));
  if (body.side === "buy") {
    const headroom = Math.max(0, Math.min(1, (cap - body.currentWeight) / cap));
    let euros = budgets.monthlyBuyCashEur * fraction * headroom;
    if (body.speculative) euros *= 0.5;
    euros = Math.round(euros / 25) * 25;
    return {
      euros, shares: body.price ? +(euros / body.price).toFixed(2) : null,
      currentWeightPct: body.currentWeight * 100, headroomFactor: headroom,
      cashBudget: budgets.monthlyBuyCashEur,
      note: (body.speculative ? "Sized at half for a speculative name. " : "") +
            (body.currentWeight ? "Adds to an existing position." : "New position."),
      flag: body.currentWeight && headroom < 0.15
        ? `Already ${(body.currentWeight * 100).toFixed(1)}% of the book against a ${(cap * 100).toFixed(0)}% cap at this conviction — almost no room to add.`
        : null,
    };
  }
  const trim = body.conviction >= 10 ? 1 : fraction;
  return {
    euros: body.positionValue * trim, trimFraction: trim,
    positionValue: body.positionValue, freeSellsPerMonth: budgets.monthlyFreeSells,
    note: `Trims about ${(trim * 100).toFixed(0)}% of the position.`,
  };
}

async function renderPension() {
  const box = document.getElementById("pensionBox");
  box.innerHTML = "";
  const health = await checkApi();

  const pots = G("pension") || {};
  const people = Object.keys(pots);

  PENSION_OWNER = pots[BOOK] ? BOOK : (BOOK === "Combined" ? "Combined" : people[0]);

  const picker = document.getElementById("pensionOwner");
  picker.innerHTML = "";
  if (BOOK === "Combined" && people.length > 1) {
    picker.append(el("span", { class: "muted" },
      `Both pots together — ${people.join(" and ")}. Switch book at the top to see one.`));
  } else if (isDemo()) {
    picker.append(el("span", { class: "muted" },
      `${PENSION_OWNER}'s pot — a sample, like the book it belongs to.`));
  } else if (!pots[BOOK]) {
    picker.append(el("span", { class: "muted" },
      `No pension statement imported for ${BOOK}; showing ${PENSION_OWNER}.`));
  }

  let data = BOOK === "Combined" && people.length > 1
    ? combinePots(pots) : (pots[PENSION_OWNER] || {});
  if (API && !isDemo()) {
    if (BOOK !== "Combined") {
      try { data = await apiGet(`/api/pension?owner=${encodeURIComponent(PENSION_OWNER)}`); }
      catch (e) {  }
    }
  } else if (!isDemo()) {
    box.append(el("div", { class: "warnbox" },
      "The API is not answering, so this is the pot as it stood when the site was last built and nothing can be edited from here."));
  }

  if (BOOK !== "Combined") bankPension(PENSION_OWNER, data.total);

  if (data.accrualNote) box.append(el("div", { class: "warnbox" }, data.accrualNote));

  if (data.contributionCoverage !== undefined && data.contributionCoverage < 50
      && data.total > 0) {
    const box_ = el("div", { class: "warnbox" });
    box_.innerHTML =
      `<strong>The contribution history here is partial.</strong> ${fmtEur(data.paidIn)} is logged against ` +
      `a ${fmtEur(data.total)} pot — ${data.contributionCoverage}% — because only ` +
      `${data.monthsObserved} month${data.monthsObserved === 1 ? " has" : "s have"} ` +
      `been imported. The projection assumes ${fmtEur(data.monthlyRate)} goes in every month, which is what ` +
      `the log shows and is very likely too low. Export the other fund views, or just type the real monthly ` +
      `figure in the box below — that single number moves the thirty-five year outcome more than anything ` +
      `else on this page.`;
    box.append(box_);
  }
  const cards = el("div", { class: "kpis" });
  for (const [k, v, s] of [
    ["Pot value", fmtEur(data.estimatedTotal ?? data.total),
     data.accruedMonths ? `${fmtEur(data.total)} confirmed + ${fmtEur(data.accrued)} accrued`
                        : (data.updated ? `as at ${data.updated.slice(0, 10)}` : "not set yet")],
    ["Contributions logged", fmtEur(data.paidIn),
     Object.entries(data.bySource || {}).map(([k2, v2]) => `${k2} ${fmtEur(v2)}`).join(" · ") || "none yet"],
    ["Growth on what is logged", data.growth === null ? "–" : fmtEur(data.growth),
     "only meaningful once the history is complete"],
    ["Lines", `${data.holdings.length}`,
     `${data.pricedCount} with a market ticker, ${data.unpricedCount} carried at stated value`],
  ]) {
    cards.append(el("div", { class: "kpi" }, el("div", { class: "k" }, k),
      el("div", { class: "v" }, v), el("div", { class: "s" }, s)));
  }
  box.append(cards);

  const rows = data.holdings.map(h => ({ ...h }));
  const panel = el("div", { class: "panel wide", style: "margin:20px 0" },
    el("h3", {}, "What the pot holds"));
  const body = el("div", { class: "body" });
  const tableBox = el("div", { class: "tablewrap" });

  function drawRows() {
    tableBox.innerHTML = "";
    const total = rows.reduce((a, r) => a + (parseFloat(r.value_eur) || 0), 0);
    tableBox.append(table(
      ["Fund", "Provider", "Ticker (optional)", "Units", "Value (€)", "Share", ""],
      rows.map((r, i) => ({
        cells: [
          { node: el("input", { value: r.name || "", "aria-label": `Fund name, row ${i + 1}`, style: "width:210px",
              oninput: e => { rows[i].name = e.target.value; } }) },
          { node: el("input", { value: r.provider || "", "aria-label": `Provider, row ${i + 1}`, style: "width:120px",
              oninput: e => { rows[i].provider = e.target.value; } }) },
          { node: el("input", { value: r.ticker || "", placeholder: "BALW.DE", "aria-label": `Ticker, row ${i + 1}`, style: "width:100px",
              oninput: e => { rows[i].ticker = e.target.value.toUpperCase(); } }) },
          { node: el("input", { type: "number", step: "any", value: r.units || 0, class: "val", "aria-label": `Units, row ${i + 1}`,
              style: "width:90px", oninput: e => { rows[i].units = parseFloat(e.target.value) || 0; } }) },
          { node: el("input", { type: "number", step: "any", value: r.value_eur || 0, class: "val", "aria-label": `Value in euro, row ${i + 1}`,
              oninput: e => { rows[i].value_eur = parseFloat(e.target.value) || 0; drawRows(); } }) },
          { text: total ? fmtPct(100 * (parseFloat(r.value_eur) || 0) / total) : "–" },
          { node: el("button", { class: "link", onclick: () => { rows.splice(i, 1); drawRows(); } }, "remove") },
        ],
      })), { numFrom: 3 }));
  }
  drawRows();

  const status = el("div", { class: "muted", style: "font-size:13px;margin-top:10px" });
  const save = el("button", { class: "btn", onclick: async () => {
    save.disabled = true; status.textContent = "saving…";
    try {
      const response = await fetch("/api/pension/holdings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: rows }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || response.status);
      status.textContent = `Saved — pot now ${fmtEur(result.total)}. Rebuild to fold it into the charts.`;
      renderPension();
    } catch (exc) { status.textContent = "Refused: " + exc.message; }
    finally { save.disabled = false; }
  } }, "save holdings");

  body.append(tableBox, el("div", { class: "controls", style: "margin-top:14px" },
    el("button", { class: "btn ghost", onclick: () => {
      rows.push({ name: "", provider: "", ticker: "", units: 0, value_eur: 0 }); drawRows();
    } }, "add a line"),
    API ? save : el("span", { class: "muted" }, "read-only without the API")),
    status,
    el("p", { class: "note muted", style: "padding:10px 0 0" },
      "A ticker is optional. Give one and the line is priced and risk-analysed like any other holding; leave it blank and the line is carried at the value you type, counted in the total and excluded from volatility and beta."));
  panel.append(body);
  box.append(panel);

  const contribPanel = el("div", { class: "panel wide" }, el("h3", {}, "Contributions"));
  const contribBody = el("div", { class: "body" });
  const when = el("input", { type: "date", "aria-label": "Contribution date", value: new Date().toISOString().slice(0, 10) });
  const amount = el("input", { type: "number", step: "any", min: "0", placeholder: "450", class: "val", "aria-label": "Contribution amount in euro" });
  const source = el("select", { "aria-label": "Contribution source" }, ["employee", "employer", "avc", "transfer"].map(
    s => el("option", { value: s }, s)));
  const cnote = el("input", { placeholder: "note", "aria-label": "Note", style: "width:150px" });
  const cstatus = el("div", { class: "muted", style: "font-size:13px;margin-top:10px" });

  const addContribution = el("button", { class: "btn", onclick: async () => {
    try {
      const response = await fetch("/api/pension/contribution", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: when.value, amount_eur: parseFloat(amount.value),
                               source: source.value, note: cnote.value.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || response.status);
      amount.value = ""; cnote.value = "";
      renderPension();
    } catch (exc) { cstatus.textContent = "Refused: " + exc.message; }
  } }, "add");

  if (API) {
    contribBody.append(el("div", { class: "controls" },
      source, el("span", { class: "muted" }, "€"), amount,
      el("span", { class: "muted" }, "on"), when, cnote, addContribution), cstatus);
  }
  const byMonth = contributionsByMonth(data.contributions || []);
  if (byMonth.length) {
    contribBody.append(table(
      ["Month", "Total in", "You %", "You", "Employer"],
      byMonth.map(m => ({
        cells: [
          m.month,
          { node: el("strong", {}, fmtEur(m.total)) },

          { text: m.total ? `${Math.round(100 * m.employee / m.total)}%` : "–", cls: "muted" },
          { text: m.employee ? fmtEur(m.employee) : "–",
            cls: m.employee ? "" : "muted" },
          { text: m.employer ? fmtEur(m.employer) : "–",
            cls: m.employer ? "" : "muted" },
        ],
      })), { numFrom: 1 }));

    const totals = byMonth.reduce((a, m) => ({
      employee: a.employee + m.employee, employer: a.employer + m.employer,
    }), { employee: 0, employer: 0 });
    const grand = totals.employee + totals.employer;
    contribBody.append(el("p", { class: "note muted", style: "padding-top:12px" },
      `${byMonth.length} month${byMonth.length === 1 ? "" : "s"} on record, ${fmtEur(grand)} in total — ` +
      `${fmtEur(totals.employer)} of it your employer's, which is ` +
      `${grand ? (100 * totals.employer / grand).toFixed(0) : 0}% of everything going in. ` +
      `That share is the part of the pension worth protecting: it is pay you only receive by contributing.`));
    const legend = el("div", { class: "pielegend" },
      el("span", {}, el("i", { style: `background:${CONTRIB_COLOURS.employee}` }), "you"),
      el("span", {}, el("i", { style: `background:${CONTRIB_COLOURS.employer}` }), "employer"));
    contribBody.append(legend);
  } else {
    contribBody.append(el("p", { class: "muted", style: "margin-top:12px" },
      "Nothing logged. Until the history is complete, treat the growth figure above as missing data rather than performance."));
  }
  contribPanel.append(contribBody);
  box.append(contribPanel);

  const monthly = document.getElementById("penMonthly");
  const years = document.getElementById("penYears");
  if (!monthly.value) monthly.value = Math.round(data.monthlyRate || 0);
  if (!monthly.dataset.wired) {
    monthly.dataset.wired = "1";
    const redraw = () => renderPensionCharts(data);
    monthly.addEventListener("change", redraw);
    years.addEventListener("input", () => {
      document.getElementById("penYearsLabel").textContent = years.value;
    });
    years.addEventListener("change", redraw);
    document.getElementById("penRateSave").addEventListener("click", async () => {
      await fetch("/api/pension/rate", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly: parseFloat(monthly.value) || 0 }) });
      renderPension();
    });
    document.getElementById("penRateAuto").addEventListener("click", async () => {
      await fetch("/api/pension/rate", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly: "auto" }) });
      monthly.value = "";
      renderPension();
    });
  }
  const charge = document.getElementById("penCharge");
  if (!charge.dataset.wired) {
    charge.dataset.wired = "1";
    document.getElementById("penChargeSave").addEventListener("click", async () => {
      await fetch("/api/pension/charge", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charge: parseFloat(charge.value), owner: PENSION_OWNER }) });
      renderPension();
    });
  }
  charge.value = ((data.charge ?? 0.015) * 100).toFixed(2);

  document.getElementById("penYearsLabel").textContent = years.value;
  renderPensionCharts(data);
}

let PENSION_OWNER = null;
let cubeScene = null;
let cubeMode = "blend";

function normalise(values) {
  const finite = values.filter(v => isFinite(v));
  const lo = Math.min(...finite), hi = Math.max(...finite);
  const span = hi - lo || 1;
  return { lo, hi, at: v => isFinite(v) ? (v - lo) / span : 0.5 };
}

const SURFACE_METRICS = {
  vol: { label: "Volatility", get: s => s.vol, unit: "%", lowerIsBetter: true },
  sharpe: { label: "Sharpe", get: s => s.sharpe, unit: "", lowerIsBetter: false },
  cagr: { label: "Return p.a.", get: s => s.cagr, unit: "%", lowerIsBetter: false },
  drawdown: { label: "Worst drawdown", get: s => s.maxDrawdown, unit: "%", lowerIsBetter: false },
};

function cubeControls() {
  const box = document.getElementById("cubeControls");
  box.innerHTML = "";

  const modeSelect = el("select", {},
    el("option", { value: "blend" }, "Blend surface — what two funds would do"),
    el("option", { value: "correlation" }, "Correlation through time — when diversification failed"));
  modeSelect.value = cubeMode;
  modeSelect.addEventListener("change", () => { cubeMode = modeSelect.value; renderCube(); });
  box.append(el("label", {}, "Show"), modeSelect);

  if (cubeMode === "blend") {
    const options = DATA.funds.filter(f => columnFor(f.ticker));
    const one = el("select", { id: "cubeFundA" }, options.map(f => el("option", { value: f.ticker }, f.name)));
    const two = el("select", { id: "cubeFundB" }, options.map(f => el("option", { value: f.ticker }, f.name)));
    one.value = options.find(f => f.id === "aagg")?.ticker || options[0].ticker;
    two.value = options.find(f => f.id === "agld")?.ticker || options[1].ticker;
    const metric = el("select", { id: "cubeSurfaceMetric" },
      Object.entries(SURFACE_METRICS).map(([k, m]) => el("option", { value: k }, m.label)));
    [one, two, metric].forEach(c => c.addEventListener("change", drawBlendSurface));
    box.append(el("label", {}, "Fund A"), one, el("label", {}, "Fund B"), two,
               el("label", {}, "Height"), metric);
  } else {
    const window_ = el("select", { id: "corrWindow" },
      el("option", { value: "42" }, "2 months"),
      el("option", { value: "63" }, "3 months"),
      el("option", { value: "126" }, "6 months"));
    window_.value = "63";
    window_.addEventListener("change", drawCorrelationSurface);
    box.append(el("label", {}, "Rolling window"), window_,
               el("span", { class: "muted" }, "height and colour are both correlation to the rest of the book"));
  }
}

function ensureScene() {
  if (!cubeScene) {
    cubeScene = new CUBE.Scene(document.getElementById("cubeCanvas"));
    const tip = document.getElementById("cubeTip");
    cubeScene.onHover = (point, projected) => {
      if (!point) { tip.style.opacity = 0; return; }
      tip.innerHTML = point.tip;
      const box = cubeScene.canvas.getBoundingClientRect();
      const dpr = cubeScene.canvas.width / box.width;
      tip.style.left = (projected.sx / dpr + 14) + "px";
      tip.style.top = (projected.sy / dpr + 10) + "px";
      tip.style.opacity = 1;
    };
    window.addEventListener("resize", () => cubeScene && cubeScene.resize());
  }
  return cubeScene;
}

function drawBlendSurface() {
  const { tickers, weights, value } = currentWeights();
  const mine = statsFor(tickers, weights, value);
  if (!mine) return;

  const tickerA = document.getElementById("cubeFundA").value;
  const tickerB = document.getElementById("cubeFundB").value;
  const key = document.getElementById("cubeSurfaceMetric").value;
  const metric = SURFACE_METRICS[key];
  const steps = 11;
  const window_ = new Set(mine.index);

  const cells = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < steps; i++) {
    const row = [];
    for (let j = 0; j < steps; j++) {
      const a = i / (steps - 1) * 0.5;
      const b = j / (steps - 1) * 0.5;
      const rest = 1 - a - b;
      const mix = statsFor([...tickers, tickerA, tickerB],
        [...weights.map(w => w * rest), a, b], value, window_);
      const height = mix ? metric.get(mix) : NaN;
      if (isFinite(height)) { lo = Math.min(lo, height); hi = Math.max(hi, height); }
      row.push({ a, b, height });
    }
    cells.push(row);
  }

  const span = hi - lo || 1;
  const grid = cells.map((row, i) => row.map((cell, j) => ({
    x: i / (steps - 1),
    y: isFinite(cell.height) ? (cell.height - lo) / span : 0,
    z: j / (steps - 1),
  })));

  const scene = ensureScene();
  scene.points = [];

  scene.surface = { grid, rows: steps, cols: steps, invert: metric.lowerIsBetter };
  scene.axes = { x: tickerA + " %", y: metric.label, z: tickerB + " %" };
  scene.ranges = { x: [0, 50], y: [lo, hi], z: [0, 50] };
  scene.tickLabels = null;

  let best = null;
  for (const row of cells) for (const cell of row) {
    if (!isFinite(cell.height)) continue;
    const better = metric.lowerIsBetter ? (!best || cell.height < best.height)
                                        : (!best || cell.height > best.height);
    if (better) best = cell;
  }
  const place = (cell, colour, label, emphasis) => ({
    x: cell.a / 0.5, y: (cell.height - lo) / span, z: cell.b / 0.5,
    r: 0.55, colour, emphasis, label,
    tip: `<strong>${label}</strong><br>${tickerA} ${(cell.a * 100).toFixed(0)}% · ${tickerB} ${(cell.b * 100).toFixed(0)}%` +
         `<br>${metric.label} ${fmtNum(cell.height)}${metric.unit}`,
  });
  const today = cells[0][0];
  scene.points.push(place(today, "#000", "As it stands", true));
  if (best && (best.a || best.b)) scene.points.push(place(best, "#B9002F", "Best mix", true));
  scene.resize();

  cubeLegend(metric.label, metric.lowerIsBetter ? hi : lo, metric.lowerIsBetter ? lo : hi);
  document.getElementById("cubeTitle").textContent =
    `Blending your book with ${tickerA} and ${tickerB}`;

  const delta = best ? best.height - today.height : 0;
  document.getElementById("cubeNote").innerHTML =
    `Every cell is a real mix — your book funded down pro-rata to make room, up to 50% in each fund. ` +
    `Black dot is where you are now; red is the best cell on this metric. ` +
    (best && Math.abs(delta) > 0.01
      ? `<strong>${tickerA} ${(best.a * 100).toFixed(0)}% / ${tickerB} ${(best.b * 100).toFixed(0)}%</strong> takes ${metric.label.toLowerCase()} from ` +
        `${fmtNum(today.height)}${metric.unit} to ${fmtNum(best.height)}${metric.unit}. `
      : "") +
    `If the surface is a broad flat basin rather than a sharp point, the decision is not delicate — anywhere in the basin does nearly the same job, so pick on cost and tax instead.`;
}

function drawCorrelationSurface() {
  const { tickers, weights, value } = currentWeights();
  const span = parseInt(document.getElementById("corrWindow").value, 10);

  const ordered = tickers
    .map((t, i) => ({ ticker: t, weight: weights[i] }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 14);
  const names = ordered.map(o => o.ticker);

  const { rows, index } = alignedRows(names);
  if (rows.length < span + 12) {
    document.getElementById("cubeNote").textContent =
      "Not enough overlapping history for a rolling window this long.";
    return;
  }

  const steps = Math.min(46, Math.floor((rows.length - span) / 5));
  const stride = Math.floor((rows.length - span) / steps);
  const grid = [], labels = [], cells = [];

  for (let k = 0; k <= steps; k++) {
    const start = k * stride, end = start + span;
    const slice = rows.slice(start, end);
    labels.push(index[end - 1]);
    const gridRow = [], cellRow = [];
    for (let n = 0; n < names.length; n++) {
      const own = slice.map(r => r[n]);

      const rest = ordered.filter((_, i) => i !== n);
      const restTotal = rest.reduce((a, o) => a + o.weight, 0) || 1;
      const restSeries = slice.map(r =>
        rest.reduce((a, o, i) => {
          const column = names.indexOf(o.ticker);
          return a + r[column] * (o.weight / restTotal);
        }, 0));
      const c = correlation(own, restSeries);
      cellRow.push(c);
      gridRow.push({ x: k / steps, y: isFinite(c) ? (c + 1) / 2 : 0.5,
                     z: names.length > 1 ? n / (names.length - 1) : 0 });
    }
    grid.push(gridRow);
    cells.push(cellRow);
  }

  const scene = ensureScene();
  scene.points = [];
  scene.surface = { grid, rows: grid.length, cols: names.length, invert: true };
  scene.axes = { x: "time", y: "correlation", z: "holding" };
  scene.ranges = { x: [0, 1], y: [-1, 1], z: [0, 1] };
  scene.tickLabels = { x: [labels[0].slice(0, 7), labels[labels.length - 1].slice(0, 7)] };

  let worst = 0, worstAvg = -2;
  cells.forEach((row, k) => {
    const finite = row.filter(v => isFinite(v));
    const avg = finite.reduce((a, b) => a + b, 0) / (finite.length || 1);
    if (avg > worstAvg) { worstAvg = avg; worst = k; }
  });
  scene.points.push({
    x: worst / steps, y: (worstAvg + 1) / 2, z: 0.5, r: 0.6,
    colour: "#B9002F", emphasis: true, label: labels[worst].slice(0, 7),
    tip: `<strong>${labels[worst]}</strong><br>average correlation across the book ${worstAvg.toFixed(2)}`,
  });
  scene.resize();

  cubeLegend("correlation", -1, 1);
  document.getElementById("cubeTitle").textContent =
    `Rolling ${span}-day correlation of each holding to the rest of the book`;

  const first = cells[0].filter(isFinite);
  const last = cells[cells.length - 1].filter(isFinite);
  const firstAvg = first.reduce((a, b) => a + b, 0) / (first.length || 1);
  const lastAvg = last.reduce((a, b) => a + b, 0) / (last.length || 1);
  document.getElementById("cubeNote").innerHTML =
    `Each ridge running across the whole width is one holding; each slice across the depth is one date. ` +
    `A ridge that rises everywhere at once is the book converging — the month your ${names.length} positions ` +
    `started behaving like one. Highest average was <strong>${worstAvg.toFixed(2)} around ${labels[worst].slice(0, 7)}</strong>, ` +
    `against ${firstAvg.toFixed(2)} at the start of the window and ${lastAvg.toFixed(2)} now. ` +
    `Correlations measured in calm markets understate what happens in a crash, so read the peaks as the honest number.`;
}

function cubeLegend(label, lo, hi) {
  const box = document.getElementById("cubeLegend");
  box.innerHTML = "";
  box.append(el("span", { class: "muted" }, label + ":"));
  box.append(el("span", {}, fmtNum(lo)));
  for (const colour of CUBE.RAMP) box.append(el("i", { style: `background:${colour}` }));
  box.append(el("span", {}, fmtNum(hi)));
  box.append(el("span", { class: "muted", style: "margin-left:14px" }, "drag to rotate · scroll to zoom"));
}

function renderCube() {
  cubeControls();
  if (cubeMode === "blend") drawBlendSurface(); else drawCorrelationSurface();
}

function combinePots(pots) {
  const people = Object.keys(pots);
  const total = people.reduce((a, p) => a + (pots[p].total || 0), 0);
  const holdings = [];
  const contributions = [];
  for (const person of people) {
    for (const h of pots[person].holdings || []) {
      holdings.push({ ...h, name: `${h.name} (${person})` });
    }
    for (const c of pots[person].contributions || []) {
      contributions.push({ ...c, note: `${person}: ${c.note || ""}` });
    }
  }
  contributions.sort((a, b) => a.date.localeCompare(b.date));
  const weighted = total
    ? people.reduce((a, p) => a + (pots[p].charge || 0) * (pots[p].total || 0), 0) / total
    : 0.015;
  return {
    owner: "Combined",
    total,
    estimatedTotal: people.reduce((a, p) => a + (pots[p].estimatedTotal ?? pots[p].total ?? 0), 0),
    paidIn: people.reduce((a, p) => a + (pots[p].paidIn || 0), 0),
    monthlyRate: people.reduce((a, p) => a + (pots[p].monthlyRate || 0), 0),
    monthlyContribution: people.reduce((a, p) => a + (pots[p].monthlyContribution || 0), 0),
    charge: weighted,
    beta: total ? people.reduce((a, p) => a + (pots[p].beta || 1) * (pots[p].total || 0), 0) / total : 1,
    holdings, contributions,
    bySource: people.reduce((acc, p) => {
      for (const [k, v] of Object.entries(pots[p].bySource || {})) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {}),
    pricedCount: people.reduce((a, p) => a + (pots[p].pricedCount || 0), 0),
    unpricedCount: people.reduce((a, p) => a + (pots[p].unpricedCount || 0), 0),
    accruedMonths: 0, accrued: 0,
    combinedFrom: people,
  };
}

function pensionProjection(data) {
  const years = parseInt(document.getElementById("penYears").value, 10);
  const monthly = parseFloat(document.getElementById("penMonthly").value) || 0;
  const start = data.estimatedTotal ?? data.total;
  const beta = data.beta ?? 1.0;

  const target = capmReturn(beta) - (data.charge ?? 0.015);

  const proxy = (data.holdings || []).map(h => h.ticker).filter(t => t && columnFor(t));
  let daily = null;
  if (proxy.length) {
    const { rows } = alignedRows(proxy);
    if (rows.length > 250) {
      const w = new Array(proxy.length).fill(1 / proxy.length);
      daily = rows.map(r => r.reduce((a, v, i) => a + v * w[i], 0));
    }
  }
  const months = years * 12, paths = 4000;
  if (!daily) {
    const sigma = 0.16, mu = target;
    daily = Array.from({ length: 800 }, () => {
      let u = 0, v = 0;
      while (!u) u = Math.random();
      while (!v) v = Math.random();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return mu / TRADING_DAYS + z * sigma / Math.sqrt(TRADING_DAYS);
    });
  }
  const sample = daily.reduce((a, b) => a + b, 0) / daily.length * TRADING_DAYS;
  const track = bootstrapPaths(daily, start, months, monthly, paths, target - sample);

  const fan = [];
  const stride = Math.max(1, Math.round(months / 24));
  for (let m = stride - 1; m < months; m += stride) {
    const col = new Float64Array(paths);
    for (let p = 0; p < paths; p++) col[p] = track[p * months + m];
    col.sort();
    fan.push({ month: m + 1, p05: percentile(col, .05), p25: percentile(col, .25),
               median: percentile(col, .5), p75: percentile(col, .75), p95: percentile(col, .95) });
  }
  const final = new Float64Array(paths);
  for (let p = 0; p < paths; p++) final[p] = track[p * months + months - 1];
  final.sort();

  return { fan, years, monthly, start, target, beta,
           paidIn: start + monthly * months,
           median: percentile(final, .5), p05: percentile(final, .05),
           p95: percentile(final, .95) };
}

function renderPensionCharts(data) {
  const result = pensionProjection(data);
  const charge = data.charge ?? 0.015;
  const labels = result.fan.map(f => (f.month / 12).toFixed(0) + "y");
  const band = (to, colour) => ({
    label: "", data: result.fan.map(f => f[to]), fill: { target: "-1" },
    backgroundColor: colour, borderWidth: 0, pointRadius: 0, tension: .2, order: 3,
  });
  chart("chartPension", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "5th percentile", data: result.fan.map(f => f.p05), borderColor: "#9BC7C8",
          borderWidth: 1, pointRadius: 0, tension: .2, fill: false },
        band("p25", "rgba(155,199,200,.32)"),
        band("median", "rgba(74,158,161,.32)"),
        band("p75", "rgba(74,158,161,.32)"),
        band("p95", "rgba(155,199,200,.32)"),
        { label: "Median", data: result.fan.map(f => f.median), borderColor: INK(),
          borderWidth: 2.4, pointRadius: 0, tension: .2, order: 0, fill: false },
        { label: "Paid in", data: result.fan.map(f => result.start + result.monthly * f.month),
          borderColor: cssVar("--amber") || "#8A5A00", borderWidth: 1.5, borderDash: [5, 4],
          pointRadius: 0, tension: 0, order: 1, fill: false },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10,
          filter: i => i.text && i.text !== "" } },
        datalabels: { display: false },
        tooltip: { filter: i => i.dataset.label !== "",
                   callbacks: { label: c => `${c.dataset.label}: ${fmtEur(c.parsed.y)}` } },
      },
      scales: { x: gridScale({ grid: { display: false } }),
                y: gridScale({ ticks: { callback: v => "€" + (v / 1000).toFixed(0) + "k" } }) },
    },
  });

  document.getElementById("penWarning").innerHTML =
    `At ${fmtEur(result.monthly)} a month for ${result.years} years you would pay in ` +
    `<strong>${fmtEur(result.paidIn)}</strong> and the median outcome is <strong>${fmtEur(result.median)}</strong> ` +
    `(bad case ${fmtEur(result.p05)}, good case ${fmtEur(result.p95)}).<br><br>` +
    `Drift is an assumption — ${(RISK_FREE * 100).toFixed(1)}% cash plus beta ${fmtNum(result.beta)} × ${(EQUITY_RISK_PREMIUM * 100).toFixed(1)}% ` +
    `less the ${fmtPct(charge * 100)} annual charge, so ${fmtPct(result.target * 100)} a year net. ` +
    (data.chargeCost ? `<strong>That charge is the single biggest number on this page: over ` +
      `${data.chargeCost.over} years it costs about ${fmtEur(data.chargeCost.median)}, or ` +
      `${data.chargeCost.pct}% of what the pot would otherwise be.</strong> ` +
      `${fmtPct(charge * 100)} is the demo pot's assumed annual charge. ` : "") +
    `Contributions are assumed flat in cash terms, so anything tied to a rising salary is understated ` +
    `while the effect of inflation on the end figure is not shown at all: ${fmtEur(result.median)} in ` +
    `${result.years} years is worth far less than ${fmtEur(result.median)} today.`;

  const byMonth = {};
  for (const c of data.contributions || []) {
    const key = c.date.slice(0, 7);
    byMonth[key] = byMonth[key] || { employee: 0, employer: 0, other: 0 };
    const bucket = c.source === "employee" ? "employee"
                 : c.source === "employer" ? "employer" : "other";
    byMonth[key][bucket] += c.amount_eur;
  }
  const months = Object.keys(byMonth).sort();
  chart("chartPenContrib", {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        { label: "Employer", data: months.map(m => byMonth[m].employer), backgroundColor: "#14527A" },
        { label: "You", data: months.map(m => byMonth[m].employee), backgroundColor: "#2A9D9F" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtEur(c.parsed.y)}` } } },
      scales: { x: gridScale({ stacked: true, grid: { display: false } }),
                y: gridScale({ stacked: true, ticks: { callback: v => "€" + v } }) },
    },
  });

  const funded = (data.holdings || []).filter(h => h.value_eur > 0);
  donut("chartPenSplit", funded.map(h => [h.name.replace(/ Fund.*| D Accumulating.*/, ""), h.value_eur]));
  document.getElementById("penProxyNote").textContent = data.proxyNote ||
    "Scheme funds are unlisted, so the simulation's shape is proxied by listed trackers with the same mandate. The pot value is the statement's.";
}

async function renderExplore(ticker) {
  const box = document.getElementById("exploreBox");
  const input = document.getElementById("exploreTicker");
  const symbol = (ticker || input.value || "").trim().toUpperCase();
  if (!symbol) {
    box.innerHTML = "";
    box.append(el("p", { class: "muted" },
      "Type a ticker from the synthetic panel: any holding or fund on this page."));
    return;
  }

  box.innerHTML = "";
  const { tickers, weights, value } = currentWeights();
  const mine = statsFor(tickers, weights, value);
  const allocation = parseFloat(document.getElementById("exploreWeight").value) / 100;

  let local = columnFor(symbol);
  let profile = null;
  if (!local || true) {
    try {
      const response = await fetch(`/api/quote?ticker=${encodeURIComponent(symbol)}`);
      if (response.ok) profile = await response.json();
    } catch (e) {  }
  }
  if (!local && !(profile && profile.returns)) {
    box.append(el("div", { class: "warnbox" },
      `No price history for ${symbol}. The demo only knows the fictional instruments in its synthetic panel - try one from the holdings or the fund list.`));
    return;
  }

  if (!local && profile && profile.returns) {
    const map = new Map(profile.returns.dates.map((d, i) => [d, profile.returns.values[i]]));
    DATA.returns.series[symbol] = DATA.returns.dates.map(d => map.has(d) ? map.get(d) : null);
    local = DATA.returns.series[symbol];
  }

  const window_ = new Set(mine.index);
  const solo = statsFor([symbol], [1], value, window_);
  const held = holdings.find(h => h.ticker === symbol);

  const cards = el("div", { class: "kpis" });
  const facts = [
    ["Name", (profile && profile.name) || symbol, (profile && profile.sector) || ""],
    ["Price", profile && profile.price ? `${profile.currency || ""} ${fmtNum(profile.price)}` : "–",
     profile && profile.country ? profile.country : ""],
    ["Volatility", solo ? fmtPct(solo.vol) : "–", "over your book's window"],
    ["Return p.a.", solo ? fmtPct(solo.cagr) : "–", "same window"],
    ["Correlation to your book", solo ? fmtNum(correlation(solo.series, mine.series)) : "–",
     "1.00 means no diversification"],
    ["You hold", held ? fmtEur(held.value) : "nothing", held ? fmtPct(100 * held.value / value) : "not in this book"],
  ];
  for (const [k, v, s] of facts) {
    cards.append(el("div", { class: "kpi" }, el("div", { class: "k" }, k),
      el("div", { class: "v", style: String(v).length > 16 ? "font-size:15px" : "" }, v),
      el("div", { class: "s" }, s)));
  }
  box.append(cards);

  if (profile && (profile.pe || profile.marketCap || profile.dividendYield)) {
    const rows = [
      ["Market cap", profile.marketCap ? fmtEur(profile.marketCap) : "–"],
      ["P/E", profile.pe ? fmtNum(profile.pe) : "–"],
      ["Dividend yield", profile.dividendYield ? fmtPct(profile.dividendYield * 100) : "–"],
      ["52-week range", profile.low52 && profile.high52
        ? `${fmtNum(profile.low52)} – ${fmtNum(profile.high52)}` : "–"],
    ];
    box.append(el("div", { class: "panel wide", style: "margin-top:20px" },
      el("h3", {}, "Fundamentals"),
      el("div", { class: "body" }, table(["", ""], rows.map(r => ({ cells: r })), { numFrom: 1 }))));
  }

  const after = statsFor([...tickers, symbol],
    [...weights.map(w => w * (1 - allocation)), allocation], value, window_);
  const impact = el("div", { class: "panel wide", style: "margin-top:20px" },
    el("h3", {}, `Buying it at ${(allocation * 100).toFixed(0)}%`));
  const impactBody = el("div", { class: "body" });
  if (after) {
    impactBody.append(table(["", "Now", `With ${symbol}`, "Change"], [
      { cells: ["Volatility", fmtPct(mine.vol), fmtPct(after.vol),
        { text: signed(after.vol - mine.vol) + "pp", cls: after.vol < mine.vol ? "pos" : "neg" }] },
      { cells: ["Beta", fmtNum(mine.beta), fmtNum(after.beta), signed(after.beta - mine.beta)] },
      { cells: ["Worst drawdown", fmtPct(mine.maxDrawdown), fmtPct(after.maxDrawdown),
        signed(after.maxDrawdown - mine.maxDrawdown) + "pp"] },
      { cells: ["Sharpe", fmtNum(mine.sharpe), fmtNum(after.sharpe), signed(after.sharpe - mine.sharpe)] },
    ], { numFrom: 1 }));
  }
  const budgets = view().advice.budgets;
  const suggestion = sizeLocally({
    side: "buy", conviction: 6, price: (profile && profile.price) || 0,
    currentWeight: held ? held.value / value : 0, speculative: false,
  }, budgets);
  impactBody.append(el("p", { class: "note muted", style: "padding-top:12px" },
    `At conviction 6 the sizer suggests ${fmtEur(suggestion.euros)}` +
    (suggestion.shares ? ` — about ${suggestion.shares} shares` : "") +
    `, from a ${fmtEur(budgets.monthlyBuyCashEur)} monthly budget against a ${budgets.maxNameWeightPct}% single-name cap. ` +
    (suggestion.flag || "") + " Set conviction yourself on the Advice tab."));
  impact.append(impactBody);
  box.append(impact);
}

const THEORY_LABELS = {
  current: ["As it stands", "what you hold today"],
  growth: ["Growth-optimal", "maximises return − vol²∕2, the rate wealth compounds at"],
  sharpe: ["Best risk-adjusted", "maximises return per unit of risk"],
  minvar: ["Least risk", "ignores return entirely"],
  parity: ["Risk parity", "every holding contributes the same risk"],
};

function renderTheories() {
  const opt = view().optimisation;
  const box = document.getElementById("theoryTable");
  const caveat = document.getElementById("theoryCaveat");
  box.innerHTML = "";
  if (!opt) {
    caveat.textContent = "Not enough overlapping history in this book to optimise.";
    return;
  }

  const order = ["current", "growth", "sharpe", "minvar", "parity"];
  const rows = order.filter(k => opt.theories[k]).map(key => {
    const t = opt.theories[key];
    const entries = Object.entries(t.weights).sort((a, b) => b[1] - a[1]);
    const shown = entries.slice(0, 3)
      .map(([ticker, pct]) => `${ticker} ${pct.toFixed(0)}%`).join(", ");
    const rest = entries.length - 3;
    const top = shown + (rest > 0 ? ` +${rest} more` : "");
    return {
      cls: key === "current" ? "me" : "",
      cells: [
        { node: el("span", {}, el("strong", {}, THEORY_LABELS[key][0]),
            el("div", { class: "muted", style: "font-size:13px" }, THEORY_LABELS[key][1])) },
        fmtPct(t.expectedReturn),
        { text: t.fee ? t.fee.toFixed(3) + "%" : "0%", cls: "muted" },
        fmtPct(t.vol),
        { text: "−" + fmtPct(t.drag), cls: "muted" },
        { text: fmtPct(t.growth), cls: key === "current" ? "" : (t.growthGain > 0 ? "pos" : "neg") },
        { text: key === "current" ? "—" : signed(t.growthGain) + "pp",
          cls: t.growthGain > 0 ? "pos" : "neg" },
        { text: top, cls: "muted" },
      ],
    };
  });
  box.append(table(["Theory", "Expected return", "Ongoing charge", "Volatility", "Drag",
                    "Compounds at", "vs today", "Mostly"], rows, { numFrom: 1 }));

  const current = opt.theories.current, best = opt.theories.growth;
  const years = 10;
  const growthOf = t => Math.pow(1 + t.growth / 100, years);
  chart("chartTheories", {
    type: "bar",
    data: {
      labels: order.filter(k => opt.theories[k]).map(k => THEORY_LABELS[k][0]),
      datasets: [
        { label: "Expected return", data: order.filter(k => opt.theories[k])
            .map(k => opt.theories[k].expectedReturn), backgroundColor: "#B8C4CC" },
        { label: "Compounds at", data: order.filter(k => opt.theories[k])
            .map(k => opt.theories[k].growth), backgroundColor: "#0F7E82" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } } },
      scales: { x: gridScale({ grid: { display: false } }),
                y: gridScale({ ticks: { callback: v => v + "%" } }) },
    },
  });

  const multipleNow = growthOf(current), multipleBest = growthOf(best);
  caveat.innerHTML =
    `<strong>Your book is taking ${fmtPct(current.vol)} volatility to earn an expected ${fmtPct(current.expectedReturn)}, ` +
    `so it compounds at ${fmtPct(current.growth)}.</strong> The growth-optimal mix earns a higher expected ` +
    `${fmtPct(best.expectedReturn)} at ${fmtPct(best.vol)} — more return for half the risk — and compounds at ` +
    `${fmtPct(best.growth)}. Over ${years} years that is ${multipleNow.toFixed(2)}× against ${multipleBest.toFixed(2)}×. ` +
    `The uncomfortable part is that the way to more money here is <em>less</em> risk, not more.<br><br>` +
    `That conclusion rests on one assumption worth naming: expected returns are CAPM — each asset earns what its ` +
    `beta entitles it to and nothing more. The optimiser therefore cannot see any edge you think you have in ` +
    `DTLM or CHPX, and prices concentrated single-stock risk as unpaid. If you genuinely expect those to beat ` +
    `their beta, the honest reading is that you are being paid for a view the model does not hold, not that the ` +
    `model has found free money. Feeding it historical returns instead would be worse: it would put the entire ` +
    `book into whatever ran hottest. Weights are capped at ${(opt.cap * 100).toFixed(0)}% per line.` +
    (opt.themeCap ? `<br><br>CAPM rewards beta, so left alone the growth and Sharpe mixes pile into the most ` +
      `volatile lines — in 2026 that is the AI trade the outside view below calls crowded and expensive. ` +
      `Those two mixes therefore hold chips, AI and tech funds and chip-led EM to ` +
      `${opt.themeCap.limit.toFixed(0)}% combined, about MSCI World's own technology weight.` : "");
}

function renderHedges() {
  const rows = view().hedges || [];
  const box = document.getElementById("hedgeTable");
  box.innerHTML = "";
  if (!rows.length) {
    document.getElementById("hedgeNote").textContent = "Not enough history to test hedges in this book.";
    return;
  }
  const named = t => (DATA.funds.find(f => f.ticker === t) || {}).name || t;
  box.append(table(
    ["Fund", "Best size", "Growth gain", "Δ vol", "Δ return", "Corr.", "In your worst 10%", "Change"],
    rows.slice(0, 12).map(r => ({
      cells: [
        named(r.ticker),
        fmtPct1(r.optimalWeightPct),
        { text: signed(r.growthGain) + "pp", cls: r.growthGain > 0 ? "pos" : "neg" },
        { text: signed(r.volChange) + "pp", cls: r.volChange < 0 ? "pos" : "neg" },
        signed(r.returnChange) + "pp",
        fmtNum(r.correlation),
        fmtNum(r.stressCorrelation),
        { text: r.deterioration === undefined ? "–" : signed(r.deterioration),
          cls: r.deterioration > 0.05 ? "neg" : r.deterioration < -0.05 ? "pos" : "muted" },
      ],
    })), { numFrom: 1 }));

  const worst = [...rows].filter(r => r.deterioration !== undefined)
    .sort((a, b) => b.deterioration - a.deterioration)[0];
  const best = [...rows].filter(r => r.stressCorrelation !== undefined)
    .sort((a, b) => a.stressCorrelation - b.stressCorrelation)[0];
  const parts = [];
  if (best) {
    parts.push(`<strong>${named(best.ticker)}</strong> holds up best when your book is falling — ` +
      `correlation ${fmtNum(best.stressCorrelation)} on your worst days, and it averages ` +
      `${best.meanOnBadDays >= 0 ? "+" : ""}${fmtNum(best.meanOnBadDays)}% on them.`);
  }
  if (worst && worst.deterioration > 0.05) {
    parts.push(`<strong>${named(worst.ticker)}</strong> is the opposite trap: ${fmtNum(worst.correlation)} correlated ` +
      `on ordinary days but ${fmtNum(worst.stressCorrelation)} on your worst ones. Diversification that ` +
      `disappears in a selloff is diversification you were not actually holding.`);
  }
  parts.push("A size at the top of the range means the optimiser wants as much as it is allowed, " +
    "not that the number is precise. Correlations are measured over the book's own window, which " +
    "contains one real drawdown and no crisis — so read every stress figure here as a floor.");
  document.getElementById("hedgeNote").innerHTML = parts.join("<br><br>");
}

function trendTag(row) {
  if (row.vsAverage200 === null || row.vsAverage200 === undefined) return "";
  const above = row.vsAverage200 >= 0;
  return `${above ? "+" : ""}${row.vsAverage200.toFixed(1)}% vs 200d`;
}

function renderPlan() {
  const plan = view().plan;
  const box = document.getElementById("planBox");
  const taxBox = document.getElementById("planTax");
  box.innerHTML = "";
  if (!plan || (!plan.sells.length && !plan.buys.length)) {
    box.append(el("p", { class: "muted" },
      "Your book is already close enough to the target that no trade clears the minimum size."));
    taxBox.textContent = "";
    return;
  }

  const month = plan.thisMonth;
  box.append(el("p", { style: "margin-bottom:14px" },
    el("strong", {}, "This month: "),
    `sell ${month.sells.length} position${month.sells.length === 1 ? "" : "s"} raising ${fmtEur(month.raised)}, `,
    `add ${fmtEur(month.newCash)} of new cash, and put ${fmtEur(month.spent)} to work. `,
    `That uses ${month.freeSellsUsed} of your ${month.freeSells} free sells.`));

  const rows = [
    ...month.sells.map(t => ({ ...t, kind: "Sell" })),
    ...month.buys.map(t => ({ ...t, kind: "Buy" })),
  ];
  const named = t => {
    const fund = DATA.funds.find(f => f.ticker === t);
    if (fund) return fund.name;
    const held = view().holdings.find(h => h.ticker === t);
    return held ? held.name : t;
  };
  box.append(table(["", "Holding", "Amount", "Shares", "Weight now", "Target", "Trend"],
    rows.map(t => ({
      cls: t.kind === "Sell" ? "" : "me",
      cells: [
        { text: t.kind + (t.partial ? " (part)" : ""), cls: t.kind === "Sell" ? "neg" : "pos" },
        named(t.ticker),
        fmtEur(t.euros),
        t.shares ? fmtNum(t.shares) : "–",
        fmtPct1(t.currentPct),
        fmtPct1(t.targetPct),
        { text: trendTag(t), cls: "muted" },
      ],
    })), { numFrom: 2 }));

  const toFunds = view().monthlyCashToFunds;
  box.append(el("p", { class: "note muted", style: "padding-top:12px" },
    `The full move is ${fmtEur(plan.turnover)} of trading — ${plan.turnoverPct}% of the book — which at five ` +
    `free sells a month takes about ${plan.months} month${plan.months === 1 ? "" : "s"}. Nothing forces you to do ` +
    `it all: the first month captures most of the concentration reduction, since the largest losers go first.` +
    (plan.unfundedEur > 0
      ? ` ${fmtEur(plan.unfundedEur)} of the buys is beyond what the sells raise and waits for fresh cash.`
      : "") +
    (toFunds === 0
      ? " This month's buys are funded by the sells alone: the monthly cash is going to the " +
        "deposit while it is behind, as the safe sleeve above says."
      : "")));

  const tax = plan.tax || {};
  const cost = plan.tradingCost || {};
  const growthGain = view().optimisation.theories.growth.growthGain;
  const annual = view().priced * growthGain / 100;
  const parts = [];

  if (cost.total !== undefined) {
    const worst = cost.worst;
    parts.push(`<strong>Dealing costs.</strong> This month's ${cost.trades.length} trades cost about ` +
      `${fmtEur(cost.total)} in commission and currency conversion` +
      (worst ? `, and the burden is uneven — ${worst.ticker} at ${fmtEur(worst.euros)} pays ` +
        `${fmtNum(worst.costPct)}% of the trade just to be executed. Small trades are where a minimum ` +
        `commission does the damage; batching them into fewer, larger ones is worth more than getting ` +
        `the allocation exactly right.` : ".") +
      ` That assumes ${(cost.assumptions.commission_pct * 100).toFixed(2)}% commission with a ` +
      `${fmtEur(cost.assumptions.commission_min)} minimum and ${(cost.assumptions.fx_pct * 100).toFixed(2)}% ` +
      `on currency — adjust if your rate differs.`);
  }
  if (tax.tax > 0) {
    const payback = tax.tax / Math.max(annual, 1);
    parts.push(`<strong>Tax first.</strong> These sells realise ${fmtEur(tax.gain)} of gains. After the ` +
      `${fmtEur(tax.exemption)} annual exemption that is ${fmtEur(tax.taxable)} taxable, ` +
      `<strong>${fmtEur(tax.tax)} of CGT at ${(tax.rate * 100).toFixed(0)}%</strong> — payable now, against ` +
      `roughly ${fmtEur(annual)} a year of extra compounding. It pays for itself in about ${payback.toFixed(1)} years, ` +
      `so this is only worth doing if you intend to hold the new allocation for longer than that.`);
  } else {
    parts.push(`<strong>Tax first, and here it is the good news.</strong> These sells realise ${fmtEur(tax.gain)} of ` +
      `net gains — losses on some positions offset the winners — which is inside the ${fmtEur(tax.exemption)} annual ` +
      `exemption, so the CGT bill is <strong>nil</strong>. That will not be true next year if these positions keep ` +
      `rising, which is an argument for doing it now rather than later.`);
  }
  if (tax.unknownBasis && tax.unknownBasis.length) {
    parts.push(`No cost basis imported for ${tax.unknownBasis.map(r => r.ticker).join(", ")}, so their gains are ` +
      `not in that figure. Import the statement covering them before relying on the tax number.`);
  }
  const switchCost = (cost.total || 0) + (tax.tax || 0);
  if (annual > 0) {
    parts.push(`<strong>All in: ${fmtEur(switchCost)} to switch</strong>, against roughly ${fmtEur(annual)} a year ` +
      `of extra compounding — about ${(switchCost / annual).toFixed(2)} years to pay back. ` +
      `That is the number to judge this on, not the headline improvement.`);
  }
  parts.push(`Tax is estimated on average cost. Irish CGT is FIFO with a four-week rule on losses, so the ` +
    `real figure will differ — treat it as the order of magnitude, not the return.`);
  taxBox.innerHTML = parts.join("<br><br>");
}

function renderGoal() {
  const goal = G("goal") || {};
  const box = document.getElementById("goalBox");
  box.innerHTML = "";
  if (!goal.target) {
    box.append(el("p", { class: "muted" },
      "No dated deposit goal for this book - see the Fact find for its goals."));
    return;
  }

  const showing = BOOK === "Combined" ? null : BOOK;
  const lines = showing ? goal.lines.filter(l => l.book === showing) : goal.lines;
  const thisBook = lines.reduce((a, l) => a + l.value, 0);

  const split = goal.source === "fact find";
  const myTarget = split && showing ? (goal.targets || {})[showing] || 0 : goal.target;
  const mySaved = split && showing ? (goal.byBook || {})[showing] || 0 : goal.held;

  const ffGoals = ((DATA.factFind || {}).goals || []).filter(g => ok(g.securedEur) && /mortgage/i.test(g.id || g.name));
  const ffSecured = showing
    ? (ffGoals.find(g => (g.books || []).length === 1 && g.books[0] === showing) || {}).securedEur
    : (ffGoals.length ? ffGoals.reduce((a, g) => a + g.securedEur, 0) : undefined);
  const myCash = split
    ? (ok(ffSecured) ? ffSecured : showing ? (goal.cashByBook || {})[showing] || 0 : goal.cashHeld || 0)
    : thisBook;
  const myPct = myTarget ? Math.min(100, mySaved / myTarget * 100) : 0;
  const dated = !!goal.targetDate;

  const cards = el("div", { class: "kpis" });

  const atMarket = Math.max(0, mySaved - myCash);
  const toFind = Math.max(0, myTarget - mySaved);
  const myGoal = showing && split
    ? ((DATA.factFind || {}).goals || []).find(g => /mortgage/i.test(g.id || g.name)
        && (g.books || []).length === 1 && g.books[0] === showing) : null;
  const myPlan = myGoal && ok(myGoal.monthlyEur) ? myGoal.monthlyEur : goal.monthlyContribution;
  const months = ok(goal.monthsRemaining) ? goal.monthsRemaining : null;
  const myNeeded = showing && split
    ? (months ? toFind / Math.max(1, months) : null)
    : goal.requiredMonthly;
  const myOnTrack = showing && split && ok(myNeeded) ? myNeeded <= myPlan + 0.5 : goal.onTrack;
  for (const [k, v, s] of [
    split
      ? ["Secured", fmtEur(myCash),
         `${myTarget ? (myCash / myTarget * 100).toFixed(0) : 0}% of ${fmtEur(myTarget)}${showing ? ` · ${showing}'s half` : ""}`]
      : showing
        ? [`${showing} holds`, fmtEur(thisBook), `of ${fmtEur(goal.held)} saved between you`]
        : ["Saved", fmtEur(goal.held), `${goal.pct}% of ${fmtEur(goal.target)}`],
    split
      ? ["Still in the market", fmtEur(atMarket), `can fall before ${dated ? goal.targetDate.slice(0, 10) : "the date"}`]
      : ["Still to find", fmtEur(goal.gap),
         goal.monthsRemaining !== null ? `over ${goal.monthsRemaining} months` : ""],
    ...(split ? [["Still to find", fmtEur(toFind), toFind > 0.5 ? "even if nothing falls" : "covered, if nothing falls"]] : []),

    ["Needed each month", ok(myNeeded) ? fmtEur(myNeeded) : "–",
     `you plan ${fmtEur(myPlan)}${showing && split ? ` · ${showing}'s half` : ""}`],
    ["Target date", dated ? goal.targetDate.slice(0, 10) : "not set",
     dated ? (myOnTrack ? "on track" : "behind") : "set one on the Fact find"],
  ]) {
    cards.append(el("div", { class: "kpi" }, el("div", { class: "k" }, k),
      el("div", { class: "v" }, v), el("div", { class: "s" }, s)));
  }
  box.append(cards);

  const pct = split ? myPct : Math.min(100, goal.pct);
  const cashPct = split && myTarget ? Math.min(pct, myCash / myTarget * 100) : 0;
  const bar = el("div", { class: "goalbar", style: "margin:20px 0 6px;height:26px;border:1px solid var(--line);position:relative" },

    el("div", { class: "goalfill secured", style: `width:${cashPct}%` }),
    el("div", { class: "goalfill atmarket", style: `width:${Math.max(0, pct - cashPct)}%` }),
    el("div", { style: "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600" },
      split ? `${fmtEur(myCash)} secured of ${fmtEur(myTarget)} · ${fmtEur(atMarket)} still in the market`
            : `${fmtEur(goal.held)} of ${fmtEur(goal.target)}`));
  box.append(bar);

  const panel = el("div", { class: "panel wide", style: "margin-top:20px" },
    el("h3", {}, split ? "Where the cash part is" : "Where the deposit is"));
  const body = el("div", { class: "body" });
  body.append(table(["Book", "Account", "Amount"],
    goal.lines.map(l => ({
      cls: showing && l.book === showing ? "me" : "",
      cells: [l.book, l.name, fmtEur(l.value)],
    })), { numFrom: 2 }));
  panel.append(body);
  box.append(panel);

  const notes = [];
  if (split) {
    notes.push(`<strong>EUR ${Math.round(goal.target).toLocaleString("en-IE")} in total, half from each book.</strong> ` +
      `Saved towards it counts each book at market, because the portfolio is the deposit; already in cash ` +
      `counts only the deposit accounts, because that is the part a fall the week before cannot touch. ` +
      `The gap between the two is the part of the deposit still riding the market.`);
    const glides = ((DATA.factFind || {}).goals || [])
      .filter(g => g.glidePath && String(g.id || "").startsWith("mortgage")
                   && (!showing || (g.books || []).includes(showing)));
    for (const g of glides) {
      notes.push(`<strong>${g.name}:</strong> ${g.glidePath.what}`);
    }
    if (!dated) {
      notes.push(`<strong>No date is set</strong>, so nothing here can say whether you are on track, and the ` +
        `advice treats the money as long-term. Give the goal a date on the Fact find and, if it falls inside ` +
        `two years, the plan moves this money to the calmer mix and starts sizing the cash sleeve.`);
    }
  }
  if (Math.abs(goal.countedElsewhere) > 1) {
    notes.push(`<strong>The sheet's own tracker counts ${fmtEur(goal.sheetHeld)}, not ${fmtEur(goal.held)}.</strong> ` +
      `It looks at one book; ${fmtEur(goal.countedElsewhere)} of deposit money sits in the other. That is the ` +
      `difference between ${goal.pct}% of the target and ${(100 * goal.sheetHeld / goal.target).toFixed(1)}%, ` +
      `and between being on track and a reported shortfall. Worth reconciling — if that money is earmarked ` +
      `for something else, this page is the one that is wrong.`);
  }
  if (dated) notes.push(goal.onTrack
    ? `At ${fmtEur(goal.monthlyContribution)} a month you reach ${fmtEur(goal.target)} with room to spare — ` +
      `${fmtEur(goal.requiredMonthly)} a month is what the remaining gap actually requires.`
    : `${fmtEur(goal.requiredMonthly)} a month is required and ${fmtEur(goal.monthlyContribution)} is planned, ` +
      `a shortfall of ${fmtEur(goal.shortfallMonthly)} a month. Either the date moves, the target moves, or ` +
      `the monthly amount does.`);
  if (showing && !split) {
    notes.push(`You are looking at ${showing}'s book, so the highlighted row is ${showing}'s ` +
      `${fmtEur(thisBook)} of it. The target is a household one — a house is bought once — so the ` +
      `progress bar and the monthly figure stay whole rather than being split in two.`);
  }
  if (dated) notes.push(`The cash part is deliberately excluded from every portfolio weight, risk figure and rebalance ` +
    `suggestion on the rest of the site. A deposit needed in ${goal.monthsRemaining} months has no business ` +
    `in equities: the horizon is far too short for volatility to average out, and the cost of being down ` +
    `20% on the day you need it is not a paper loss, it is not buying the house.`);
  box.append(el("div", { class: "warnbox", style: "margin-top:18px" },
    (() => { const d = el("div"); d.innerHTML = notes.join("<br><br>"); return d; })()));
}

const CONTRIB_COLOURS = { employee: "#14527A", employer: "#B9002F" };

function contributionsByMonth(contributions) {
  const months = {};
  for (const row of contributions) {
    const key = (row.date || "").slice(0, 7);
    if (!key) continue;
    const month = months[key] || (months[key] = {
      month: key, total: 0, employee: 0, employer: 0, other: 0,
    });
    const amount = Number(row.amount_eur) || 0;
    month.total += amount;
    if (row.source === "employee") month.employee += amount;
    else if (row.source === "employer") month.employer += amount;
    else month.other += amount;
  }
  return Object.values(months).sort((a, b) => b.month.localeCompare(a.month));
}

function renderLevers() {
  const data = G("levers");
  const box = document.getElementById("leverTable");
  if (!data) return;
  box.innerHTML = "";

  box.append(table(["Lever", "Change", "Ends at", "Difference", "Why"],
    data.levers.map(l => ({
      cls: l.gain > 0 ? "" : "",
      cells: [
        { node: el("strong", {}, l.name) },
        l.change,
        fmtEur(l.terminal),
        { text: (l.gain >= 0 ? "+" : "−") + fmtEur(Math.abs(l.gain)).slice(1),
          cls: l.gain >= 0 ? "pos" : "neg" },
        { text: l.note, cls: "muted" },
      ],
    })), { numFrom: 2 }));

  chart("chartLevers", {
    type: "bar",
    data: {
      labels: data.levers.map(l => l.name),
      datasets: [{
        data: data.levers.map(l => l.gain),
        backgroundColor: data.levers.map(l => l.gain >= 0 ? "#0F7E82" : "#B9002F"),
      }],
    },
    options: {
      maintainAspectRatio: false, indexAxis: "y",
      plugins: { legend: { display: false }, datalabels: { display: false },
        tooltip: { callbacks: { label: c => fmtEur(c.parsed.x) } } },
      scales: { x: gridScale({ ticks: { callback: v => "€" + (v / 1000).toFixed(0) + "k" } }),
                y: gridScale({ grid: { display: false } }) },
    },
  });

  const top = data.levers[0];
  document.getElementById("leverNote").innerHTML =
    `<strong>Over ten years, ${top.name.toLowerCase()} is worth ${fmtEur(top.gain)} — more than every ` +
    `allocation decision on this page combined.</strong> Contributions are ${data.contributionsShare}% of ` +
    `the ${fmtEur(data.base)} base case, which is what a small pot looks like: the money you add dominates ` +
    `the money it earns.<br><br>` +
    `Returns only overtake a year of saving after <strong>${data.crossoverYears} years</strong>, at about ` +
    `${fmtEur(data.crossoverValue)}. Before that point, time spent optimising the portfolio is time spent on ` +
    `the smallest term in the equation — and after it, the habit you built is what got you there.<br><br>` +
    `Assumes 8% a year, which is roughly what global equities have returned over the long run. Nothing here ` +
    `is a forecast; it is arithmetic on an assumption, shown so the terms can be compared against each other.`;
}

function renderMilestones() {
  const rows = G("milestones") || [];
  const box = document.getElementById("milestoneTable");
  if (!rows.length) return;
  box.innerHTML = "";

  box.append(table(["Target in 10 years", "Needs", "Multiple of today", "Verdict"],
    rows.map(m => ({
      cells: [
        { node: el("strong", {}, fmtEur(m.target)) },
        { text: fmtPct1(m.requiredPct),
          cls: m.requiredPct <= 10 ? "pos" : m.requiredPct <= 20 ? "" : "neg" },
        `${m.multipleOfStart.toLocaleString("en-IE")}×`,
        { text: m.verdict, cls: "muted" },
      ],
    })), { numFrom: 1 }));

  const reference = rows[0];
  const benchmarks = (reference.benchmarks || [])
    .map(b => `${b.name} ${b.rate}%`).join(" · ");
  document.getElementById("milestoneNote").innerHTML =
    `For scale: ${benchmarks}. A required return is the one input nobody sanity-checks, and a number that ` +
    `sounds ambitious looks identical to one that is arithmetically impossible until it is written down next ` +
    `to what the best investors alive have actually sustained. At a defensible 8% this book reaches ` +
    `<strong>${fmtEur(reference.atEightPercent)}</strong> in ten years — and the honest way to move that ` +
    `number is the table above, not a better fund.`;
}

const VALUE_RUNGS = [5000, 10000, 25000, 30000, 40000, 50000, 75000, 100000,
                     150000, 200000, 250000, 500000, 1000000];
const PENSION_RUNGS = [5000, 10000, 25000, 50000, 100000, 250000, 500000];

const bookWord = () =>
  BOOK === "Combined" ? "Both books together" : `${BOOK}'s book`;

function achievementsNow(value) {
  const items = [];

  for (const rung of VALUE_RUNGS) {
    if (value < rung) continue;
    items.push({
      id: `value.${BOOK}.${rung}`,
      label: fmtEur(rung),
      detail: `${bookWord()} crossed ${fmtEur(rung)} of priced holdings.`,
      grand: rung >= 100000,
    });
  }

  const goal = G("goal") || {};
  if (goal.target > 0) {
    if (goal.held >= goal.target / 2) items.push({
      id: `goal.deposit.half.${BOOK}`,
      label: "Half the deposit",
      detail: `${fmtEur(goal.held)} of the ${fmtEur(goal.target)} mortgage deposit is saved.`,
    });
    if (goal.held >= goal.target) items.push({
      id: `goal.deposit.full.${BOOK}`,
      label: "Deposit saved",
      detail: `The full ${fmtEur(goal.target)} mortgage deposit is there.`,
      grand: true,
    });
  }

  const plan = view().plan;
  if (plan && !plan.sells.length && !plan.buys.length) items.push({
    id: `plan.ontarget.${BOOK}`,
    label: "At target allocation",
    detail: `${bookWord()} is close enough to its target mix that no trade clears the minimum size.`,
    grand: true,
  });

  if (Array.isArray(G("corrections")) && !G("corrections").length) items.push({
    id: `data.reconciled.${BOOK}`,
    label: "Books reconciled",
    detail: "Every position is accounted for by the trade history.",
  });

  return items;
}

function bankPension(owner, total) {
  if (!(total > 0) || !owner) return;
  const items = PENSION_RUNGS.filter(r => total >= r).map(r => ({
    id: `pension.${owner}.${r}`,
    label: `Pension ${fmtEur(r)}`,
    detail: `${owner}'s pension pot passed ${fmtEur(r)}.`,
    grand: r >= 100000,
  }));
  celebrate(Celebrate.bank(items));
}

function celebrate(fresh) {
  if (!fresh.length || (DATA && DATA.demoMode)) return;
  Celebrate.announce(fresh);
}

function renderAchievements(value) {
  const box = document.getElementById("achievementBox");
  if (!box) return;

  if (!isEdited()) celebrate(Celebrate.bank(achievementsNow(value)));

  box.innerHTML = "";

  const next = VALUE_RUNGS.find(r => r > value);
  if (next) {
    const pct = Math.max(0, Math.min(100, (value / next) * 100));
    const card = el("div", { class: "mstone-next" });
    card.append(el("div", { class: "top" },
      el("div", {}, "Next: ", el("strong", {}, fmtEur(next)),
        BOOK === "Combined" ? " for both books together" : ` for ${BOOK}'s book`),
      el("div", { class: "muted" }, `${fmtEur(next - value)} to go · ${pct.toFixed(1)}%`)));
    const bar = el("div", { class: "mstone-bar" });
    bar.append(el("i", { style: `width:${pct.toFixed(2)}%` }));
    card.append(bar);
    box.append(card);
  }

  if (next) {
    const growth = ((view().optimisation || {}).theories || {}).growth;
    const monthly = (view().advice.budgets || {}).monthlyBuyCashEur || 0;
    const rate = (growth ? growth.growth : 5) / 100 / 12;
    let months = 0, pot = value;
    while (pot < next && months < 600) { pot = pot * (1 + rate) + monthly; months++; }
    box.append(el("p", { class: "note muted" },
      `About ${months} month${months === 1 ? "" : "s"} away at ${fmtEur(monthly)} a month and the target mix's expected growth — ` +
      `${fmtEur(next / Math.pow(1 + (DATA.inflation ?? 0.03), months / 12))} in today's money.`));
  }

  document.getElementById("achievementNote").textContent = "";
}

const URGENCY_CLASS = {
  "now": "urg-now", "this week": "urg-week",
  "this month": "urg-month", "opportunistic": "urg-opp",
};

let LIVE = { at: null, prices: {}, book: null };

async function loadLivePrices() {
  if (!API || isDemo()) { LIVE = { at: null, prices: {}, book: null }; return false; }
  const tickers = (view().holdings || [])
    .filter(h => h.tradable !== false && h.shares > 0 && columnFor(h.ticker))
    .map(h => h.ticker);
  if (!tickers.length) return false;

  if (!tickers.includes(DATA.benchmarkTicker)) tickers.push(DATA.benchmarkTicker);
  try {
    const data = await apiGet(`/api/prices?tickers=${encodeURIComponent(tickers.join(","))}`);
    LIVE = { at: new Date(), prices: data.prices || {}, book: BOOK };
    return true;
  } catch (e) {
    LIVE = { at: null, prices: {}, book: null };
    return false;
  }
}

function liveValuation() {
  if (!LIVE.at || LIVE.book !== BOOK) return null;
  let total = 0, priced = 0, unpriced = [], oldest = null;
  for (const h of view().holdings || []) {
    if (h.tradable === false || !(h.shares > 0)) continue;
    const q = LIVE.prices[h.ticker];
    if (q && q.eur) {
      total += h.shares * q.eur; priced++;
      if (q.asOf && (!oldest || q.asOf < oldest)) oldest = q.asOf;
    } else {
      unpriced.push(h.ticker);
    }
  }
  if (!priced) return null;
  return { total, priced, unpriced, oldest,
           at: LIVE.at.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" }) };
}

function livePriceFor(ticker) {
  const q = LIVE.book === BOOK ? LIVE.prices[ticker] : null;
  return q && q.eur ? q : null;
}

const isDemo = () => true;

function G(key) {
  if (!isDemo()) return DATA[key];
  const swap = (DATA.demoByBook || {})[BOOK] || DATA.demo || {};
  return key in swap ? swap[key] : undefined;
}

function renderDemoBanner() {
  const box = document.getElementById("demoBanner");
  if (!box) return;
  if (!isDemo()) { box.style.display = "none"; return; }
  box.style.display = "";
  const view_ = view();
  box.innerHTML =
    `<strong>${BOOK} is a fictional book, not anybody's money.</strong> The holdings, the instruments and ` +
    `the price history are synthetic (a seeded simulation); everything computed from them is the ` +
    `application's own arithmetic - the same optimiser, orders and stress code a real book would get. ` +
    `${fmtEur(view_.priced)} of holdings plus ${fmtEur(view_.parked)} of cash and deposit.<br><br>` +
    `The goals, the pension, the protection ages and salaries and the transaction history are fabricated ` +
    `to match. Not investment advice; not live performance.`;
}

function exchangeClock(tz, when = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(when).reduce((a, p) => (a[p.type] = p.value, a), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (+parts.hour % 24) * 60 + (+parts.minute),
    weekday: parts.weekday,
  };
}

function zonedToInstant(dateStr, hhmm, tz) {
  const guess = new Date(`${dateStr}T${hhmm}:00Z`);
  const inZone = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  const inUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (inUtc - inZone));
}

const toMinutes = hhmm => (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(3, 5));
const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function marketStatus(code, when = new Date()) {
  const spec = (DATA.markets || {})[code];
  if (!spec) return null;
  const holidays = new Set(spec.holidays || []);
  const isSession = iso => {
    const day = new Date(iso + "T12:00:00Z").getUTCDay();
    return day !== 0 && day !== 6 && !holidays.has(iso);
  };
  const now = exchangeClock(spec.tz, when);
  const open = toMinutes(spec.openLocal), close = toMinutes(spec.closeLocal);
  const openNow = isSession(now.date) && now.minutes >= open && now.minutes < close;

  let why = null;
  if (!openNow) {
    const day = new Date(now.date + "T12:00:00Z").getUTCDay();
    why = (day === 0 || day === 6) ? "the weekend"
        : holidays.has(now.date) ? "a market holiday"
        : now.minutes < open ? "before the open" : "after the close";
  }

  let iso = now.date;
  if (!isSession(iso) || now.minutes >= close) iso = addDays(iso, 1);
  for (let i = 0; i < 30 && !isSession(iso); i++) iso = addDays(iso, 1);
  const nextOpen = zonedToInstant(iso, spec.openLocal, spec.tz);

  return { code, name: spec.name, open: openNow, why, nextOpen, nextSession: iso, spec };
}

const whenLocal = d => d.toLocaleString("en-IE", {
  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});

function renderMarketBanner() {
  const box = document.getElementById("marketBanner");
  if (!box || !DATA.markets) return;

  const states = ["US", "EU"].map(code => marketStatus(code)).filter(Boolean);
  if (!states.length) return;
  const shut = states.filter(s => !s.open);

  if (!shut.length) {
    box.className = "goodbox";
    box.innerHTML = `<strong>Markets are open.</strong> ` +
      states.map(s => `${s.name} until ${s.spec.closeLocal} local`).join(" · ") +
      `. Orders below can be placed now.`;
    return;
  }

  box.className = "warnbox";
  box.innerHTML =
    `<strong>${shut.length === states.length ? "Markets are closed" : "Some markets are closed"} — ` +
    `${shut[0].why}.</strong> ` +
    shut.map(s => `${s.name} reopens ${whenLocal(s.nextOpen)}`).join(". ") +
    `.<br><br>` +
    `<strong>What you can still do right now:</strong> queue the limit orders below as good-till-cancelled — ` +
    `they go live at the open. Never "market" into a closed session: the first print of the week has the ` +
    `widest spread. Countdowns below are in <strong>sessions</strong>, not days.`;
}

const CONF_CLASS = { high: "conf-high", moderate: "conf-mod",
                     low: "conf-low", speculative: "conf-spec" };

function confidenceCell(c) {
  if (!c) return { text: "–", cls: "muted" };
  const wrap = el("span", { class: "confcell" });
  wrap.append(el("span", { class: "conf " + (CONF_CLASS[c.band] || "conf-spec") },
    `${c.score} ${c.band}`));
  const bar = el("span", { class: "confbar" });
  bar.append(el("i", { style: `width:${c.score}%` }));
  wrap.append(bar);
  return { node: wrap };
}

function confidenceDetail(c) {
  if (!c) return null;
  const box = el("div", { class: "confdetail" });
  box.append(el("div", { class: "confhead" },
    el("span", { class: "conf " + (CONF_CLASS[c.band] || "conf-spec") },
      `confidence ${c.score}/100 — ${c.band}`)));
  const list = el("ul");
  for (const p of c.parts) {
    list.append(el("li", {},
      el("strong", {}, `${p.name} ${p.points}/${p.outOf}`),
      el("span", { class: "muted" }, ` — ${p.why}`)));
  }
  box.append(list);
  for (const cap of c.caps || []) {
    box.append(el("div", { class: "confcap" }, cap));
  }
  box.append(el("div", { class: "muted", style: "font-size:13px;margin-top:6px" }, c.ceiling));
  return box;
}

const sessionWord = n =>
  n === null || n === undefined ? "—"
  : n === 0 ? "today or gone"
  : n === 1 ? "1 session left"
  : `${n} sessions left`;

function placeabilityLine(order) {
  const state = marketStatus(order.market || "US");
  if (!state) return null;
  const line = el("div", { style: "font-size:13px;margin-top:6px" });
  if (state.open) {
    line.innerHTML = `<strong>${state.name} is open.</strong> This can be placed now, and a limit that ` +
      `is already through the market fills immediately.`;
    line.className = "pos";
    return line;
  }
  line.className = "amber";
  line.innerHTML =
    `<strong>${state.name} is closed — ${state.why}.</strong> Queue this as a good-till-cancelled limit ` +
    `now and it goes live at ${whenLocal(state.nextOpen)}. ` +
    (order.deadlineDays !== null && order.deadlineDays !== undefined && order.deadlineDays <= 1
      ? `<strong>That is the same session the deadline falls in</strong>, so there is no second attempt: ` +
        `if it does not fill, the free sell is gone.`
      : `Do not leave it as a market order over a close — the first print of a session is the widest ` +
        `spread of the week.`);
  return line;
}

function renderOrders() {
  const orders = view().orders || [];
  const box = document.getElementById("orderBox");
  box.innerHTML = "";
  if (!orders.length) {
    box.append(el("p", { class: "muted" },
      "Nothing to place — the book is close enough to target that no trade clears the minimum size."));
    document.getElementById("orderNote").textContent = "";
    return;
  }

  const named = t => {
    const fund = DATA.funds.find(f => f.ticker === t);
    if (fund) return fund.name;
    const held = view().holdings.find(h => h.ticker === t);
    return held ? held.name : t;
  };

  const money = (value, currency) =>
    currency === "USD" ? "$" + value.toFixed(2) : fmtEur(value);

  box.append(table(
    ["When", "Order", "Holding", "Where", "Amount", "Limit price", "If unfilled",
     "Costs to wait", "How sure"],
    orders.map(o => ({
      cls: o.skipped ? "muted" : "",
      cells: [
        { node: el("span", { class: "urg " + (o.skipped ? "urg-opp" : URGENCY_CLASS[o.urgency]) },
            o.skipped ? "skip" : o.urgency) },
        { node: el("strong", { class: o.side === "sell" ? "neg" : "pos" },
            o.skipped ? "—"
            : `${o.side === "sell" ? "SELL" : "BUY"} ${o.shares ? Math.round(o.shares) : ""}`) },
        named(o.ticker),
        { node: el("span", {},
            el("strong", {}, o.broker || "unknown"),
            o.brokerSaving > 0
              ? el("div", { class: "muted", style: "font-size:13px" },
                  `saves ${fmtEur(o.brokerSaving)}`)
              : (o.brokerSplit && o.brokerSplit.length > 1
                  ? el("div", { class: "muted", style: "font-size:13px" }, "split — 2 orders")
                  : null)) },
        o.euros ? fmtEur(o.euros) : "–",

        { node: o.limit
            ? el("span", {},
                el("strong", {}, money(o.nativeLimit ?? o.limit, o.currency)),
                el("div", { class: "muted", style: "font-size:13px" },
                  `now ${money(o.nativePrice ?? o.price, o.currency)}` +
                  (o.currency === "USD" ? ` · ${fmtEur(o.limit)}` : "") +
                  ` · ${o.bandPct}% band`))
            : el("span", { class: "muted" }, "market") },

        { text: o.deadline
            ? `${o.deadline} · ${sessionWord(o.deadlineDays)}`
            : o.limitExpires ? `limit expires ${o.limitExpires}`
            : o.skipped ? "skipped — under one whole share" : "–",
          cls: o.deadlineDays !== null && o.deadlineDays <= 2 ? "neg" : "muted" },
        { text: o.costPerMonth >= 1 ? fmtEur(o.costPerMonth) + "/mo" : "–",
          cls: o.costPerMonth >= 20 ? "neg" : "muted" },
        confidenceCell(o.confidence),
      ],
    })), { numFrom: 3 }));

  const detail = el("div", { style: "margin-top:18px" });
  for (const o of orders.slice(0, 4)) {
    detail.append(el("div", { style: "padding:12px 0;border-bottom:1px solid var(--line-soft)" },
      el("div", {},
        el("span", { class: "urg " + URGENCY_CLASS[o.urgency] }, o.urgency),
        el("strong", { style: "margin-left:10px" },
          `${o.side === "sell" ? "Sell" : "Buy"} ${named(o.ticker)}`),
        el("span", { class: "muted" },
          ` — ${fmtEur(o.euros)}${o.shares ? `, about ${fmtNum(o.shares)} shares` : ""}`)),
      el("div", { class: "muted", style: "font-size:13px;margin-top:6px" },
        o.limit ? `${o.side === "sell" ? "Limit sell" : "Limit buy"} at ` +
          `${money(o.nativeLimit ?? o.limit, o.currency)}` +
          (o.currency === "USD" ? ` (${fmtEur(o.limit)})` : "") + `. ${o.rationale}` : ""),
      o.rounding ? el("div", { style: "font-size:13px;margin-top:6px;color:var(--amber)" }, o.rounding) : null,
      o.brokerWhy ? el("div", { class: "muted", style: "font-size:13px;margin-top:6px" },
        el("strong", {}, (o.broker || "Venue unknown") + ". "), o.brokerWhy) : null,
      el("div", { class: "muted", style: "font-size:13px;margin-top:6px" }, o.deadlineReason || ""),
      placeabilityLine(o),
      confidenceDetail(o.confidence)));
  }
  box.append(detail);

  const urgent = orders.filter(o => o.urgency === "now");
  const totalCost = orders.reduce((a, o) => a + o.costPerMonth, 0);
  document.getElementById("orderNote").innerHTML =
    (urgent.length
      ? `<strong>${urgent.length} order${urgent.length === 1 ? "" : "s"} marked now.</strong> ` +
        (urgent.some(o => o.overCap)
          ? `${urgent.filter(o => o.overCap).map(o => o.ticker).join(", ")} sits past the ` +
            `${(view().advice.budgets.maxNameWeightPct)}% single-name cap, which is concentration you did ` +
            `not choose rather than a view you took. `
          : "") +
        `The rest are dated by the free-sell allowance, which resets at month end and does not carry over.<br><br>`
      : "") +
    `Leaving the whole plan undone costs about <strong>${fmtEur(totalCost)} a month</strong> in foregone ` +
    `compounding — that figure, not a colour, is what "urgent" means here.<br><br>` +
    `Each order names the account. A sell can only happen where the shares are — and MRKT, CHPX and VLTR sit ` +
    `across both, so those are two orders rather than one. A buy goes wherever it is cheapest, which on these ` +
    `sizes is always the commission-free account: a ${fmtEur(15)} minimum is 4.3% of a ${fmtEur(342)} trade ` +
    `and nothing at all next to 0.15% conversion.<br><br>` +
    `Sizes are whole shares and a sell is the whole position, because fractions cannot be traded in these ` +
    `accounts. That is not a rounding detail: an instruction to trim 62% of a holding cannot be placed, so ` +
    `the numbers here are the ones that can — with whatever they leave in cash stated on the order.<br><br>` +
    `Prices in bold are the currency the broker quotes, which for a US line is dollars. The euro figure ` +
    `beside it is for reconciling against the rest of this site; typing it into a dollar ticket would be a ` +
    `16% error on the one number that has to be exact.<br><br>` +
    `<strong>How sure</strong> is a score out of 100 built from five things that can be checked, not from ` +
    `how strong the conclusion feels: whether the four independent optimisations agree on the direction, ` +
    `whether the expected gain beats what the trade costs to place, whether the share count reconciles and ` +
    `the cost basis is real, how much overlapping history the estimate rests on (` +
    `${DATA.historyYears ? DATA.historyYears + " years here" : "unknown here"}), and whether price momentum ` +
    `points the same way. Two of those can veto: an unreconciled share count caps the score at 34 however ` +
    `good the arithmetic looks, and under three years of history caps it below high. Open an order below to ` +
    `see which of the five is costing it points.<br><br>` +
    `Two honest limits on all of this. The limit prices assume the recent daily volatility holds, which it ` +
    `does until it does not; if a holding gaps through your limit on news, you get filled at a price the ` +
    `band never contemplated. And the destination comes from CAPM, which cannot see any edge you believe ` +
    `you have — so these are the orders that follow from the model, not a claim that the model is right.`;
}

function renderDeadlines() {
  const rows = DATA.deadlines || [];
  const box = document.getElementById("deadlineTable");
  if (!rows.length) return;
  box.innerHTML = "";
  box.append(table(["Date", "In", "What", "Why it matters"],
    rows.map(r => ({
      cells: [
        { node: el("strong", {}, r.when) },
        { text: `${r.days} days`, cls: r.days <= 14 ? "neg" : "" },
        r.what,
        { text: r.why, cls: "muted" },
      ],
    })), { numFrom: 1 }));
}

function renderAudit() {
  const audit = (view().optimisation || {}).audit || [];
  const box = document.getElementById("auditTable");
  if (!box) return;
  box.innerHTML = "";
  if (!audit.length) return;

  const funds = Object.fromEntries(DATA.funds.map(f => [f.ticker, f]));
  box.append(table(
    ["Fund", "Issuer", "Target", "Expected return", "Ongoing charge", "Volatility", "Corr. to book"],
    audit.map(r => {
      const fund = funds[r.ticker] || {};
      return { cells: [
        fund.name || r.ticker,
        { text: fund.issuer || "already held", cls: "muted" },
        fmtPct1(r.weight),
        fmtPct(r.expectedReturn),
        { text: r.cost ? r.cost.toFixed(3) + "%" : "0%",
          cls: r.cost > 0.25 ? "neg" : "muted" },
        fmtPct(r.vol),
        r.correlationToBook === null ? "–" : fmtNum(r.correlationToBook),
      ] };
    }), { numFrom: 2 }));

  const byIssuer = {};
  for (const r of audit) {
    const issuer = (funds[r.ticker] || {}).issuer || "already held";
    byIssuer[issuer] = (byIssuer[issuer] || 0) + r.weight;
  }
  const mix = Object.entries(byIssuer).sort((a, b) => b[1] - a[1])
    .map(([issuer, weight]) => `${issuer} ${weight.toFixed(0)}%`).join(", ");

  document.getElementById("auditNote").innerHTML =
    `<strong>No provider pays for placement here, and none could.</strong> The selection is a function of four ` +
    `numbers per fund — expected return from its beta, its ongoing charge, its volatility, and its correlation ` +
    `to what you already hold. Current mix: ${mix}.<br><br>` +
    `The place bias can get in is the shortlist, which is written by hand: a list dominated by one issuer ` +
    `tends to recommend that issuer, so the demo universe carries several fictional issuers per exposure. ` +
    `If a provider is missing from the ` +
    `${DATA.funds.length}-fund list, say so: an absent fund cannot be chosen, and that is the failure mode to ` +
    `watch for rather than a thumb on the scale.<br><br>` +
    `Two things worth checking yourself. Ongoing charges are hand-entered from published KIDs, so a wrong one ` +
    `moves the ranking — the numbers above are the ones to verify. And expected returns come from CAPM, which ` +
    `pays for beta and nothing else: that is why a technology sector fund lands at 25%, and it is a property ` +
    `of the model rather than a judgement that technology will keep winning.`;
}

function renderDiscrepancies() {
  const rows = G("corrections") || [];
  const panel = document.getElementById("discrepancyPanel");
  const box = document.getElementById("discrepancyTable");
  if (!panel || !box) return;

  if (!rows.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";
  box.innerHTML = "";

  box.append(table(
    ["Holding", "Sheet says", "Statements account for", "Gap", "Value at stake", "Most likely"],
    rows.map(r => ({
      cells: [
        { node: el("strong", {}, tickerLink(r.ticker)) },
        fmtNum(r.sheetShares),
        fmtNum(r.ledgerShares),
        { text: (r.gap > 0 ? "+" : "") + fmtNum(r.gap), cls: "neg" },
        fmtEur(r.valueAtStake),
        { text: r.reason, cls: "muted" },
      ],
    })), { numFrom: 1 }));

  const missing = rows.filter(r => r.gap < 0);
  const extra = rows.filter(r => r.gap > 0);
  const atStake = rows.reduce((a, r) => a + r.valueAtStake, 0);

  document.getElementById("discrepancyNote").innerHTML =
    `<strong>${rows.length} position${rows.length === 1 ? "" : "s"} where the sheet and the statements ` +
    `disagree, ${fmtEur(atStake)} at stake.</strong> Neither source overwrites the other, because they ` +
    `disagree in both directions and so neither is reliably right.<br><br>` +
    (missing.length
      ? `<strong>${missing.map(r => r.ticker).join(", ")}</strong>: the sheet holds more than the imported ` +
        `statements account for, which points at a broker whose statement has not been loaded. The ` +
        `Larch export is a PDF whose numbers cannot be extracted — its CSV export would close this.<br><br>`
      : "") +
    (extra.length
      ? `<strong>${extra.map(r => r.ticker).join(", ")}</strong>: the statements account for more than the ` +
        `sheet holds, which is either a sale the statements do not cover or a sheet not yet updated for a ` +
        `recent buy. Those need opposite corrections, so they have to be looked at rather than guessed.<br><br>`
      : "") +
    `Share counts here come from the sheet. Prices are refreshed from the market, which is safe — what an ` +
    `instrument is worth does not depend on how many of it you own. An order sized off an unreconciled count ` +
    `is the one error on this page that costs real money, so resolve these before placing anything in them.`;
}
