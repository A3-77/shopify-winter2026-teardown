# -*- coding: utf-8 -*-
"""
探测真实站点全部 GLB 的体积分布，决定采集策略。
（只发 HEAD 请求，不下载内容）
"""
import json
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "evidence", "ASSETS_full.json")

urls = json.load(open(ASSETS, encoding="utf-8"))
glbs = sorted({u for u in urls if u.lower().split("?")[0].endswith(".glb")})
print(f"GLB 总数: {len(glbs)}\n")


def head(u):
    try:
        req = urllib.request.Request(u, method="HEAD")
        with urllib.request.urlopen(req, timeout=25) as r:
            return u, int(r.headers.get("Content-Length") or 0)
    except Exception as e:
        return u, -1


with ThreadPoolExecutor(8) as ex:
    results = list(ex.map(head, glbs))

ok = [(u, s) for u, s in results if s > 0]
bad = [(u, s) for u, s in results if s <= 0]

total = sum(s for _, s in ok)
print(f"{'大小':>10}  文件名")
print("-" * 78)
for u, s in sorted(ok, key=lambda x: -x[1]):
    name = u.split("/")[-1].split("?")[0]
    print(f"{s / 1024 / 1024:9.2f}M  {name}")

print("-" * 78)
print(f"可访问 {len(ok)} 个，合计 {total / 1024 / 1024:.1f} MB")
if bad:
    print(f"不可访问 {len(bad)} 个:")
    for u, _ in bad:
        print("   ", u)

with open(os.path.join(ROOT, "evidence", "GLB_urls.txt"), "w", encoding="utf-8") as f:
    for u, s in sorted(ok, key=lambda x: -x[1]):
        f.write(f"{s}\t{u}\n")
print(f"\n已写入 evidence/GLB_urls.txt")
