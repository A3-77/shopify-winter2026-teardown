#!/usr/bin/env python3
"""
把「几何口径」和「渲染口径」的三角面数都算出来 —— 这两个数字不一样，差在哪值得说清楚。

背景
----
`tools/fetch_glb_meta.py` 统计的三角形数是**去重几何口径**：
它遍历 `gltf["meshes"]`，把每个 mesh 的 `indices.count` 加起来除以 3。

但 glTF 的 `meshes` 和 `nodes` 是分开的 —— 同一个 mesh 可以被多个 node 引用。
three.js 的 GLTFLoader 会为**每个 node 建一个 Mesh 对象**（共享同一份 geometry）。
所以真正送进 GPU 的三角面数是**渲染口径**：要按 node 引用次数重复计。

实测例子：`EW26_Finance_251208v2`
    nodes 85 / meshes 7  →  去重几何 46,793 面，渲染 49,063 面
差 2,270 面，全部来自被重复引用的 mesh（10 枚硬币共用同一份几何）。

结论：报告里「全站 883,812 三角面」是**几何口径**，不是 GPU 实际处理的量。
两者差多少，这个脚本给答案。

用法
----
    python tools/count_render_triangles.py
    python tools/count_render_triangles.py --json   # 机器可读输出
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "assets-original" / "models"


def read_gltf_json(path: Path) -> dict | None:
    """只读 GLB 的 JSON chunk，不碰 BIN chunk（几何数据一个字节都不用下）。"""
    with path.open("rb") as f:
        header = f.read(12)
        if len(header) < 12:
            return None
        magic, version, _length = struct.unpack("<III", header)
        if magic != 0x46546C67:  # 'glTF'
            return None
        # 第一个 chunk 必须是 JSON
        clen, ctype = struct.unpack("<II", f.read(8))
        if ctype != 0x4E4F534A:  # 'JSON'
            return None
        return json.loads(f.read(clen).decode("utf-8"))


def mesh_triangles(g: dict, mesh: dict) -> int:
    """一个 mesh 下所有 primitive 的三角面数（几何口径）。"""
    accessors = g.get("accessors", [])
    total = 0
    for prim in mesh.get("primitives", []):
        # Draco 压缩的 primitive 里 indices 在扩展里，count 仍写在 accessor
        idx = prim.get("indices")
        if idx is not None and idx < len(accessors):
            total += accessors[idx].get("count", 0) // 3
            continue
        pos = prim.get("attributes", {}).get("POSITION")
        if pos is not None and pos < len(accessors):
            total += accessors[pos].get("count", 0) // 3
    return total


def analyse(path: Path) -> dict | None:
    g = read_gltf_json(path)
    if not g:
        return None

    meshes = g.get("meshes", [])
    per_mesh = [mesh_triangles(g, m) for m in meshes]

    geom_tris = sum(per_mesh)
    geom_verts = 0
    accessors = g.get("accessors", [])
    for m in meshes:
        for prim in m.get("primitives", []):
            pos = prim.get("attributes", {}).get("POSITION")
            if pos is not None and pos < len(accessors):
                geom_verts += accessors[pos].get("count", 0)

    # 渲染口径：每个引用 mesh 的 node 都算一次
    render_tris = 0
    render_verts = 0
    render_meshes = 0
    instanced = 0
    for node in g.get("nodes", []):
        mi = node.get("mesh")
        if mi is None or mi >= len(meshes):
            continue
        render_tris += per_mesh[mi]
        render_meshes += 1
        m = meshes[mi]
        for prim in m.get("primitives", []):
            pos = prim.get("attributes", {}).get("POSITION")
            if pos is not None and pos < len(accessors):
                render_verts += accessors[pos].get("count", 0)

    # 有多少 mesh 被不止一个 node 引用
    ref_count: dict[int, int] = {}
    for node in g.get("nodes", []):
        mi = node.get("mesh")
        if mi is not None:
            ref_count[mi] = ref_count.get(mi, 0) + 1
    instanced = sum(1 for c in ref_count.values() if c > 1)

    return {
        "file": path.name,
        "nodes": len(g.get("nodes", [])),
        "meshes": len(meshes),
        "mesh_instances": render_meshes,
        "instanced_meshes": instanced,
        "geom_vertices": geom_verts,
        "geom_triangles": geom_tris,
        "render_vertices": render_verts,
        "render_triangles": render_tris,
        "delta": render_tris - geom_tris,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--dir", default=str(MODELS), help="GLB 目录")
    args = ap.parse_args()

    d = Path(args.dir)
    if not d.is_dir():
        print(f"目录不存在：{d}", file=sys.stderr)
        print("先跑 python tools/fetch_assets.py --only 3d", file=sys.stderr)
        return 1

    rows = []
    for p in sorted(d.glob("*.glb")):
        r = analyse(p)
        if r:
            rows.append(r)

    if not rows:
        print("没有找到 GLB", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    tot_geom_t = sum(r["geom_triangles"] for r in rows)
    tot_rend_t = sum(r["render_triangles"] for r in rows)
    tot_geom_v = sum(r["geom_vertices"] for r in rows)
    tot_rend_v = sum(r["render_vertices"] for r in rows)

    print(f"{'模型':<56}{'nodes':>6}{'meshes':>7}{'inst':>6}{'几何面':>10}{'渲染面':>10}{'差':>8}")
    print("-" * 103)
    for r in sorted(rows, key=lambda x: -x["render_triangles"]):
        name = r["file"][:54]
        print(
            f"{name:<56}{r['nodes']:>6}{r['meshes']:>7}{r['instanced_meshes']:>6}"
            f"{r['geom_triangles']:>10,}{r['render_triangles']:>10,}{r['delta']:>8,}"
        )

    print("-" * 103)
    print(f"{'合计（%d 个模型）' % len(rows):<56}{'':>6}{'':>7}{'':>6}"
          f"{tot_geom_t:>10,}{tot_rend_t:>10,}{tot_rend_t - tot_geom_t:>8,}")
    print()
    print(f"顶点  几何口径 {tot_geom_v:>10,}    渲染口径 {tot_rend_v:>10,}    差 {tot_rend_v - tot_geom_v:>8,}")
    print(f"三角面 几何口径 {tot_geom_t:>10,}    渲染口径 {tot_rend_t:>10,}    差 {tot_rend_t - tot_geom_t:>8,}"
          f"   (+{(tot_rend_t / tot_geom_t - 1) * 100:.2f}%)")
    print()
    n_inst = sum(1 for r in rows if r["instanced_meshes"] > 0)
    print(f"有实例化 mesh 的模型：{n_inst} / {len(rows)}")
    print()
    print("读法：")
    print("  几何口径 = 去重后的几何总量（报告里的 883,812 用的是这个）")
    print("  渲染口径 = three.js 按 node 建 Mesh 后真正送进 GPU 的量")
    print("  两者不一致的原因：同一个 mesh 被多个 node 引用时，渲染要重复计数")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
