function committeeChip(score, why) {
  if (!ok(score)) return el("span", { class: "cscore" }, "–");
  const s = Math.max(-5, Math.min(5, Math.round(score)));
  const tone = s > 0 ? "up" : s < 0 ? "dn" : "";
  const attrs = { class: "cscore " + tone, title: why || "" };
  if (s) attrs.style = `--mix:${12 + Math.abs(s) * 10}%`;
  return el("span", attrs, (s > 0 ? "+" : "") + s);
}

const COMMITTEE_ACTION = { buy: "BUY", sell: "SELL", trim: "TRIM" };
const committeeAction = a => COMMITTEE_ACTION[a] || String(a || "").toUpperCase();

function committeeTrade(t) {
  return [el("strong", {}, committeeAction(t.action)), " ", tickerLink(t.ticker),
          ok(t.eur) ? " " + fmtEur(t.eur) : ""];
}

function renderCommittee() {
  const box = document.getElementById("committeeBox");
  if (!box) return;
  box.innerHTML = "";
  const c = (view() || {}).committee;
  if (!c || !(c.ideas || []).length) {
    box.append(el("p", { class: "muted" }, "The committee has not sat for this book yet."));
    return;
  }

  const members = c.members || [];
  const nameOf = id => (members.find(m => m.id === id) || {}).name || id || "";
  const cio = c.cio || {};

  box.append(el("div", { class: "demobox committee-label", role: "note" },
    el("strong", {}, c.label || "AI-assisted committee output on a fictional book"),
    " · rule-based members, no language model called · not investment advice"));

  const verb = { approve: "approves", amend: "amends", reject: "rejects" }[cio.decision] || "has not ruled";
  const final = c.final || [];
  box.append(el("div", { class: cio.decision === "reject" ? "warnbox" : "goodbox", style: "margin:0 0 16px" },
    el("div", { class: "muted" }, `The CIO ${verb}${c.asOf ? " — committee sat " + c.asOf : ""}` +
      (c.engine ? ` · members: ${c.engine}` : "") +
      (c.usage && ok(c.usage.costUsd) ? ` · ${c.usage.calls} calls, about $${c.usage.costUsd.toFixed(2)}` : "")),
    final.length
      ? el("ul", { style: "margin:6px 0 8px;padding-left:18px" },
          final.map(t => el("li", {}, committeeTrade(t), t.why ? el("span", { class: "muted" }, " — " + t.why) : null)))
      : el("p", { style: "margin:6px 0 8px" }, el("strong", {}, "No trade this time.")),
    cio.note ? el("div", {}, cio.note) : null,
    el("div", { class: "muted", style: "margin-top:6px" }, "A recommendation, not an order: the final call is yours.")));

  const cioWhy = {};
  for (const a of cio.approved || []) cioWhy[a.ideaId] = a.why;
  for (const r of cio.rejected || []) cioWhy[r.ideaId] = r.why;
  const statusCls = { approved: "pos", amended: "pos", rejected: "neg" };

  const ideas = [...c.ideas].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const rows = ideas.map(idea => ({

    cls: idea.status === "approved" || idea.status === "amended" ? "me" : "",
    cells: [
      { text: ok(idea.rank) ? String(idea.rank) : "–", cls: "muted" },
      { node: el("div", { class: "cidea" },
          el("div", {}, committeeTrade(idea), el("span", { class: "muted" }, " · " + nameOf(idea.author))),
          idea.thesis ? el("div", { class: "muted" }, idea.thesis) : null) },
      ...members.map(m => {
        if (m.id === idea.author) return { text: "—", cls: "muted" };
        const r = (idea.ratings || {})[m.id];
        return { node: r ? committeeChip(r.score, r.why) : el("span", { class: "muted" }, "–") };
      }),
      { node: el("span", { title: ok(idea.spread) ? `Spread of the scores: ${fmtNum(idea.spread)}` : "" },
          ok(idea.score) ? signed(idea.score) : "–") },
      { node: el("span", { class: statusCls[idea.status] || "muted", title: cioWhy[idea.id] || "" },
          idea.status || "–") },
    ],
  }));

  const headers = ["Rank", "Idea",
    ...members.map(m => el("span", { title: `${m.name} — ${m.lens || ""}` }, String(m.name || m.id).replace(/^The /, ""))),
    "Score", "Status"];

  box.append(el("div", { class: "tablewrap" },
    table(headers, rows, { stack: false })));

  box.append(el("details", { class: "working", style: "margin-top:16px" },
    el("summary", {}, "Who sits on the committee"),
    el("ul", { class: "cmembers" }, members.map(m => el("li", {},
      el("strong", {}, m.name || m.id), m.lens ? " — " + m.lens : "",
      m.style ? el("div", { class: "muted" }, m.style) : null)))));
  if (c.method) box.append(el("p", { class: "note", style: "padding:8px 0 0" }, c.method));
  if (c.caveat) box.append(el("p", { class: "note", style: "padding:4px 0 0" }, c.caveat));
}
