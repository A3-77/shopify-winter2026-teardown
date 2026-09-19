# 怎么用这个仓库

> 这份文档是给"三个月后的我自己"写的。
> 目标是：不看任何别的东西，只读这一页，就能把仓库跑起来、看懂、并改成自己的东西。

---

## 0. 30 秒了解这是什么

对 `https://www.shopify.com/editions/winter2026` 做的一次公开前端逆向。

仓库里有**三类东西**，用途完全不同，别混着看：

| 类型 | 在哪 | 干什么用 |
|---|---|---|
| **① 结论** | `01-` ~ `04-*.md` | 想知道"它怎么做到的" → 读这个 |
| **② 可运行的复刻** | `replica/` | 想亲眼看到效果 / 改成自己的 → 跑这个 |
| **③ 原站素材实物** | `assets-original/` | 想拿真实素材 / 验证我的数字 → 看这个 |

三类都齐了才叫"能用"。之前只有 ①，那只是一堆文字。

---

## 1. 快速上手

### 只看素材长什么样（最省事，30 秒）

```bash
cd replica
npm install          # 约 78 个包
npm run dev
```

打开 **http://127.0.0.1:5173/viewer.html**

左边是原站 748 个素材的清单，点任意一个 → 右边 3D 实时预览。
37 个 GLB 模型可以直接拖动旋转、滚轮缩放，带动画的能播放、能拖时间轴。

> 这一步不需要联网。Draco / KTX2 解码器用的是 `three` 包自带的 wasm，
> 已经拷到 `replica/public/decoders/` 里了。

### 看滚动复刻效果

同一个 dev server，打开 **http://127.0.0.1:5173/**（不带 `viewer.html`）。

这是 3 个章节的滚动驱动场景，带交叉溶解过渡。

**同一个页面有两种素材模式**，加个 URL 参数就切换：

| 打开这个 | 素材来自 | 场景构成 |
|---|---|---|
| `http://127.0.0.1:5173/` | `replica/public/assets/` 里的程序化占位图 | 3 层平面（bg / mid / fg），纯 2D 合成 |
| `http://127.0.0.1:5173/?assets=original` | `assets-original/` 里的原站素材 | **KTX2 背景平面 + GLB 前景模型**（带骨骼、带动画） |

第二种才是原站的真实构成 —— 背景是 KTX2 解压出来的贴图，前景是 Draco 压缩的蒙皮模型，
动画由滚动进度 scrub 驱动。三个章节分别是 Hero（36,125 顶点 / 170 骨骼）、
Sidekick（星空背景本身也是个 4 顶点 GLB）、Operations（144,040 顶点 / 65,780 面 / 20 骨骼）。

> `?assets=original` 走的是 dev server 里的 `/original/*` 中间件，直接映射仓库根的
> `assets-original/`，不需要额外拷贝。生产构建里则只打进去 3D 核心（98 文件 / 27.8 MB）。

### 读逆向结论

```bash
# 按顺序读，04 是最终汇总
01-勘察报告.md              # 页面结构、技术栈实测
02-动画拆解.md              # 13 场景 82 对象 / 375 轨道 / 780 关键帧
03-深度还原.md              # 滚动链路、过渡 shader 全文、设计 token
04-几何全量统计与最终架构.md   # 37 个 GLB 全量统计 + 最终架构 + 9 步实现顺序
```

---

## 2. 仓库地图

