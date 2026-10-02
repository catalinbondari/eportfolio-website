function goalBar(g) {
  const pct = ok(g.pct) ? g.pct : 0;
  if (ok(g.securedEur) && g.targetEur) {
    const safe = Math.min(100, g.securedEur / g.targetEur * 100);
    const market = Math.min(100 - safe, (g.atMarketEur || 0) / g.targetEur * 100);
    return el("div", { class: "goalbar" },
      el("div", { class: "goalfill secured", style: `width:${Math.max(1, safe)}%` }),
      el("div", { class: "goalfill atmarket", style: `width:${market}%` }));
  }
  return el("div", { class: "goalbar" },
    el("div", { class: "goalfill" + (g.done ? " done" : g.onTrack === false ? " behind" : ""),
                style: `width:${Math.max(2, Math.min(100, pct))}%` }));
}

function goalHeadline(g) {
  if (!g.targetEur) return g.kindLabel || "";
  if (ok(g.securedEur)) {
    return `${fmtEur(g.securedEur)} secured of ${fmtEur(g.targetEur)} · ${(g.securedPct || 0).toFixed(0)}%`;
  }
  return `${fmtEur(g.fundedEur)} of ${fmtEur(g.targetEur)} · ${(ok(g.pct) ? g.pct : 0).toFixed(0)}%`;
}

function goalSplit(g) {
  if (!ok(g.securedEur) || !g.targetEur) return null;
  const toFind = Math.max(0, g.targetEur - (g.fundedEur || 0));
  return el("p", { class: "desk-line goal-split" },
    el("span", { class: "sw secured" }), `${fmtEur(g.securedEur)} in deposit accounts and the parking fund · `,
    el("span", { class: "sw atmarket" }), `${fmtEur(g.atMarketEur)} still in funds and shares, can fall before ${g.targetDate || "the date"}` +
    (toFind > 0.5 ? ` · ${fmtEur(toFind)} still to find` : ""));
}

function goalRow(g) {
  const bar = goalBar(g);
  const meta = [];
  if (g.targetDate) meta.push(`due ${g.targetDate}` + (ok(g.monthsToDate) ? ` · ${g.monthsToDate.toFixed(0)} months` : ""));
  if (g.monthlyEur) meta.push(`${fmtEur(g.monthlyEur)} a month`);
  if ((g.books || []).length) meta.push(g.books.join(" + "));
  if (ok(g.realTargetEur)) meta.push(`${fmtEur(g.realTargetEur)} in that year's money`);
  const edit = el("button", { class: "desk-go", type: "button", title: "Load this goal into the form" }, "edit");
  edit.addEventListener("click", () => editGoal(g));
  return el("div", { class: "goal" },
    el("div", { class: "goal-head" },
      el("span", {}, el("strong", {}, g.name), API ? [" ", edit] : null),
      el("span", { class: g.done ? "pos" : g.onTrack === false ? "neg" : "muted" },
        goalHeadline(g))),
    g.targetEur ? bar : null,
    goalSplit(g),
    el("p", { class: "desk-line" }, g.verdict || g.note || ""),
    meta.length ? el("p", { class: "desk-line muted" }, meta.join(" · ")) : null,
    g.horizonWarning ? el("div", { class: "warnbox", style: "margin-top:8px" }, g.horizonWarning) : null,
    g.protection ? el("p", { class: "desk-line muted" },
      (g.protection.priority && g.protection.priority.what
        ? `First priority: ${g.protection.priority.what}. `
        : "") + "See the Protection tab for the cover and what it costs.") : null);
}

