/* Minimal progressive enhancement: theme, mobile nav, on-load reveal, contact form. */
(function () {
  "use strict";

  var root = document.documentElement;
  var STORAGE_KEY = "theme";
  var THEMES = ["system", "light", "dark"];
  var LABELS = { system: "System", light: "Light", dark: "Dark" };

  /* ---------- Theme: light / dark / system ---------- */
  function readTheme() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      return stored === "light" || stored === "dark" ? stored : "system";
    } catch (e) {
      return "system";
    }
  }

  function applyTheme(theme) {
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      if (theme === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) { /* storage unavailable: theme still applies for this page */ }

    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < buttons.length; i++) {
      var next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      buttons[i].setAttribute("aria-label", "Colour theme: " + LABELS[theme] + ". Switch to " + LABELS[next]);
      var label = buttons[i].querySelector("[data-theme-label]");
      if (label) label.textContent = LABELS[theme];
      buttons[i].setAttribute("data-current", theme);
    }
  }

  var current = readTheme();
  applyTheme(current);
  document.addEventListener("click", function (event) {
    var btn = event.target.closest && event.target.closest("[data-theme-toggle]");
    if (!btn) return;
    current = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    applyTheme(current);
  });

  /* ---------- Mobile nav ---------- */
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = toggle && document.getElementById(toggle.getAttribute("aria-controls"));

  function setNav(open, returnFocus) {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    if (!open && returnFocus) toggle.focus();
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      setNav(toggle.getAttribute("aria-expanded") !== "true", false);
    });
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setNav(false, false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setNav(false, true);
      }
    });
    document.addEventListener("click", function (event) {
      if (toggle.getAttribute("aria-expanded") === "true" &&
          !nav.contains(event.target) && !toggle.contains(event.target)) {
        setNav(false, false);
      }
    });
    // Close if the viewport grows past the mobile breakpoint.
    var desktop = window.matchMedia("(min-width: 768px)");
    var onChange = function (e) { if (e.matches) setNav(false, false); };
    if (desktop.addEventListener) desktop.addEventListener("change", onChange);
  }

  /* ---------- Single on-load reveal ---------- */
  var reveal = document.querySelectorAll("[data-reveal]");
  for (var r = 0; r < reveal.length && r < 6; r++) reveal[r].style.setProperty("--i", r);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.add("is-loaded"); });
  });

  /* ---------- Contact form ---------- */
  var form = document.querySelector("[data-contact-form]");
  if (!form || !window.fetch || !window.FormData) return;

  var status = form.querySelector("[data-form-status]");
  var submit = form.querySelector("[type=submit]");
  var submitLabel = submit ? submit.textContent : "";
  var sending = false;

  var rules = {
    name: function (v) { return v.trim() ? "" : "Enter your name."; },
    email: function (v) {
      if (!v.trim()) return "Enter your email address.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "" : "Enter an email address like name@example.com.";
    },
    message: function (v) { return v.trim().length >= 10 ? "" : "Enter a message of at least 10 characters."; }
  };

  function showError(field, message) {
    var error = document.getElementById(field.id + "-error");
    if (message) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
    if (error) error.textContent = message;
  }

  function validate(field) {
    var rule = rules[field.name];
    if (!rule) return true;
    var message = rule(field.value);
    showError(field, message);
    return !message;
  }

  function setStatus(state, message) {
    status.setAttribute("data-state", state);
    status.textContent = message;
  }

  form.setAttribute("novalidate", "");

  form.addEventListener("blur", function (event) {
    var field = event.target;
    if (field.name in rules && field.value) validate(field);
  }, true);

  form.addEventListener("input", function (event) {
    var field = event.target;
    if (field.getAttribute("aria-invalid") === "true") validate(field);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (sending) return;

    var firstInvalid = null;
    Object.keys(rules).forEach(function (name) {
      var field = form.elements[name];
      if (field && !validate(field) && !firstInvalid) firstInvalid = field;
    });
    if (firstInvalid) {
      setStatus("error", "Please fix the highlighted fields and try again.");
      firstInvalid.focus();
      return;
    }

    sending = true;
    submit.setAttribute("aria-disabled", "true");
    submit.textContent = "Sending…";
    setStatus("pending", "Sending your message…");

    fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" }
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Request failed");
        form.reset();
        setStatus("success", "Thanks, your message has been sent. I'll reply by email.");
      })
      .catch(function () {
        setStatus("error", "Sorry, your message could not be sent. Please try again, or reach me on LinkedIn.");
      })
      .then(function () {
        sending = false;
        submit.removeAttribute("aria-disabled");
        submit.textContent = submitLabel;
      });
  });
})();
