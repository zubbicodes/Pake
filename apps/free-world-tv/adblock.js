/*
 * Free World TV - ad and pop-up blocker (injected with Pake --inject).
 * 1. Stops known ad-network scripts and iframes from loading.
 * 2. Blocks window.open / link clicks / frame links that would send the user
 *    to an outside site in the system browser (pop-unders), except a small
 *    allowlist of real destinations (share buttons, YouTube trailers).
 */
(function () {
  if (window.__FWTV_ADBLOCK__) return;
  window.__FWTV_ADBLOCK__ = true;

  var AD_PATTERNS = [
    "al5sm.com",
    "tag.min.js",
    "monetag",
    "popads",
    "popcash",
    "adnxs",
    "doubleclick",
    "googlesyndication",
    "adservice",
    "pagead2",
    "propellerads",
    "adsterra",
    "hilltopads",
    "trafficjunky",
    "exoclick",
    "juicyads",
    "adcash",
    "revcontent",
    "mgid",
    "taboola",
    "outbrain",
    "popunder",
    "clickadu",
    "adfly",
    "adf.ly",
    "shorte.st",
    "ouo.io",
    "bc.vc",
    "linkvertise",
    "admaven",
    "popcornads",
    "popnads",
    "onclicka",
    "onclckads",
    "highperformanceformat",
    "effectivecpm",
    "profitablecpm",
    "profitableratecpm",
    "displayvertising",
    "a-ads",
    "bidgear",
    "adskeeper",
    "galaksion",
    "richpartners",
    "pushame",
    "notix",
    "realsrv",
    "tsyndicate",
  ];

  // Outside sites that may still open in the browser when clicked.
  var ALLOW_EXTERNAL = [
    "twitter.com",
    "x.com",
    "api.whatsapp.com",
    "wa.me",
    "youtube.com",
    "youtu.be",
  ];

  function hostOf(raw) {
    try {
      return new URL(String(raw), document.baseURI).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  }
  function hostMatches(host, list) {
    return list.some(function (d) {
      return host === d || host.slice(-(d.length + 1)) === "." + d;
    });
  }
  function isAd(raw) {
    if (!raw) return false;
    var s = String(raw).toLowerCase();
    return AD_PATTERNS.some(function (p) {
      return s.indexOf(p) !== -1;
    });
  }
  var homeHost = (function () {
    try {
      var cfg = window.pakeConfig || {};
      return new URL(
        cfg.url || window.top.location.href,
      ).hostname.toLowerCase();
    } catch (e) {
      return "mlwbd-newsite.blogspot.com";
    }
  })();
  // true when opening this URL should be blocked
  function shouldBlockOpen(raw) {
    if (raw == null) return false;
    var s = String(raw).trim();
    if (
      !s ||
      s.charAt(0) === "#" ||
      /^(about:|javascript:|blob:|data:)/i.test(s)
    ) {
      return false;
    }
    if (isAd(s)) return true;
    var host = hostOf(s);
    if (!host) return false;
    if (host === homeHost || hostMatches(host, ALLOW_EXTERNAL)) return false;
    if (window === window.top && host === location.hostname) return false;
    return true; // any other outside destination = pop-up ad
  }
  function log(what, url) {
    try {
      console.info("[FWTV adblock] blocked " + what + ":", url);
    } catch (e) {}
  }

  // --- 1. Neuter ad scripts / iframes before they load -----------------------
  function guardSrc(proto, prop) {
    try {
      var desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          if (isAd(v)) {
            log(prop, v);
            return;
          }
          return desc.set.call(this, v);
        },
      });
    } catch (e) {}
  }
  guardSrc(HTMLScriptElement.prototype, "src");
  guardSrc(HTMLIFrameElement.prototype, "src");

  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var n = String(name).toLowerCase();
    if (
      n === "src" &&
      (this instanceof HTMLScriptElement ||
        this instanceof HTMLIFrameElement) &&
      isAd(value)
    ) {
      log("attr", value);
      return;
    }
    return origSetAttribute.call(this, name, value);
  };

  function sweep(node) {
    if (!node || node.nodeType !== 1) return;
    var tag = node.tagName;
    if (
      (tag === "SCRIPT" || tag === "IFRAME") &&
      isAd(node.getAttribute("src"))
    ) {
      node.remove();
      return;
    }
    if (node.querySelectorAll) {
      node.querySelectorAll("script[src], iframe[src]").forEach(function (el) {
        if (isAd(el.getAttribute("src"))) el.remove();
      });
    }
  }
  try {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(sweep);
      });
    }).observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  } catch (e) {}

  // --- 2. Block pop-up windows to outside sites -------------------------------
  function fakeWindow() {
    // Ad scripts often check the return value; give them a harmless dummy.
    return {
      closed: true,
      opener: null,
      close: function () {},
      focus: function () {},
      blur: function () {},
      postMessage: function () {},
      document: { write: function () {}, close: function () {} },
      location: { href: "", replace: function () {}, assign: function () {} },
    };
  }
  function wrapOpen() {
    var current = window.open;
    if (current && current.__fwtv) return;
    var wrapped = function (url) {
      if (shouldBlockOpen(url)) {
        log("window.open", url);
        return fakeWindow();
      }
      return current.apply(window, arguments);
    };
    wrapped.__fwtv = true;
    try {
      window.open = wrapped;
    } catch (e) {}
  }
  wrapOpen();
  // Pake re-wraps window.open on DOMContentLoaded; wrap again on top of it.
  document.addEventListener("DOMContentLoaded", function () {
    wrapOpen();
    setTimeout(wrapOpen, 0);
  });
  window.addEventListener("load", wrapOpen);

  // Link clicks (including invisible full-page click-jack anchors).
  function onClick(e) {
    var t = e.target;
    var a = t && t.closest ? t.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (shouldBlockOpen(href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      log("link", href);
    }
  }
  window.addEventListener("click", onClick, true);
  window.addEventListener("auxclick", onClick, true);

  // Links that embedded players forward to the main window.
  if (window === window.top) {
    window.addEventListener(
      "message",
      function (e) {
        var d = e.data;
        if (
          d &&
          d.type === "pake:frame-external-link" &&
          shouldBlockOpen(d.url)
        ) {
          e.stopImmediatePropagation();
          log("frame link", d.url);
        }
      },
      true,
    );
  }

  // --- 3. Hide leftover ad containers ----------------------------------------
  var css =
    'iframe[src*="al5sm"],iframe[src*="adsterra"],iframe[src*="popads"],' +
    'iframe[src*="doubleclick"],iframe[src*="googlesyndication"],' +
    'ins.adsbygoogle,[id^="google_ads"]' +
    "{display:none!important;visibility:hidden!important}";
  function addCss() {
    try {
      var st = document.createElement("style");
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }
  if (document.head || document.documentElement) addCss();
  else document.addEventListener("DOMContentLoaded", addCss);
})();
