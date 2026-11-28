#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""门户站网关 `/api/chat`（Python 标准库，无框架）。

职责只有三件：按注册表选项目 → 按意图选工具 → 真调 adapter（MCP stdio 或 A2A HTTP）
→ 把 adapter 的真实返回整理成前端已依赖的回包。本文件不含任何业务逻辑。

回包契约（字段名不许改，hub.html 已依赖）：
    {answer, route, tool, latency_ms, evidence}
    另带前端展示用的别名：tools=[tool]、ms=latency_ms。

诚实原则：
    - adapter 起不来 / 超时 / 协议错 → HTTP 503 + error.code=ADAPTER_UNAVAILABLE，前端据此回退演示数据；
    - 工具本身报错（-32602 / isError）→ HTTP 200，answer 如实写错误，tool 仍是真实工具名，evidence 带 error；
    - 不编造任何内容：answer 只从 adapter 返回的 JSON 整理。

路由：读 data/projects.json 的 projects[].tools / health（单一真源，与 tools/sync_projects.py 同源）。
端口：--port > 环境变量 HUB_PORT > data/projects.json 的 hub_config.port；三者都没有则报错退出，不硬编码。

adapter 启动表（ADAPTERS）：三个项目的入口与 capability.json 的 entry / health.mcp.cmd 一致；
贺兰没有 capability.json，且 adapter 内部工具名是 helan_ask_culture（下划线），按命名裁定 adapter 一行不动、
在注册表层用 aliases 映射（helan.ask_culture → helan_ask_culture）。

运行：
    python server/hub_server.py --port 8250
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "projects.json"

# ---------------------------------------------------------------- adapter 启动表（配置，非业务逻辑）
def _hengjian_sample() -> list[str]:
    """与 finrisk/smoke_mcp.py 同一规则：样例目录 var/sources/files/44 下第一个 PDF，启动时用 --sample 登记。
    找不到就不传（verify_filing 会如实报“没有这个样例编号”，不伪造）。"""
    d = Path(r"D:\Financial Agent\dev\finrisk\var\sources\files\44")
    pdfs = sorted(d.glob("*.pdf")) if d.is_dir() else []
    return ["--sample", str(pdfs[0])] if pdfs else []


ADAPTERS: dict[str, dict[str, Any]] = {
    "helan": {
        "python": r"D:\SilverCup-Agent\.venv\Scripts\python.exe",
        "module": None, "script": r"D:\SilverCup-Agent\mcp-adapter\server.py",
        "cwd": r"D:\SilverCup-Agent", "pre_args": [], "args": [],
        # 门户对外名（projects.js）→ adapter 内部名（不改 adapter）
        "aliases": {"helan.ask_culture": "helan_ask_culture", "helan.plan_itinerary": "helan_plan",
                    "helan.revise_plan": "helan_revise", "helan.verify_plan": "helan_verify"},
        # 贺兰 A2A 的 skill id 就是内部名
        "a2a_skill_aliases": {"helan.ask_culture": "helan_ask_culture", "helan.plan_itinerary": "helan_plan",
                              "helan.revise_plan": "helan_revise", "helan.verify_plan": "helan_verify"},
    },
    "hengjian": {
        "python": r"D:\Financial Agent\dev\finrisk\.venv\Scripts\python.exe",
        "module": "finrisk.mcp_server", "script": None,
        "cwd": r"D:\Financial Agent\dev\finrisk", "pre_args": [],
        "args": ["--db", r"D:\Financial Agent\dev\finrisk\var\workbench.db"] + _hengjian_sample(),
    },
    "cement": {
        "python": r"D:\Cement-SalesAgent\.venv\Scripts\python.exe",
        "module": None, "script": r"D:\Cement-SalesAgent\mcp\server.py",
        "cwd": r"D:\Cement-SalesAgent", "pre_args": [],
        # 固定 db：read_customer / validate_quote 要能读到同一 session 先前落的草稿
        "args": ["--db", r"D:\Cement-SalesAgent\runtime\hub_agent.sqlite3"],
    },
    "researchos": {
        "python": "py", "module": "researchos.mcp_server", "script": None,
        "cwd": r"D:\AI-Knowledge-Base2", "pre_args": ["-3.12"], "args": [],
    },
}

