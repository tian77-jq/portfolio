/* =============================================================================
   data/projects.js —— 统一平台的项目注册表（转发给 data/projects.json）
   -----------------------------------------------------------------------------
   为什么这么写：
     hub.html 在 <script> 之后立刻读 window.PROJECTS，所以这里必须「同步」给出数据。
     真实项目数据只保留一份（data/projects.json），避免两处手改走形。
     读取失败时回退到极简清单，页面仍能渲染四个入口，不会空白。

   同时挂两件事（面试官点开就在真跑，不再是静态演示）：
     1) 把同源的 /api/* 请求转发到「当前可达的真后端」（data/live.js 里登记的地址）；
     2) 载入 assets/trial.js 挂件，右下角随时可切四个项目对话。
   ========================================================================== */
(function () {
  var fallback = [
    { id: "helan", name: "贺兰有灵", tag: "文旅 · 多 Agent", url: "product-helan.html", accent: "#7c9cff", tools: [], skills: [] },
    { id: "hengjian", name: "衡鉴", tag: "金融 · 财报核验", url: "product-hengjian.html", accent: "#d9b26a", tools: [], skills: [] },
    { id: "cement", name: "砼智销", tag: "工业 · 销售 Agent", url: "product-cement.html", accent: "#f0a35e", tools: [], skills: [] },
    { id: "researchos", name: "ResearchOS", tag: "科研 · 证据检索", url: "product-researchos.html", accent: "#3fd6b0", tools: [], skills: [] }
  ];
  try {
    var x = new XMLHttpRequest();
    x.open("GET", "data/projects.json", false);
    x.send(null);
    var d = JSON.parse(x.responseText);
    window.PROJECTS = (d && d.projects) || d || fallback;
  } catch (e) {
    window.PROJECTS = fallback;
  }
  if (!window.PROJECTS || !window.PROJECTS.length) { window.PROJECTS = fallback; }
})();
(function () {
  if (window.__HUB_SHIM__) { return; }
  window.__HUB_SHIM__ = true;
  var B = null, of = window.fetch.bind(window);
  function tk() {
    var m = (location.search.match(/[?&]k=([^&]+)/) || [])[1];
    if (m) { try { localStorage.setItem("hub_k", decodeURIComponent(m)); } catch (e) {} return decodeURIComponent(m); }
    try { return localStorage.getItem("hub_k") || ""; } catch (e) { return ""; }
  }
  function pb(b) {
    return fetch(b + "/health", { cache: "no-store" }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function rd() {
    if (B) { return Promise.resolve(B); }
    var L = window.HUB_LIVE || {}, cs = [];
    function push(u) { if (u) { u = String(u).replace(/\/+$/, ""); if (cs.indexOf(u) < 0) { cs.push(u); } } }
    try { push(localStorage.getItem("hub_api")); } catch (e) {}
    push(L.backend);
    (L.endpoints || []).forEach(push);
    if (!cs.length) { return Promise.resolve(null); }
    return Promise.all(cs.map(pb)).then(function (rs) {
      for (var i = 0; i < rs.length; i++) {
        if (rs[i]) { B = cs[i]; try { localStorage.setItem("hub_api", B); } catch (e) {} return B; }
      }
      return null;
    });
  }
  window.fetch = function (u, o) {
    var url = String((u && u.url) || u);
    if (url.indexOf("/api/") < 0) { return of(u, o); }
    return rd().then(function (b) {
      if (!b) { return of(u, o); }
      o = o || {};
      var h = o.headers || {}, nh = {};
      if (h && typeof h.forEach === "function" && typeof h.get === "function") { h.forEach(function (v, k) { nh[k] = v; }); }
      else { for (var k in h) { if (Object.prototype.hasOwnProperty.call(h, k)) { nh[k] = h[k]; } } }
      var t = tk(); if (t) { nh["X-Hub-Token"] = t; }
      o.headers = nh;
      return of(b + url, o);
    });
  };
  var s = document.createElement("script");
  s.src = "data/live.js";
  document.head.appendChild(s);
  function widget() {
    if (document.querySelector("script[data-trial]")) { return; }
    var w = document.createElement("script");
    w.src = "assets/trial.js"; w.setAttribute("data-trial", "1");
    document.body.appendChild(w);
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", widget); }
  else { widget(); }
})();
