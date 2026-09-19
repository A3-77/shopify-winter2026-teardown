#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 assets-original/ 里的 748 个素材归类，产出 SCENE_MAP.json。

先说结论（这部分是实测得出，不是猜的）
--------------------------------------
原站的素材分成**三层**，命名规律完全不同：

  1. 3D 场景层（77 个：37 GLB + 40 KTX2）
     命名带章节名：EW26_Hero_251207v3 / Sidekick_desktop / Finance_bg-optimized
     → 能 100% 按章节归类。这是"滚动驱动"的那一层。

  2. Rive 图集层（314 个 .webp）
     命名 rive_U113_1.webp … rive_U113_N.webp
     对应技术栈里的 @rive-app/webgl2。U<数字> 是 Rive 内部的 artboard/object id，
     与滚动章节**无关**，是另一套渲染层。

  3. 功能卡片层（~200 个）
     命名 U113_Shop_campaigns.png / U200_Shop_SDK_Minis.png
     这是每个"新功能卡片"的配图。原站有 250+ 个 feature card，
     所以这一层是按**功能**组织的，不是按滚动章节。

  4. 其余：背景底图（BG-*.png）、视频封面（*Poster*）、站点 chrome（favicon/logo/og）、
     以及一批被 Shopify CDN 重命名成内容哈希的文件（如 0dfe781a….mp4）。

所以 SCENE_MAP.json 只对第 1 层做章节映射 —— 那是唯一有可靠命名信号的一层。
对其余层强行编造"章节归属"是假的，这个脚本不干那种事。

用法
----
    python tools/build_scene_map.py
