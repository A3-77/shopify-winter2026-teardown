# Shopify Editions Winter '26 — 前端逆向分析与复刻

对一个 WebGL 重动画电商站的**证据级前端逆向分析**（15 个阶段），以及一个**可运行的复刻 Demo**。

分析对象：`https://www.shopify.com/editions/winter2026`（公开可访问，仅用于学习与研究）

> ### 📖 第一次来？先读 [**USE.md**](USE.md)
>
> 那一份讲的是**怎么用这个仓库**：怎么跑起来、每个目录干什么、
> 怎么换成你自己的素材、怎么加章节、大文件在哪、常见坑在哪。
> 这一份 README 讲的是**逆向出了什么**。两者互补。

---

## 这个仓库有什么

| 部分 | 内容 | 怎么用 |
|---|---|---|
| **① 结论** | 4 份报告，从页面结构一路拆到 shader 逐行、GLB 几何全量统计 | 按序号读，`04` 是总纲 |
| **② 复刻 Demo** | `replica/` —— Vite + React 18 + TS + three.js | `npm install && npm run dev` |
| **③ 素材浏览器** | `replica/viewer.html` —— 748 个原站素材的 3D 实时预览 | 同上，换个 URL |
| **④ 原站素材实物** | `assets-original/` —— 748 个文件 / 356 MB（模型 / 贴图 / 图片 / 视频 / 数据） | 拿真实素材，或复核我的数字 |
| **⑤ 采集工具** | `tools/` —— 5 个脚本，可复现全部采集过程 | `python tools/fetch_assets.py` |

**每条结论都标注了证据等级**：【已确认】/【高度可能】/【推测】/【浏览器公开环境无法确认】。
没有原文证据的推测会被明确标出来，不伪装成事实。

---

## 快速开始

```bash
cd replica
npm install
npm run dev
```

然后开三个页面：

| URL | 是什么 |
|---|---|
| `http://127.0.0.1:5173/` | 滚动驱动的复刻 Demo（3 个章节 + 交叉溶解过渡），**程序化占位素材** |
| `http://127.0.0.1:5173/?assets=original` | 同一个 Demo，但用**原站真实素材**（KTX2 背景 + GLB 蒙皮模型 + 滚动驱动动画） |
| `http://127.0.0.1:5173/viewer.html` | 素材浏览器（37 个 GLB 可拖动旋转，带动画可播放） |

两个 Demo 入口的实测差异（同一台机器，1783×842 画布）：

| | `/` | `/?assets=original` |
|---|---|---|
| 场景构成 | 3 层平面，纯 2D 合成 | KTX2 背景平面 + GLB 前景模型 |
| draw calls | 10 | 21 |
| 三角面 | 20 | 49,101（Hero 章节） |
| 控制台 | 干净 | 干净 |

**完全离线可跑** —— Draco / KTX2 解码器用的是 `three` 包自带的 wasm，
已拷到 `replica/public/decoders/`，不碰任何 CDN（原站自己是指向 jsdelivr 的）。

复刻细节见 [`replica/README.md`](replica/README.md)，使用说明见 [`USE.md`](USE.md)。

---

## 八个最有价值的发现

### 1. 它不是 3D 站，是"立体书"

全站 37 个 GLB 合计 **873,416 顶点 / 883,812 三角面 / 17.9 MB**。但其中：

- **7 个 `*_bg_diffuse` 模型只有 4 个顶点、2 个三角面** —— 背景就是一块 quad + 内嵌 KTX2 贴图
- **19 / 37 个模型用 `KHR_materials_unlit`（无光照材质）**，配合运行时实测的 `shadowMap: false`

结论：**主体视觉不依赖 PBR 光照**。立体感来自「贴图本身是画好的插画 + 相机运动 + 后处理」，
不是「建 3D 场景打光渲染」。这解释了为什么 87 万顶点看起来依然接近 2D。

> **★ 2026-09-20 修正**：这条原先写成「整站没有做 PBR 光照」，**过于绝对**。
> 把 GLB 真正加载进 three.js 之后才发现：另外 18 个模型（**包含 Hero / Sidekick / Operations
> 这三个主体模型**）用的是 PBR 材质，不加光源渲染出来是全黑的。
> 也就是「19 个不需要光 + 18 个需要光」，而不是「整站没有光照」。
> 原站的光照参数（写死在 JS 里，GLB 内无 `KHR_lights_punctual`）**我确认不了**。
> 详见 `04-几何全量统计与最终架构.md` §3.3。

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