```
shopify-winter2026/
│
├── 01-勘察报告.md ──────────┐
├── 02-动画拆解.md           ├─ ① 结论：四份报告，按序号读
├── 03-深度还原.md           │
├── 04-几何全量统计与最终架构.md ┘
│
├── replica/ ──────────────── ② 可运行的复刻 Demo（Vite + React + three）
│   ├── index.html             → 滚动场景复刻（主入口）
│   ├── viewer.html            → 素材浏览器（3D / 贴图 / 视频预览）
│   ├── public/
│   │   ├── assets/            → 8 张程序化占位图（换成你自己的图就是这里）
│   │   └── decoders/          → draco + basis 的 wasm（离线解码用）
│   └── src/
│       ├── config/            ★ 所有可调参数都在这
│       │   ├── scenes.ts      ★ 加章节 / 改动画，只动这个文件
│       │   ├── assets.ts      ★ 素材路径唯一出口
│       │   └── design.ts        设计 token（字号、间距、缓动）
│       ├── animation/         ★ 滚动进度公式 + 关键帧求值器
│       ├── engine/              渲染管线（场景构建 / 后处理 / 加载器）
│       ├── shaders/             过渡 shader（从原站 118 行源码逐行还原）
│       ├── components/          React 外壳
│       └── viewer/              素材浏览器
│
├── assets-original/ ──────── ③ 原站素材实物（748 个 / 356 MB）
│   ├── models/                  37 个 GLB（Draco 压缩，含蒙皮动画）
│   ├── textures/                40 张 KTX2（Basis Universal / BC7）
│   ├── images/                  553 张图片
│   ├── video/                   99 个视频
│   ├── data/                    16 份 Theatre.js 工程状态 JSON
│   ├── fonts/                   3 个 woff2
│   ├── manifest.json            ★ 全量清单：URL / 本地路径 / 字节 / sha256 / 几何元数据
│   └── SCENE_MAP.json           ★ 按章节分组的素材索引
│
├── bundles/                    28 个原站 JS chunk（3.2 MB）
├── theatre/                    13 份 Theatre.js 工程 JSON（500 KB）
├── evidence/                   抓取到的原始证据（shader 全文 / 页面 HTML / 资产清单…）
└── tools/                      可复现的采集与整理脚本
```

---

## 3. 三个入口分别怎么用

### 3.1 素材浏览器 —— 看原站长什么样

```bash
cd replica && npm run dev
# → http://127.0.0.1:5173/viewer.html
```

界面上有什么：

- **顶部标签**：模型 37 / 贴图 40 / 图片 553 / 视频 99 / 数据 16 / 字体 3
- **左侧列表**：模型按三角面降序（大的在前），其他按体积降序
- **右上角 HUD**：这个文件的真实数据 —— 顶点数、三角面数、骨骼数、
  用了哪些 glTF 扩展、解码耗时
- **底部控制条**：带动画的模型可以播放 / 拖时间轴 / 切换动画片段

**几个值得亲手点开看的：**

| 点这个 | 会看到什么 |
|---|---|
| `Operations_fg_smaller_*.glb` | 最大的模型：144,040 顶点 / 65,780 面 / 20 骨骼，6 段动画 |
| `EW26_Hero_251207v3_*.glb` | Hero 首屏，170 根骨骼 |
| `Checkout_bg_diffuse-optimized.glb` | **只有 4 个顶点 / 2 个三角面** —— 它就是一块 quad，贴图烘在 GLB 里 |
| `Hero-bg-hires-optimized.ktx2` | 2876×1840 的 KTX2，GPU 侧直接解压，HUD 会显示格式常量 36492 = BC7 |
| `rive_U113_*.webp` | Rive 图集切片 —— 原站另一套渲染层 |

> 「4 个顶点」这条是 04 报告里的关键发现之一：**原站的"背景"不是 3D 场景，
> 是一块贴了 KTX2 的平面**。浏览器里点一下就能自己确认，不用信我。

### 3.2 滚动复刻 Demo —— 看效果

```bash
cd replica && npm run dev
# → http://127.0.0.1:5173/                 占位素材（默认）
# → http://127.0.0.1:5173/?assets=original 原站真实素材
```

滚动页面，观察：

- 3 个章节依次推进，章节之间是**阈值场交叉溶解**，不是简单的透明度渐变
- 首屏（Hero）的进入方式与其他章节不同（圆形径向溶解 vs 斜向擦除）
- 每个章节的相机 z / fov 走的方向都不一样

调试面板在**右上角**，显示当前章节、进度、过渡进度、draw call。
控制台里 `window.__REPLICA__` 暴露了 `renderer` / `composer` / `scrollEngine` / `sectionStore`，
可以直接在 devtools 里改参数看效果。

