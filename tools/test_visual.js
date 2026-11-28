/* 门户站 hub.html 视觉/结构自检（静态，Node 无依赖）。
   范围（2026-11-28 14:45 纠正后）：只检查 hub.html —— 自身 token 完整、可对话、可跳转；
   四个产品页各自保留原风格，不在本脚本范围内，只断言“未被统一改造波及”。
   用法：node tools/test_visual.js   退出码 0 = 全过 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.dirname(__dirname);
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const HUB = read("hub.html");
const THEME = read("assets/theme.css");
const PROJECTS = read("data/projects.js");
const PRODUCTS = { helan: "--violet:", hengjian: "--gold:", cement: "--amber:", researchos: "--teal:" };

let pass = 0; const fails = [];
function ok(cond, where, msg, extra) {
  const line = where + " · " + msg + (extra !== undefined && !cond ? "  -> " + JSON.stringify(extra) : "");
  if (cond) { pass++; console.log("  [OK]   " + line); } else { fails.push(line); console.log("  [FAIL] " + line); }
}
const styleOf = html => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");

/* ---------- 1. hub 自身 token 完整（不依赖产品页） ---------- */
console.log("1) hub.html 用到的每个 var(--x) 都有定义（theme.css 或 hub 自己的 :root）");
{
  const defined = new Set([...(THEME + HUB).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));   /* 含卡片模板里的内联 style="--c:…" */
  const used = [...new Set([...HUB.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))];
  const missing = used.filter(v => !defined.has(v));
  ok(used.length > 0 && missing.length === 0, "hub.html", `用到 ${used.length} 个变量，未定义 ${missing.length} 个`, missing);
  ok(/<link rel="stylesheet" href="assets\/theme\.css">/.test(HUB) && HUB.indexOf('href="assets/theme.css"') < HUB.indexOf("<style>"), "hub.html", "在页面 <style> 之前引入 assets/theme.css");
  const must = ["--space-1", "--space-8", "--radius-sm", "--radius-md", "--radius-lg", "--shadow-1", "--shadow-2", "--dur-1", "--dur-2", "--ease",
                "--text-1", "--text-2", "--text-3", "--surface-1", "--surface-2", "--border-1", "--border-2", "--ok", "--warn", "--bad", "--sans", "--mono", "--serif", "--max"];
  ok(must.every(t => defined.has(t)), "assets/theme.css", `任务书 V1 必须定义的 ${must.length} 个 token 齐全`, must.filter(t => !defined.has(t)));
  const own = [...styleOf(HUB).matchAll(/:root\s*\{([^}]*)\}/g)].flatMap(m => [...m[1].matchAll(/(--[\w-]+)\s*:/g)].map(k => k[1]));
  ok(own.length > 0 && own.length <= 6 && own.every(n => /^--brand(-2|-soft)?$/.test(n)), "hub.html", `hub 自己的 :root 只覆写品牌变量：${own.join(" ")}`, own);
}

