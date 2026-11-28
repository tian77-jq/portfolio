#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/projects.js（浏览器注册表）同步成 data/projects.json（给后端 / 工具 / 评测中心用）。

单一真源：projects.js。本脚本只做格式转换，不修改字段。
用法：
    python tools/sync_projects.py                    # 写入 data/projects.json
    python tools/sync_projects.py --check            # 只比对，不写；不一致时退出码 1
    python tools/sync_projects.py --verify-capability  # 门户 tools/health ↔ 各项目 capability.json 机器校验

--verify-capability（B4/P1-5）：
    门户 projects.js 的 tools 数组不得手写想象的能力，必须与各项目 capability.json 的 tools[].name 集合相等；
    health 的 host:port 必须与 capability.health.a2a.url 一致。
    不一致 → 打印 [MISMATCH] 明细，退出码 1；一致 → "N/N projects consistent"，退出码 0。
    某项目没有 capability.json → 打 WARN 跳过（贺兰目前就是这种），不计入 N。
"""
import json
import os
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "projects.js")
DST = os.path.join(ROOT, "data", "projects.json")

# 项目 id → capability.json 所在目录（审核员 P1-5 指定的四个路径）
CAPABILITY_DIRS = {
    "helan": r"D:\SilverCup-Agent",
    "hengjian": r"D:\Financial Agent\dev\finrisk",
    "cement": r"D:\Cement-SalesAgent",
    "researchos": r"D:\AI-Knowledge-Base2",
}


def _load_capability(cap_dir):
    path = os.path.join(cap_dir, "capability.json")
    if not os.path.isfile(path):
        return None, path
    with open(path, encoding="utf-8") as fh:
        return json.load(fh), path


def _hostport(url):
    u = urlsplit(str(url or ""))
    return (u.hostname or "", u.port)


def verify_capability(data):
    """返回 (ok, checked, lines)。checked 是有 capability.json 且参与比对的项目数。"""
    lines, checked, bad = [], 0, 0
    for p in data["projects"]:
        pid = p.get("id")
        cap_dir = CAPABILITY_DIRS.get(pid)
        if cap_dir is None:
            lines.append("[WARN] %s: 未登记 capability 目录，跳过" % pid)
            continue
        cap, path = _load_capability(cap_dir)
        if cap is None:
            lines.append("[WARN] %s: 无 capability.json（%s），跳过" % (pid, path))
            continue
        checked += 1
        portal_tools = list(p.get("tools") or [])
        cap_tools = [t.get("name") for t in (cap.get("tools") or []) if t.get("name")]
        more = sorted(set(portal_tools) - set(cap_tools))
        less = sorted(set(cap_tools) - set(portal_tools))
        dup = sorted({t for t in portal_tools if portal_tools.count(t) > 1})
        if more or less or dup:
            bad += 1
            parts = []
            if more:
                parts.append("门户多=%s" % more)
            if less:
                parts.append("门户缺=%s" % less)
            if dup:
                parts.append("门户重复=%s" % dup)
            lines.append("[MISMATCH] %s tools: %s" % (pid, "  ".join(parts)))
        else:
            lines.append("[OK] %s tools: %d 项与 capability 一致" % (pid, len(cap_tools)))
        cap_url = ((cap.get("health") or {}).get("a2a") or {}).get("url")
        portal_hp, cap_hp = _hostport(p.get("health")), _hostport(cap_url)
        if cap_hp != (None, None) and portal_hp != cap_hp:
            bad += 1
            lines.append("[MISMATCH] %s health: 门户=%s capability=%s" % (pid, ":".join(map(str, portal_hp)), ":".join(map(str, cap_hp))))
        else:
            lines.append("[OK] %s health: %s:%s" % (pid, portal_hp[0], portal_hp[1]))
    ok = bad == 0
    lines.append("%d/%d projects consistent%s" % (checked - bad, checked, "" if ok else "  → %d 项不一致" % bad))
    return ok, checked, lines


SNIPPET = """
global.window = {};
require(%r);
const P = global.window.PROJECTS || [];
process.stdout.write(JSON.stringify({projects: P, hub_tools: global.window.HUB_TOOLS || [], hub_config: global.window.HUB_CONFIG || {}}, null, 1));
""" % (SRC.replace("\\", "\\\\"),)


def load():
    try:
        out = subprocess.run(["node", "-e", SNIPPET], capture_output=True, timeout=30)
    except FileNotFoundError:
        sys.exit("[FAIL] 未找到 node；本脚本依赖 node 解析 projects.js。装好 node 或手工维护 projects.json。")
    if out.returncode != 0:
        sys.exit("[FAIL] node 解析 projects.js 失败：\n" + out.stderr.decode("utf-8", "replace")[:1200])
    return json.loads(out.stdout.decode("utf-8"))


def main():
    if "--verify-capability" in sys.argv:
        data = load()
        ok, checked, lines = verify_capability(data)
        for line in lines:
            print(line)
        return 0 if ok else 1

    data = load()
    n = len(data["projects"])
    ids = [p.get("id") for p in data["projects"]]
    if len(set(ids)) != n:
        sys.exit("[FAIL] 注册表里存在重复 id：%r" % ids)
    for p in data["projects"]:
        lack = [k for k in ("id", "name", "tag", "url", "tools", "skills", "health") if k not in p]
        if lack:
            sys.exit("[FAIL] 项目 %r 缺字段：%r" % (p.get("id"), lack))
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"

    if "--check" in sys.argv:
        if not os.path.exists(DST):
            print("[DIFF] projects.json 不存在")
            sys.exit(1)
        old = open(DST, encoding="utf-8").read()
        if old != text:
            print("[DIFF] projects.json 与 projects.js 不一致，请运行 python tools/sync_projects.py")
            sys.exit(1)
        print("[OK] 一致：%d 个项目" % n)
        return

    open(DST, "w", encoding="utf-8", newline="\n").write(text)
    print("[OK] 已写入 %s：%d 个项目（%s）" % (DST, n, ", ".join(ids)))


if __name__ == "__main__":
    sys.exit(main())
