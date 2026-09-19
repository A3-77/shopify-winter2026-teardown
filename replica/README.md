# Winter 2026 —— 前端视觉复刻 Demo

对 `shopify.com/editions/winter2026` 核心视觉表现的**可运行复刻**。

不是截图模仿，是按逆向出来的真实实现重写的：滚动进度公式、双场景离屏渲染、
阈值场交叉溶解、fwidth 线稿、hero 圆形扩散 —— 逻辑与真实站点的 shader 逐行对应。

```bash
npm install
npm run dev
# → http://127.0.0.1:5173
```

---

## 一、这个 Demo 到底复刻了什么

真实站点有 13 个章节、37 个 GLB、1247 个资产。这个 Demo 保留了**驱动整套视觉的机制**，
把内容层压到 3 个章节、8 张程序化占位图。

| 机制 | 真实站点 | 本 Demo |
| --- | --- | --- |
| 滚动进度归一化 | `Tn()`，区间起点 = `acc - vh - ec` | **逐行还原**，见 `animation/scrollProgress.ts` |
| 双场景交叉溶解 | 两张离屏纹理 + 阈值场 | **逐行还原**，见 `shaders/transition.ts` |
| fwidth 线稿 | `fwidth(luma) * mix(5,10,progress)` | **原值保留** |
| 泥浆法线扰动 | `(mudNormal.r - 0.5) * mudStrength` | **原值保留** |
| hero 圆形扩散 | 3D 点投影到屏幕 + 10% 鼠标影响 | **原值保留** |
| 画布钉住 | `sticky` + `-mb-[100vh]` | **完全相同** |
| 平滑滚动 | Lenis 1.3.23 | Lenis 1.3.26 |
| 相机关键帧 | Theatre.js（13 份 JSON） | 本地求值器，语义一致 |
| 3D 内容 | R3F + 37 个 GLB + SkinnedMesh | 无（改为 2.5D 平面分层） |
| 纹理 | KTX2 + BC7 + ZSTD | PNG（为了"拖张图进去就能用"） |
| 后处理 | pmndrs/postprocessing | 自写 3 段式 bloom |

---

## 二、素材：怎么换成你自己的图

**这是设计上最优先考虑的一件事。**

```
public/assets/
├── hero-bg.png        1600×900    章节 01 背景（最远层）
├── hero-mid.png        900×1200   章节 01 中景（人物剪影，带 alpha）
├── hero-fg.png        1600×500    章节 01 前景（剪影，带 alpha）
├── sidekick-bg.png    1600×900    章节 02 背景
├── sidekick-mid.png    900×900    章节 02 中景（带 alpha）
├── sidekick-fg.png    1600×500    章节 02 前景
├── noise.png           256×256    过渡扰动噪声（灰度）
└── mud-normal.png      512×512    过渡法线扰动（R 通道被用作位移）
```

### 方式一：同名覆盖（零代码改动）

直接把你的图重命名成上面的名字，覆盖 `public/assets/` 下的文件，刷新页面即可。

### 方式二：用你自己的文件名

只改一个文件 —— `src/config/assets.ts`：

```ts
export const ASSETS = {
  heroBg: 'assets/我的背景.webp',   // ← 改这里
  // ...
} as const;
```

全项目**没有任何地方硬编码过 `/assets/xxx.png`**，所有引用都走 `resolveAsset(key)`。
（真实站点也是这样：1247 个资产 URL 全部由 CMS 下发，前端代码里零硬编码。）

### 换完图发现构图不对？

调整 `src/config/scenes.ts` 里对应图层的四个参数：

```ts
{
  id: 'mid',
  asset: 'heroMid',
  z: -11,            // ← 深度。越负越远，视差越弱。改这个比改 position 有效得多
  overscan: 1.02,    // ← 放大倍数。1.0 = 刚好铺满视口；位移大就调大它，否则会露边
  offset: [0.02, 0.02],  // ← 基准偏移，单位是"视口高/宽的比例"
  tracks: [...],     // ← 滚动过程中的位移/缩放/旋转
}
```

---

## 三、加一个新章节（Scene 04 / 05…）

**只改 `src/config/scenes.ts`，往 `SCENES` 数组里追加一项。** 不需要动组件、shader、渲染管线。

