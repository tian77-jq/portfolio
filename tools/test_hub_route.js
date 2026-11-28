/* 门户站纯逻辑自检：路由 / @解析 / 演示问答选择 / 地图文字降级 / 探针诚实性 / 零 key / 新项目热插拔。
   不依赖真实浏览器：用一个最小 DOM 桩让 hub.html 的内联脚本能跑起来，然后断言结果。
   用法：node tools/test_hub_route.js    退出码 0 = 全过 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.dirname(__dirname);
const DEMO_NEW = { id: "demo_new", name: "演示新项目", tag: "测试插槽", accent: "#ff9f7c",
  desc: "只在自检里注入，用来证明“注册表加一项、不改 hub.html”就能路由。",
  tools: [], skills: [], metrics: [{ k: "状态", v: "假项目" }], demo: [{ q: "测试", a: "演示新项目的占位回答，不是真实数据。", tools: [], ms: 0, evidence: "—" }] };

/* ---------- 最小 DOM 桩 ---------- */
function el(id) {
  const node = {
    id, innerHTML: "", textContent: "", value: "", disabled: false,
    selectionStart: 0, selectionEnd: 0, onclick: null, className: "",
    children: [], parentNode: null,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 contains(c) { return this._s.has(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); } },
    addEventListener() {}, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    querySelector() { return el("q"); }, setAttribute() {}, remove() {}, focus() {}
  };
  return node;
}
const cache = {};
const document = {
  getElementById(id) { return cache[id] || (cache[id] = el(id)); },
  createElement() { return el("new"); },
  head: el("head")
};
let fetchMode = "reject";   /* reject | pending | 503 | ok */
function fakeFetch(url, opts) {
  /* 桩要忠实：真 fetch 在 signal abort 时 reject；pending 模式必须监听 signal，否则测不出“截止时间 abort” */
  if (fetchMode === "pending") return new Promise((_, rej) => {
    if (opts && opts.signal) opts.signal.addEventListener("abort", () => rej(new Error("The user aborted a request.")));
  });
  if (fetchMode === "503") return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
  if (fetchMode === "ok") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  return Promise.reject(new Error("no backend in test"));
}

/* ---------- 载入注册表 + 页面脚本 ---------- */
const sandbox = {
  window: {}, document, console,
  performance: { now: () => Date.now() },
  location: { protocol: "http:", href: "http://127.0.0.1/", port: "8250", hostname: "127.0.0.1" },
  fetch: fakeFetch,
  AbortController, setTimeout, clearTimeout, Promise, Math, Date, JSON
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(ROOT, "data", "projects.js"), "utf8"), ctx, { filename: "projects.js" });
/* D4：在页面脚本之前注入一个“假项目”，证明路由与卡片渲染对注册表开放，不改 hub.html 一行 */
vm.runInContext("window.PROJECTS.push(" + JSON.stringify(DEMO_NEW) + ");", ctx, { filename: "inject_demo_new.js" });
const html = fs.readFileSync(path.join(ROOT, "hub.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) { console.error("[FAIL] hub.html 找不到内联脚本"); process.exit(1); }
blocks.forEach((code, i) => vm.runInContext(code, ctx, { filename: "hub.html#script" + i }));

const H = sandbox.window.__HUB;
if (!H) { console.error("[FAIL] 未暴露 window.__HUB"); process.exit(1); }

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log("  [OK]   " + msg); }
  else { fail++; console.log("  [FAIL] " + msg + (extra ? "  -> " + JSON.stringify(extra) : "")); }
}
const real = () => H.projects.filter(p => p.id !== "demo_new");

console.log("注册表");
ok(H.projects.length === 5, "4 个真实项目 + 1 个自检注入的假项目", H.projects.map(p => p.id));
ok(real().every(p => p.tools && p.tools.length), "每个真实项目都有 MCP 工具清单");
ok(real().every(p => p.demo && p.demo.length >= 2), "每个真实项目至少 2 条演示问答");
ok(real().every(p => p.demo.every(d => d.tools && d.evidence)), "每条演示都带 tools 与 evidence 字段");
ok(real().filter(p => !p.health).length === 0, "每个真实项目都配了健康探针地址");
ok(H.config && H.config.port === 8250 && H.config.probe_timeout_ms === 2500, "HUB_CONFIG 暴露端口 8250 / 探针 2500ms（不硬编码在页面里）", H.config);
ok(["tencent", "amap", "baidu", "tianditu"].includes(H.config.map.provider) && H.config.map.coord === "GCJ-02",
  "地图供应商在白名单内且坐标系 GCJ-02", H.config.map);
ok(/__WB_TMAP_SECRET__/.test(H.config.map.serviceHost || ""), "腾讯地图 serviceHost 仍是占位符（未填真实 key）", H.config.map.serviceHost);
{
  const ht = sandbox.window.HUB_TOOLS.map(t => t.name);
  ok(["tools.weather_now", "tools.map_geocode", "tools.map_route"].every(n => ht.includes(n)), "门户工具清单含 weather_now / map_geocode / map_route", ht);
  ok(sandbox.window.HUB_TOOLS.filter(t => t.name.startsWith("tools.")).every(t => t.via && t.fallback), "地图/天气三项都声明了 via（贺兰已有工具）与 fallback");
}

