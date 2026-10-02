/* Demo build.

   The full application has panels fed by live third-party data (news,
   analyst targets, betting markets, option chains, a model forecast) and by
   a private trade ledger (the advice record, the value history, the
   money-weighted return). None of that ships in the demo. These no-op stubs
   keep the remaining page code's call sites unchanged. */

const DEMO_BANNER = "Demo · synthetic data · not investment advice · not live performance";
const NEWS_LIVE = {};

/* Read-only and offline: the page may load its own relative files
   (data.json, vendor/...) and nothing else. Any absolute path or remote URL -
   the full application's /api/ calls - is refused before it leaves the
   browser, so the static export never talks to a server. */
(() => {
  const pageFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (/^(\/|[a-z]+:)/i.test(url)) {
      return Promise.reject(new Error("demo: network access is disabled (" + url + ")"));
    }
    return pageFetch(input, init);
  };
})();

function renderForecastModel() {}
function renderNews() {}
function loadNews() {}
function newsAutoRefresh() {}
function renderPrediction() {}
function renderOutside() {}
function renderValuation() {}
function trustedLine() { return null; }
function trustedBadge() { return null; }
function trustedDeskLine() { return null; }
function trackVerdictBox() { return null; }
function renderTrack() {}
function renderHistory() {}
function renderActual() {}
function renderMoneyWeighted() {}

/* Keyboard access: any horizontally scrolling table wrapper must be
   focusable so its overflow can be reached without a mouse. */
(() => {
  let queued = false;
  const mark = () => {
    queued = false;
    document.querySelectorAll(".tablewrap, .tscroll, .folded .body").forEach(n => {
      if (!n.hasAttribute("tabindex")) n.setAttribute("tabindex", "0");
    });
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(mark); } };
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
    queue();
  });
})();