```ts
{
  id: 'scene-04',
  handle: 'scene-04',
  index: 3,                      // ← 递增
  eyebrow: 'Edition 04',
  title: '你的标题',
  body: '描述文案',
  accent: '#ffb27a',             // 章节主色（DOM 文字 / 导航点）
  background: '#120e0a',
  heightVh: 1.2,                 // 滚动高度（vh 倍数）
  earlyCrossfade: 0.2,           // 从第 3 章起按真实规则给 0.2
  isHero: false,                 // 只有首屏该为 true
  fadeCenter: [0, 0, 0],
  camera: { z: 6, fov: 26, tracks: [...] },
  layers: [ /* bg / mid / fg */ ],
}
```

`SCENES` 数组长度变化后，DOM 章节、导航点、进度计算、渲染管线都会自动跟上 ——
`totalVh` 和 `USED_ASSETS` 都是从数组派生的。

> 章节 03（Retail）就是刻意做出来证明这点的：它复用了 01/02 的素材，
> 只靠 `tint` + `z` + 相机轨道 + `earlyCrossfade` 做出一个全新章节。

---

## 四、项目结构

```
replica/
├── public/assets/             ← 所有素材（唯一需要你动的地方）
├── src/
│   ├── config/                ★ 配置层：改内容只改这里
│   │   ├── assets.ts          素材路径唯一出口
│   │   ├── scenes.ts          场景/图层/关键帧定义
│   │   └── design.ts          设计 token（字号/字体/过渡常量）
│   ├── store/                 状态层
│   │   ├── createStore.ts     极简 zustand 风格 store（可替换）
│   │   └── sectionStore.ts    滚动状态
│   ├── animation/             动画层
│   │   ├── scrollProgress.ts  ★ 滚动进度公式（真实实现还原）
│   │   ├── timeline.ts        关键帧求值器（替代 Theatre.js）
│   │   └── smoothScroll.ts    Lenis 封装
│   ├── engine/                引擎层
│   │   ├── SceneBuilder.ts    按 config 建 THREE.Scene
│   │   ├── Composer.ts        ★ 渲染管线（双 RT + 过渡 + bloom）
│   │   ├── fullscreenQuad.ts  全屏 quad
│   │   └── loaders.ts         纹理加载
│   ├── shaders/               ★ Shader 层
│   │   ├── transition.ts      过渡 shader（真实实现还原）
│   │   ├── bloom.ts           亮度提取 + 高斯模糊 + 合成
│   │   └── fullscreen.ts      全屏顶点着色器
│   ├── components/            DOM 层
│   │   ├── CanvasHost.tsx     WebGL 宿主 + 主循环
│   │   ├── ScrollSections.tsx 章节文案 + 导航
│   │   └── DebugHUD.tsx       实时调试面板
│   ├── hooks/useStore.ts      store → React 绑定
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

### 分层规则（改动时请遵守）

```
config  →  不含任何 three 代码，纯数据
store   →  不含 three，不含 React
anim    →  纯函数（除了 smoothScroll 持有 Lenis 实例）
engine  →  唯一持有 three 对象的地方
shader  →  只有 GLSL 字符串
comp    →  React + DOM，通过 engine 暴露的接口驱动
```

`config` 层零 three 依赖是刻意的 —— 这样你调构图时不需要理解 three。

---

## 五、渲染管线（一帧发生了什么）

```
                          sectionStore (scrollY)
                                  │
                    computeSectionProgress()
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
            current.progress              next.progress
                    │                           │
              sceneTime(i, ·)              sceneTime(j, ·)
                    │                           │
                    ▼                           ▼
          ┌──────────────────┐        ┌──────────────────┐
          │  Scene i         │        │  Scene j         │
          │  camera + 3 图层 │        │  camera + 3 图层 │
          └────────┬─────────┘        └────────┬─────────┘
                   │                           │
                   ▼                           ▼
            rtCurrent (HDR)              rtNext (HDR)
                   │                           │
                   └─────────────┬─────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │  Transition Shader     │
                    │  ─ 阈值场 threshold     │
                    │    · dist / uv 斜向     │
                    │    · noise 噪声扰动     │
                    │    · mudNormal 法线扰动 │
                    │  ─ fwidth 线稿          │
                    │  ─ 边界发光             │
                    └───────────┬────────────┘
                                ▼
                         rtComposite
                                │
                   ┌────────────┴────────────┐
                   ▼                         ▼
            亮度提取(1/2 分辨率)        原图
                   ▼                         │
            横向高斯 → 纵向高斯              │
                   └────────────┬────────────┘
                                ▼
                            屏幕