console.log("\nD4 新项目热插拔（注册表加一项，不改 hub.html）");
{
  const d = H.resolveTarget("@演示新项目 测试问题");
  ok(d.target && d.target.id === "demo_new" && d.text === "测试问题", "@演示新项目 → demo_new，正文剥离 @ 前缀", d.target && d.target.id);
  const cards = document.getElementById("cards").innerHTML;
  ok(cards.includes('data-card="demo_new"'), "能力卡里出现了 demo_new");
  ok(/MCP 工具 <b[^>]*>—<\/b>/.test(cards) && /健康探针 <b[^>]*>—<\/b>/.test(cards), "无 tools / 无 health 的项目卡片显示“—”，不显示 0 个 / 已配");
  ok(!cards.includes('href="undefined"') && !cards.includes('href=""'), "无 url 的项目不渲染坏链接");
  ok(!cards.includes("undefined") && !cards.includes("NaN"), "卡片 HTML 无 undefined / NaN 泄漏");
  const d2 = H.resolveTarget("@不存在项目 你好");
  ok(d2.target === null && d2.text === "@不存在项目 你好", "未知 @ 不瞎猜：target=null，正文保持原样");
}

console.log("\n@ 解析");
ok(H.byName("贺兰有灵").id === "helan", "@贺兰有灵 -> helan");
ok(H.byName("衡鉴").id === "hengjian", "@衡鉴 -> hengjian");
ok(H.byName("砼智销").id === "cement", "@砼智销 -> cement");
ok(H.byName("ResearchOS").id === "researchos", "@ResearchOS -> researchos");
ok(H.byName("helan").id === "helan", "英文 id 也能解析");
ok(H.byName("不存在的项目") === null, "未知项目返回 null（不瞎猜）");

console.log("\n意图路由（不 @ 时）");
const cases = [
  ["三天两晚带老人去宁夏怎么安排", "helan"],
  ["沙坡头和西夏陵哪个更适合老人", "helan"],
  ["这份年报的研发费用同比变动多少", "hengjian"],
  ["把这条结论追溯到 PDF 第几页", "hengjian"],
  ["住宅建房用水泥，银川 200 平，帮我起一份询价草稿", "cement"],
  ["同一个客户换个目标再起一份询价，会覆盖上一份吗", "cement"],
  /* 回归：地名跨领域复用。「西夏区」是银川的区，但这句话讲的是混凝土询价，
     不能因为「西夏」两个字被判成文旅。 */
  ["西夏区建房要 200 方 C30 混凝土，多久能到", "cement"],
  ["西夏陵和沙坡头哪个更值得去", "helan"],
  ["帮我找长上下文压缩的文献，要有出处", "researchos"],
  ["这条结论能过证据门禁吗", "researchos"]
];
cases.forEach(([q, want]) => {
  const r = H.route(q);
  ok(r && r.p.id === want, `「${q}」-> ${want}`, r ? { got: r.p.id, why: r.why } : null);
});
ok(H.route("今天天气怎么样") === null, "无关问题不乱路由（返回 null，让页面提示用 @ 指定）");

console.log("\n演示问答选择");
[
  ["helan", "三天两晚，带老人，预算 3000"],
  ["hengjian", "把这个数字追溯到 PDF 哪一页"],
  ["cement", "住宅建房用水泥，银川，200 平，帮我起一份询价草稿"],
  ["researchos", "这个插件包能过质量门吗"]
].forEach(([pid, q]) => {
  const p = H.byId(pid);
  const d = H.demoAnswer(p, q);
  ok(d && d.a && d.a.length > 20, `${pid} 命中非空回答`, { tools: d.tools });
});