MCP_TIMEOUT_S = float(os.environ.get("HUB_MCP_TIMEOUT") or 90)
A2A_TIMEOUT_S = float(os.environ.get("HUB_A2A_TIMEOUT") or 30)
RESEARCHOS_DEMO_PACK = "examples/researchos_packs/v1/demo_evidence_pack"

# ---------------------------------------------------------------- 意图 → 工具 + 参数
# 每条规则：(正则, 对外工具名, 参数构造函数)。参数只从消息里取；取不到就用显式默认值并在 answer 里标注"默认"。
_CITY_RE = re.compile(r"(银川|石嘴山|吴忠|固原|中卫|沙坡头|水洞沟|西夏陵|沙湖|贺兰山)")
_AREA_RE = re.compile(r"(\d{2,5})\s*平")


def _area(m: str) -> int | None:
    hit = _AREA_RE.search(m)
    return int(hit.group(1)) if hit else None


def _city(m: str, default: str | None = None) -> str | None:
    hit = _CITY_RE.search(m)
    return hit.group(1) if hit else default


RULES: dict[str, list[tuple[str, str, Any]]] = {
    "hengjian": [
        (r"任务|task", "hengjian.list_tasks", lambda m, s: {}),
        (r"快照|snapshot", "hengjian.list_report_snapshots", lambda m, s: {}),
        (r"预览|报告|排除", "hengjian.preview_report", lambda m, s: {"kind": "formal" if "正式" in m else "draft"}),
        (r"导入|核|营收|研发|同比|期间|口径|年报", "hengjian.verify_filing",
         lambda m, s: {"sample_index": 0}),   # 只接已登记样例；具体编号取不到时用 0 并在 answer 标注
        (r"追溯|页码|哪一页|fact", "hengjian.trace_fact", lambda m, s: None),  # 需要 fact_id，无法从消息推出 → 如实要求
    ],
    "cement": [
        (r".*", "cement.quote_generate", None),  # 构造见 _cement_args
    ],
    "researchos": [
        (r"门|质量|插件|gate", "researchos.gate_check", lambda m, s: {"package_root": RESEARCHOS_DEMO_PACK}),
        (r"网关|放行|gateway", "researchos.gateway_invoke",
         lambda m, s: {"task": "medical_internal_reasoning", "classification": "TEAM_INTERNAL", "prompt": m[:200],
                       "local_provider": True}),
        # search_evidence 的语义是「查证据类型注册表」，不是全文检索；
        # domain 只能取注册表里的合法值，消息里认不出就传空（返回覆盖表），不伪造 'literature'。
        (r".*", "researchos.search_evidence", lambda m, s: _researchos_domain_args(m)),
    ],
    "helan": [
        (r"改|换|替换|增加|去掉|修订", "helan.revise_plan", lambda m, s: {"session_id": s, "message": m}),
        (r"可靠|门票|开放时间|审核|核验", "helan.verify_plan", lambda m, s: {"session_id": s}),
        (r"行程|天|晚|预算|带老人|怎么安排|路线|旅游|玩", "helan.plan_itinerary", lambda m, s: {"session_id": s, "message": m}),
        (r".*", "helan.ask_culture", lambda m, s: {"message": m}),
    ],
}


_RESEARCHOS_DOMAINS = {
    "cement_industry": re.compile(r"水泥|建材|砼|工业"),
    "mathematical_modeling": re.compile(r"数学|建模|数模|优化模型"),
    "medical_vision": re.compile(r"医疗|影像|CT|病灶|医学"),
}


def _researchos_domain_args(message: str) -> dict[str, Any]:
    """projectos.search_evidence 只接受注册表内的 domain；认不出就传空，返回覆盖表。
    绝不把不存在的 'literature' 塞进去（那会触发 UNKNOWN_DOMAIN）。"""
    for domain, pat in _RESEARCHOS_DOMAINS.items():
        if pat.search(message or ""):
            return {"domain": domain}
    return {}


def _cement_args(message: str, session_id: str) -> dict[str, Any]:
    facts: dict[str, Any] = {
        "project_type": {"value": "住宅建房"},
        "purchase_city": {"value": _city(message, "银川")},
        "cement_usage": {"value": "砌筑抹灰"},
    }
    area = _area(message)
    if area:
        facts["project_area_sqm"] = {"value": area}
    return {"session_id": session_id, "goal": message[:240] or "水泥询价", "facts": facts}