function renderFactFind() {
  const box = document.getElementById("goalsBox");
  if (!box) return;
  box.innerHTML = "";
  const f = DATA.factFind;
  const form = document.getElementById("goalForm");
  if (form) form.style.display = API ? "" : "none";
  const deposit = document.getElementById("depositForm");
  if (deposit) deposit.style.display = API ? "" : "none";
  if (!f || !f.goals || !f.goals.length) {
    box.append(el("p", { class: "muted" }, "No goals set yet."));
    return;
  }
  if (ok(f.pct)) {
    box.append(el("div", { class: f.behind && f.behind.length ? "warnbox" : "goodbox", style: "margin-bottom:14px" },
      `${fmtEur(f.totalFundedEur)} of ${fmtEur(f.totalTargetEur)} across every goal — ${f.pct.toFixed(0)}%.` +
      (f.behind && f.behind.length ? ` Behind on: ${f.behind.join(", ")}.`
        : f.goals.some(g => g.targetDate) ? " Every dated goal is on track."
        : " No goal has a date yet, so none can be on or off track — add one to measure it.")));
  }
  box.append(el("div", { class: "goals" }, f.goals.map(goalRow)));
  box.append(cashAtBrokers());
  if (API && !SAVINGS_ROWS.length) loadSavingsRows();
  const note = document.getElementById("goalsNote");
  if (note) note.textContent =
    `Measured at ${f.expectedReturnPct}% expected return on the target mix and ${f.inflationPct}% inflation. ${f.caveat}`;
}

function editGoal(g) {
  const set = (id, value) => { const e = document.getElementById(id); if (e) e.value = value ?? ""; };
  set("goalId", g.id); set("goalName", g.name); set("goalKind", g.kind || "portfolio");
  set("goalTarget", g.targetEur ?? ""); set("goalDate", g.targetDate ?? "");
  set("goalMonthly", g.monthlyEur ?? 0); set("goalBooks", (g.books || []).join(", "));
  set("goalPriority", g.priority ?? "");
  const form = document.getElementById("goalForm");
  if (form) { form.open = true; form.scrollIntoView({ block: "center" }); }
  const status = document.getElementById("goalStatus");
  if (status) status.textContent = `Editing "${g.name}". Change what you want and save.`;
}

let SAVINGS_ROWS = [];

async function loadSavingsRows() {
  if (!API) return;
  try {
    const out = await apiGet("/api/savings");
    SAVINGS_ROWS = out.rows || [];
  } catch (e) {
    SAVINGS_ROWS = [];
  }
  const picker = document.getElementById("depositLine");
  if (!picker) return;
  picker.innerHTML = "";
  for (const row of SAVINGS_ROWS) {
    picker.append(el("option", { value: String(row.row) },
      `${row.book} · ${row.name}${row.label ? " (" + row.label + ")" : ""} — ${fmtEur(row.valueEur)}`));
  }
  if (!SAVINGS_ROWS.length) {
    picker.append(el("option", { value: "" }, "no savings line found in the sheet"));
  }
}

async function recordDeposit() {
  const status = document.getElementById("depositStatus");
  const picker = document.getElementById("depositLine");
  const amount = parseFloat((document.getElementById("depositAmount") || {}).value);
  const row = SAVINGS_ROWS.find(r => String(r.row) === (picker || {}).value);
  if (!row) { status.textContent = "Pick the line the money went into."; return; }
  const mode = (document.getElementById("depositMode") || {}).value || "add";
  if (!(amount > 0) && !(mode === "set" && amount === 0)) {
    status.textContent = mode === "set" ? "What does the statement say?" : "How much went in?";
    return;
  }
  status.textContent = "Recording…";
  try {
    const response = await fetch("/api/savings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: row.row, name: row.name, book: row.book, amountEur: amount,
                             mode: (document.getElementById("depositMode") || {}).value || "add" }),
    });
    const out = await response.json();
    if (!response.ok) { status.textContent = out.error || `failed (${response.status})`; return; }
    status.textContent = out.what + " The goal updates at the next rebuild.";
    document.getElementById("depositAmount").value = "";
    loadSavingsRows();
  } catch (e) {
    status.textContent = "Read-only demo: deposits cannot be recorded here.";
  }
}

async function saveGoal() {
  const status = document.getElementById("goalStatus");
  const value = id => (document.getElementById(id) || {}).value || "";
  const body = {
    id: value("goalId").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: value("goalName").trim(),
    kind: value("goalKind"),
    targetEur: parseFloat(value("goalTarget")) || null,
    targetDate: value("goalDate") || null,
    monthlyEur: parseFloat(value("goalMonthly")) || 0,
    books: value("goalBooks").split(",").map(s => s.trim()).filter(Boolean),
    priority: parseInt(value("goalPriority"), 10) || 9,
  };
  if (!body.id) { status.textContent = "A goal needs a short id."; return; }
  status.textContent = "Saving…";
  try {
    const response = await fetch("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const out = await response.json();
    status.textContent = response.ok
      ? `Saved. ${out.goals.length} goal(s); the panel updates at the next rebuild.`
      : (out.error || `failed (${response.status})`);
  } catch (e) {
    status.textContent = "Read-only demo: goals cannot be edited here.";
  }
}

async function deleteGoal() {
  const status = document.getElementById("goalStatus");
  const id = ((document.getElementById("goalId") || {}).value || "").trim();
  if (!id) { status.textContent = "Which goal? Put its id in the box."; return; }
  const response = await fetch("/api/goals", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, delete: true }),
  });
  const out = await response.json();
  status.textContent = response.ok ? `Deleted. ${out.goals.length} left.` : (out.error || "failed");
}