### 7. 素材不是三层，是四层 —— 之前漏了一整层 Rive 图集

把 748 个素材全量拉下来之后才看清：`@rive-app/webgl2` 不是"UI 小动效"那么简单。

- **314 个 `rive_U*_N.webp`**，合计 16.2 MB —— Rive 导出的**纹理图集切片**
- 命名里的 `U113` / `U200` 是 Rive 内部的 artboard / object id，与滚动章节**无关**

原站的素材实际分成四层，命名规律各不相同：

| 层 | 数量 | 命名规律 | 能否按章节归类 |
|---|---|---|---|
| 3D 场景层 | 77 | `EW26_Hero_*` / `Sidekick_desktop` | ✅ 100% 可靠 |
| Rive 图集层 | 314 | `rive_U113_1.webp` | ❌ 按 artboard 组织 |
| 功能卡片层 | ~200 | `U113_Shop_campaigns.png` | ❌ 按**功能**组织（原站有 250+ 张功能卡片） |
| 其余 | ~150 | 背景底图 / 视频封面 / 站点 chrome / 内容哈希名 | ❌ 无信号 |

> 这条修正了一个容易犯的错：**"按滚动章节组织素材"只对 3D 那一层成立**。
> 对 2D 强行编造章节归属就是假的。`tools/build_scene_map.py` 的头部注释写了完整推理。

另外，748 个唯一 URL 里有 **125 个被 Shopify CDN 重命名成了纯内容哈希**
（如 `0dfe781a….mp4`），文件名不带任何语义 —— 这部分无法归类，如实标出。

### 8. 三角面数有两种口径 —— 报告里的 883,812 是"去重几何"，不是 GPU 处理的量

这条是**把 GLB 真正加载起来、和浏览器实测数字对不上**之后才发现的。

glTF 里 `meshes` 和 `nodes` 是分开的：同一个 mesh 可以被多个 node 引用，
three.js 会为每个 node 建一个 `Mesh`（共享 geometry）。所以"资产里有多少面"和
"每帧送进 GPU 多少面"**不是同一个数**：

| 口径 | 全站 37 个模型 |
|---|---|
| **几何口径**（遍历 `meshes[]`，报告此前用的） | **883,812 面** / 873,416 顶点 |
| **渲染口径**（再按 node 引用次数重复计） | **888,438 面** / 877,622 顶点 |

差 4,626 面（+0.52%），集中在 3 个有实例化 mesh 的模型上 ——
`EW26_Finance_251208v2` 里 10 枚硬币共用一份几何，85 个 node 只对应 7 个 mesh。

**交叉验证：** 三条独立路径把 Finance 章节的三角面数串成一条链 ——

```
Python 解析 GLB 的 JSON chunk   49,061   该模型（渲染口径）
+ 背景平面 quad                      2
+ 全屏后处理 quad ×5 次绘制          10   （过渡 / 亮度提取 / 模糊横竖 / 合成）
────────────────────────────────────────
浏览器 renderer.info.render        49,073   ← 逐位吻合
```

一边是纯 Python 解析二进制，一边是 GPU 实际渲染计数 —— 两条完全独立的路径给出同一个数。

> 该引用哪个：衡量**资产规模**（下载体积、解码成本）用几何口径，这是对的；
> 但别说成"GPU 每帧处理 88 万面"。原站每帧真实处理量属于【浏览器公开环境无法确认】。
> 详见 `04-几何全量统计与最终架构.md` §3.5。

---

## 目录结构