**两种素材模式实测数据（同一台机器，1783×842 画布）：**

| | 占位模式 `/` | 原站素材 `/?assets=original` |
|---|---|---|
| draw calls | 10 | 21 |
| 三角面 | 20（9 个平面 + 1 个全屏过渡 quad） | 49,101（Hero 章节） |
| WebGL | 2.0 | 2.0 |
| 色调映射 | NeutralToneMapping | NeutralToneMapping |
| 控制台 | 干净 | 干净 |

> 想改哪一章用哪套素材？看 `replica/src/config/scenes.ts` 里的
> `PLACEHOLDER_SCENES` 与 `ORIGINAL_SCENES` —— 两组都是普通配置数组，
> 加一组自己的、或者两套混着用都行。

### 3.3 报告 —— 看结论

`04-几何全量统计与最终架构.md` 是总纲，其余三份是它的支撑材料。

报告里每条结论都标了可信度：

- **【已确认】** —— 有实测证据（运行时抓的、二进制解析的、浏览器里数出来的）
- **【高度可能】** —— 多方证据一致但没直接抓到
- **【推测】** —— 明确标注是推断
- **【浏览器公开环境无法确认】** —— 老实承认做不到

第 6 节「诚实边界」列了 6 项**我确认不了**的东西（真实 draw call、GPU 帧耗时、
`asset-2.frameProgress` 语义、`e0`/`e2`/`e3` 三层 shader 源码等）。
别把这些当成"已还原"。

---

## 4. 换成你自己的素材 ★

这是这个仓库最重要的用途。

### 4.1 用平面图（最简单）

```bash
# 1. 把你的图丢进 replica/public/assets/，覆盖同名文件
cp 我的背景图.png replica/public/assets/hero-bg.png
cp 我的人物图.png replica/public/assets/hero-mid.png

# 2. 重启 dev server，刷新
```

**一行代码都不用改。**

要求：
- 带 alpha 的图层（中景 / 前景）用 PNG
- 竖版图请确认对应图层配了 `fit: 'contain'`（见下）

### 4.2 改文件名 / 加新素材

只动 `replica/src/config/assets.ts`：

```ts
export const ASSETS = {
  heroBg:  'assets/hero-bg.png',
  heroMid: 'assets/hero-mid.png',
  // 加一行：
  myLayer: 'assets/我的图.png',
} as const;
```

然后在 `scenes.ts` 的图层里写 `asset: 'myLayer'`。

> ⚠️ **不要**在组件里写 `"/assets/xxx.png"` 这种字符串。
> 所有路径必须走 `resolveAsset()`，这是"素材路径集中管理"这条要求的落地方式。

### 4.3 竖版图被拉成三角形？

这是最容易踩的坑。在图层配置里加 `fit`：

```ts
{
  id: 'mid',
  asset: 'heroMid',
  fit: 'contain',   // ← 加这个
  z: -11,
  ...
}
```

| `fit` | 行为 | 什么时候用 |
|---|---|---|
| `'cover'`（默认） | 铺满视口，可能裁切 | 抽象背景 |
| `'contain'` | 按图片自身宽高比完整放入，不裁切不拉伸 | 有明确形状的人像 / 物体 |

`contain` 的逻辑等价于 CSS 的 `object-fit: contain`。
不加这个、图又是竖版（比如 900×1200），平面会按视口比例（约 1.95）去算，
拉伸 2.6 倍 —— 人像会变成一个大三角。我第一版就是这么翻车的。

### 4.4 用原站的真实素材

**最快的方式是加 URL 参数**，不用改任何代码：

```
http://127.0.0.1:5173/?assets=original
```

这会把场景组从 `PLACEHOLDER_SCENES` 换成 `ORIGINAL_SCENES`
（见 `src/config/scenes.ts`），素材全部指向 `assets-original/`。

想自己指定某一张，就在 `assets.ts` 里写路径：

