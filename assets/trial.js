/* =============================================================================
   assets/trial.js —— 「真后端 · 即时试用」挂件
   -----------------------------------------------------------------------------
   为什么要有这个文件：
     作品集站点托管在 GitHub Pages 上，只能发静态文件；四个 Agent 的 adapter
     是跑在本机的 Python 进程。挂件负责把页面上的对话请求送到「当前可达的真
     后端」，并在拿不到后端时如实说明，绝不用静态样例冒充真实回答。

   后端发现顺序（逐级探活 GET /health，第一个 200 的胜出）：
     1) 链接参数 ?api=https://xxx
     2) 上次探活成功记在 localStorage 的地址
     3) data/live.js 里的 window.HUB_LIVE.backend / .endpoints
     4) 页面自身同源（当页面就由本机网关托管时）
     5) http://127.0.0.1:8250（本机直接打开时）

   协议契约（与 server/hub_server.py 一致，不随前端改）：
     请求  POST {base}/api/chat  {"project","message","protocol"}
     回包  {answer, tool, latency_ms, evidence, data}
     口令  HUB_PUBLIC_TOKEN 存在时需带 X-Hub-Token（链接 ?k=... 或 localStorage）

   用法：任意页面加一行 <script src="assets/trial.js"></script>，无需传参——
   挂件按文件名自动认领项目（product-helan.html → helan），非项目页给选择器。
   ========================================================================== */
