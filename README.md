# Shopify Editions Winter '26 — 前端逆向分析与复刻

对一个 WebGL 重动画电商站的**证据级前端逆向分析**（15 个阶段），以及一个**可运行的复刻 Demo**。

分析对象：`https://www.shopify.com/editions/winter2026`（公开可访问，仅用于学习与研究）

---

## 这个仓库有什么

| 部分 | 内容 |
|---|---|
| **逆向报告** | 4 份文档，从页面结构一路拆到 shader 逐行、GLB 几何全量统计 |
| **复刻 Demo** | `replica/` —— Vite + React 18 + TS + three.js，`npm install && npm run dev` 可跑 |
| **采集工具** | `tools/` —— 3 个脚本，可复现全部证据采集过程 |

**每条结论都标注了证据等级**：【已确认】/【高度可能】/【推测】/【浏览器公开环境无法确认】。
没有原文证据的推测会被明确标出来，不伪装成事实。

---

## 快速开始

```bash
cd replica
npm install
npm run dev
# → http://127.0.0.1:5173
```

滚动页面即可看到：滚动驱动的双场景交叉溶解、阈值场溶解边界、fwidth 线稿、边界发光、Bloom。
左下角有实时调试面板（fps / draw calls / 两个场景的进度条）。

复刻细节见 [`replica/README.md`](replica/README.md)。

---

## 六个最有价值的发现

### 1. 它不是 3D 站，是"立体书"

全站 37 个 GLB 合计 **873,416 顶点 / 883,812 三角面 / 17.9 MB**。但其中：

- **7 个 `*_bg_diffuse` 模型只有 4 个顶点、2 个三角面** —— 背景就是一块 quad + 内嵌 KTX2 贴图
- **19 / 37 个模型用 `KHR_materials_unlit`（无光照材质）**，配合运行时实测的 `shadowMap: false`

结论：**整站没有做 PBR 光照**。立体感来自「贴图本身是画好的插画 + 相机运动 + 后处理」，
不是「建 3D 场景打光渲染」。这解释了为什么 87 万顶点看起来依然接近 2D。

### 2. 没有 depth map —— 流行说法被实测证伪

1247 个资产全量正则匹配 `depth|displac`，**命中 0**。背景是实打实的平面几何，
靠相机运动产生纵深。第三方文章里常见的"depth map 伪 3D"说法在这里不成立。

### 3. 滚动进度的区间起点比章节入屏早一个视口高

```js
start = acc - vh - ec;      // 不是 acc
zone  = height + vh + ec;
```

后果：**首屏 `progress(0) = vh/(h+vh) ≈ 0.4545`，不是 0**。
实测值 `0.4546583850931677` 与手算 `732/1610` 逐位吻合。

原站用一个很妙的 `offset = -1`（仅 hero）把首屏对齐到动画第 0 帧。

### 4. 过渡的"活边界"来自三样东西叠加

```
threshold = dist(到溶解中心的距离 | uv 斜向)
          + noise * 0.2                        ← 边界永远在抖
          + (mudNormal.r - 0.5) * mudStrength  ← 泥浆流动的有机感
edge = progress - threshold
blend = smoothstep(-fwidth(edge)*10, +fwidth(edge)*10, edge)
edges = fwidth(luma) * mix(5, 10, progress)    ← 硬件导数，一行拿到线稿
```

不是 alpha 渐变，是**在屏幕上铺一张空间变化的阈值图**再逐像素比较。
`fwidth()` 是 GPU 硬件导数，不需要任何卷积就拿到高质量边缘。

### 5. `?theatre` 创作后门是死代码

第三方拆解称加 `?theatre` 参数可加载 Theatre.js Studio 创作后门。**实测证伪**：

源码条件是 `(!(releaseStage === "production") || false)`，production 下恒为 false。
实测 `releaseStage === "production"`，访问 `?theatre` 后那个 242KB 的 `@theatre/studio` chunk
**从未出现在网络请求里**，`window.theatre === null`。代码发布了，但逻辑被编译期关掉。

### 6. GSAP / ScrollTrigger 完全没用到

全量 grep 命中 **0**。画布钉住用的是 `sticky top-0 h-[100vh] -mb-[100vh]` ——
一对 CSS 属性替代了 ScrollTrigger 的 pin，全程零 JS 参与定位。

---

## 目录结构