```ts
// replica/src/config/assets.ts
// 指向 assets-original 里拷出来的文件，或者直接用 dev server 的 /original/ 路径
export const ASSETS = {
  heroBg: { path: 'original/textures/Hero-bg-hires-optimized.ktx2', kind: 'ktx2' },
  ...
}
```

`/original/` 在 dev server 下由 `vite.config.ts` 里的中间件直接映射到
仓库根的 `assets-original/`，不用拷贝。**生产构建时**只打进去 3D 核心
（`models/` + `textures/` + `data/` + `fonts/`，98 文件 / 27.8 MB）；
想要全部 748 个文件，用 `EW26_COPY_ALL=1 npm run build`。

> `kind` 字段决定用哪个 loader 去加载。`image` 走 `TextureLoader`、
> `ktx2` 走 `KTX2Loader`、`glb` 走 `GLTFLoader`（+ Draco）。
> 分派逻辑在 `src/engine/loaders.ts`，不要在业务代码里手写 loader。

### 4.5 用原站的 GLB 模型

**别手写加载代码** —— 在 `scenes.ts` 里声明一个 `type: 'model'` 的图层就行：

```ts
{
  id: 'model',
  type: 'model',              // ← 默认是 'plane'
  asset: 'oHeroModel',
  modelHeight: 0.86,          // 包围盒高度 = 该值 × 视口高
  scrubAnimations: true,      // 动画由滚动进度驱动，不是按墙上时钟播
  z: -8,
  overscan: 1,
  offset: [0.06, -0.05],
  tracks: [ /* 和平面图层一样的轨道格式 */ ],
}
```

三个字段值得说清楚：

- **`modelHeight`** —— 37 个模型出自不同美术之手，单位尺度完全不统一（有的 0.5，有的 40）。
  按包围盒归一化，换模型时只调这一个数。
- **`scrubAnimations`** —— 开启后是 `mixer.setTime(t × clipDuration)`，
  **不是** `mixer.update(dt)`。原站的动画就是挂在 Theatre.js 时间轴上被
  `sequence.position` 拖着走的，用 `update(dt)` 会变成自播、和滚动脱节。
- **`opaque`** —— 满幅背景平面必须标 `true`，否则会**盖住前景模型**。
  three 先渲不透明、后渲透明，这个分类发生在 `renderOrder` 排序**之前**，
  所以"透明背景 + 不透明模型"会让背景后画、把模型整个盖掉。
  症状很迷惑：三角面数在涨（说明模型确实在渲染），但屏幕上什么都看不见。

底层链路（`viewer.html` 用的就是这套，想自己写可以参考）：

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const draco = new DRACOLoader().setDecoderPath('./decoders/draco/');
const ktx2  = new KTX2Loader().setTranscoderPath('./decoders/basis/').detectSupport(renderer);
const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);

const gltf = await loader.loadAsync('./original/models/EW26_Hero_251207v3_compressed-optimized.glb');
scene.add(gltf.scene);
```

解码器在 `replica/public/decoders/`，**离线可用，不依赖任何 CDN**
（原站自己是指向 jsdelivr 的）。

> 蒙皮模型克隆**必须**用 `SkeletonUtils.clone`，普通 `Object3D.clone()`
> 不重建骨骼绑定，模型会塌成一团。three r181 里它是具名导出：
> `import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'`。

---

## 5. 加一个新章节

只动一个文件：`replica/src/config/scenes.ts`，往 `SCENES` 数组里追加一项。

```ts
{
  id: 'scene-my-04',
  handle: 'my-section',        // 对应 DOM 章节的 data-section-id
  index: 3,                    // 必须递增
  eyebrow: 'Edition 04',
  title: '我的新章节',
  body: '说明文字',
  accent: '#7fb0ff',           // 章节主色
  background: '#0c1420',       // canvas 底色
  heightVh: DESIGN.sectionHeightVh,
  earlyCrossfade: 0.2,         // index>=2 时原站用 0.2
  isHero: false,               // 只有首屏为 true
  fadeCenter: [0, 0, 0],
  camera: { z: 6, fov: 26, tracks: [ /* 相机轨道 */ ] },
  layers: [ /* 图层，每层一个 asset + z + tracks */ ],
}
```