/* ---------- 2. 可对话：@ 路由入口存在 ---------- */
console.log("\n2) 可对话：@ 路由的输入框 / 提示 / 弹层 / 路由函数都在");
ok(/<textarea[^>]*id="ask"/.test(HUB), "hub.html", "有输入框 #ask");
ok(/id="ask"[^>]*placeholder="[^"]*@[^"]*"/.test(HUB), "hub.html", "输入框 placeholder 提示用 @ 选项目");
ok(/class="pop"/.test(HUB) && /function resolveTarget\(/.test(HUB) && /function route\(/.test(HUB), "hub.html", "有 @ 弹层 .pop 与 resolveTarget()/route() 路由函数");
ok(/fetch\(base \+ "\/api\/chat"/.test(HUB) && /project:p\.id, message:text, protocol:"mcp"/.test(HUB), "hub.html", "POST /api/chat {project, message, protocol}（B5 契约未动）");

/* ---------- 3. 可跳转：到 4 个产品页的链接 ---------- */
console.log("\n3) 可跳转：4 个项目卡片直达 product-*.html");
for (const [id, priv] of Object.entries(PRODUCTS)) {
  const m = PROJECTS.match(new RegExp(`id:\\s*"${id}"[\\s\\S]*?url:\\s*"([^"]+)"`));
  const url = m ? m[1] : null;
  ok(url === `product-${id}.html`, "data/projects.js", `${id}.url = ${url}`, url);
}
ok(HUB.includes("location.href = tp.url") && HUB.includes("href=\"'+esc(p.url)+'\""), "hub.html", "卡片「进去用 →」与「产品页」都跳 p.url");

/* ---------- 4. 零外部 CDN / 零真实 key ---------- */
console.log("\n4) hub.html 无外部 CDN、无真实 key");
{
  const urls = [...HUB.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map(m => m[0]);
  const hosts = [...new Set(urls.map(u => u.replace(/^https?:\/\//, "").split("/")[0]))];
  const bad = hosts.filter(h => !["map.qq.com", "127.0.0.1:8250", "localhost"].includes(h));
  ok(bad.length === 0, "hub.html", `外链 host：${hosts.join(", ") || "无"}（map.qq.com=腾讯地图脚本，127.0.0.1=本机网关示例）`, bad);
  ok(!/<link[^>]+href="https?:/.test(HUB) && !/<script[^>]+src="https?:/.test(HUB), "hub.html", "无外部 <link>/<script src>");
  const keyRe = /key=[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}|api_key\s*=\s*"[A-Za-z0-9]{16,}"/;
  const hit = [HUB, THEME, PROJECTS, read("data/projects.json")].filter(s => keyRe.test(s));
  ok(hit.length === 0, "hub.html + assets/ + data/", "真实 key 零命中", hit.length);
  ok(/__WB_TMAP_SECRET__/.test(PROJECTS) && !/serviceHost:\s*"[^"]*[A-Za-z0-9]{20,}"[^"]*__WB/.test(HUB), "hub.html + data/projects.js", "腾讯地图占位符原样保留");
}

/* ---------- 5. 可访问性：focus-visible + reduced-motion ---------- */
console.log("\n5) :focus-visible 与 prefers-reduced-motion（hub 自身或所引 theme.css）");
ok(/:focus-visible\s*\{/.test(HUB + THEME), "hub.html", "有 :focus-visible");
ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(HUB + THEME), "hub.html", "有 prefers-reduced-motion:reduce");
{
  const bps = [...new Set([...(styleOf(HUB) + THEME).matchAll(/@media[^{]*?\(max-width:\s*(\d+)px\)/g)].map(m => +m[1]))].sort((a, b) => a - b);
  ok(bps.length === 2 && bps[0] === 640 && bps[1] === 900, "hub.html", `断点 ${bps.join("/")}`, bps);
}
{
  const tok = n => { const m = THEME.match(new RegExp(n + "\\s*:\\s*([^;]+);")); return m ? m[1].trim() : null; };
  const hex = s => { const m = (s || "").match(/^#([0-9a-f]{6})$/i); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  const bg = hex(tok("--bg"));
  for (const t of ["--text-1", "--text-2", "--text-3"]) {
    const fg = hex(tok(t)); const r = fg && bg ? ratio(fg, bg) : 0;
    ok(r >= 4.5, "assets/theme.css", `${t} ${tok(t)} 对 ${tok("--bg")} = ${r.toFixed(2)}:1（≥4.5）`, +r.toFixed(2));
  }
}

/* ---------- 6. 四个产品页未被本轮改动（各自原风格） ---------- */
console.log("\n6) 四个产品页保持原样：仍是各自私有变量，未引 theme.css、无 --brand");
for (const [id, priv] of Object.entries(PRODUCTS)) {
  const f = `product-${id}.html`; const html = read(f);
  ok(html.includes(priv) && !/--brand[\w-]*\s*:/.test(html) && !/assets\/theme\.css/.test(html), f, `含 ${priv}，无 --brand，未引 theme.css`);
}

console.log(`\n${pass + fails.length} 项：${pass} 通过，${fails.length} 失败`);
if (fails.length) { console.log("\n失败项："); fails.forEach(x => console.log("  - " + x)); }
process.exit(fails.length ? 1 : 0);