def pick_tool(project_id: str, tools: list[str], message: str, session_id: str) -> tuple[str, dict[str, Any] | None, str]:
    """返回 (对外工具名, 参数或 None=无法构造, 命中理由)。"""
    rules = RULES.get(project_id) or []
    allowed = set(tools)
    for pattern, tool, build in rules:
        if tool not in allowed:
            continue
        if not re.search(pattern, message):
            continue
        if tool == "cement.quote_generate":
            return tool, _cement_args(message, session_id), "规则:%s" % pattern
        args = build(message, session_id) if build else None
        return tool, args, "规则:%s" % pattern
    fallback = tools[0] if tools else ""
    return fallback, None, "默认工具（无规则命中）"


# ---------------------------------------------------------------- 注册表
def load_registry() -> dict[str, Any]:
    with open(REGISTRY, encoding="utf-8") as fh:
        return json.load(fh)


def resolve_project(reg: dict[str, Any], project: str, message: str) -> tuple[dict[str, Any] | None, str]:
    projects = reg.get("projects") or []
    for p in projects:
        if p.get("id") == project:
            return p, "显式指定 project=%s" % project
    # 没有 project 字段时按工具名前缀 / 名称 / id 做最朴素的匹配（真正的意图路由在前端 hub.html）
    low = (message or "").lower()
    for p in projects:
        if p.get("name") and p["name"] in (message or ""):
            return p, "命中项目名 %s" % p["name"]
        if p.get("id") and p["id"] in low:
            return p, "命中 id %s" % p["id"]
    return None, ""


def a2a_base(health: str | None) -> str | None:
    if not health:
        return None
    u = urllib.parse.urlsplit(health)
    return "%s://%s" % (u.scheme, u.netloc)


# ---------------------------------------------------------------- MCP stdio 客户端
class AdapterUnavailable(Exception):
    pass


class _Stdio:
    def __init__(self, cmd: list[str], cwd: str):
        try:
            self.p = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, bufsize=0)
        except (OSError, ValueError) as e:
            raise AdapterUnavailable("spawn failed: %s" % e)
        self.q: queue.Queue[bytes] = queue.Queue()
        self.err: list[bytes] = []
        threading.Thread(target=self._pump_out, daemon=True).start()
        threading.Thread(target=self._pump_err, daemon=True).start()

    def _pump_out(self):
        for line in self.p.stdout:
            self.q.put(line)
        self.q.put(b"")

    def _pump_err(self):
        for line in self.p.stderr:
            self.err.append(line[:400])

    def call(self, req: dict[str, Any], timeout: float) -> dict[str, Any]:
        try:
            self.p.stdin.write((json.dumps(req, ensure_ascii=False) + "\n").encode("utf-8"))
            self.p.stdin.flush()
        except (BrokenPipeError, OSError, ValueError) as e:
            raise AdapterUnavailable("stdin closed: %s; stderr=%s" % (e, b"".join(self.err)[-300:].decode("utf-8", "replace")))
        deadline = time.monotonic() + timeout
        while True:
            remain = deadline - time.monotonic()
            if remain <= 0:
                raise AdapterUnavailable("adapter %ds 内无响应；stderr=%s" % (timeout, b"".join(self.err)[-300:].decode("utf-8", "replace")))
            try:
                line = self.q.get(timeout=min(remain, 0.5))
            except queue.Empty:
                continue
            if line == b"":
                raise AdapterUnavailable("adapter 提前退出；stderr=%s" % b"".join(self.err)[-400:].decode("utf-8", "replace"))
            try:
                obj = json.loads(line.decode("utf-8", "replace"))
            except Exception:
                continue  # stdout 上的非协议行（理论上不该有）跳过
            if obj.get("id") == req.get("id"):
                return obj

    def close(self):
        try:
            self.p.stdin.close()
        except Exception:
            pass
        try:
            self.p.wait(timeout=3)
        except Exception:
            self.p.kill()


