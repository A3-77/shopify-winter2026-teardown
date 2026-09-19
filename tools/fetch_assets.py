#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把原站公开 CDN 上的素材全量拉回本地，落成一份可离线使用的 assets-original/。

为什么需要它
------------
逆向报告只存了"元数据 + URL 清单"，那样仓库是不可复现的：
你没法验证我关于几何/贴图的任何结论，也没法拿真实素材跑复刻 Demo。
这个脚本把"证据"补成"实物"。

用法
----
    python tools/fetch_assets.py --probe            # 只探测体积，不下载
    python tools/fetch_assets.py --only 3d          # 只下 GLB + KTX2（约 20 MB）
    python tools/fetch_assets.py --only 3d,image    # 再加 2D 图片
    python tools/fetch_assets.py                    # 全量（含视频）

设计要点
--------
1. Shopify CDN 会拒绝不带 User-Agent 的请求 —— 必须带 UA。
2. 同一张图有 6 个 ?width= 变体，按 path 去重后只留一份（默认取最大变体）。
3. 并发下载（ThreadPoolExecutor），失败重试 3 次，逐条记账。
4. 落盘后写 manifest.json：原始 URL / 本地路径 / 字节数 / sha256，可校验。

作者：阿枢    最后更新：2026-09-20
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse as up
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(ROOT, "evidence")
OUT = os.path.join(ROOT, "assets-original")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# 分类规则：按扩展名落到哪个子目录
CATEGORY = {
    "glb": "models",
    "ktx2": "textures",
    "png": "images",
    "webp": "images",
    "jpg": "images",
    "jpeg": "images",
    "svg": "images",
    "mp4": "video",
    "webm": "video",
    "json": "data",
    "woff2": "fonts",
}

# --only 的分组别名
GROUPS = {
    "3d": {"glb", "ktx2"},
    "image": {"png", "webp", "jpg", "jpeg", "svg"},
    "video": {"mp4", "webm"},
    "data": {"json"},
    "font": {"woff2"},
}


def log(*a):
    print(*a, flush=True)


def ext_of(url: str) -> str:
    path = up.urlparse(url).path
    tail = path.rsplit("/", 1)[-1]
    return tail.rsplit(".", 1)[-1].lower() if "." in tail else ""


def dedupe(urls: list[str]) -> dict[str, str]:
    """按 host+path 去重。同一 path 有多个 ?width= 变体时，保留 width 最大的那个。"""

    def width(u: str) -> int:
        q = up.parse_qs(up.urlparse(u).query)
        try:
            return int(q.get("width", ["0"])[0])
        except ValueError:
            return 0

    best: dict[str, str] = {}
    for u in urls:
        p = up.urlparse(u)
        key = p.netloc + p.path
        if key not in best or width(u) > width(best[key]):
            best[key] = u
    return best


def request(url: str, rng: str | None = None, timeout: int = 60):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if rng:
        headers["Range"] = rng
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout)


def probe_one(url: str) -> tuple[str, int]:
    """取字节数。用 Range: bytes=0-0 拿 Content-Range，比 HEAD 稳。"""
    try:
        with request(url, "bytes=0-0", timeout=45) as r:
            cr = r.headers.get("Content-Range")
            if cr and "/" in cr:
                return url, int(cr.split("/")[-1])
            cl = r.headers.get("Content-Length")
            return url, int(cl) if cl else -1
    except Exception as e:  # noqa: BLE001
        return url, -1


def human(n: int) -> str:
    if n < 0:
        return "?"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024.0
    return str(n)


