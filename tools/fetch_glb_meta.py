# -*- coding: utf-8 -*-
"""
采集全部 GLB 的几何元数据。

思路：GLB 的结构是 [12B header][8B chunk0 header][JSON chunk][8B chunk1 header][BIN chunk]
      —— JSON chunk 在文件最前面，且里面带着每个 accessor 的 count。
      所以只要 Range 请求前 256KB，就能拿到顶点数/索引数/骨骼/动画，
      **完全不需要下载几十 MB 的模型，也不需要解码 Draco。**

输出：evidence/GLB_meta.json + 控制台表格
"""
import json
import os
import struct
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URLS_FILE = os.path.join(ROOT, "evidence", "GLB_urls.txt")
OUT_JSON = os.path.join(ROOT, "evidence", "GLB_meta.json")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)
HEAD_BYTES = 256 * 1024


def fetch_head(url):
    """取文件前 HEAD_BYTES 字节，返回 (bytes, 文件总大小)"""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Range": f"bytes=0-{HEAD_BYTES - 1}"},
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        data = r.read()
        cr = r.headers.get("Content-Range")  # 形如 "bytes 0-262143/909293"
        total = int(cr.split("/")[-1]) if cr else len(data)
        return data, total


def parse_glb(data, url, total):
    if len(data) < 20 or data[:4] != b"glTF":
        return {"url": url, "error": "not a GLB"}

    version, _declared = struct.unpack("<II", data[4:12])
    json_len, json_type = struct.unpack("<II", data[12:20])

    if json_type != 0x4E4F534A:  # 'JSON'
        return {"url": url, "error": f"first chunk is not JSON (0x{json_type:08x})"}

    if 20 + json_len > len(data):
        return {"url": url, "error": f"JSON chunk {json_len}B exceeds fetched {len(data)}B"}

    g = json.loads(data[20 : 20 + json_len].decode("utf-8"))

    accessors = g.get("accessors", [])
    meshes = g.get("meshes", [])
    ext_used = g.get("extensionsUsed", [])

    total_verts = 0
    total_indices = 0
    prim_count = 0
    vertex_attrs = set()
    modes = set()
    skinned_prims = 0
    mesh_rows = []

    for m in meshes:
        mv = 0
        mi = 0
        for p in m.get("primitives", []):
            prim_count += 1
            attrs = p.get("attributes", {})
            vertex_attrs.update(attrs.keys())
            modes.add(p.get("mode", 4))

            # Draco 压缩时 attributes 里仍然是原始 accessor 的 index
            pos = attrs.get("POSITION")
            if pos is not None and pos < len(accessors):
                mv += accessors[pos].get("count", 0)
            idx = p.get("indices")
            if idx is not None and idx < len(accessors):
                mi += accessors[idx].get("count", 0)

            if "JOINTS_0" in attrs:
                skinned_prims += 1

        total_verts += mv
        total_indices += mi
        mesh_rows.append({"name": m.get("name", "?"), "verts": mv, "indices": mi})

    return {
        "url": url,
        "file": url.split("/")[-1].split("?")[0],
        "bytes": total,
        "gltf_version": version,
        "generator": g.get("asset", {}).get("generator", ""),
        "nodes": len(g.get("nodes", [])),
        "meshes": len(meshes),
        "primitives": prim_count,
        "vertices": total_verts,
        "indices": total_indices,
        "triangles": total_indices // 3 if total_indices else None,
        "materials": len(g.get("materials", [])),
        "textures": len(g.get("textures", [])),
        "images": len(g.get("images", [])),
        "skins": len(g.get("skins", [])),
        "animations": len(g.get("animations", [])),
        "bones": sum(len(s.get("joints", [])) for s in g.get("skins", [])),
        "skinned_primitives": skinned_prims,
        "attributes": sorted(vertex_attrs),
        "primitive_modes": sorted(modes),
        "extensions_used": ext_used,
        "draco": "KHR_draco_mesh_compression" in ext_used,
        "mesh_detail": mesh_rows,
    }


def work(line):
    size_hint, url = line.split("\t", 1)
    url = url.strip()
    try:
        data, total = fetch_head(url)
        return parse_glb(data, url, total)
    except Exception as e:
        return {"url": url, "file": url.split("/")[-1], "error": str(e)}


def main():
    lines = [l for l in open(URLS_FILE, encoding="utf-8").read().splitlines() if l.strip()]
    print(f"采集 {len(lines)} 个 GLB 的头部元数据...\n")

    with ThreadPoolExecutor(8) as ex:
        metas = list(ex.map(work, lines))

    ok = [m for m in metas if "error" not in m]
    bad = [m for m in metas if "error" in m]

    ok.sort(key=lambda m: -m["bytes"])

    print(f"{'大小':>8} {'顶点':>9} {'三角面':>9} {'网格':>5} {'材质':>5} {'骨骼':>5} {'动画':>5}  文件")
    print("-" * 118)
    for m in ok:
        tri = m["triangles"] if m["triangles"] is not None else 0
        print(
            f"{m['bytes'] / 1024:7.0f}K {m['vertices']:9,} {tri:9,} "
            f"{m['meshes']:5} {m['materials']:5} {m['bones']:5} {m['animations']:5}  {m['file']}"
        )

    print("-" * 118)
    print(f"成功 {len(ok)} / {len(lines)}")
    print(f"顶点合计   : {sum(m['vertices'] for m in ok):,}")
    print(f"三角面合计 : {sum((m['triangles'] or 0) for m in ok):,}")
    print(f"体积合计   : {sum(m['bytes'] for m in ok) / 1024 / 1024:.1f} MB")
    print(f"Draco 压缩 : {sum(1 for m in ok if m['draco'])} / {len(ok)}")
    print(f"带骨骼     : {sum(1 for m in ok if m['bones'] > 0)} / {len(ok)}")
    print(f"带动画     : {sum(1 for m in ok if m['animations'] > 0)} / {len(ok)}")

    exts = {}
    for m in ok:
        for e in m["extensions_used"]:
            exts[e] = exts.get(e, 0) + 1
    print("\n扩展使用情况:")
    for e, c in sorted(exts.items(), key=lambda x: -x[1]):
        print(f"  {c:3}  {e}")

    if bad:
        print("\n失败:")
        for m in bad:
            print(f"  {m['file']}: {m['error']}")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"ok": ok, "failed": bad}, f, ensure_ascii=False, indent=1)
    print(f"\n已写入 evidence/GLB_meta.json")


if __name__ == "__main__":
    main()
