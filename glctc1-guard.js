/* =====================================================================
   GLCTC1 GUARD v2 — community content filter for every page
   ---------------------------------------------------------------------
   Swearing is welcome on GLCTC1. Racism, hate, porn, child abuse and
   "kill yourself" style harassment are not.

   How it works: this file wraps the Supabase client the moment a page
   loads it, so EVERY post, chat message, comment, profile, booking,
   track title and file name is checked before it is saved — on every
   page, with no changes needed to the page code itself.

   Load it in <head> BEFORE the Supabase <script> tag:
     <script src="glctc1-guard.js"></script>

   To add or remove a blocked word, edit the lists below.
   The matching server-side lock is in glctc1-guard.sql.
   ===================================================================== */
(function () {
  "use strict";
  if (window.GLCTC1Guard) return;

  /* ---------- SETTINGS ---------- */
  var SUPABASE_URL = "https://zdlaloiruxamxsduxqxw.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkbGFsb2lydXhhbXhzZHV4cXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMTc3MTEsImV4cCI6MjEwMDg5MzcxMX0.m1MdepLYwqZuu3fGVzDfaFUkdW4rSsKt1Z85UDbpRBQ";
  var ADMIN_ID = "8c70a492-3cf1-4053-b0ee-b5b186529d54";
  /* Nudity scanner (NSFWJS, runs in the visitor's browser — files are never sent anywhere to be checked) */
  var SCANNER_URLS = ["https://cdn.jsdelivr.net/npm/nsfwjs@4.4.0/+esm", "https://esm.sh/nsfwjs@4.4.0"];
  var NUDITY_LIMITS = { Porn: 0.5, Hentai: 0.5, Sexy: 0.8 };   /* lower = stricter */
  var VIDEO_FRAMES_MAX = 12;                                   /* frames checked per video */
  /* If the scanner can't load (very rare), true = refuse the photo/video, false = let it through */
  var BLOCK_IF_SCANNER_FAILS = true;

  /* ---------- BLOCK LISTS (regular expressions, matched as whole words) ---------- */
  var RULES = [
    { why: "racism or hate", list: [
      "nigg+(?:a|ah|az|as|er|ers|uh|ur|ahs)", "nig+nogs?", "jigg?aboos?", "jungle ?bunn(?:y|ies)", "porch ?monkeys?",
      "coons?", "darkies?", "sambos?", "golliwogs?", "wogs?", "pakis?", "chinks?", "chinky", "gooks?",
      "zipperheads?", "spics?", "spicks?", "wetbacks?", "beaners?", "kikes?", "ragheads?", "towel ?heads?",
      "sand ?nigg+(?:er|a)s?", "kaffirs?", "pikeys?", "gyppos?", "gypos?", "half ?castes?",
      "faggots?", "trann(?:y|ies)",
      "heil hitler", "sieg heil", "white power", "white pride", "1488", "14 88", "88 14",
      "gas the jews", "kill all (?:jews|muslims|blacks|gays|asians|whites|christians|arabs|immigrants|trans)",
      "kkk", "ku klux klan"
    ]},
    { why: "porn or sexual content", list: [
      "porn", "porno", "pornos", "pornography", "pornhub", "xvideos", "xhamster", "xnxx", "redtube", "youporn",
      "brazzers", "onlyfans", "chaturbate", "stripchat", "spankbang", "rule ?34", "hentai",
      "nudes", "send nudes", "sex ?tapes?", "blow ?jobs?", "hand ?jobs?", "cum ?shots?", "cream ?pies?",
      "gang ?bangs?", "bukkake", "deep ?throat(?:ing)?", "milfs?", "cam ?girls?", "escort services?"
    ]},
    { why: "child abuse", list: [
      "pedos?", "paedos?", "pedophil(?:e|es|ia)", "paedophil(?:e|es|ia)", "jail ?bait", "loli", "lolis", "lolicon",
      "shotacon", "pthc", "child porn", "kiddie porn", "underage (?:sex|nudes?|porn)"
    ]},
    { why: "harassment", list: [ "kill yourself", "kill urself", "kys", "neck yourself" ]}
  ];
  /* Website addresses that are always blocked (porn sites), even inside links */
  var BLOCKED_DOMAINS = /(?:^|[^a-z0-9])(?:pornhub|xvideos|xhamster|xnxx|redtube|youporn|brazzers|onlyfans|chaturbate|stripchat|spankbang|rule34)\.[a-z]{2,}/i;

  var COMPILED = RULES.map(function (r) {
    return { why: r.why, re: new RegExp("(?:^|[^a-z0-9])(?:" + r.list.join("|") + ")(?=$|[^a-z0-9])", "i") };
  });

  /* ---------- NORMALISE: catches n1gg3r, n.i.g.g.e.r, Ｐｏｒｎ, accents, hidden characters ---------- */
  var LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i", "€": "e" };
  function normalise(text) {
    var t = String(text);
    try { t = t.normalize("NFKD"); } catch (e) {}
    t = t.replace(/[̀-ͯ​-‏⁠﻿­]/g, "").toLowerCase();
    return t;
  }
  function deLeet(t) { return t.replace(/[0134578@$!|€]/g, function (c) { return LEET[c] || c; }); }
  function variants(text) {
    var base = normalise(text);
    var out = [base];
    var leet = deLeet(base);
    if (leet !== base) out.push(leet);
    /* spaced-out letters: "n i g g e r", "p.o.r.n" -> joined */
    [base, leet].forEach(function (v) {
      var joined = v.replace(/(?:^|[^a-z])((?:[a-z][\s._\-*+~,'"]+){2,}[a-z])(?=$|[^a-z])/g, function (m, seq) {
        return " " + seq.replace(/[^a-z]/g, "") + " ";
      });
      if (joined !== v) out.push(joined);
    });
    /* words smashed together with symbols in between: "p*o*r*n" handled above; "porn_hub" etc */
    out.push(leet.replace(/[_*.\-]+/g, ""));
    return out;
  }

  function checkText(text) {
    if (text == null) return null;
    var s = String(text);
    if (!s.trim()) return null;
    if (BLOCKED_DOMAINS.test(s)) return "porn or sexual content";
    var vs = variants(s);
    for (var i = 0; i < COMPILED.length; i++) {
      for (var j = 0; j < vs.length; j++) {
        if (COMPILED[i].re.test(vs[j])) return COMPILED[i].why;
      }
    }
    return null;
  }

  /* Walk any value (object, array, string) and return the first problem found */
  function checkValue(v, depth) {
    depth = depth || 0;
    if (depth > 6 || v == null) return null;
    if (typeof v === "string") return checkText(v);
    if (typeof File !== "undefined" && v instanceof File) return checkText(v.name);
    if (typeof Blob !== "undefined" && v instanceof Blob) return null;
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return null;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) { var r = checkValue(v[i], depth + 1); if (r) return r; }
      return null;
    }
    if (typeof v === "object") {
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        var r2 = checkValue(v[k], depth + 1); if (r2) return r2;
      }
    }
    return null;
  }

  /* ---------- MESSAGE ON SCREEN ---------- */
  function message(why) {
    return "🚫 GLCTC1: this can't be posted — " + why + " isn't allowed here. Swearing is fine; hate, porn and abuse aren't.";
  }
  function toast(why) { toastText(message(why)); }
  function toastText(text) {
    try {
      var id = "glctc1GuardToast", el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.setAttribute("role", "alert");
        el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:min(92vw,560px);padding:14px 18px;border-radius:14px;border:1px solid #ff5470;background:#1a0b10;color:#ffe3e8;font:600 14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 10px 40px #000a,0 0 24px #ff547055;text-align:center";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = text;
      el.style.display = "block";
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.style.display = "none"; }, 6000);
    } catch (e) {}
  }

  /* A fake Supabase result that says "blocked" and works with .select().single() etc */
  function blockedResult(why) {
    var res = { data: null, error: { message: message(why), code: "GLCTC1_BLOCKED", details: why, hint: "" }, count: null, status: 400, statusText: "Blocked by GLCTC1" };
    var p;
    var handler = {
      get: function (t, k) {
        if (k === "then") return function (a, b) { return Promise.resolve(res).then(a, b); };
        if (k === "catch") return function (f) { return Promise.resolve(res).catch(f); };
        if (k === "finally") return function (f) { return Promise.resolve(res).finally(f); };
        return function () { return p; };
      }
    };
    p = new Proxy(function () {}, handler);
    return p;
  }

  /* ---------- NUDITY SCANNER (photos & video) ---------- */
  function isMedia(f) {
    return !!(f && typeof Blob !== "undefined" && f instanceof Blob && /^(image|video)\//i.test(f.type || ""));
  }
  var modelPromise = null, injectedModel = null;
  function loadScanner() {
    if (injectedModel) return Promise.resolve(injectedModel);
    if (!modelPromise) {
      modelPromise = (async function () {
        var lastErr;
        for (var i = 0; i < SCANNER_URLS.length; i++) {
          try {
            var mod = await import(SCANNER_URLS[i]);
            var lib = (mod && typeof mod.load === "function") ? mod : (mod && mod.default) || mod;
            return await lib.load();          /* bundled MobileNetV2 model */
          } catch (e) { lastErr = e; console.warn("GLCTC1 Guard: scanner source failed", SCANNER_URLS[i], e); }
        }
        throw lastErr || new Error("scanner unavailable");
      })();
      modelPromise.catch(function () { modelPromise = null; });
    }
    return modelPromise;
  }
  function isNude(preds) {
    var flagged = false;
    (preds || []).forEach(function (p) {
      var lim = NUDITY_LIMITS[p.className];
      if (lim != null && p.probability >= lim) flagged = true;
    });
    return flagged;
  }
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]);
  }
  async function scanImage(model, file) {
    var url = URL.createObjectURL(file);
    try {
      var img = new Image();
      img.src = url;
      await withTimeout(img.decode ? img.decode() : new Promise(function (r, j) { img.onload = r; img.onerror = j; }), 15000);
      return isNude(await model.classify(img));
    } finally { URL.revokeObjectURL(url); }
  }
  async function scanVideo(model, file) {
    var url = URL.createObjectURL(file);
    var v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    try {
      await withTimeout(new Promise(function (r, j) { v.onloadeddata = r; v.onerror = j; }), 20000);
      var d = isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      var n = Math.max(3, Math.min(VIDEO_FRAMES_MAX, Math.ceil(d / 5)));
      var c = document.createElement("canvas");
      var w = v.videoWidth || 224, h = v.videoHeight || 224, scale = Math.min(1, 448 / Math.max(w, h));
      c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
      var ctx = c.getContext("2d");
      for (var i = 0; i < n; i++) {
        var t = Math.min(d - 0.05, (d * (i + 0.5)) / n);
        await withTimeout(new Promise(function (r) { v.onseeked = r; v.currentTime = Math.max(0, t); }), 8000);
        ctx.drawImage(v, 0, 0, c.width, c.height);
        if (isNude(await model.classify(c))) return true;
      }
      return false;
    } finally { v.removeAttribute("src"); v.load && v.load(); URL.revokeObjectURL(url); }
  }
  async function scanFile(file) {
    var kind = /^video\//i.test(file.type) ? "video" : "photo";
    note("🔎 Checking your " + kind + "…");
    try {
      var model = await loadScanner();
      var nude = kind === "video" ? await scanVideo(model, file) : await scanImage(model, file);
      hideNote();
      return nude ? { blocked: true, why: "nudity or porn" } : { blocked: false };
    } catch (e) {
      console.warn("GLCTC1 Guard: could not scan " + kind, e);
      hideNote();
      if (BLOCK_IF_SCANNER_FAILS) return { blocked: true, why: "an unchecked " + kind + " (the safety scanner couldn't run — please try again)" };
      return { blocked: false };
    }
  }
  function note(text) {
    try {
      var el = document.getElementById("glctc1GuardNote");
      if (!el) {
        el = document.createElement("div");
        el.id = "glctc1GuardNote";
        el.setAttribute("role", "status");
        el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483646;padding:12px 18px;border-radius:999px;border:1px solid #38e8ff;background:#07131a;color:#c9f6ff;font:600 14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 10px 30px #000a";
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = text; el.style.display = "block";
    } catch (e) {}
  }
  function hideNote() { var el = document.getElementById("glctc1GuardNote"); if (el) el.style.display = "none"; }

  /* ---------- 🚩 REPORTS ---------- */
  var REASONS = ["Racism or hate", "Nudity or porn", "Child safety", "Harassment or threats", "Stolen music / copyright", "Spam or scam", "Something else"];
  var reportClient = null;
  function getReportClient() {
    if (reportClient) return reportClient;
    if (!current || typeof current.createClient !== "function") return null;
    reportClient = current.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return reportClient;
  }
  function evalExpr(expr) {
    try { return (0, eval)(expr); } catch (e) { return null; }
  }
  function reportStyles() {
    if (document.getElementById("glctc1ReportCss")) return;
    var st = document.createElement("style");
    st.id = "glctc1ReportCss";
    st.textContent =
      ".glctc1-flag{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;margin:4px 0 0 6px;padding:2px 8px;border:1px solid #4a2a33;border-radius:999px;font:600 11px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.04em;color:#ff9db0;background:#1a0d12;cursor:pointer;opacity:.75;vertical-align:middle}" +
      ".glctc1-flag:hover,.glctc1-flag:focus-visible{opacity:1;border-color:#ff5470;outline:none}" +
      "#glctc1ReportModal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:#000b}" +
      "#glctc1ReportModal .box{width:min(440px,100%);max-height:92vh;overflow:auto;padding:20px;border:1px solid #ff5470;border-radius:16px;background:#0d0e14;color:#f4f1e8;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 20px 60px #000}" +
      "#glctc1ReportModal h3{margin:0 0 4px;font-size:17px;letter-spacing:.08em}" +
      "#glctc1ReportModal .pv{margin:8px 0 12px;padding:8px 10px;border-left:3px solid #ff5470;background:#16171f;color:#bdb9c8;font-size:13px;max-height:80px;overflow:hidden;white-space:pre-wrap;word-break:break-word}" +
      "#glctc1ReportModal label{display:flex;gap:8px;align-items:center;padding:7px 4px;cursor:pointer}" +
      "#glctc1ReportModal textarea{width:100%;min-height:64px;margin-top:8px;padding:10px;border:1px solid #34364a;border-radius:10px;background:#07080b;color:#f4f1e8;font:inherit;box-sizing:border-box}" +
      "#glctc1ReportModal .row{display:flex;gap:8px;margin-top:12px}" +
      "#glctc1ReportModal button.b{flex:1;padding:11px;border-radius:999px;border:1px solid #34364a;background:#16171f;color:#f4f1e8;font:700 13px system-ui;letter-spacing:.08em;cursor:pointer}" +
      "#glctc1ReportModal button.go{background:#ff5470;border-color:#ff5470;color:#fff}" +
      "#glctc1ReportModal .msg{margin-top:10px;font-size:13px;color:#ffb3c1;min-height:18px}";
    document.head.appendChild(st);
  }
  function openReport(table, id, preview) {
    if (!id) { toastText("🚩 Pick the item first, then press Report."); return; }
    reportStyles();
    var old = document.getElementById("glctc1ReportModal"); if (old) old.remove();
    var m = document.createElement("div");
    m.id = "glctc1ReportModal";
    m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "Report");
    var box = document.createElement("div"); box.className = "box";
    box.innerHTML = '<h3>🚩 REPORT</h3><div style="font-size:13px;color:#a6a4ad">Tell GLCTC1 what’s wrong. Reports are private.</div>';
    var pv = document.createElement("div"); pv.className = "pv"; pv.textContent = (preview || "").slice(0, 300) || "(no preview)";
    box.appendChild(pv);
    REASONS.forEach(function (r, i) {
      var l = document.createElement("label");
      var inp = document.createElement("input"); inp.type = "radio"; inp.name = "glctc1Reason"; inp.value = r; if (i === 0) inp.checked = true;
      l.appendChild(inp); l.appendChild(document.createTextNode(r)); box.appendChild(l);
    });
    var ta = document.createElement("textarea"); ta.maxLength = 500; ta.placeholder = "Anything else we should know? (optional)"; box.appendChild(ta);
    var row = document.createElement("div"); row.className = "row";
    var cancel = document.createElement("button"); cancel.className = "b"; cancel.type = "button"; cancel.textContent = "CANCEL";
    var send = document.createElement("button"); send.className = "b go"; send.type = "button"; send.textContent = "SEND REPORT";
    row.appendChild(cancel); row.appendChild(send); box.appendChild(row);
    var msg = document.createElement("div"); msg.className = "msg"; box.appendChild(msg);
    m.appendChild(box); document.body.appendChild(m);
    function close() { m.remove(); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", esc);
    m.addEventListener("click", function (e) { if (e.target === m) close(); });
    cancel.addEventListener("click", close);
    send.addEventListener("click", async function () {
      var reason = (box.querySelector('input[name="glctc1Reason"]:checked') || {}).value || "Something else";
      var key = "glctc1Reported:" + table + ":" + id;
      try { if (localStorage.getItem(key)) { msg.textContent = "You've already reported this — thank you."; return; } } catch (e) {}
      var sb = getReportClient();
      if (!sb) { msg.textContent = "Reporting isn't available on this page."; return; }
      send.disabled = true; send.textContent = "SENDING…";
      var res = await sb.from("glctc1_reports").insert({
        page: (location.pathname.split("/").pop() || "index.html"),
        page_url: location.href.slice(0, 500),
        item_table: String(table).slice(0, 80),
        item_id: String(id).slice(0, 200),
        item_preview: String(preview || "").slice(0, 1000),
        reason: reason,
        details: ta.value.slice(0, 500)
      });
      if (res && res.error) {
        send.disabled = false; send.textContent = "SEND REPORT";
        msg.textContent = "Couldn't send the report: " + (res.error.message || "please try again") + (/relation|does not exist|schema cache/i.test(res.error.message || "") ? " (reports table not set up yet)" : "");
        return;
      }
      try { localStorage.setItem(key, "1"); } catch (e) {}
      box.innerHTML = '<h3>✔ THANK YOU</h3><p style="color:#cfcbd8">Your report has been sent to GLCTC1 and will be reviewed.</p>';
      setTimeout(close, 1800);
    });
    setTimeout(function () { send.focus(); }, 30);
  }
  function previewOf(el) {
    if (!el) return "";
    var t = (el.innerText || el.textContent || "").replace(/🚩\s*Report/g, "").replace(/\s+/g, " ").trim();
    return t.slice(0, 500);
  }
  /* Any element with data-report-table + data-report-id gets a 🚩 button automatically */
  function attachFlags(root) {
    if (!root || !root.querySelectorAll) return;
    var list = root.matches && root.matches("[data-report-table][data-report-id]") ? [root] : [];
    list = list.concat([].slice.call(root.querySelectorAll("[data-report-table][data-report-id]")));
    list.forEach(function (el) {
      if (el.__glctc1Flag || !el.getAttribute("data-report-id")) return;
      if (el.querySelector(":scope > .glctc1-flag")) { el.__glctc1Flag = true; return; }
      el.__glctc1Flag = true;
      reportStyles();
      var b = document.createElement("button");
      b.type = "button"; b.className = "glctc1-flag"; b.textContent = "🚩 Report"; b.title = "Report this"; b.setAttribute("aria-label", "Report this");
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        openReport(el.getAttribute("data-report-table"), el.getAttribute("data-report-id"), previewOf(el));
      });
      el.appendChild(b);
    });
  }
  /* Buttons placed in the page: <button data-glctc1-report="table" data-id="…"> or data-glctc1-id-expr="selectedRecord&&selectedRecord.id" */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("[data-glctc1-report]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var table = b.getAttribute("data-glctc1-report");
    var id = b.getAttribute("data-id") || (b.getAttribute("data-glctc1-id-expr") ? evalExpr(b.getAttribute("data-glctc1-id-expr")) : null);
    var pvExpr = b.getAttribute("data-glctc1-preview-expr");
    var host = b.closest("[data-report-host]") || b.closest("article") || b.parentElement;
    var preview = (pvExpr ? evalExpr(pvExpr) : null) || b.getAttribute("data-preview") || previewOf(host);
    openReport(table, id, preview);
  }, true);
  function startFlags() {
    attachFlags(document.body);
    try {
      new MutationObserver(function (muts) {
        muts.forEach(function (mu) { mu.addedNodes && [].forEach.call(mu.addedNodes, function (n) { if (n.nodeType === 1) attachFlags(n); }); });
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startFlags); else startFlags();

  /* ---------- WRAP SUPABASE ---------- */
  function wrapQuery(qb, table) {
    if (!qb || qb.__glctc1) return qb;
    if (table === "glctc1_reports") return qb;   /* reports may quote what was reported */
    ["insert", "update", "upsert"].forEach(function (m) {
      if (typeof qb[m] !== "function") return;
      var orig = qb[m];
      qb[m] = function (values) {
        var why = checkValue(values);
        if (why) { toast(why); console.warn("GLCTC1 Guard blocked a save:", why); return blockedResult(why); }
        return orig.apply(qb, arguments);
      };
    });
    try { Object.defineProperty(qb, "__glctc1", { value: true }); } catch (e) {}
    return qb;
  }
  function wrapBucket(b) {
    if (!b || b.__glctc1) return b;
    ["upload", "update"].forEach(function (m) {
      if (typeof b[m] !== "function") return;
      var orig = b[m];
      b[m] = function (path, file) {
        var args = arguments;
        var why = checkText(path) || (file && file.name ? checkText(file.name) : null);
        if (why) { toast(why); return Promise.resolve({ data: null, error: { message: message(why), statusCode: "400" } }); }
        if (!isMedia(file)) return orig.apply(b, args);
        return scanFile(file).then(function (res) {
          if (res.blocked) {
            toast(res.why);
            return { data: null, error: { message: message(res.why), statusCode: "400" } };
          }
          return orig.apply(b, args);
        });
      };
    });
    try { Object.defineProperty(b, "__glctc1", { value: true }); } catch (e) {}
    return b;
  }
  function wrapStorage(st) {
    if (!st || st.__glctc1 || typeof st.from !== "function") return st;
    var orig = st.from;
    st.from = function () { return wrapBucket(orig.apply(st, arguments)); };
    try { Object.defineProperty(st, "__glctc1", { value: true }); } catch (e) {}
    return st;
  }
  function findDescriptor(obj, key) {
    var o = obj;
    while (o) { var d = Object.getOwnPropertyDescriptor(o, key); if (d) return d; o = Object.getPrototypeOf(o); }
    return null;
  }
  function wrapClient(client) {
    if (!client || client.__glctc1) return client;
    if (typeof client.from === "function") {
      var origFrom = client.from;
      client.from = function (t) { return wrapQuery(origFrom.apply(client, arguments), t); };
    }
    var d = findDescriptor(client, "storage");
    if (d && d.get) {
      Object.defineProperty(client, "storage", { configurable: true, get: function () { return wrapStorage(d.get.call(client)); } });
    } else if (client.storage) {
      wrapStorage(client.storage);
    }
    try { Object.defineProperty(client, "__glctc1", { value: true }); } catch (e) {}
    return client;
  }
  function wrapLib(lib) {
    if (!lib || lib.__glctc1 || typeof lib.createClient !== "function") return lib;
    var origCreate = lib.createClient;
    var wrapped;
    try {
      wrapped = Object.create(lib);
      Object.getOwnPropertyNames(lib).forEach(function (k) { try { wrapped[k] = lib[k]; } catch (e) {} });
    } catch (e) { wrapped = lib; }
    wrapped.createClient = function () { return wrapClient(origCreate.apply(lib, arguments)); };
    try { Object.defineProperty(wrapped, "__glctc1", { value: true }); } catch (e) {}
    return wrapped;
  }

  /* Catch the Supabase library whenever it arrives on the page */
  var current = window.supabase ? wrapLib(window.supabase) : undefined;
  try {
    Object.defineProperty(window, "supabase", {
      configurable: true,
      get: function () { return current; },
      set: function (v) { current = wrapLib(v); }
    });
  } catch (e) {
    if (window.supabase) window.supabase = wrapLib(window.supabase);
  }

  window.GLCTC1Guard = {
    version: 2,
    check: checkText,
    checkValue: checkValue,
    wrapClient: wrapClient,
    scanFile: scanFile,
    loadScanner: loadScanner,
    report: openReport,
    client: getReportClient,
    adminId: ADMIN_ID,
    _setScanner: function (m) { injectedModel = m; }   /* testing only */
  };
})();