(function () {
  "use strict";
  if (window.__HUB_TRIAL__) { return; }
  window.__HUB_TRIAL__ = true;

  var PROJECTS = {
    helan: {
      name: "贺兰有灵", sub: "文旅 · 多 Agent 行程规划", accent: "#7c9cff",
      blurb: "一句话说出偏好，出三天动线、预算与地理可达性校验，带出处的文化解说。",
      presets: [
        "银川 3 天，带老人，预算 3000，想看西夏陵和沙湖",
        "这些景点的门票和开放时间可靠吗",
        "沙湖不在银川吧？那还能排进去吗"
      ]
    },
    hengjian: {
      name: "衡鉴", sub: "金融 · 财报核验", accent: "#d9b26a",
      blurb: "把年报里的数字追溯到原文位置，冲突不代签，复核留痕。",
      presets: [
        "核一下这份年报样例的营收和研发费用",
        "这个数字追溯到 PDF 哪一页",
        "帮我看看哪几条不该采信"
      ]
    },
    cement: {
      name: "砼智销", sub: "工业 · 销售 Agent", accent: "#f0a35e",
      blurb: "客户说一句工地情况，出可落库的询价草稿：缺什么信息、按什么口径算。",
      presets: [
        "银川，120 平住宅建房，砌筑抹灰，帮我报个价",
        "银川 200 平自建房，主体砌筑，报个价",
        "这单如果中途崩了，能接着算吗"
      ]
    },
    researchos: {
      name: "ResearchOS", sub: "科研 · 证据检索", accent: "#3fd6b0",
      blurb: "带出处的证据检索与门禁：证据分级、可追溯、不通过就明说。",
      presets: [
        "水泥行业有哪些可用的证据类型",
        "医疗影像方向有哪些证据类型",
        "这条结论的证据能通过门禁吗"
      ]
    }
  };

  var ORDER = ["helan", "hengjian", "cement", "researchos"];
  var CSS = [
    ".ht-fab{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:inline-flex;align-items:center;gap:9px;",
    "padding:12px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.18);cursor:pointer;",
    "background:linear-gradient(135deg,#232544,#15172c);color:#eceaf7;font:600 14px/1 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;",
    "box-shadow:0 10px 30px rgba(0,0,0,.42);transition:transform .18s ease,box-shadow .18s ease}",
    ".ht-fab:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.5)}",
    ".ht-fab .ht-dot{width:8px;height:8px;border-radius:50%;background:#8b8aa8;box-shadow:0 0 0 3px rgba(139,138,168,.18)}",
    ".ht-fab[data-state='ok'] .ht-dot{background:#6ee7a8;box-shadow:0 0 0 3px rgba(110,231,168,.18)}",
    ".ht-fab[data-state='bad'] .ht-dot{background:#ef7c8a;box-shadow:0 0 0 3px rgba(239,124,138,.18)}",
    ".ht-fab[data-state='check'] .ht-dot{background:#f0c46a;box-shadow:0 0 0 3px rgba(240,196,106,.18);animation:ht-pulse 1.1s infinite}",
    "@keyframes ht-pulse{0%,100%{opacity:1}50%{opacity:.35}}",
    ".ht-panel{position:fixed;right:22px;bottom:88px;z-index:2147483001;width:min(420px,calc(100vw - 32px));",
    "max-height:min(76vh,680px);display:none;flex-direction:column;border-radius:18px;overflow:hidden;",
    "background:#0e1020;border:1px solid rgba(236,234,247,.14);box-shadow:0 24px 64px rgba(0,0,0,.55);",
    "color:#eceaf7;font:14px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}",
    ".ht-panel.ht-open{display:flex}",
    ".ht-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 12px;border-bottom:1px solid rgba(236,234,247,.1)}",
    ".ht-title{font-weight:700;font-size:15px;letter-spacing:.02em}",
    ".ht-sub{font-size:11.5px;color:#a7a4c4;margin-top:2px}",
    ".ht-badge{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:3px 9px;border-radius:999px;",
    "font:600 10.5px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;border:1px solid}",
    ".ht-badge.ok{color:#6ee7a8;border-color:rgba(110,231,168,.4);background:rgba(110,231,168,.1)}",
    ".ht-badge.bad{color:#ef7c8a;border-color:rgba(239,124,138,.4);background:rgba(239,124,138,.1)}",
    ".ht-badge.check{color:#f0c46a;border-color:rgba(240,196,106,.4);background:rgba(240,196,106,.1)}",
    ".ht-x{border:0;background:transparent;color:#a7a4c4;font-size:20px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:6px}",
    ".ht-x:hover{color:#eceaf7;background:rgba(255,255,255,.08)}",
    ".ht-tabs{display:flex;gap:6px;padding:10px 12px 0;flex-wrap:wrap}",
    ".ht-tab{border:1px solid rgba(236,234,247,.16);background:transparent;color:#a7a4c4;border-radius:999px;",
    "padding:5px 11px;font-size:12px;cursor:pointer;transition:.15s}",
    ".ht-tab:hover{color:#eceaf7;border-color:rgba(236,234,247,.32)}",
    ".ht-tab.on{color:#0b0d1f;font-weight:700;border-color:transparent}",
    ".ht-log{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px;min-height:120px}",
    ".ht-msg{max-width:92%;padding:10px 13px;border-radius:13px;white-space:pre-wrap;word-break:break-word;font-size:13.5px}",
    ".ht-msg.me{align-self:flex-end;background:rgba(124,156,255,.18);border:1px solid rgba(124,156,255,.34)}",
    ".ht-msg.ai{align-self:flex-start;background:rgba(255,255,255,.05);border:1px solid rgba(236,234,247,.1)}",
    ".ht-msg.sys{align-self:center;background:transparent;border:1px dashed rgba(239,124,138,.4);color:#ef7c8a;font-size:12.5px;text-align:center}",
    ".ht-meta{margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#8f8cab}",
    ".ht-meta span{padding:2px 7px;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid rgba(236,234,247,.08)}",
    ".ht-meta .ev{color:#8fd3b6;max-width:100%;overflow-wrap:anywhere}",
    ".ht-wait{align-self:flex-start;display:flex;align-items:center;gap:8px;color:#f0c46a;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:8px 12px;border-radius:10px;background:rgba(240,196,106,.07);border:1px solid rgba(240,196,106,.22)}",
    ".ht-wait::before{content:'';flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:#f0c46a;animation:htpulse 1s ease-in-out infinite}",
    "@keyframes htpulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}",
    ".ht-chips{display:flex;gap:6px;padding:0 12px 10px;flex-wrap:wrap}",
    ".ht-chip{border:1px dashed rgba(236,234,247,.22);background:transparent;color:#a7a4c4;border-radius:9px;",
    "padding:6px 10px;font-size:11.5px;cursor:pointer;text-align:left;max-width:100%}",
    ".ht-chip:hover{color:#eceaf7;border-color:rgba(236,234,247,.4)}",
    ".ht-form{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid rgba(236,234,247,.1)}",
    ".ht-in{flex:1;min-height:40px;max-height:96px;resize:none;border-radius:11px;padding:10px 12px;",
    "background:rgba(255,255,255,.05);border:1px solid rgba(236,234,247,.16);color:#eceaf7;font:13.5px/1.5 inherit}",
    ".ht-in:focus{outline:2px solid rgba(124,156,255,.5);outline-offset:1px}",
    ".ht-send{border:0;border-radius:11px;padding:0 16px;font-weight:700;font-size:13px;cursor:pointer;color:#0b0d1f;background:#7c9cff}",
    ".ht-send:disabled{opacity:.45;cursor:not-allowed}",
    ".ht-foot{padding:0 12px 12px;font-size:10.5px;color:#6d6a8e;line-height:1.5}",
    ".ht-foot a{color:#8f8cab}",
    "@media (max-width:520px){.ht-panel{right:0;left:0;bottom:0;width:100%;max-height:86vh;border-radius:16px 16px 0 0}",
    ".ht-fab{right:14px;bottom:14px;padding:11px 16px}}"
  ].join("");
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function injectCSS() {
    if (document.getElementById("ht-css")) { return; }
    var s = document.createElement("style");
    s.id = "ht-css"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------------- 后端发现 */
  var A = { base: null, status: "check", ms: null, project: null, busy: false };

  function token() {
    var m = (location.search.match(/[?&]k=([^&]+)/) || [])[1];
    if (m) {
      var v = decodeURIComponent(m);
      try { localStorage.setItem("hub_k", v); } catch (e) {}
      return v;
    }
    try { return localStorage.getItem("hub_k") || ""; } catch (e) { return ""; }
  }

  /* 会话号：每个项目一个、存在本地。这样「把第二天换成水洞沟」这类后续指令
     能接上上一轮生成的行程（贺兰的 revise 依赖同一 session 里的上一版）。 */
  function sessionId(pid) {
    var k = "hub_sid_" + pid, v = null;
    try { v = localStorage.getItem(k); } catch (e) {}
    if (!v) {
      v = pid + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }

  function loadLiveScript() {
    return new Promise(function (resolve) {
      if (window.HUB_LIVE) { return resolve(); }
      var done = false;
      function fin() { if (!done) { done = true; resolve(); } }
      var s = document.createElement("script");
      s.src = "data/live.js";
      s.onload = fin; s.onerror = fin;
      document.head.appendChild(s);
      setTimeout(fin, 2500);
    });
  }

  function candidates() {
    var out = [];
    function push(u) {
      if (!u) { return; }
      u = String(u).replace(/\/+$/, "");
      if (u && out.indexOf(u) < 0) { out.push(u); }
    }
    var q = (location.search.match(/[?&]api=([^&]+)/) || [])[1];
    if (q) { push(decodeURIComponent(q)); }
    try { push(localStorage.getItem("hub_api")); } catch (e) {}
    var L = window.HUB_LIVE || {};
    push(L.backend);
    (L.endpoints || []).forEach(push);
    var h = location.hostname || "";
    var p = String(location.port || "");
    if (/^https?:$/.test(location.protocol) && (p === "8250" || h === "127.0.0.1" || h === "localhost")) {
      push(location.origin);
    }
    if (!/^https?:$/.test(location.protocol)) { push("http://127.0.0.1:8250"); }
    return out;
  }

  function probe(base) {
    return new Promise(function (resolve) {
      var ctl = new AbortController();
      var to = setTimeout(function () { ctl.abort(); }, 5000);
      fetch(base + "/health", { method: "GET", cache: "no-store", signal: ctl.signal })
        .then(function (r) { clearTimeout(to); resolve(!!r.ok); })
        .catch(function () { clearTimeout(to); resolve(false); });
    });
  }

  function discover() {
    return loadLiveScript().then(function () {
      var list = candidates();
      if (!list.length) { return null; }
      return new Promise(function (resolve) {
        var left = list.length, hit = null;
        list.forEach(function (b) {
          probe(b).then(function (ok) {
            if (ok && !hit) {
              hit = b;
              try { localStorage.setItem("hub_api", b); } catch (e) {}
            }
            left -= 1;
            if (left === 0) { resolve(hit); }
          });
        });
      });
    });
  }
  function chat(project, text) {
    return new Promise(function (resolve, reject) {
      if (!A.base) { return reject(new Error("NO_BACKEND")); }
      var hdr = { "Content-Type": "application/json" };
      var tk = token();
      if (tk) { hdr["X-Hub-Token"] = tk; }
      var ctl = new AbortController();
      var to = setTimeout(function () { ctl.abort(); }, 125000);
      fetch(A.base + "/api/chat", {
        method: "POST", headers: hdr, signal: ctl.signal,
        body: JSON.stringify({ project: project, message: text, protocol: "mcp", session_id: sessionId(project) })
      }).then(function (r) {
        clearTimeout(to);
        if (r.status === 401) { throw new Error("后端要求访问口令（链接里需带 ?k=…）"); }
        if (r.status === 429) { throw new Error("试用频率超限，请稍等一会儿再试"); }
        if (!r.ok) { throw new Error("后端返回 HTTP " + r.status); }
        return r.json();
      }).then(function (j) {
        if (!j || !j.answer) { throw new Error("回包缺少 answer 字段"); }
        resolve(j);
      }).catch(function (e) {
        clearTimeout(to);
        reject(e && e.name === "AbortError" ? new Error("请求超时（后端可能正忙）") : e);
      });
    });
  }

  /* ---------------------------------------------------------------- UI */
  var root = null, logEl = null, fabEl = null, badgeEl = null, inputEl = null, sendEl = null;

  function currentProject() {
    var m = (location.pathname.match(/product-([a-z]+)\.html/i) || [])[1];
    if (m && PROJECTS[m.toLowerCase()]) { return m.toLowerCase(); }
    var q = (location.search.match(/[?&]p=([a-z]+)/) || [])[1];
    if (q && PROJECTS[q]) { return q; }
    return A.project || (A.project = ORDER[0]);
  }

  function setStatus(st, ms) {
    A.status = st; A.ms = ms == null ? null : ms;
    if (!badgeEl) { return; }
    var map = {
      ok: ["ok", "真后端 · 在线" + (A.ms != null ? " · " + A.ms + "ms" : "")],
      bad: ["bad", "真后端 · 未连上"],
      check: ["check", "正在连真后端…"]
    };
    var m = map[st] || map.check;
    badgeEl.className = "ht-badge " + m[0];
    badgeEl.textContent = m[1];
    if (fabEl) { fabEl.setAttribute("data-state", m[0]); }
  }

  function addMsg(kind, text, meta) {
    var d = document.createElement("div");
    d.className = "ht-msg " + kind;
    d.innerHTML = esc(text);
    if (meta) {
      var m = document.createElement("div");
      m.className = "ht-meta";
      m.innerHTML = meta.map(function (x) {
        return '<span' + (x.cls ? ' class="' + x.cls + '"' : "") + ">" + esc(x.t) + "</span>";
      }).join("");
      d.appendChild(m);
    }
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    return d;
  }
  function renderChips(pid) {
    var P = PROJECTS[pid] || {};
    var box = root.querySelector(".ht-chips");
    box.innerHTML = "";
    (P.presets || []).slice(0, 3).forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ht-chip"; b.textContent = q;
      b.addEventListener("click", function () { send(q); });
      box.appendChild(b);
    });
  }

  function renderTabs() {
    var tabs = root.querySelector(".ht-tabs");
    tabs.innerHTML = "";
    ORDER.forEach(function (id) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ht-tab" + (id === A.project ? " on" : "");
      b.textContent = PROJECTS[id].name;
      if (id === A.project) { b.style.background = PROJECTS[id].accent; }
      b.addEventListener("click", function () {
        A.project = id;
        root.querySelector(".ht-title").textContent = PROJECTS[id].name;
        root.querySelector(".ht-sub").textContent = PROJECTS[id].sub;
        root.querySelector(".ht-send").style.background = PROJECTS[id].accent;
        renderTabs(); renderChips(id);
      });
      tabs.appendChild(b);
    });
  }

  function greeting(pid) {
    var P = PROJECTS[pid];
    addMsg("ai", P.blurb + "\n\n下面随便点一句，或直接说你的情况——请求会打到本机真实 adapter。");
  }

  /* 流式对话：先拿到工具名（几十毫秒），再让答案逐段长出来。
     后端 /api/chat/stream 吐的是标准 SSE：meta → tick… → answer… → done */
  function parseSSE(block) {
    var ev = "message", data = "";
    block.split("\n").forEach(function (line) {
      if (line.indexOf("event:") === 0) { ev = line.slice(6).trim(); }
      else if (line.indexOf("data:") === 0) { data += line.slice(5).trim(); }
    });
    return { ev: ev, data: data };
  }

  function chatStream(project, text, on) {
    return new Promise(function (resolve, reject) {
      if (!A.base) { return reject(new Error("NO_BACKEND")); }
      var hdr = { "Content-Type": "application/json", "Accept": "text/event-stream" };
      var tk = token();
      if (tk) { hdr["X-Hub-Token"] = tk; }
      var ctl = new AbortController();
      var to = setTimeout(function () { ctl.abort(); }, 180000);
      fetch(A.base + "/api/chat/stream", {
        method: "POST", headers: hdr, signal: ctl.signal,
        body: JSON.stringify({ project: project, message: text, protocol: "mcp", session_id: sessionId(project) })
      }).then(function (r) {
        if (r.status === 401) { throw new Error("后端要求访问口令（链接里需带 ?k=…）"); }
        if (r.status === 429) { throw new Error("试用频率超限，请稍等一会儿再试"); }
        if (!r.ok) { throw new Error("后端返回 HTTP " + r.status); }
        if (!r.body || !r.body.getReader) { throw new Error("NO_STREAM"); }
        var reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
        var final = null, failure = null;
        function pump() {
          return reader.read().then(function (x) {
            if (x.done) {
              clearTimeout(to);
              if (final) { return resolve(final); }
              if (failure) { return reject(failure); }
              return reject(new Error("流提前结束（后端未给出 done）"));
            }
            buf += dec.decode(x.value, { stream: true });
            var i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              var block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              var e = parseSSE(block);
              if (!e.data) { continue; }
              var d;
              try { d = JSON.parse(e.data); } catch (_) { continue; }
              if (e.ev === "done") { final = d; }
              else if (e.ev === "error") { failure = new Error(d.message || d.detail || d.code || "后端错误"); }
              else { on(e.ev, d); }
            }
            return pump();
          });
        }
        return pump();
      }).catch(function (e) {
        clearTimeout(to);
        reject(e && e.name === "AbortError" ? new Error("请求超时（后端可能正忙）") : e);
      });
    });
  }

  function send(text) {
    text = String(text || "").trim();
    if (!text || A.busy) { return; }
    var pid = currentProject();
    addMsg("me", text);
    inputEl.value = "";
    A.busy = true; sendEl.disabled = true;

    var wait = document.createElement("div");
    wait.className = "ht-wait";
    var t0 = performance.now();
    wait.textContent = "正在连真后端 · " + PROJECTS[pid].name + " …";
    logEl.appendChild(wait);
    logEl.scrollTop = logEl.scrollHeight;

    var toolName = "", toolNote = "";
    var bubble = null, acc = "", finished = false;

    var tick = setInterval(function () {
      var s = Math.round((performance.now() - t0) / 1000);
      if (toolName) {
        wait.textContent = "正在调用 " + toolName + " · 已 " + s + " 秒" +
          (s >= 6 ? "（" + (toolNote || "多步推理，请稍等") + "）" : "");
      } else {
        wait.textContent = "正在连真后端 · " + PROJECTS[pid].name + " … " + s + "s";
      }
    }, 400);

    function clearWait() {
      clearInterval(tick);
      if (wait.parentNode) { wait.parentNode.removeChild(wait); }
    }
    function unlock() {
      if (finished) { return; }
      finished = true;
      clearWait();
      A.busy = false; sendEl.disabled = false;
    }

    function onEvent(ev, d) {
      if (ev === "meta") {
        toolName = d.tool || "";
        toolNote = d.note || "";
        // 几十毫秒内就把真实工具名摆出来，而不是让用户对着空白等
        wait.textContent = "已连上 · 正在调用 " + toolName + (toolNote ? "（" + toolNote + "）" : "");
        return;
      }
      if (ev === "tick") {
        var s = Math.round((d.elapsed_ms || 0) / 1000);
        wait.textContent = "正在调用 " + toolName + " · 已 " + s + " 秒" +
          (s >= 6 ? "（" + (toolNote || "多步推理，请稍等") + "）" : "");
        return;
      }
      if (ev === "answer" && d.chunk) {
        if (!bubble) { clearWait(); bubble = addMsg("ai", "", null); }
        acc += d.chunk;
        bubble.innerHTML = esc(acc);
        logEl.scrollTop = logEl.scrollHeight;
      }
    }

    function finish(j) {
      unlock();
      var meta = [
        { t: "工具：" + (j.tool || toolName || "—") },
        { t: "耗时：" + (j.latency_ms != null ? j.latency_ms + " ms" : Math.round(performance.now() - t0) + " ms") }
      ];
      if (j.cached) {
        meta.push({ t: "缓存命中 · 原始 " + (j.origin_latency_ms != null ? j.origin_latency_ms + " ms" : "—"), cls: "ev" });
      }
      if (j.evidence) { meta.push({ t: "证据：" + j.evidence, cls: "ev" }); }
      if (j.demo) { meta.push({ t: "⚠ demo 回包" }); }
      if (bubble) {
        bubble.innerHTML = esc(j.answer || acc);
        var m = document.createElement("div");
        m.className = "ht-meta";
        m.innerHTML = meta.map(function (x) {
          return '<span' + (x.cls ? ' class="' + x.cls + '"' : "") + ">" + esc(x.t) + "</span>";
        }).join("");
        bubble.appendChild(m);
        logEl.scrollTop = logEl.scrollHeight;
      } else {
        addMsg("ai", j.answer, meta);
      }
      setStatus("ok", j.latency_ms);
    }

    function fail(err) {
      unlock();
      var msg = String((err && err.message) || err);
      if (msg === "NO_BACKEND") {
        addMsg("sys", "真后端现在没连上：本机网关未启动，或公网隧道地址已换。\n" +
          "这不是静态样例——连不上就不回答。点右下角按钮重试，或稍后再来。");
        setStatus("bad");
        return;
      }
      addMsg("sys", "请求失败：" + msg + "\n（页面不会用演示数据冒充真实回答）");
      setStatus(A.base ? "ok" : "bad");
    }

    function go() {
      chatStream(pid, text, onEvent).then(finish).catch(function (e) {
        // 老后端没有 SSE 端点 / 浏览器不支持流：退回一次性请求，行为不变
        if (e && (e.message === "NO_STREAM" || /HTTP 404/.test(e.message))) {
          return chat(pid, text).then(finish).catch(fail);
        }
        fail(e);
      });
    }

    if (A.base) { return go(); }
    setStatus("check");
    discover().then(function (b) {
      if (!b) { A.base = null; return fail(new Error("NO_BACKEND")); }
      A.base = b; setStatus("ok");
      go();
    });
  }
  function build() {
    injectCSS();
    var fab = document.createElement("button");
    fab.type = "button"; fab.className = "ht-fab"; fab.setAttribute("data-state", "check");
    fab.innerHTML = '<span class="ht-dot"></span><span>立即试用 · 真后端</span>';
    document.body.appendChild(fab);
    fabEl = fab;

    var P0 = PROJECTS[currentProject()];
    var panel = document.createElement("div");
    panel.className = "ht-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "真后端即时试用");
    panel.innerHTML =
      '<div class="ht-head">' +
        '<div><div class="ht-title">' + esc(P0.name) + '</div>' +
        '<div class="ht-sub">' + esc(P0.sub) + '</div>' +
        '<div class="ht-badge check">正在连真后端…</div></div>' +
        '<button class="ht-x" type="button" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="ht-tabs"></div>' +
      '<div class="ht-log"></div>' +
      '<div class="ht-chips"></div>' +
      '<form class="ht-form"><textarea class="ht-in" rows="1" placeholder="说出你的真实场景，例如：银川 3 天带老人，预算 3000"></textarea>' +
      '<button class="ht-send" type="submit">发送</button></form>' +
      '<div class="ht-foot">请求直接打到本机 adapter（真进程 / 真工具 / 真数据）；连不上就如实报错，不伪造回答。' +
      '<br>统一平台：<a href="hub.html">hub.html</a> · 访问口令见管理员给的链接 ?k=</div>';
    document.body.appendChild(panel);
    root = panel;
    logEl = panel.querySelector(".ht-log");
    badgeEl = panel.querySelector(".ht-badge");
    inputEl = panel.querySelector(".ht-in");
    sendEl = panel.querySelector(".ht-send");
    sendEl.style.background = P0.accent;

    renderTabs(); renderChips(currentProject());
    greeting(currentProject());

    panel.querySelector(".ht-x").addEventListener("click", function () { panel.classList.remove("ht-open"); });
    panel.querySelector(".ht-form").addEventListener("submit", function (e) {
      e.preventDefault(); send(inputEl.value);
    });
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(inputEl.value); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { panel.classList.remove("ht-open"); }
    });

    fab.addEventListener("click", function () {
      var open = panel.classList.toggle("ht-open");
      if (open) {
        inputEl.focus();
        if (A.status !== "ok") {
          setStatus("check");
          discover().then(function (b) {
            if (b) { A.base = b; setStatus("ok"); }
            else { A.base = null; setStatus("bad"); }
          });
        }
      }
    });

    /* 先探一次，让按钮上的灯提前告诉人「现在能不能真聊」 */
    discover().then(function (b) {
      if (b) { A.base = b; setStatus("ok"); }
      else { A.base = null; setStatus("bad"); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
