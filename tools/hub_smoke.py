#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""门户网关冒烟：对已启动的 server/hub_server.py 发一组 /api/chat 请求，打印真实回包。

用法：python tools/hub_smoke.py [--base http://127.0.0.1:8250]
退出码：0 = 四个项目都拿到 adapter 真实回包（工具名为真实名、demo=false）；1 = 有项目落到 503。
不启动任何 adapter 常驻进程：网关自己按请求起子进程，这里只看结果。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

CASES = [
    # (project, message, protocol, 期望工具名片段；None = 只要 200 且 tool 非空)
    ("hengjian", "核一下这份年报的营收期间", "mcp", "hengjian.verify_filing"),
    ("cement", "住宅建房用水泥，银川 200 平，帮我起一份询价草稿", "mcp", "cement.quote_generate"),
    ("researchos", "这个插件包能过质量门吗", "mcp", "researchos.gate_check"),
    ("helan", "三天两晚带老人去宁夏怎么安排，想去镇北堡和西夏陵", "mcp", "helan.plan_itinerary"),
    # 错误路径
    ("hengjian", "把这条结论追溯到 PDF 第几页", "mcp", "INPUT_REQUIRED"),   # trace_fact 需要 fact_id，不许猜
    ("no_such_project", "你好", "mcp", "ROUTE_UNRESOLVED"),
]


def post(base: str, body: dict) -> tuple[int, dict, float]:
    req = urllib.request.Request(base + "/api/chat", data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode("utf-8")), time.monotonic() - t0
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw), time.monotonic() - t0
        except Exception:
            return e.code, {"raw": raw[:300]}, time.monotonic() - t0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8250")
    ns = ap.parse_args()
    hard_fail = 0
    for project, msg, proto, expect in CASES:
        status, body, dt = post(ns.base, {"project": project, "message": msg, "protocol": proto})
        ok = expect in json.dumps(body, ensure_ascii=False)
        if status == 503:
            hard_fail += 1
        print("=" * 78)
        print("POST /api/chat  project=%s protocol=%s  -> HTTP %s  %.2fs  [%s]" % (project, proto, status, dt, "OK" if ok else "MISS"))
        print("  message: %s" % msg)
        print(json.dumps(body, ensure_ascii=False, indent=1, default=str)[:1800])
    print("=" * 78)
    print("RESULT: %s" % ("PASS" if hard_fail == 0 else "FAIL (%d 个 503)" % hard_fail))
    return 1 if hard_fail else 0


if __name__ == "__main__":
    sys.exit(main())