**不用改任何组件、shader、渲染管线代码。** 这就是"config 驱动 scene"的意思。

轨道格式对齐原站 Theatre.js 的语义（`'position.x'` / `'scale.y'` / `'rotation.z'` / `'opacity'`）：

```ts
tracks: [
  { path: 'position.y', keyframes: [
    { t: 0, value: 0.18, ease: 'easeInOut' },
    { t: 1, value: -0.16 },
  ]},
]
```

`t` 是章节滚动进度 0..1，`value` 的单位是"一个视口高"。

---

## 6. 素材是怎么来的（可复现）

`assets-original/` 不是手工下载的，是脚本跑的：

```bash
# 全量拉取（约 356 MB，1-2 分钟）
python tools/fetch_assets.py

# 只探测体积，不下载
python tools/fetch_assets.py --probe

# 只拉 3D 核心（约 27 MB，够跑 viewer）
python tools/fetch_assets.py --only 3d,data,font

# 重新生成按章节的分组索引
python tools/build_scene_map.py

# 复核全站三角面数（几何口径 vs 渲染口径，见 04 报告 §3.5）
python tools/count_render_triangles.py
```

脚本的要点：

- Shopify CDN **会拒绝不带 User-Agent 的请求** —— 必须带 UA
- 同一张图有 6 个 `?width=` 变体，按 path 去重后只留最大的一份
- 并发 8 线程，失败重试 3 次，逐条记账
- 落盘后写 `manifest.json`：URL / 本地路径 / 字节数 / sha256 / GLB 几何元数据

想验证我报告里的任何数字，直接查 `manifest.json`，或者跑：

```bash
python tools/build_scene_map.py   # 打印按章节的素材分布
```

---

## 7. 关于体积

| 部分 | 体积 | 说明 |
|---|---|---|
| `assets-original/` | 356 MB | 原站素材实物，**在仓库里** |
| `bundles/` + `theatre/` + `evidence/` | 5.6 MB | 抓取到的原始证据 |
| `replica/` 源码 | ~1 MB | |
| **clone 总计** | **约 365 MB** | 首次 clone 会慢一点 |

单文件最大 14.47 MB，没有触碰 GitHub 的 100 MB 硬上限。

**没有入库的两样东西**（不是遗漏，是刻意的）：

- `node_modules/` —— 由 `package.json` + `package-lock.json` 精确复现，`npm install` 即可。
  里面是平台相关的二进制，入库反而会在别的机器上出错。
- `replica/dist/` —— 构建产物，`npm run build` 一条命令重建，也随 release 附件提供。

区别在哪：素材的原始 URL 会变、站点可能下线，**抓下来就不可再生**，所以入库。
依赖和构建产物**永远可由仓库内的源码推导出来**，所以不入库。

---

## 8. 常见问题

**Q: `npm run dev` 起来后 viewer 左侧列表是空的 / 报 404**

`assets-original/` 不在。跑 `python tools/fetch_assets.py --only 3d,data,font`（约 27 MB）。
或者你只 clone 了 `replica/` 子目录。

**Q: viewer 里点图片/视频打不开**

本地开发时全量都在。但 `npm run build` 默认**只打包 3D 核心**（27 MB），
2D 那 652 个文件不会进 `dist/`，清单也会自动裁剪掉。
要全量构建：`EW26_COPY_ALL=1 npm run build`。

**Q: 中景人像变成了一个大三角**

图层没配 `fit: 'contain'`。见 §4.3。

**Q: 加了 `?assets=original` 但画面没变 / 模型加载失败**

三种可能：
1. `assets-original/` 不在（见上一个 Q），dev server 拿不到 `/original/*`
2. URL 参数拼错 —— 必须是 `?assets=original`，不是 `?assets=origin` 或 `?original=1`
3. 你在看**生产构建**的 `dist/`，而构建时只打了 3D 核心。原站素材模式需要的
   `models/` + `textures/` 正好都在核心集里，所以构建产物是支持的；
   但如果连这 27 MB 都没有（比如用了 `EW26_COPY_ALL` 之外的手工裁剪），就会 404。

