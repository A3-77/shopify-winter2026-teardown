# -*- coding: utf-8 -*-
"""
为复刻 Demo 生成程序化占位素材。
全部用 numpy 向量化，避免逐像素 Python 循环（上次超时的原因）。

这些图只是"占位"，用来验证：
  bg / mid / fg 三层分离 -> 视差
  暖色 / 冷色对比       -> 章节过渡看得出来
  噪声图 / 法线图       -> 过渡 shader 的扰动可用

你要换成自己的图，只需替换 public/assets/ 下的同名文件即可。
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "replica", "public", "assets")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

rng = np.random.default_rng(20260919)


# ---------------------------------------------------------------- noise utils
def value_noise(h, w, cells, seed_rng):
    """cells x cells 随机格点 -> smoothstep 双线性上采样到 h x w。"""
    g = seed_rng.random((cells + 1, cells + 1)).astype(np.float32)
    ys = np.linspace(0, cells, h, endpoint=False)
    xs = np.linspace(0, cells, w, endpoint=False)
    y0 = ys.astype(np.int32)
    x0 = xs.astype(np.int32)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    fy = fy * fy * (3.0 - 2.0 * fy)
    fx = fx * fx * (3.0 - 2.0 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(h, w, octaves=5, base=4, rng_=None):
    r = rng_ or rng
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(h, w, base * (2 ** o), r)
        tot += amp
        amp *= 0.5
    return out / tot


def norm01(a):
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / max(hi - lo, 1e-6)


def gradient(h, w, top, bottom):
    """竖直渐变，返回 h x w x 3。"""
    t = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None, None]
    top = np.array(top, np.float32).reshape(1, 1, 3)
    bottom = np.array(bottom, np.float32).reshape(1, 1, 3)
    return np.repeat(top * (1 - t) + bottom * t, w, axis=1)


def save(arr, name):
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr)
    p = os.path.join(OUT, name)
    img.save(p, optimize=True)
    print(f"  {name:<22} {img.size[0]}x{img.size[1]}  {os.path.getsize(p)/1024:.1f} KB")


# ---------------------------------------------------------------- 1. hero-bg
def make_hero_bg(h=900, w=1600):
    """暖色油画感：赭石 -> 深褐，叠加云状 fbm，加径向暗角。"""
    base = gradient(h, w, (214, 168, 118), (58, 34, 26))
    n = norm01(fbm(h, w, octaves=6, base=3))
    # 油画笔触感：叠一层高频
    n2 = norm01(fbm(h, w, octaves=3, base=18))
    cloud = 0.62 * n + 0.38 * n2
    cloud = cloud[:, :, None]

    warm = np.array([236, 196, 140], np.float32).reshape(1, 1, 3)
    dark = np.array([42, 24, 20], np.float32).reshape(1, 1, 3)
    img = base * 0.35 + (dark * (1 - cloud) + warm * cloud) * 0.75

    # 径向暗角
    yy = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(-1, 1, w, dtype=np.float32)[None, :]
    r = np.sqrt(xx * xx + yy * yy)
    vig = np.clip(1.0 - 0.55 * np.clip(r - 0.35, 0, None), 0.25, 1.0)[:, :, None]
    return img * vig


# ---------------------------------------------------------------- 2. hero-mid
def make_hero_mid(h=1200, w=900):
    """RGBA 人形剪影（兜帽 + 肩 + 斗篷下摆），软边。

    逐行定义"半宽"，比用简单几何体拼更像人：
      头（椭圆）→ 颈（收窄）→ 肩（快速展开）→ 斗篷（正弦展开的下摆）
    """
    yy = np.linspace(0, 1, h, dtype=np.float32)
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    cx = 0.5

    hw = np.zeros_like(yy)

    # 头（椭圆，中心 y=0.115）
    m = (yy >= 0.040) & (yy < 0.180)
    t = (yy[m] - 0.110) / 0.070
    hw[m] = 0.074 * np.sqrt(np.maximum(0.0, 1.0 - t * t))

    # 颈 → 肩
    m = (yy >= 0.180) & (yy < 0.245)
    hw[m] = 0.046 + (yy[m] - 0.180) / 0.065 * 0.116

    # 肩 → 斗篷下摆：单调外扩的 A 字，避免中部最宽变成"蛋形"
    m = yy >= 0.245
    t = (yy[m] - 0.245) / 0.755
    hw[m] = 0.162 + 0.238 * (t ** 0.62)

    mask = (np.abs(xx - cx) < hw[:, None]).astype(np.float32)

    # 软边：噪声扰动轮廓，避免刀切感
    edge_n = norm01(fbm(h, w, octaves=4, base=10)) - 0.5
    mask = np.clip(mask + edge_n * 0.07, 0, 1)

    # 内部明暗：左亮右暗（侧光）+ 布料纹理
    shade = 0.52 + 0.48 * (1.0 - xx)
    shade = shade * (0.72 + 0.38 * norm01(fbm(h, w, octaves=5, base=7)))

    col = np.stack(
        [shade * 96 + 26, shade * 64 + 19, shade * 50 + 17],
        axis=2,
    )

    return np.dstack([col, mask * 255.0])


# ---------------------------------------------------------------- 3. hero-fg
def make_hero_fg(h=500, w=1600):
    """底部深色植被/山脊剪影，上缘不规则。"""
    n = norm01(fbm(h, w, octaves=5, base=6))
    ridge = 0.42 + 0.30 * n[0]                      # 每列一个高度
    ridge = np.convolve(ridge, np.ones(9) / 9, mode="same")
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]

    mask = (yy > ridge[None, :]).astype(np.float32)
    fine = norm01(fbm(h, w, octaves=4, base=40)) - 0.5
    mask = np.clip(mask + fine * 0.10, 0, 1)

    detail = 0.30 + 0.55 * norm01(fbm(h, w, octaves=5, base=16))
    col = np.stack([detail * 26 + 8, detail * 22 + 9, detail * 18 + 11], axis=2)
    return np.dstack([col, mask * 255.0])


# ---------------------------------------------------------------- 4. sidekick-bg
def make_sidekick_bg(h=900, w=1600):
    """冷色调：青 -> 深蓝，加细密网格线（科技感）。"""
    base = gradient(h, w, (120, 196, 214), (14, 30, 58))
    n = norm01(fbm(h, w, octaves=6, base=4))[:, :, None]
    cool = np.array([168, 232, 240], np.float32).reshape(1, 1, 3)
    deep = np.array([10, 24, 48], np.float32).reshape(1, 1, 3)
    img = base * 0.4 + (deep * (1 - n) + cool * n) * 0.7

    # 网格
    yy = np.arange(h)[:, None]
    xx = np.arange(w)[None, :]
    grid = ((yy % 60 < 1.5) | (xx % 60 < 1.5)).astype(np.float32)
    img += grid[:, :, None] * np.array([40, 90, 110], np.float32).reshape(1, 1, 3)
    return img


# ---------------------------------------------------------------- 5. sidekick-mid
def make_sidekick_mid(h=900, w=900):
    """几何立方体感：等距投影的方块堆，RGBA。"""
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]

    # 六边形（等距立方体轮廓）
    ax = np.abs(xx - 0.5) * 1.9
    ay = np.abs(yy - 0.52) * 1.9
    hexmask = (ay <= 0.62) & (ax <= 0.55 + np.maximum(0, 0.62 - ay) * 0.9)

    # 顶面 / 左面 / 右面 三块用不同亮度
    top = hexmask & (yy < 0.40)
    left = hexmask & (yy >= 0.40) & (xx < 0.5)
    right = hexmask & (yy >= 0.40) & (xx >= 0.5)

    col = np.zeros((h, w, 3), np.float32)
    col[top] = (236, 244, 250)
    col[left] = (128, 160, 186)
    col[right] = (72, 100, 130)

    # 加一点噪声质感
    tex = 0.88 + 0.24 * norm01(fbm(h, w, octaves=5, base=12))
    col *= tex[:, :, None]

    # 软边
    edge_n = norm01(fbm(h, w, octaves=4, base=14)) - 0.5
    alpha = np.clip(hexmask.astype(np.float32) + edge_n * 0.05, 0, 1) * 255.0
    return np.dstack([col, alpha])


# ---------------------------------------------------------------- 6. sidekick-fg
def make_sidekick_fg(h=500, w=1600):
    n = norm01(fbm(h, w, octaves=5, base=5))
    ridge = 0.35 + 0.32 * n[0]
    ridge = np.convolve(ridge, np.ones(11) / 11, mode="same")
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    mask = (yy > ridge[None, :]).astype(np.float32)
    detail = 0.28 + 0.5 * norm01(fbm(h, w, octaves=5, base=20))
    col = np.stack([detail * 20 + 6, detail * 34 + 10, detail * 46 + 16], axis=2)
    return np.dstack([col, mask * 255.0])


# ---------------------------------------------------------------- 7. noise
def make_noise(h=256, w=256):
    """灰度噪声，过渡 shader 的 threshold 扰动源。"""
    n = norm01(fbm(h, w, octaves=7, base=4))
    n = 0.5 * n + 0.5 * norm01(fbm(h, w, octaves=4, base=32))
    v = np.clip(n * 255.0, 0, 255)
    return np.dstack([v, v, v]).astype(np.uint8)


# ---------------------------------------------------------------- 8. mud-normal
def make_mud_normal(h=512, w=512):
    """法线贴图：由高度场求梯度得到。R 通道做位移扰动（还原真实 shader 用法）。"""
    height = norm01(fbm(h, w, octaves=6, base=5))
    gy, gx = np.gradient(height)
    strength = 6.0
    nx = -gx * strength
    ny = -gy * strength
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    r = (nx * 0.5 + 0.5) * 255.0
    g = (ny * 0.5 + 0.5) * 255.0
    b = (nz * 0.5 + 0.5) * 255.0
    return np.dstack([r, g, b]).astype(np.uint8)


# ---------------------------------------------------------------- main
def main():
    print(f"输出目录: {OUT}\n")
    print("--- 生成占位素材 ---")
    save(make_hero_bg(), "hero-bg.png")
    save(make_hero_mid(), "hero-mid.png")
    save(make_hero_fg(), "hero-fg.png")
    save(make_sidekick_bg(), "sidekick-bg.png")
    save(make_sidekick_mid(), "sidekick-mid.png")
    save(make_sidekick_fg(), "sidekick-fg.png")
    save(make_noise(), "noise.png")
    save(make_mud_normal(), "mud-normal.png")
    print("\n完成。")


if __name__ == "__main__":
    main()