"""

from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGINALS = os.path.join(ROOT, "assets-original")
MANIFEST = os.path.join(ORIGINALS, "manifest.json")
OUT = os.path.join(ORIGINALS, "SCENE_MAP.json")

# --------------------------------------------------------------------- 规则

# 纯内容哈希名（Shopify CDN 对部分上传文件会重命名成这样）
RE_HASHED = re.compile(r"^[0-9a-f]{16,}([._-].*)?$", re.I)
# Rive 图集
RE_RIVE = re.compile(r"^rive[_-]", re.I)
# 功能卡片配图：U<数字>_<名字>.png，以及 xxl_* 这一组 ChatGPT 主题配图
RE_CARD = re.compile(r"^(u\d+|xxl)[_-]", re.I)
# 背景底图（bg 出现在词尾也算：flowerbg-2、u8bg、BG-B1）
RE_BG = re.compile(r"(?:^|[-_.])bg[-_.]|bg[-_.]?\d|^(bg|u\d*bg)[-_.]", re.I)
# 视频封面
RE_POSTER = re.compile(r"poster|preroll|frame", re.I)

# 章节规则。**顺序敏感**：具体章节排在泛化规则前面。
#
# ★ 这里踩过一个坑，值得记下来：
#   最初写的是 r"\bhero\b"、r"\bb2b\b" 这种词边界写法。
#   但正则里的 \b 只把 [A-Za-z0-9] 当单词字符，**下划线不算边界**，
#   于是 "hero_desktop.ktx2"、"b2b_fg_smaller_...glb"、"online_fg_...glb"
#   全部匹配失败，被误判成"未归类" —— 一整个 3D 资产子集就这么丢了。
#   改用 (?<![a-z0-9]) / (?![a-z0-9]) 自定义边界，把下划线当分隔符才对。
def _kw(word: str) -> str:
    """匹配一个独立关键词，下划线/连字符/点都算分隔符。"""
    return rf"(?<![a-z0-9]){word}(?![a-z0-9])"


SECTION_RULES: list[tuple[str, str]] = [
    ("sidekick", r"sidekick"),
    ("agentic", r"agentic"),
    ("shopapp", r"shop[_-]?app"),
    ("developer", r"developer"),
    ("operations", r"operations?"),
    ("marketing", r"marketing"),
    ("checkout", r"checkout"),
    ("shipping", r"shipping"),
    ("retail", r"retail"),
    ("finance", r"finance"),
    ("b2b", _kw("b2b")),
    ("online", _kw("online")),
    ("pos", rf"{_kw('pos')}|pos[_-]v53"),
    ("hero", _kw("hero")),
]

SECTION_LABEL = {
    "hero": "Hero —— 首屏（暖色油画感）",
    "sidekick": "Sidekick —— 冷色科技感",
    "finance": "Finance",
    "retail": "Retail",
    "operations": "Operations",
    "online": "Online",
    "shipping": "Shipping",
    "checkout": "Checkout",
    "marketing": "Marketing",
    "b2b": "B2B",
    "developer": "Developer",
    "shopapp": "Shop App",
    "agentic": "Agentic",
    "pos": "POS（线下零售）",
}

LAYER_LABEL = {
    "mobile-fallback": "移动端兜底图（12 张，与章节无关）",
    "shared": "通用素材（噪声 / 法线 / 道具）",
    "rive": "Rive 图集（@rive-app/webgl2 用的纹理集，与章节无关）",
    "feature-card": "功能卡片配图（按功能组织，不按滚动章节）",
    "background": "背景底图",
    "video-poster": "视频封面",
    "ui-chrome": "站点 chrome（favicon / logo / og 图）",
    "content-hashed": "CDN 内容哈希名 —— 文件名无任何语义，无法归类",
    "unclassified": "未归类",
}


def classify(name: str) -> str:
    """返回分组 key。判定顺序即优先级。"""
    low = name.lower()

    # 0. 兜底图与通用件先摘出来
    #    注意 fallback 的命名不统一：有 Fallback_Mobile_Hero_2x 也有 herofallback.jpg
    if "fallback" in low:
        return "mobile-fallback"
    if re.search(r"noise|mud|grain|globe|rigged[_-]?book", low) or low in (
        "key.glb",
        "key.png",
    ):
        return "shared"

    # 1. 3D 场景层：按章节
    for scene, pat in SECTION_RULES:
        if re.search(pat, low):
            return scene

    # 2. Rive 图集
    if RE_RIVE.match(low):
        return "rive"

    # 3. 功能卡片配图
    if RE_CARD.match(low):
        return "feature-card"

    # 4. 站点 chrome
    if re.search(r"favicon|logo|opengraph|og[_-]?image|^share\.|icon", low):
        return "ui-chrome"

    # 5. 背景 / 封面
    if RE_POSTER.search(low):
        return "video-poster"
    if RE_BG.match(low):
        return "background"

    # 6. 内容哈希名
    if RE_HASHED.match(os.path.splitext(low)[0]):
        return "content-hashed"

    return "unclassified"


def human(n: int) -> str:
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return f"{n:.1f} {u}" if u != "B" else f"{n} B"
        n /= 1024.0
    return str(n)


def main() -> int:
    if not os.path.exists(MANIFEST):
        print("× 找不到 assets-original/manifest.json")
        print("  请先运行: python tools/fetch_assets.py")
        return 1

    m = json.load(open(MANIFEST, encoding="utf-8"))

    groups: dict[str, dict[str, list[str]]] = {}
    counts: dict[str, int] = {}
    size: dict[str, int] = {}

    for f in m["files"]:
        path = f["path"]
        name = os.path.basename(path)
        cat = path.split("/")[0] if "/" in path else "misc"
        g = classify(name)

        groups.setdefault(g, {}).setdefault(cat, []).append(path)
        counts[g] = counts.get(g, 0) + 1
        size[g] = size.get(g, 0) + f.get("bytes", 0)

    for g in groups:
        for cat in groups[g]:
            groups[g][cat].sort()

    # ---- 打印 ----
    print(f"{'分组':<34}{'文件数':>7}{'体积':>11}   模型/贴图/图片/视频")
    print("-" * 84)
    for g in sorted(groups, key=lambda k: -counts[k]):
        c = groups[g]
        detail = " / ".join(
            str(len(c.get(k, []))) for k in ("models", "textures", "images", "video")
        )
        print(f"{LAYER_LABEL.get(g, SECTION_LABEL.get(g, g)):<34}{counts[g]:>7}{human(size[g]):>11}   {detail}")
    print("-" * 84)
    print(f"{'合计':<34}{m['count']:>7}{human(m['total_bytes']):>11}")

    scenes = {
        g: {
            "label": SECTION_LABEL.get(g, LAYER_LABEL.get(g, g)),
            "kind": "3d-scene" if g in SECTION_LABEL else "layer",
            "count": counts[g],
            "bytes": size[g],
            "files": groups[g],
        }
        for g in sorted(groups, key=lambda k: -counts[k])
    }

    doc = {
        "_note": (
            "素材分组索引。只有 3D 场景层（kind=3d-scene）能按章节可靠归类 —— "
            "因为只有它的文件名带章节名。Rive 图集层与功能卡片层是按别的维度组织的，"
            "强行映射到滚动章节会是编造。详见本文件生成脚本 tools/build_scene_map.py 的头部说明。"
        ),
        "source": m["source"],
        "generated": m["generated"],
        "total_files": m["count"],
        "total_bytes": m["total_bytes"],
        "scene_layer_count": sum(1 for g in scenes if scenes[g]["kind"] == "3d-scene"),
        "groups": scenes,
    }
    with open(OUT, "w", encoding="utf-8") as fp:
        json.dump(doc, fp, ensure_ascii=False, indent=1)

    print(f"\n✓ 已写出 {OUT}")
    print(f"  其中 3D 场景层（可按章节定位）: {doc['scene_layer_count']} 组")
    return 0


if __name__ == "__main__":
    sys.exit(main())