排查：devtools Network 面板看 `/original/models/*.glb` 的响应码。
正常应该是 200；404 说明中间件没映射到，403 说明路径穿越防护拦了。

**Q: 模型渲染出来了但被背景盖住（屏幕上什么都没有，三角面数却在涨）**

背景图层缺 `opaque: true`。见 §4.5 的 `opaque` 说明。

**Q: 模型白得刺眼 / 高光死白**

色调映射没开。渲染器需要 `THREE.NeutralToneMapping`，同时**平面材质**要显式
`toneMapped: false` 保持直通（平面是插画/照片，不该被压缩），
**模型材质**要保留 `toneMapped`（默认 true）以获得高光滚降。
`src/components/CanvasHost.tsx` 与 `src/engine/SceneBuilder.ts` 里已经这么做了。

不要用 `ACESFilmicToneMapping` —— 它会把鲜艳的橙袍压成灰橙，原站的插画质感会丢。

**Q: 章节切换时画面闪断**

检查你有没有把 raw progress 直接喂给 `uProgress`。
原站的 progress 区间起点比章节入屏早一个视口高，所以任何一章刚成为 current 时
progress 已经是 0.4545，直接喂会在切换瞬间从 0.99 硬跳到 0.45。
用 `src/animation/scrollProgress.ts` 里的 `transitionProgress()` 重映射。
细节见 `03-深度还原.md`。

**Q: 视差没了 / 图层跟着相机一起缩放**

平面尺寸只在初始化时按"起始相机状态"算一次。
一旦每帧按当前距离重算，平面就会跟着相机缩放，视差被完全抵消。
见 `src/engine/SceneBuilder.ts` 的注释。

**Q: 想换成原站那样的 KTX2 纹理管线**

`src/engine/loaders.ts` 里预留了分派。KTX2 体积能压到 PNG 的 1/4 左右，
但需要 Basis Universal 的编码工具（`toktx` 或 `basisu`）离线转。

---

## 9. 诚实边界

这个仓库**不是**原站的源码。它是从公开可访问的前端产物里逆向出来的理解 + 一个复刻。

**已确认**（有实测证据）：
滚动进度公式、过渡 shader 的算法结构、37 个模型的几何统计、
KTX2 的实际压缩格式、画布钉住机制、GSAP 未被使用、Theatre.js 的数据格式。

**确认不了**（04 报告第 6 节有完整列表）：
真实 draw call 数、GPU 帧耗时、FPS、`asset-2.frameProgress` 的确切语义、
`e0`/`e2`/`e3` 三层 shader 的完整源码、`mudNormal`/`tNoise` 纹理的来源文件、
线上实际请求的是哪一份 GLB 版本。

**复刻 Demo 与原站的已知差异**：
用 3 个章节（原站 13 个）、
用本地关键帧求值器代替 Theatre.js 运行时、bloom 是简化版、
章节顺序与文案是我编的（不是原站的章节内容）。
原站那 13 章的完整清单在 `02-动画拆解.md` 里。

> 注意：`?assets=original` 模式下**素材是真的**（原站 GLB + KTX2），
> 但**编排是复刻的** —— 用哪些模型、放在哪一章、什么运动曲线，是我按原站
> 的结构重新组织的，不等于原站的实际编排。原站的实际编排只有
> `theatre/` 里的 13 份工程 JSON 能证明，那份是权威依据。

---

## 10. 版权与使用范围

这个仓库是**个人逆向研究笔记**，不是可以拿去发布的东西。

| 内容 | 权利 |
|---|---|
| 四份报告、复刻 Demo 源码、tools 脚本 | 我写的，MIT |
| `assets-original/`、`bundles/`、`theatre/`、`evidence/` | **原站内容的副本，版权归 Shopify 及原权利人** |

后一类是为了让结论可验证而保存的证据。**不要公开分发、不要商用、不要拿去发布成自己的作品。**