function cashAtBrokers() {
  const books = Object.keys(DATA.bookViews || {}).filter(n => n !== "Combined" && n !== DATA.demoBook);
  const held = name => ((DATA.bookViews[name] || {}).holdings || [])
    .filter(h => h.symbol === "Cash" || h.ticker === "Cash").reduce((a, h) => a + (h.value_eur || 0), 0);
  const block = el("div", { class: "goal", style: "margin-top:16px" },
    el("div", { class: "goal-head" }, el("strong", {}, "Cash at the brokers"),
      el("span", { class: "muted" }, books.map(b => `${b} ${fmtEur(held(b))}`).join(" · "))),
    el("p", { class: "desk-line muted" },
      "Sale proceeds not yet reinvested. Counted in the book's value and as secured for the mortgage. " +
      "Recorded trades move it; set it here when the broker's figure differs."));
  if (API) {
    const status = el("span", { class: "muted", style: "margin-left:8px" });
    for (const b of books) {
      const input = el("input", { type: "number", step: "0.01", min: "0", value: held(b).toFixed(2),
                                  style: "width:120px", "aria-label": `${b} cash at brokers` });
      const save = el("button", { class: "desk-go", type: "button" }, "save");
      save.addEventListener("click", async () => {
        status.textContent = "saving…";
        try {
          const r = await fetch("/api/cash", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: b, eur: parseFloat(input.value) }) });
          const out = await r.json();
          if (!r.ok) throw new Error(out.error || r.status);
          status.textContent = `${b} set to ${fmtEur(out.cash.eur)} — rebuilding.`;
        } catch (e) { status.textContent = "Refused: " + e.message; }
      });
      block.append(el("div", { class: "controls", style: "margin-top:6px" },
        el("span", {}, `${b} €`), input, save));
    }

    const BROKERS = ["Kestrel", "Harbour", "Larch"];
    for (const b of books) {
      const inputs = BROKERS.map(name => el("input", { type: "number", step: "0.01", min: "0",
        placeholder: name, style: "width:110px", "aria-label": `${b} ${name} account total` }));
      const work = el("button", { class: "desk-go", type: "button" }, "work out cash");
      work.addEventListener("click", async () => {
        const totals = inputs.map(i => parseFloat(i.value) || 0);
        const sum = totals.reduce((a, x) => a + x, 0);
        const positions = ((DATA.bookViews[b] || {}).holdings || [])
          .filter(h => !["Cash", "Mortgage Deposit"].includes(h.ticker))
          .reduce((a, h) => a + (h.value_eur || 0), 0);
        const eur = Math.max(0, Math.round((sum - positions) * 100) / 100);
        if (!sum) { status.textContent = "Enter at least one broker total."; return; }
        if (!confirm(`${b}: brokers ${fmtEur(sum)} − positions ${fmtEur(positions)} = cash ${fmtEur(eur)}. Save it?`)) return;
        status.textContent = "saving…";
        try {
          const r = await fetch("/api/cash", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book: b, eur, note: "From broker totals: " +
              BROKERS.map((n, i) => `${n} ${totals[i].toFixed(2)}`).join(", ") }) });
          const out = await r.json();
          if (!r.ok) throw new Error(out.error || r.status);
          status.textContent = `${b} cash set to ${fmtEur(out.cash.eur)} — rebuilding.`;
        } catch (e) { status.textContent = "Refused: " + e.message; }
      });
      block.append(el("div", { class: "controls", style: "margin-top:6px" },
        el("span", { class: "muted" }, `${b}, from broker totals:`), inputs, work));
    }
    block.append(status);
  }
  return block;
}