```
.
├── USE.md                           ★ 怎么用这个仓库（先读这个）
├── 01-勘察报告.md                   页面结构树 / 13 个 section 实测属性 / 技术栈确认表
├── 02-动画拆解.md                   13 场景 82 对象 / 375 轨道 / 780 关键帧全量
├── 03-深度还原.md                   progress 公式 / 运行时场景图 / 过渡 shader 全文 / 性能
├── 04-几何全量统计与最终架构.md     37 个 GLB 统计 / 架构图 / 实现顺序
│
├── replica/                         可运行复刻 Demo + 素材浏览器
│   ├── README.md                    复刻细节 / 素材替换 / 加章节 / 已知简化项
│   ├── index.html                   滚动场景复刻（主入口）
│   ├── viewer.html                  ★ 素材浏览器（3D / 贴图 / 视频实时预览）
│   ├── src/
│   │   ├── config/                  配置层（改内容只改这里）
│   │   ├── animation/               进度公式 + 关键帧求值器 + Lenis
│   │   ├── engine/                  渲染管线（双 RT + 过渡 + bloom）
│   │   ├── shaders/                 过渡 shader（逐行还原）
│   │   ├── components/              React + DOM 层
│   │   └── viewer/                  素材浏览器
│   └── public/
│       ├── assets/                  8 张程序化生成的占位素材
│       └── decoders/                ★ draco + basis 的 wasm（离线解码，不依赖 CDN）
│
├── assets-original/                 ★ 原站素材实物（748 个 / 356 MB）
│   ├── manifest.json                全量清单：URL / 本地路径 / 字节 / sha256 / 几何元数据
│   ├── SCENE_MAP.json               按章节分组的素材索引
│   ├── models/                      37 个 GLB（Draco 压缩，含蒙皮动画）
│   ├── textures/                    40 张 KTX2（Basis Universal / BC7）
│   ├── images/                      553 张图片
│   ├── video/                       99 个视频
│   ├── data/                        16 份 Theatre.js 工程状态 JSON
│   └── fonts/                       3 个 woff2
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
    ├── fetch_assets.py              ★ 全量拉取原站素材（含体积探测 / 去重 / 清单生成）
    ├── build_scene_map.py           ★ 按章节归类素材
    ├── count_render_triangles.py    ★ 几何口径 vs 渲染口径的三角面数（见「发现 8」）
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

# 4. 全量拉取素材实物（约 356 MB）
python tools/fetch_assets.py --probe          # 先看体积，不下载
python tools/fetch_assets.py --only 3d,data,font   # 只拉 3D 核心（约 27 MB）
python tools/fetch_assets.py                  # 全量

# 5. 生成按章节的素材索引
python tools/build_scene_map.py

# 6. 复核三角面数的两种口径（几何口径 vs 渲染口径）
python tools/count_render_triangles.py
```

> 环境提示：Shopify 的 CDN 会拒绝不带 `User-Agent` 的请求（HEAD 与 GET 都是），
> 带 UA 后正常。GLB 元数据采集用 `Range: bytes=0-262143` 只取头部，
> 返回 `206 Partial Content` 与 `Content-Range`。

**想验证报告里的数字，不用信我 —— 三条路都能自己跑：**

| 想验证什么 | 跑什么 |
|---|---|
| 某个素材的 URL / 字节 / sha256 / 几何元数据 | 查 `assets-original/manifest.json` |
| 素材按章节的分布 | `python tools/build_scene_map.py` |
| 全站三角面数（两种口径） | `python tools/count_render_triangles.py` |
| 某个模型的真实顶点/骨骼/动画 | 打开 `replica/viewer.html` 点它，HUD 显示的是浏览器实测值 |
| 复刻 Demo 的实际渲染开销 | 打开 Demo，读 `window.__REPLICA__.renderer.info` |

---

## 关于版权与使用范围

**本仓库为个人研究用途，不对外分发。**

仓库内包含从公开可访问网站采集的**内容副本**：JS bundle、完整 HTML、
13 份 Theatre 项目 JSON、37 个 GLB 模型、40 张 KTX2 贴图、以及 652 个图片/视频。

纳入它们的目的是**让报告里每条结论都可复核** —— 这是「证据级逆向」和「凭印象写拆解」的分界线。
一个只有结论、没有实物的逆向报告，你没法验证它，也没法拿它做任何事。

| 类别 | 内容 | 版权 |
|---|---|---|
| 原创产出 | 4 份分析报告、`replica/` Demo 源码、`viewer` 浏览器、`tools/` 脚本 | MIT |
| 原站内容副本 | `assets-original/`、`bundles/`、`theatre/`、`evidence/` 下的原始文件 | **归 Shopify 及原权利人所有** |

**未入库**的只有 `node_modules/` 与 `replica/dist/` —— 这两样由仓库内的源码
一条命令即可精确重建，入库反而会引入平台相关的二进制。素材则不同：
原始 URL 会变、站点可能下线，**抓下来就不可再生**，所以在库里。

分析对象为公开可访问的网站，分析目的是学习其前端实现方法。
**请勿公开分发、请勿商用、请勿拿去发布成自己的作品。**

---

## License

本仓库原创内容（报告、Demo 代码、工具脚本）采用 MIT License。
分析结论中引用的原站代码片段版权归原权利人所有。