```

**为什么要绕这么多离屏纹理？** 因为 WebGL 没有"读回当前 framebuffer 再混合"的廉价手段。
过渡效果需要同时访问两张完整画面（还要对它们求硬件导数），唯一可行且高性能的方式
就是各自先渲到纹理。真实站点用的 `pmndrs/postprocessing` 的 `EffectComposer` 走的是同一条路。

---

## 六、调试

页面左下角有实时面板：fps / draw size / draw calls / triangles / 两个场景的进度条 / 章节高度。

控制台里还有完整的对象：

```js
__REPLICA__.composer.stats        // 每帧统计
__REPLICA__.renderer.info         // three 的 renderer.info
__REPLICA__.sectionStore.getState()  // 当前滚动状态
__REPLICA__.scrollEngine.lenis    // Lenis 实例
__REPLICA__.scrollEngine.scrollToSection(2)   // 跳到第 3 章
```

想看清过渡 shader 的原始输出（关掉 bloom）：

```js
// src/engine/Composer.ts 的构造参数
new Composer({ gl, textures, bloom: false })
```

---

## 七、已知简化项（诚实清单）

这些是**有意为之**的取舍，不是遗漏：

1. **没有 3D 内容。** 真实站点的 Hero 人物是 `SkinnedMesh` + 骨骼蒙皮（我实测确认过：
   `Robed_Woman_Rig` 含 `skinIndex`/`skinWeight`，场景里有 `Bone` 节点），还有 37 个 Draco
   压缩的 GLB。复刻这部分的成本远高于视觉收益，Demo 用 2.5D 平面分层替代。
   **视差原理是一样的** —— 不同 z 深度的平面 + 透视相机，这是几何后果，不是代码。

2. **纹理是 PNG 不是 KTX2。** 真实站点用 KTX2 + Basis + ZSTD + BC7 块压缩，
   GPU 直接上传零解码。换 KTX2 需要额外的构建步骤，会破坏"拖张图进去就能用"。

3. **关键帧是本地求值器，不是 Theatre.js。** 语义完全一致（都是"按 sequence.position
   求值的属性轨道"），但去掉了 Theatre 运行时。想换回去：`npm i @theatre/core`，
   然后替换 `animation/timeline.ts` 一层即可。

4. **bloom 是自写的三段式，不是 pmndrs/postprocessing。** 效果接近（都走半分辨率 +
   可分离高斯），但少了 pmndrs 的 mipmap 链式模糊，大光晕的衰减不如原版细腻。

5. **`transitionProgress` 的定义是我推导的。** 真实站点过渡参数的确切来源我没能从公开
   bundle 里确认 —— 只提取到了 `Tn()` 返回的 `{current, next}` 和 shader 里的 `uProgress`
   声明，没找到把两者连起来的那一行。当前定义在数学上保证跨章节连续、无跳变，
   观感与真实站点一致。详见 `animation/scrollProgress.ts` 的注释。

6. **没有做 WebGL2 不可用时的 DOM 图片 fallback。** 真实站点会退化成
   `FallbackImageStack`（纯 `<img>` 叠层 + opacity 过渡）。Demo 在 WebGL2 缺失时直接报错。

---

## 八、技术栈

| | |
| --- | --- |
| 构建 | Vite 5 |
| UI | React 18 + TypeScript |
| 3D | three 0.181.2（= 真实站点的 r181） |
| 滚动 | Lenis 1.3.26 |
| 后处理 | 自写（three 原生 RenderTarget） |

**为什么不用 @react-three/fiber？** 真实站点用的是 R3F，但本 Demo 的核心
（滚动驱动 + 双 RT + 过渡 shader）与 R3F 无关 —— R3F 在这里只能提供 canvas 管理和
声明式场景图，而场景图恰恰是我们要按 config 命令式构建的。去掉它让依赖从 6 个降到 4 个，
`npm install` 的失败面显著变小。想换回 R3F：把 `engine/SceneBuilder.ts` 和
`engine/Composer.ts` 换成 R3F 的 `useFrame(priority=1)` 手动接管渲染即可，
config / shader / animation 三层完全不用改。

---

## 九、参考

逆向分析的完整过程与证据在上一级目录：

- `01-勘察报告.md` —— 页面结构、13 个 section 实测属性、技术栈确认表
- `02-动画拆解.md` —— 13 场景 82 对象 / 375 轨道 / 780 关键帧全量
- `03-深度还原.md` —— progress 公式、运行时场景图、过渡 shader 全文、性能数据
- `evidence/` —— 原始 HTML、shader 源码、1247 个资产清单
- `theatre/` —— 13 份 Theatre.js 项目状态 JSON
- `tools/gen_assets.py` —— 占位素材的程序化生成脚本（想换配色可以改它）
