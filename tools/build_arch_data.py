#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 archcompare 的真实结果生成站点用的架构对照数据。

数据来源（只读，不改动实验产物）：
  D:/Cement-SalesAgent/archcompare/results/arch_compare_*.json   对照汇总
  D:/Cement-SalesAgent/archcompare/results/env_size.csv          环境体积
本脚本不做任何估算：缺字段就写 null，页面显示"未测"。
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os

FRAMEWORK_LABEL = {
    "langgraph": "LangGraph",
    "langchain": "LangChain",
    "llamaindex": "LlamaIndex",
    "autogen": "AutoGen",
}
ORDER = ["langgraph", "langchain", "llamaindex", "autogen"]
PORT_FILE = {
    "langgraph": "ports/p_langgraph.py",
    "langchain": "ports/p_langchain.py",
    "llamaindex": "ports/p_llamaindex.py",
    "autogen": "ports/p_autogen.py",
}


def count_loc(path: str) -> int:
    """有效代码行：去空行与纯注释行。"""
    if not os.path.isfile(path):
        return 0
    n = 0
    for line in open(path, encoding="utf-8"):
        t = line.strip()
        if t and not t.startswith("#"):
            n += 1
    return n


def latest_compare(center: str):
    """优先读 bench_all 的汇总；没有则回退到每个框架各自的最新结果。"""
    files = sorted(glob.glob(os.path.join(center, "results", "arch_compare_*.json")))
    if files:
        path = files[-1]
        return os.path.basename(path), json.load(open(path, encoding="utf-8"))

    rows = []
    for fw in ORDER:
        one = sorted(glob.glob(os.path.join(center, "results", f"arch_{fw}_*.json")),
                     key=os.path.getmtime)
        if one:
            d = json.load(open(one[-1], encoding="utf-8"))
            d["_file"] = os.path.basename(one[-1])
            rows.append(d)
    if not rows:
        return None, None
    env = {}
    csv_path = os.path.join(center, "results", "env_size.csv")
    if os.path.isfile(csv_path):
        for i, line in enumerate(open(csv_path, encoding="utf-8")):
            parts = line.strip().split(",")
            if i == 0 or len(parts) < 4:
                continue
            key = parts[0]
            if key.endswith("312"):
                key = key[:-3]
            try:
                env[key] = {"packages": int(parts[2]), "size_mb": int(parts[3])}
            except ValueError:
                pass
    return ("(各框架最新单次结果)", {
        "stamp": max((r.get("generated_at") or "") for r in rows),
        "repeat": rows[0].get("repeat"),
        "rows": rows,
        "env_sizes": env,
    })


def _ci95(paired: dict):
    """配对差值的 95% 置信区间（正态近似）。区间跨 0 视为未检出差异。"""
    mean, sd, n = paired.get("mean"), paired.get("stdev"), paired.get("n")
    if mean is None or sd is None or not n or n < 2:
        return None
    se = sd / math.sqrt(n)
    return [round(mean - 1.96 * se, 3), round(mean + 1.96 * se, 3)]


def build(center: str) -> dict:
    name, merged = latest_compare(center)
    if not merged:
        return {"ok": False, "reason": "尚未运行 archcompare"}

    rows = {r["framework"]: r for r in merged.get("rows", [])}
    env = merged.get("env_sizes") or {}

    items = []
    bare_ref = None
    native_ref = None
    for fw in ORDER:
        r = rows.get(fw)
        if not r or r.get("skipped") or r.get("failed"):
            items.append({
                "framework": fw, "label": FRAMEWORK_LABEL[fw], "available": False,
                "reason": (r or {}).get("reason") or "未运行",
            })
            continue
        cap = r.get("capability") or {}
        lat = r.get("latency_ms") or {}
        nat = r.get("native_latency_ms") or {}
        if native_ref is None and nat.get("mean"):
            native_ref = nat["mean"]
        if bare_ref is None and (r.get("bare_latency_ms") or {}).get("mean"):
            bare_ref = r["bare_latency_ms"]["mean"]
        size = env.get(fw, {})
        loc = count_loc(os.path.join(center, PORT_FILE.get(fw, "")))
        items.append({
            "framework": fw,
            "label": FRAMEWORK_LABEL[fw],
            "available": True,
            "version": cap.get("version"),
            "container": cap.get("container"),
            "business_same": bool(r.get("business_all_same")),
            "action_match": r.get("action_match_rate"),
            "mean_ms": lat.get("mean"),
            "p95_ms": lat.get("p95"),
            "container_overhead_pct": r.get("container_overhead_pct"),
            "native_mean_ms": nat.get("mean"),
            "packages": size.get("packages"),
            "size_mb": size.get("size_mb"),
            "state_serializable": cap.get("state_serializable"),
            "resume": cap.get("cross_process_resume"),
            "resume_evidence": cap.get("resume_evidence"),
            "paired_overhead_ms": (r.get("paired_overhead_ms") or {}).get("mean"),
            "paired_overhead_median": (r.get("paired_overhead_ms") or {}).get("median"),
            "paired_ci95": _ci95(r.get("paired_overhead_ms") or {}),
            "paired_n": (r.get("paired_overhead_ms") or {}).get("n"),
            "bare_mean_ms": (r.get("bare_latency_ms") or {}).get("mean"),
            "loc": loc,
            "errors": r.get("error_count"),
            "repeat": r.get("repeat"),
        })

    return {
        "ok": True,
        "source": name,
        "stamp": merged.get("stamp"),
        "repeat": merged.get("repeat"),
        "python": "3.12.9",
        "native_mean_ms": native_ref,
        "bare_mean_ms": bare_ref,
        "items": items,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--center", default=r"D:/Cement-SalesAgent/archcompare")
    ap.add_argument("--out", default=".")
    args = ap.parse_args()
    data = build(args.center)
    dst = os.path.join(args.out, "data")
    os.makedirs(dst, exist_ok=True)
    path = os.path.join(dst, "arch.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # 同时产出 JS：file:// 直接打开时 fetch 会被拦截，用全局变量更稳
    js_path = os.path.join(dst, "arch.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.ARCH = ")
        json.dump(data, f, ensure_ascii=False)
        f.write(";\n")
    print("ok", data.get("ok"), "items", len(data.get("items", [])), "->", path, "+ arch.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