console.log("\n能力对齐（portal tools/health ↔ capability.json）");
/* B4/P1-5：门户 tools 数组不得手写想象的能力。调 sync_projects.py --verify-capability 做机器校验，
   它打 [MISMATCH] 则退出码 1；没有 capability.json 的项目（贺兰）打 WARN 跳过，不算失败。 */
{
  const cp = require("child_process");
  const r = cp.spawnSync("python", [path.join(ROOT, "tools", "sync_projects.py"), "--verify-capability"], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  process.stdout.write(out.split("\n").filter(Boolean).map(l => "  " + l + "\n").join(""));
  ok(r.status === 0, "sync_projects.py --verify-capability 退出码 0", { status: r.status, tail: out.trim().split("\n").slice(-1)[0] });
}

console.log("\nD2 地图 / 天气文字降级");
{
  const t1 = H.geoText("镇北堡和西夏陵哪个近");
  ok(/地图未加载/.test(t1), "无地图时明确写“地图未加载”，不留空框", t1);
  ok(t1.includes("镇北堡西部影城") && t1.includes("西夏陵") && !t1.includes("沙坡头"), "只列问题里提到的地标");
  ok(/GCJ-02 [\d.]+, [\d.]+，待核/.test(t1) && /距银川市中心直线 [\d.]+ km/.test(t1), "文字模式仍给出坐标（标待核）与直线距离", t1);
  const t2 = H.geoText("中卫沙坡头怎么走");
  ok(t2.includes("距中卫市中心直线"), "城市随问题切换（中卫）", t2);
  const km = H.haversine({ lat: 38.474, lng: 106.273 }, { lat: 37.515, lng: 105.190 });
  ok(km > 130 && km < 160, "haversine 银川→中卫 ≈ 143 km（量级校验）", km.toFixed(1));
  ok(H.haversine({ lat: 38.474, lng: 106.273 }, { lat: 38.474, lng: 106.273 }) === 0, "同点距离为 0");
  ok(/_TMapSecurityConfig = \{ serviceHost: cfg\.serviceHost \}/.test(blocks[0]) && /__WB_TMAP_SECRET__/.test(fs.readFileSync(path.join(ROOT, "data", "projects.js"), "utf8")),
    "页面只透传注册表里的 serviceHost 占位符，不拼 key");
}

console.log("\nD3 探针诚实性（失败不写“在线”，共享截止时间）");
(async () => {
  const probes = document.getElementById("probes").children;
  await new Promise(r => setTimeout(r, 30));
  ok(probes.length === 5, "5 个项目各一个探针 chip", probes.length);
  ok(probes.every(e => /未知/.test(e.innerHTML) && !/在线/.test(e.innerHTML)), "后端不可达 → 全部“未知（未连）”，没有一个写“在线”", probes.map(e => e.innerHTML));
  ok(!probes.some(e => /探测中/.test(e.innerHTML)), "没有 chip 卡在“探测中”");
  /* 截止时间已过：fetch 不发，直接“未知（超时）” */
  fetchMode = "pending";
  const late = el("late");
  H.probeOne({ id: "x", name: "X", health: "http://127.0.0.1:1/x" }, late, sandbox.performance.now() - 1);
  ok(/未知（超时）/.test(late.innerHTML), "共享截止时间已过 → 立即“未知（超时）”，不再各等 2.5s", late.innerHTML);
  /* HTTP 503 → “异常 503”，不是“在线” */
  fetchMode = "503";
  const bad = el("bad");
  H.probeOne({ id: "y", name: "Y", health: "http://127.0.0.1:1/y" }, bad, sandbox.performance.now() + 2500);
  await new Promise(r => setTimeout(r, 10));
  ok(/异常 503/.test(bad.innerHTML) && !/在线/.test(bad.innerHTML), "HTTP 503 → “异常 503”", bad.innerHTML);
  /* 永远不回包 → 到共享截止时间后 abort → “未知（未连）”，总耗时 ≈ budget */
  fetchMode = "pending";
  const slow = el("slow"); const t0 = Date.now();
  H.probeOne({ id: "z", name: "Z", health: "http://127.0.0.1:1/z" }, slow, sandbox.performance.now() + 300);
  let took = -1;
  for (let i = 0; i < 50; i++) {                   /* 轮询到状态翻转为“未知”为止，记真实 abort 时刻 */
    await new Promise(r => setTimeout(r, 20));
    if (/未知/.test(slow.innerHTML)) { took = Date.now() - t0; break; }
  }
  ok(/未知（未连）/.test(slow.innerHTML) && took >= 250 && took < 450, "挂起的探针按共享截止时间 abort（300ms 截止，实测 " + took + " ms）", slow.innerHTML);

  console.log("\n红线：前端零真实 key");
  {
    const re = /key=[A-Za-z0-9]{16,}|api_key\s*=\s*"[A-Za-z0-9]{16,}"/;
    const files = [path.join(ROOT, "hub.html"), path.join(ROOT, "data", "projects.js"), path.join(ROOT, "server", "hub_server.py")];
    const hits = files.filter(f => re.test(fs.readFileSync(f, "utf8")));
    ok(hits.length === 0, "key=<16+位> / api_key=\"<16+位>\" 零命中（hub.html / data/ / server/）", hits);
  }
  console.log("\n红线：/api/chat 回包字段契约");
  {
    const src = fs.readFileSync(path.join(ROOT, "server", "hub_server.py"), "utf8");
    ok(/fetch\(base \+ "\/api\/chat"/.test(html) && /protocol:"mcp"/.test(html), "前端仍 POST /api/chat {project, message, protocol}");
    ok(["answer", "route", "tool", "latency_ms", "evidence"].every(k => new RegExp('"' + k + '":').test(src)), "网关回包含 answer/route/tool/latency_ms/evidence 五字段", null);
    ok(/ADAPTER_UNAVAILABLE/.test(src) && /if \(!r\.ok\) throw/.test(html), "adapter 不可用 → 503 ADAPTER_UNAVAILABLE → 前端回退演示数据并标注");
  }

  console.log("\n汇总\n  " + (pass + fail) + " 项：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