def mcp_call(project_id: str, tool: str, args: dict[str, Any]) -> dict[str, Any]:
    """initialize → tools/call。返回 {"data":..., "error":..., "isError":bool}。adapter 级问题抛 AdapterUnavailable。"""
    ad = ADAPTERS.get(project_id)
    if not ad:
        raise AdapterUnavailable("未登记 adapter 启动配置: %s" % project_id)
    python = ad["python"]
    if os.path.isabs(python) and not Path(python).is_file():
        raise AdapterUnavailable("python 不存在: %s" % python)
    script = ad.get("script")
    if script and not Path(script).is_file():
        raise AdapterUnavailable("入口脚本不存在: %s" % script)
    cmd = [python] + list(ad.get("pre_args") or [])
    if ad.get("module"):
        cmd += ["-m", ad["module"]]
    else:
        cmd += [script]
    cmd += list(ad.get("args") or [])
    internal = (ad.get("aliases") or {}).get(tool, tool)
    s = _Stdio(cmd, ad["cwd"])
    try:
        init = s.call({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                                  "clientInfo": {"name": "hub-server", "version": "1"}}}, min(MCP_TIMEOUT_S, 30))
        if "error" in init:
            raise AdapterUnavailable("initialize 失败: %s" % json.dumps(init["error"], ensure_ascii=False)[:200])
        try:
            s.p.stdin.write((json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n").encode("utf-8"))
            s.p.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            pass
        res = s.call({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                      "params": {"name": internal, "arguments": args or {}}}, MCP_TIMEOUT_S)
    finally:
        s.close()
    if "error" in res:
        return {"data": None, "error": res["error"], "isError": True}
    result = res.get("result") or {}
    content = (result.get("content") or [{}])[0]
    text = content.get("text") if isinstance(content, dict) else None
    try:
        data = json.loads(text) if isinstance(text, str) else result
    except Exception:
        data = {"text": text}
    if result.get("isError"):
        return {"data": None, "error": (data.get("error") if isinstance(data, dict) else None) or {"message": str(data)[:300]},
                "isError": True}
    return {"data": data, "error": None, "isError": False}


# ---------------------------------------------------------------- A2A HTTP 客户端
def a2a_call(project_id: str, tool: str, message: str, args: dict[str, Any] | None, base: str | None) -> dict[str, Any]:
    if not base:
        raise AdapterUnavailable("注册表无 health，推不出 A2A 地址")
    ad = ADAPTERS.get(project_id) or {}
    skill = (ad.get("a2a_skill_aliases") or {}).get(tool, tool)
    parts = []
    if isinstance(args, dict) and args:
        parts.append({"kind": "data", "data": args})
    parts.append({"kind": "text", "text": message[:500]})
    body = {"jsonrpc": "2.0", "id": int(time.time() * 1000) % 1_000_000, "method": "message/send",
            "params": {"message": {"role": "user", "parts": parts}, "skill": {"id": skill}}}
    req = urllib.request.Request(base + "/message/send", data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=A2A_TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            raise AdapterUnavailable("A2A HTTP %s" % e.code)
        return {"data": None, "error": payload.get("error") or {"message": "HTTP %s" % e.code}, "isError": True}
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise AdapterUnavailable("A2A %s 不可达: %s" % (base, e))
    if payload.get("error"):
        return {"data": None, "error": payload["error"], "isError": True}
    result = payload.get("result") or {}
    task = result.get("task") or {}
    art = (task.get("artifacts") or [{}])[0]
    for part in art.get("parts") or []:
        if part.get("kind") == "data":
            return {"data": part.get("data"), "error": None, "isError": False}
    return {"data": task or result, "error": None, "isError": False}


# ---------------------------------------------------------------- 回包整理（只整理，不编造）
def _short(v: Any, n: int = 80) -> str:
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[: n - 1] + "…"


def summarize(tool: str, data: Any) -> tuple[str, str]:
    """把 adapter 的真实返回整理成 (answer, evidence)。认得的字段给人话，认得的不了就给结构化摘要。"""
    d = data if isinstance(data, dict) else {}
    notes: list[str] = []
    if "task_id" in d: notes.append("task_id=%s" % _short(d.get("task_id"), 40))
    if "status" in d: notes.append("status=%s" % _short(d.get("status"), 40))
    if "allowed" in d: notes.append("allowed=%s" % d.get("allowed"))
    if "reasons" in d and isinstance(d["reasons"], list): notes.append("reasons=%s" % _short(d["reasons"], 160))
    if "artifact_sha256" in d: notes.append("artifact_sha256=%s…" % str(d.get("artifact_sha256"))[:12])
    if "valid" in d: notes.append("valid=%s" % d.get("valid"))
    if "draft_status" in d: notes.append("draft_status=%s" % d.get("draft_status"))
    if "rfq_id" in d: notes.append("rfq_id=%s" % _short(d.get("rfq_id"), 40))
    if "fact_count" in d: notes.append("fact_count=%s" % d.get("fact_count"))
    if "task_ids" in d and isinstance(d["task_ids"], list): notes.append("task_ids=%d 个" % len(d["task_ids"]))
    # 衡鉴 verify_filing：事实条数 / 是否落库 / 复用
    if isinstance(d.get("claims"), list): notes.append("claims=%d 条" % len(d["claims"]))
    elif isinstance(d.get("claims"), int): notes.append("claims=%d 条" % d["claims"])
    if "persisted" in d: notes.append("persisted=%s" % d.get("persisted"))
    if "task_reused" in d: notes.append("task_reused=%s" % d.get("task_reused"))
    if d.get("note"): notes.append("note=%s" % _short(d.get("note"), 160))
    if "evidence_types" in d and isinstance(d["evidence_types"], list): notes.append("evidence_types=%s" % _short(d["evidence_types"], 120))
    # ResearchOS search_evidence：不传 domain 时返回的是覆盖表，不是检索结果
    if "domains" in d and isinstance(d["domains"], list):
        notes.append("可用域=%s" % _short(d["domains"], 160))
    if "coverage" in d and isinstance(d["coverage"], dict):
        notes.append("覆盖表=%d 个域" % len(d["coverage"]))
    if "canonical" in d: notes.append("canonical=%s allowed=%s" % (d.get("canonical"), d.get("allowed")))
    if "context" in d and isinstance(d["context"], dict) and isinstance(d["context"].get("facts"), dict):
        notes.append("facts=%d 个字段" % len(d["context"]["facts"]))
    keys = sorted(d.keys())[:12] if isinstance(d, dict) else []
    # 贺兰：summary 里才是人话（闸门/建议），不整段倒 dict
    summ = d.get("summary") if isinstance(d.get("summary"), dict) else None
    if summ:
        gates = summ.get("gates") or {}
        notes.append("task_id=%s" % _short(summ.get("task_id"), 40))
        notes.append("release_pass=%s" % summ.get("release_pass"))
        notes.append("mode=%s" % _short(summ.get("mode"), 40))
        for gname, g in gates.items():
            if isinstance(g, dict) and g.get("pass") is False:
                notes.append("%s 未过：%s" % (gname, _short(g.get("issues"), 120)))
        adv = summ.get("advisories") or []
        if isinstance(adv, list) and adv:
            notes.append("advisories=%s" % _short([a.get("code") if isinstance(a, dict) else a for a in adv], 160))
        if isinstance(d.get("report"), dict):
            notes.append("report 字段：%s" % _short(sorted(d["report"].keys()), 200))
    answer = "【%s 真实返回】%s\n\n字段：%s" % (tool, "；".join(notes) if notes else _short(d, 400), ", ".join(keys) or "—")
    if tool == "cement.quote_generate":
        answer += "\n\n注：project_type / cement_usage 为网关默认值（消息里未给出），purchase_city / 面积从消息解析；请业务人员确认。"
    if tool == "researchos.gate_check":
        answer += "\n\ntest_evidence 未由宿主提供时 gate_check 如实返回未验证，这不是假通过。"
    if tool == "researchos.search_evidence" and isinstance(d.get("coverage"), dict):
        answer += ("\n\n说明：search_evidence 的语义是「查证据类型注册表」，返回每个域允许的证据类型，"
                   "不是全文文献检索。这句话里没识别出具体域，所以返回全量覆盖表。")
    evidence = "adapter=true demo=false tool=%s keys=%s" % (tool, ",".join(keys) or "—")
    return answer, evidence


def handle_chat(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    t0 = time.monotonic()
    reg = load_registry()
    project = str(body.get("project") or "")
    message = str(body.get("message") or "")
    protocol = str(body.get("protocol") or "mcp").lower()
    target, why = resolve_project(reg, project, message)
    if not target:
        return 400, {"error": {"code": "ROUTE_UNRESOLVED", "message": "注册表里没有项目 %r" % project,
                               "candidates": [p.get("id") for p in reg.get("projects") or []]}}
    pid = target["id"]
    tools = list(target.get("tools") or [])
    if not tools:
        return 503, {"error": {"code": "ADAPTER_UNAVAILABLE", "project": pid, "detail": "注册表 tools 为空"}}
    session_id = str(body.get("session_id") or uuid.uuid4().hex[:12])
    tool, args, hit = pick_tool(pid, tools, message, session_id)
    route: dict[str, Any] = {"project": pid, "via": protocol, "why": why, "hit": hit}

    if args is None:
        # 工具需要的参数无法从消息推出：如实说明，不猜
        latency = int((time.monotonic() - t0) * 1000)
        return 200, {"answer": "【%s 未执行】该工具需要的参数无法从这句话推出（%s）。请补充参数后再调用；"
                               "本次没有调用任何工具，也没有使用演示数据。" % (tool, "如 fact_id"),
                     "route": route, "tool": tool, "latency_ms": latency, "tools": [], "ms": latency,
                     "evidence": "adapter=false demo=false reason=INPUT_REQUIRED"}

    try:
        if protocol == "a2a":
            r = a2a_call(pid, tool, message, args, a2a_base(target.get("health")))
        else:
            r = mcp_call(pid, tool, args or {})
    except AdapterUnavailable as e:
        return 503, {"error": {"code": "ADAPTER_UNAVAILABLE", "project": pid, "tool": tool, "detail": str(e)[:400]}}

    latency = int((time.monotonic() - t0) * 1000)
    if r["isError"]:
        err = r.get("error") or {}
        answer = "【%s 调用失败】adapter 返回错误：code=%s reason=%s message=%s" % (
            tool, err.get("code"), err.get("reason"), _short(err.get("message") or err, 200))
        return 200, {"answer": answer, "route": route, "tool": tool, "latency_ms": latency, "tools": [tool], "ms": latency,
                     "evidence": "adapter=true demo=false error_code=%s" % err.get("code"), "error": err}
    answer, evidence = summarize(tool, r["data"])
    return 200, {"answer": answer, "route": route, "tool": tool, "latency_ms": latency, "tools": [tool], "ms": latency,
                 "evidence": evidence, "data": r["data"]}


def probe_project(project_id: str, target: dict[str, Any]) -> dict[str, Any]:
    """诚实探针：不假装项目「在线」，只回答「网关是否已配置可启动的 adapter」。
    判定 = 已登记启动配置 + python 存在 + 入口（script 或 module 所在目录）存在。
    真正能否跑通要在 /api/chat 里才见分晓，这里不做假阳性。"""
    ad = ADAPTERS.get(project_id)
    if not ad:
        return {"ok": False, "state": "未登记", "detail": "网关没有该项目的 adapter 启动配置"}
    python = ad.get("python")
    if os.path.isabs(python) and not Path(python).is_file():
        return {"ok": False, "state": "缺失", "detail": "python 不存在: %s" % python}
    script = ad.get("script")
    if script and not Path(script).is_file():
        return {"ok": False, "state": "缺失", "detail": "入口脚本不存在: %s" % script}
    cwd = ad.get("cwd")
    if cwd and not Path(cwd).is_dir():
        return {"ok": False, "state": "缺失", "detail": "工作目录不存在: %s" % cwd}
    return {"ok": True, "state": "可调用", "detail": "adapter 已登记且入口存在（MCP stdio）"}


# ---------------------------------------------------------------- 天气（服务端 key，仅环境变量；前端零 key）
def handle_weather(city: str) -> dict[str, Any]:
    key = os.environ.get("TMAP_KEY")
    if not key:
        return {"status": "未配置", "city": city, "data_time": None, "source": None,
                "note": "服务端未设置 TMAP_KEY；不编造温度/天气"}
    url = "https://apis.map.qq.com/ws/weather/v1/?key=%s&city=%s" % (urllib.parse.quote(key), urllib.parse.quote(city))
    try:
        with urllib.request.urlopen(url, timeout=4) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return {"status": "待核", "city": city, "data_time": None, "source": "tencent-weather", "note": "请求失败: %s" % e}
    if payload.get("status") != 0:
        return {"status": "待核", "city": city, "data_time": None, "source": "tencent-weather",
                "note": "接口 status=%s" % payload.get("status")}
    result = payload.get("result") or {}
    return {"status": "ok", "city": city, "data_time": result.get("updateTime") or result.get("forecasts", [{}])[0].get("updateTime")
            if isinstance(result.get("forecasts"), list) and result.get("forecasts") else result.get("updateTime"),
            "source": "tencent-weather", "result": result}


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "hub-server/1.0"

    def _json(self, status: int, body: dict[str, Any]):
        raw = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self._json(204, {})

    def _static(self, rel: str):
        """静态托管：放行 hub.html、顶层 *.html（产品页）、data/* 与 assets/*（样式与图片）；
        server/ tools/ 等源码目录不对外。禁止越出目录。"""
        allowed = (rel == "hub.html" or rel.startswith("data/") or rel.startswith("assets/")
                   or (rel.endswith(".html") and "/" not in rel))
        if not allowed:
            return self._json(404, {"error": {"code": "NOT_FOUND", "path": rel}})
        base = ROOT.resolve()
        target = (base / rel).resolve()
        if base not in target.parents and target != base:
            return self._json(403, {"error": {"code": "FORBIDDEN"}})
        if not target.is_file():
            return self._json(404, {"error": {"code": "NOT_FOUND", "path": rel}})
        ctype = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
                 ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
                 ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
                 ".ico": "image/x-icon", ".woff2": "font/woff2"}.get(target.suffix.lower(),
                                                                       "application/octet-stream")
        raw = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path in ("/", "/hub.html"):
            return self._static("hub.html")
        if u.path == "/health":
            return self._json(200, {"ok": True, "registry": str(REGISTRY),
                                    "projects": [{"id": p.get("id"), "tools": len(p.get("tools") or []),
                                                  "adapter": p.get("id") in ADAPTERS} for p in load_registry().get("projects") or []]})
        if u.path == "/api/weather":
            q = urllib.parse.parse_qs(u.query)
            return self._json(200, handle_weather((q.get("city") or ["银川"])[0]))
        if u.path == "/api/probe":
            q = urllib.parse.parse_qs(u.query)
            pid = (q.get("project") or [""])[0]
            reg = load_registry()
            target = next((p for p in reg.get("projects") or [] if p.get("id") == pid), None)
            if not target:
                return self._json(404, {"error": {"code": "UNKNOWN_PROJECT", "project": pid}})
            return self._json(200, {"project": pid, **probe_project(pid, target)})
        if not u.path.startswith("/api/"):
            return self._static(urllib.parse.unquote(u.path).lstrip("/"))
        return self._json(404, {"error": {"code": "NOT_FOUND", "path": u.path}})

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path != "/api/chat":
            return self._json(404, {"error": {"code": "NOT_FOUND", "path": u.path}})
        n = int(self.headers.get("Content-Length") or 0)
        if n > 64 * 1024:
            return self._json(413, {"error": {"code": "PAYLOAD_TOO_LARGE"}})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8", "replace") or "{}")
        except Exception as e:
            return self._json(400, {"error": {"code": "BAD_JSON", "message": str(e)[:120]}})
        if not isinstance(body, dict):
            return self._json(400, {"error": {"code": "BAD_JSON", "message": "body 必须是 object"}})
        try:
            status, out = handle_chat(body)
        except Exception as e:  # 网关自身异常也不能挂
            status, out = 500, {"error": {"code": "HUB_INTERNAL", "message": "%s: %s" % (type(e).__name__, str(e)[:200])}}
        self.log_message("%s %s -> %s tool=%s", self.command, u.path, status, out.get("tool"))
        return self._json(status, out)


def resolve_port(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="门户站 /api/chat 网关")
    parser.add_argument("--port", type=int, default=None)
    ns = parser.parse_args(argv)
    if ns.port:
        return ns.port
    env = os.environ.get("HUB_PORT")
    if env and env.isdigit():
        return int(env)
    hub_cfg = load_registry().get("hub_config") or {}
    if hub_cfg.get("port"):
        return int(hub_cfg["port"])
    sys.exit("[FAIL] 未指定端口：用 --port、环境变量 HUB_PORT 或 data/projects.json 的 hub_config.port（不硬编码）")


def main(argv=None):
    port = resolve_port(list(sys.argv[1:] if argv is None else argv))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    sys.stderr.write("[hub] /api/chat on http://127.0.0.1:%d  registry=%s\n" % (port, REGISTRY))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