def local_path_for(url: str, taken: set[str] | None = None) -> str:
    """
    决定文件落盘到哪里。返回 **POSIX 风格** 路径。

    为什么坚持正斜杠：这个路径会进 manifest.json，再被浏览器拼成 URL。
    Windows 上 os.path.join 给的是反斜杠，写进 JSON 就是 "models\\xxx.glb"，
    虽然浏览器 URL 解析器会容忍，但显示出来很难看，也容易在下游出错。

    为什么文件名保持原样（不带哈希）：实测 748 个唯一 URL 的原始文件名
    **零重复**，所以加哈希前缀是纯噪音 —— 直接露出 CDN 上的真名更好认。
    真撞名了才补一个 8 位哈希。
    """
    e = ext_of(url)
    cat = CATEGORY.get(e, "misc")
    name = os.path.basename(up.urlparse(url).path)
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)

    key = f"{cat}/{name}"
    if taken is not None and key in taken:
        h = hashlib.sha1(up.urlparse(url).path.encode()).hexdigest()[:8]
        stem, dot, ext = name.rpartition(".")
        key = f"{cat}/{stem}-{h}.{dot}{ext}" if dot else f"{cat}/{name}-{h}"
    if taken is not None:
        taken.add(key)
    return key


def adopt_legacy_name(full: str) -> None:
    """
    兼容旧命名：早期版本给每个文件都加了 -<sha1:8> 后缀。
    如果干净名字不存在、但同目录下有 <stem>-????????.<ext>，就地改名，
    省掉 356 MB 的重新下载。
    """
    if os.path.exists(full):
        return
    d, base = os.path.split(full)
    stem, dot, ext = base.rpartition(".")
    if not dot:
        return
    if not os.path.isdir(d):
        return
    for fn in os.listdir(d):
        m = re.fullmatch(rf"{re.escape(stem)}-[0-9a-f]{{8}}\.{re.escape(ext)}", fn)
        if m:
            os.replace(os.path.join(d, fn), full)
            return


