#!/usr/bin/env python3
"""把评测中心的真实运行产物编译成站点数据。

数据源优先级：runs/*/result.json（权威，含中心自算的 Wilson 区间与 P95 状态）
             → 回退 runs/_index/eval_center.sqlite（索引可能滞后于目录）

设计约束：
  1. 只读，绝不修改评测中心任何文件。
  2. 每个数字带 run_id 与 source 字段，页面上可追溯到那次运行。
  3. 缺失就是缺失：中心说 INSUFFICIENT_SAMPLE_FOR_P95 就写 null，不补 0、不估算。
  4. 非能力测量（配置错误跑、非 DONE）排除，但排除必须留痕。
  5. 输出 data/metrics.js（window.METRICS），使 file:// 直接打开也可用，不依赖 fetch。

用法：
  python tools/build_site_data.py --center "D:/Agent评测与数据中心" --out .
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import sqlite3
from datetime import datetime, timezone


def wilson(k: int, n: int, z: float = 1.959963985) -> list[float] | None:
    """Wilson score interval（95%）。n=0 返回 None，不返回 [0,1] 这种假区间。"""
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round(max(0.0, (c - m) / d), 4), round(min(1.0, (c + m) / d), 4)]


def suites_with_exclusions(all_runs: list[dict]) -> tuple[list[dict], list[dict]]:
    # 只保留每个 (suite, adapter) 的最新一次
    latest: dict[tuple, dict] = {}
    for r in all_runs:
        key = (r["suite"], r["adapter"])
        if key not in latest or r["started_at"] > latest[key]["started_at"]:
            latest[key] = r
    return list(latest.values()), []


def scan_run_dirs(center: str) -> list[dict]:
    out = []
    for p in glob.glob(os.path.join(center, "runs", "*", "result.json")):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        meta = d.get("meta") or {}
        m = d.get("metrics") or {}
        if not meta.get("suite_id"):
            continue
        lat = m.get("latency") or {}
        out.append(
            {
                "run_id": meta.get("run_id") or os.path.basename(os.path.dirname(p)),
                "suite": meta.get("suite_id"),
                "suite_version": meta.get("suite_version"),
                "adapter": meta.get("adapter_name") or "",
                "adapter_version": meta.get("adapter_version"),
                "started_at": meta.get("started_at") or "",
                "status": m.get("status") or "DONE",
                "n": m.get("n", m.get("n_cases")),
                "passed": m.get("passed"),
                "pass_rate": m.get("pass_rate"),
                "ci_center": m.get("pass_rate_ci95_wilson"),
                "mean_ms": lat.get("mean_ms"),
                "p50_ms": lat.get("p50_ms"),
                "p95_ms": lat.get("p95_ms"),
                "p95_status": lat.get("status"),
                "by_tag": m.get("by_tag") or {},
                "git_head": (meta.get("env") or {}).get("git_head"),
                "source": os.path.relpath(p, center).replace("\\", "/"),
            }
        )
    return out


def scan_sqlite(center: str) -> list[dict]:
    db = os.path.join(center, "runs", "_index", "eval_center.sqlite")
    if not os.path.isfile(db):
        return []
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    out = []
    for r in con.execute("SELECT * FROM runs"):
        d = dict(r)
        out.append(
            {
                "run_id": d.get("run_id"),
                "suite": d.get("suite_id"),
                "suite_version": d.get("suite_version"),
                "adapter": d.get("adapter_name") or "",
                "adapter_version": d.get("adapter_version"),
                "started_at": d.get("started_at") or "",
                "status": d.get("status") or "DONE",
                "n": d.get("n"),
                "passed": d.get("passed"),
                "pass_rate": d.get("pass_rate"),
                "ci_center": None,
                "mean_ms": d.get("mean_latency_ms"),
                "p50_ms": None,
                "p95_ms": d.get("p95_latency_ms"),
                "p95_status": None,
                "by_tag": {},
                "git_head": None,
                "source": f"runs/_index/eval_center.sqlite :: run_id={d.get('run_id')}",
            }
        )
    con.close()
    return out


def count_suites(center: str) -> int:
    d = os.path.join(center, "suites")
    if not os.path.isdir(d):
        return 0
    return sum(1 for x in os.listdir(d) if os.path.isfile(os.path.join(d, x, "suite.json")))


def adapters(center: str) -> list[str]:
    d = os.path.join(center, "adapters")
    if not os.path.isdir(d):
        return []
    return [x for x in sorted(os.listdir(d))
            if os.path.isfile(os.path.join(d, x, "adapter.py"))]


def registry_counts(center: str) -> dict:
    p = os.path.join(center, "data", "registry.json")
    if not os.path.isfile(p):
        return {"datasets": 0, "models": 0}
    reg = json.load(open(p, encoding="utf-8"))
    return {"datasets": len(reg.get("datasets") or []), "models": len(reg.get("models") or [])}


# 套件的展示语义。刻意手写：哪个能比、哪个只能并列、哪个是声明拒绝——这是判断，不能自动推导。
SUITE_META = {
    "industrial_sales_core": ("砼智销", "工业品销售", True, "单一 Agent 承接，可纵向比较版本间变化。"),
    "safety_guard": ("砼智销 / 贺兰有灵", "输入侧安全", True,
                     "衡鉴声明拒绝：无输入侧拦截层（应拦 20 条仅拒答 3 条），该套件对它不可比。"),
    "intent_clarify": ("砼智销 / 衡鉴", "意图澄清（分区）", False,
                       "分区套件：两域各自金标、分母不同，仅并列，不构成排名。"),
    "helan_e2e_40": ("贺兰有灵", "文旅行程端到端", True, "端到端交付物判分，含地点、动线、预算一致性。"),
    "finrisk_guard_16": ("衡鉴", "财报风险", True, "native_verdict：复用项目原生金标脚本，不另造标签。"),
    "finrisk_dialogue_12": ("衡鉴", "财报对话", True, "多轮对话一致性。"),
    "finrisk_memory_12": ("衡鉴", "长期记忆", True, "跨轮记忆保持。"),
    "finrisk_memory_12_noexpand": ("衡鉴", "长期记忆（禁展开）", True, "对照组：禁止上下文展开时的记忆表现。"),
    "researchos_governance": ("ResearchOS", "科研治理", True, "引用可核验性；越界即失败。"),
    "rag_pipeline_deterministic": ("RAG 知识库", "检索确定性", True, "确定性流水线：同输入应得同输出。"),
    "medical_vision_route": ("医影路由", "影像分诊路由", True, "路由决策正确性，不评诊断结论。"),
    "travel_planning_route": ("贺兰规划器", "行程规划路由", True, "规划分支选择正确性。"),
}


def build(center: str) -> dict:
    runs = scan_run_dirs(center)
    if not runs:
        runs = scan_sqlite(center)
    reg = registry_counts(center)

    kept, excluded = [], []
    for r in runs:
        adapter = r["adapter"] or ""
        bad = []
        if "INVALID" in adapter.upper():
            bad.append("适配器名为 INVALID_CONFIG，该次为配置错误运行")
        if (r.get("status") or "").upper() not in ("DONE", "OK", ""):
            bad.append(f"运行状态 {r.get('status')} 非 DONE")
        (excluded if bad else kept).append({**r, "reason": "；".join(bad)} if bad else r)

    # 崩溃或配置错误的那次运行可能没写出 result.json，只留在索引表里。
    # 它同样要出现在"排除记录"里，否则等于悄悄丢掉一次失败。
    seen_ids = {x.get("run_id") for x in excluded}
    for row in scan_sqlite(center):
        if "INVALID" not in (row["adapter"] or "").upper():
            continue
        if row.get("run_id") in seen_ids:
            continue
        excluded.append({**row, "reason": "适配器名为 INVALID_CONFIG，该次为配置错误运行（无 result.json）"})

    # 每个 (suite, adapter) 取最新
    latest: dict[tuple, dict] = {}
    for r in kept:
        key = (r["suite"], r["adapter"])
        if key not in latest or r["started_at"] > latest[key]["started_at"]:
            latest[key] = r

    suites = []
    for r in sorted(latest.values(), key=lambda x: (x["suite"], x["adapter"])):
        product, domain, comparable, note = SUITE_META.get(
            r["suite"], (r["adapter"], "", True, "")
        )
        n, passed = r.get("n"), r.get("passed")
        mine = wilson(int(passed or 0), int(n or 0))
        center_ci = r.get("ci_center")
        # 中心自算区间与自己算的不一致就报出来，不静默选一个
        ci_mismatch = bool(center_ci and mine and any(
            abs(a - b) > 5e-4 for a, b in zip(center_ci, mine)))
        p95 = r.get("p95_ms")
        p95_ok = p95 is not None and (n or 0) >= 200
        suites.append({
            "suite": r["suite"],
            "suite_version": r.get("suite_version"),
            "adapter": r["adapter"],
            "adapter_version": r.get("adapter_version"),
            "product": product,
            "domain": domain,
            "n": n,
            "passed": passed,
            "pass_rate": r.get("pass_rate"),
            "ci95": center_ci or mine,
            "ci_source": "center" if center_ci else "computed",
            "ci_mismatch": ci_mismatch,
            "mean_ms": r.get("mean_ms"),
            "p50_ms": r.get("p50_ms"),
            "p95_ms": p95 if p95_ok else None,
            "p95_raw": p95,
            "p95_note": None if p95_ok else (
                "样本 < 200，中心标记 " + (r.get("p95_status") or "INSUFFICIENT_SAMPLE_FOR_P95")
                if p95 is None else "样本 < 200，P95 仅作参考，不作能力结论"
            ),
            "comparable": comparable,
            "note": note,
            "by_tag": r.get("by_tag") or {},
            "started_at": r.get("started_at"),
            "run_id": r.get("run_id"),
            "source": r.get("source"),
        })

    total_cases = sum((s["n"] or 0) for s in suites)
    passed_cases = sum((s["passed"] or 0) for s in suites)

    return {
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "center_root": center,
        "counts": {
            "datasets": reg["datasets"],
            "models": reg["models"],
            "suites": count_suites(center),
            "adapters": len(adapters(center)),
            "adapter_names": adapters(center),
            "latest_runs": len(suites),
            "cases_in_latest_runs": total_cases,
            "passed_in_latest_runs": passed_cases,
            "excluded": len(excluded),
        },
        "suites": suites,
        "excluded": [
            {
                "suite": e["suite"], "adapter": e["adapter"], "n": e.get("n"),
                "pass_rate": e.get("pass_rate"), "reason": e["reason"],
                "started_at": e.get("started_at"), "run_id": e.get("run_id"),
            } for e in sorted(excluded, key=lambda x: x["started_at"], reverse=True)
        ],
        "conventions": {
            "ci": "Wilson 95% 区间；报告点估计而不报区间等于隐藏不确定性",
            "bootstrap": "bootstrap seed=2027，可复现",
            "provenance": "每次运行归档数据源 SHA-256、数据集卡与 git HEAD",
            "p95_gate": "n<200 不出 P95（INSUFFICIENT_SAMPLE_FOR_P95）",
            "domain_isolation": "分区套件不合并分母；跨域通过率不相减、不排名",
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--center", default="D:/Agent评测与数据中心")
    ap.add_argument("--out", default=".")
    a = ap.parse_args()

    data = build(a.center)
    os.makedirs(os.path.join(a.out, "data"), exist_ok=True)
    with open(os.path.join(a.out, "data", "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    with open(os.path.join(a.out, "data", "metrics.js"), "w", encoding="utf-8") as f:
        f.write("window.METRICS = ")
        json.dump(data, f, ensure_ascii=False)
        f.write(";\n")

    c = data["counts"]
    print(f"suites={c['suites']} adapters={c['adapters']} datasets={c['datasets']} "
          f"rows={c['latest_runs']} cases={c['cases_in_latest_runs']} passed={c['passed_in_latest_runs']} "
          f"excluded={c['excluded']}")
    mism = [s["suite"] + "/" + s["adapter"] for s in data["suites"] if s["ci_mismatch"]]
    print("CI mismatch:", mism or "none")


if __name__ == "__main__":
    main()