```
.
├── 01-勘察报告.md                   页面结构树 / 13 个 section 实测属性 / 技术栈确认表
├── 02-动画拆解.md                   13 场景 82 对象 / 375 轨道 / 780 关键帧全量
├── 03-深度还原.md                   progress 公式 / 运行时场景图 / 过渡 shader 全文 / 性能
├── 04-几何全量统计与最终架构.md     37 个 GLB 统计 / 架构图 / 实现顺序
│
├── replica/                         可运行复刻 Demo
│   ├── README.md                    素材替换 / 加章节 / 调试入口
│   ├── src/
│   │   ├── config/                  配置层（改内容只改这里）
│   │   ├── animation/               进度公式 + 关键帧求值器 + Lenis
│   │   ├── engine/                  渲染管线（双 RT + 过渡 + bloom）
│   │   ├── shaders/                 过渡 shader（逐行还原）
│   │   └── components/              React + DOM 层
│   └── public/assets/               8 张程序化生成的占位素材
│
├── evidence/                        证据文件
│   ├── SHADER_transition.glsl       过渡 shader 完整源码（118 行）
│   ├── GLB_meta.json                37 个 GLB 完整元数据
│   ├── GLB_urls.txt                 37 个 GLB URL
│   ├── ASSETS_full.json             1247 个资产 URL 完整清单
│   ├── page-source.html             原始 SSR HTML（1.45 MB）
│   ├── theatre_summary.json         13 份 Theatre JSON 的提取汇总
│   └── EXTRACT_*.txt / X2_*.txt / X3_*.txt   关键代码切片（滚动处理器 / hook / GLSL）
│
├── bundles/                         28 个 chunk（含 Background 1.0MB / Effects 66KB）
├── theatre/                         13 份 Theatre 项目状态 JSON（约 470KB）
│
└── tools/
    ├── fetch_glb_meta.py            GLB 元数据采集（Range 请求 + 解析 JSON chunk，不解 Draco）
    ├── probe_glb.py                 GLB 体积探测
    └── gen_assets.py                复刻 Demo 的占位素材生成
```

---

## 技术栈（分析结论）

| 层 | 用了什么 |
|---|---|
| 框架 | Remix / Hydrogen on Oxygen（SSR + 流式 hydration） |
| 3D | three.js **r181** + `@react-three/fiber` |
| 动画编排 | **Theatre.js**（13 份 `*.theatre-project-state*.json` 作为 CMS 资产下发） |
| 平滑滚动 | Lenis 1.3.23 |
| 后处理 | pmndrs `postprocessing`（EffectComposer + Bloom + SMAA） |
| 纹理 | KTX2 + Basis Universal + ZSTD + BC7(BPTC) |
| 几何 | Draco（WASM，Worker 池 4 并发） |
| UI 动画 | `@rive-app/webgl2` |
| 样式 | Tailwind v4.2.2 |
| GPU 分档 | detect-gpu 5.0.70 |
| **没用** | GSAP / ScrollTrigger / drei / leva / framer-motion / WebGPU |

> 版本号注意：不要用运行时请求的 `three@0.172.0`（那是 `KTX2Loader.setTranscoderPath()`
> 的硬编码 CDN 路径）反推主库版本。真实版本从 bundle 内的 `const sa="181"` 与
> `THREE_REVISION` 读取，是 **r181**。

---

## 证据采集（复现完整链路）

仓库已纳入全部采集结果。如果想自己重新跑一遍：

```bash
# 1. 抓页面源码（含 SSR 内联的 1247 个资产 URL）
curl -sS --compressed "https://www.shopify.com/editions/winter2026" -o evidence/page-source.html

# 2. 从源码提取资产清单，再抓 bundles / theatre JSON
#    具体命令见 01-勘察报告.md 的「证据文件索引」一节

# 3. 采集 GLB 几何元数据（只需前 256KB，不解 Draco）
python tools/probe_glb.py          # 先探测体积分布
python tools/fetch_glb_meta.py     # 再采元数据
```

> 环境提示：Shopify 的 3D CDN 会拒绝不带 `User-Agent` 的 HEAD 请求，
> 但带 UA 的 GET + `Range` 正常返回 `206 Partial Content`。

---

## 关于版权与使用范围

**本仓库为个人研究用途，不对外分发。**

仓库内包含从公开可访问网站采集的证据文件原样副本（JS bundle、完整 HTML、13 份 Theatre
项目 JSON、资产 URL 清单），纳入它们的目的是**让报告里每条结论都可复核** ——
这是「证据级逆向」和「凭印象写拆解」的分界线。

| 类别 | 内容 | 版权 |
|---|---|---|
| 原创产出 | 4 份分析报告、`replica/` Demo 源码、`tools/` 采集脚本 | MIT |
| 原站内容副本 | `bundles/`、`theatre/`、`evidence/` 下的原始文件 | 归原权利人所有 |

复刻 Demo 中的图片素材全部是**程序化生成**的占位图（`tools/gen_assets.py`），
与原站素材无关。Demo 复现的是**技术机制**，不是视觉资产。

分析对象为公开可访问的网站，分析目的是学习其前端实现方法。
**请勿公开分发或用于商业用途。**

---

## License

本仓库原创内容（报告、Demo 代码、工具脚本）采用 MIT License。
分析结论中引用的原站代码片段版权归原权利人所有。