def download_one(url: str, path: str) -> dict:
    full = os.path.join(OUT, *path.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    adopt_legacy_name(full)
    # 记下 CDN 上的原始文件名 —— manifest 合并元数据时要靠它精确匹配，
    # 不能用模糊前缀（会误伤，实测把 37 个 GLB 匹配成 44 个）。
    src_name = os.path.basename(up.urlparse(url).path)

    if os.path.exists(full) and os.path.getsize(full) > 0:
        data = open(full, "rb").read()
        return {
            "url": url, "path": path, "src_name": src_name, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "status": "cached",
        }

    last = ""
    for attempt in range(3):
        try:
            with request(url) as r:
                data = r.read()
            if not data:
                raise RuntimeError("空响应")
            with open(full, "wb") as f:
                f.write(data)
            return {
                "url": url, "path": path, "src_name": src_name, "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(), "status": "ok",
            }
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.5 * (attempt + 1))
    return {
        "url": url, "path": path, "src_name": src_name, "bytes": 0,
        "sha256": "", "status": "fail", "error": last,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="只探测体积")
    ap.add_argument("--only", default="", help="逗号分隔：3d,image,video,data,font")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--include-failed", action="store_true",
                    help="连上次失败的也重试")
    args = ap.parse_args()

    src = os.path.join(EVIDENCE, "ASSETS_full.json")
    if not os.path.exists(src):
        log(f"× 找不到 {src}")
        return 1

    raw = json.load(open(src, encoding="utf-8"))
    urls = [u.replace("&amp;", "&") for u in raw]

    # GLB 也单独维护了一份清单。注意历史格式是 "字节数\tURL"，
    # 早期版本没剥前缀，导致同一批 URL 被当成两批（去重后 74 而非 37）。
    glb_list = os.path.join(EVIDENCE, "GLB_urls.txt")
    if os.path.exists(glb_list):
        for line in open(glb_list, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            m = re.match(r"^\d+\t(https?://\S+)$", line)
            urls.append(m.group(1) if m else line)

    uniq = dedupe(urls)
    log(f"原始条目 {len(urls)} → 去重后 {len(uniq)} 个唯一文件")

    if args.only:
        want = set()
        for g in args.only.split(","):
            g = g.strip()
            want |= GROUPS.get(g, {g})
        uniq = {k: v for k, v in uniq.items() if ext_of(v) in want}
        log(f"过滤 --only {args.only} → {len(uniq)} 个")

    if args.probe:
        log(f"探测 {len(uniq)} 个文件的体积…")
        total = 0
        by_cat: dict[str, int] = {}
        cnt: dict[str, int] = {}
        with futures.ThreadPoolExecutor(args.jobs) as ex:
            for i, (u, n) in enumerate(ex.map(probe_one, uniq.values()), 1):
                cat = CATEGORY.get(ext_of(u), "misc")
                if n > 0:
                    total += n
                    by_cat[cat] = by_cat.get(cat, 0) + n
                cnt[cat] = cnt.get(cat, 0) + 1
                if i % 100 == 0:
                    log(f"  …{i}/{len(uniq)}")
        log("")
        log(f"{'分类':<10}{'文件数':>8}{'体积':>14}")
        for c in sorted(by_cat, key=lambda k: -by_cat[k]):
            log(f"{c:<10}{cnt[c]:>8}{human(by_cat[c]):>14}")
        log(f"{'合计':<10}{len(uniq):>8}{human(total):>14}")
        return 0

    log(f"下载 {len(uniq)} 个文件 → {OUT}")
    os.makedirs(OUT, exist_ok=True)
    results: list[dict] = []
    done = 0
    # taken 在主线程里顺序累积（字典推导先于 submit 求值），并发下不会竞争
    taken: set[str] = set()
    paths = {u: local_path_for(u, taken) for u in uniq.values()}
    with futures.ThreadPoolExecutor(args.jobs) as ex:
        futs = {ex.submit(download_one, u, paths[u]): u for u in uniq.values()}
        for f in futures.as_completed(futs):
            r = f.result()
            results.append(r)
            done += 1
            if r["status"] == "fail":
                log(f"  × {r['path']}  {r.get('error', '')}")
            if done % 50 == 0:
                log(f"  …{done}/{len(uniq)}")

    results.sort(key=lambda r: r["path"])
    ok = [r for r in results if r["status"] in ("ok", "cached")]
    bad = [r for r in results if r["status"] == "fail"]
    total = sum(r["bytes"] for r in ok)

    # 把 GLB 的几何元数据（顶点/三角面/骨骼/扩展）并进 manifest，
    # 这样素材浏览器不用再去读 evidence/GLB_meta.json 就能显示统计。
    meta_by_file: dict[str, dict] = {}
    meta_src = os.path.join(EVIDENCE, "GLB_meta.json")
    if os.path.exists(meta_src):
        try:
            for m in json.load(open(meta_src, encoding="utf-8")).get("ok", []):
                meta_by_file[m["file"]] = m
        except Exception as e:  # noqa: BLE001
            log(f"! GLB_meta.json 解析失败，跳过元数据合并: {e}")

    if meta_by_file:
        merged = 0
        for r in results:
            m = meta_by_file.get(r.get("src_name", ""))
            if m is None:
                continue
            r["meta"] = {
                k: m.get(k)
                for k in (
                    "vertices", "triangles", "nodes", "meshes", "materials",
                    "textures", "skins", "bones", "animations", "draco",
                    "extensions_used", "generator",
                )
            }
            merged += 1
        log(f"✓ 已为 {merged} 个 GLB 合并几何元数据（精确匹配 {len(meta_by_file)} 条）")

    manifest = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "https://www.shopify.com/editions/winter2026",
        "note": "原站公开 CDN 素材副本，仅用于个人逆向研究与复刻参考。版权归 Shopify 及原权利人。",
        "count": len(results),
        "ok": len(ok),
        "failed": len(bad),
        "total_bytes": total,
        "files": results,
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    log("")
    log(f"✓ 成功 {len(ok)}  失败 {len(bad)}  合计 {human(total)}")
    log(f"✓ 清单 → {os.path.join(OUT, 'manifest.json')}")
    return 0 if not bad else 2


if __name__ == "__main__":
    sys.exit(main())
