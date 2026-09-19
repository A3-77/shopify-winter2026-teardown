/**
 * ★ 场景配置 —— 整个 Demo 的"内容层"
 * ---------------------------------------------------------------------------
 * 想加一个新章节？在下面 SCENES 数组里追加一项就行。
 * 不需要动任何组件、shader、渲染管线代码。
 *
 * 数据结构刻意对齐真实站点的 Theatre.js 资产格式：
 *   Theatre:  sheet.sequence.tracksByObject[obj].trackData[trackId].keyframes
 *              + trackIdByPropPath: '["position","x"]' -> trackId
 *   这里:     layer.tracks[].path = 'position.x' + layer.tracks[].keyframes
 * 语义完全一致（都是"按 sequence.position 求值的属性轨道"），
 * 只是去掉了 Theatre 运行时，改成本地 ~40 行的求值器（见 animation/timeline.ts）。
 */

import type { AssetKey } from './assets';
import { useOriginalAssets } from './assets';
import { DESIGN } from './design';

/* ------------------------------------------------------------------ 类型 */

export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'easeOutCubic';

export interface Keyframe {
  /** 时间轴位置 0..1 —— 对应章节的滚动进度 */
  t: number;
  value: number;
  /** 从"上一个关键帧"到"本关键帧"之间使用的缓动 */
  ease?: Ease;
}

export interface Track {
  /**
   * 属性路径。刻意与真实站点的 trackIdByPropPath 保持同名：
   *   'position.x' | 'position.y' | 'position.z'
   *   'scale.x' | 'scale.y'
   *   'rotation.z'
   *   'opacity'
   */
  path: string;
  keyframes: Keyframe[];
}

export interface LayerConfig {
  id: string;
  /** 素材 key（在 config/assets.ts 里声明），不是路径 */
  asset: AssetKey;

  /**
   * 图层类型。
   *   'plane'（默认）—— 一张贴图铺在平面上，MeshBasicMaterial 无光照
   *   'model'        —— 一个 GLB 模型，按包围盒自动缩放居中
   *
   * 两种可以混在同一个场景里（原站就是这么干的：背景是平面，
   * 前景是带骨骼的 GLB 模型）。
   */
  type?: 'plane' | 'model';

  /**
   * 仅 `type: 'model'` —— 把模型缩放到「包围盒高度 = 该值 × 视口高」。
   *
   * 为什么要这个而不是直接用 GLB 自带的 scale：
   *   37 个模型出自不同美术之手，单位尺度完全不统一（有的 0.5，有的 40）。
   *   按包围盒归一化，才能让任何模型一进来就是合适的构图，
   *   换模型时只调这一个数。
   */
  modelHeight?: number;

  /**
   * 仅 `type: 'model'` —— 是否播放模型自带的动画。
   * 默认 false。开启后动画由**滚动进度**驱动（scrub），不是按墙上时钟播放 ——
   * 原站的动画就是挂在 Theatre.js 时间轴上被 sequence.position 拖着走的。
   */
  scrubAnimations?: boolean;

  /**
   * 图层在相机空间的 z 深度（负值 = 越远）。
   * 真实站点实测：asset-1 在 z=-7.09，asset-2 在 z=-25.46。
   * 「不同 z 的平面 + 透视相机」本身就是视差，不需要额外写视差代码 ——
   * 相机一动，近的层动得多、远的层动得少，这是硬件免费给的。
   */
  z: number;

  /** 平面相对"刚好铺满视口"的放大倍数，>1 留出位移余量 */
  overscan: number;

  /**
   * 平面尺寸如何适配视口。**不写这个字段，竖版人像图会被横向拉成三角形。**
   *   'cover'   —— 铺满视口（可能裁切）。抽象背景用这个，默认值。
   *   'contain' —— 按纹理自身宽高比完整放入视口（不裁切、不拉伸）。
   *                有明确形状的中景/前景用这个。
   */
  fit?: 'cover' | 'contain';

  /** 基准偏移，单位 = 该深度处视口高度/宽度的比例 */
  offset: [number, number];

  /** 着色色调，用于在不换图的前提下改冷暖（#ffffff = 原色） */
  tint?: string;

  /** 混合模式：normal 用于实拍层，additive 用于光晕/粒子层 */
  blending?: 'normal' | 'additive';

  /**
   * 该图层是否不透明。
   *
   * ★ 这个字段是为了修一个真实的渲染顺序 bug 才加的。
   *   three 渲染时会先把所有**不透明**物体画完，再画**透明**物体 ——
   *   这个分类发生在排序**之前**，renderOrder 管不了跨列表的先后。
   *
   *   所以「背景平面 transparent:true + 前景模型 opaque」的组合会翻车：
   *   模型先画（不透明列表），背景后画（透明列表），且背景关掉了深度测试，
   *   结果**背景直接把模型盖住**，模型白渲染一场（三角面数还在涨，就是看不见）。
   *
   *   把满幅背景标成 opaque，两者就落进同一个列表，renderOrder 才真正生效。
   *   这也更贴合真实站点 —— 它的背景就是一块不透明的 quad。
   *
   * 默认 false（透明）。带 alpha 的中景/前景剪影要的就是透明，不要改。
   */
  opaque?: boolean;

  /** 该图层的属性轨道 */
  tracks: Track[];
}

export interface SceneConfig {
  id: string;
  /** 对应 DOM 章节的 data-section-id，也用于调试面板 */
  handle: string;
  index: number;

  /** DOM 覆盖层文案 */
  eyebrow: string;
  title: string;
  body: string;

  /** 章节主色（DOM 文字 / 进度条 / 调试面板） */
  accent: string;
  /** canvas 底色，同时是 DOM 的背景（避免加载瞬间白闪） */
  background: string;

  /** DOM 章节高度（vh 倍数）—— 决定"滚多远换一章" */
  heightVh: number;

  /**
   * 交叉溶解提前量（vh 倍数）。
   * 真实实现：index >= 2 ? 0.2 : 0
   */
  earlyCrossfade: number;

  /** 过渡 shader 的 uIsHero：首屏走"圆形径向溶解 + 缩放"，其余走"斜向擦除" */
  isHero: boolean;

  /** 过渡时投影到屏幕的"溶解中心点"（世界坐标） */
  fadeCenter: [number, number, number];

  camera: {
    /** 相机到世界原点的距离 */
    z: number;
    fov: number;
    /** 相机自身的轨道（真实站点 Hero 的 fov 实测从 25 走到 22.27） */
    tracks: Track[];
  };

  layers: LayerConfig[];
}

/* ------------------------------------------------------------------ 工具 */

/** 按真实规则推导 earlyCrossfade */
const crossfadeFor = (index: number): number =>
  index >= DESIGN.earlyCrossfadeFrom ? DESIGN.earlyCrossfadeAmount : 0;

/* ------------------------------------------------------------------ 场景 */

/* ==========================================================================
   场景组 A —— 占位素材（默认）
   用 tools/gen_assets.py 生成的抽象图，开箱即跑，不携带原站美术资产。
   ========================================================================== */

const PLACEHOLDER_SCENES: SceneConfig[] = [
  /* ============================================================ 01 Hero */
  {
    id: 'scene-hero',
    handle: 'hero',
    index: 0,
    eyebrow: 'Edition 01',
    title: 'Winter 2026',
    body: '滚动驱动的双场景交叉溶解。背景、中景、前景分别位于不同 z 深度，相机推进时自然产生视差。',
    accent: '#e8c08a',
    background: '#1a1210',
    heightVh: DESIGN.sectionHeightVh,
    earlyCrossfade: crossfadeFor(0),
    isHero: true,
    fadeCenter: [0, 0, 0],
    camera: {
      z: 6.44,
      fov: 25,
      tracks: [
        // 真实站点 Hero 的相机 z 从 6.439 出发；fov 实测从 25 收到 22.27
        { path: 'position.z', keyframes: [
          { t: 0.0, value: 6.44, ease: 'easeInOut' },
          { t: 1.0, value: 4.20 },
        ]},
        { path: 'fov', keyframes: [
          { t: 0.0, value: 25.0, ease: 'easeInOut' },
          { t: 1.0, value: 22.27 },
        ]},
        { path: 'position.y', keyframes: [
          { t: 0.0, value: -0.25, ease: 'easeInOut' },
          { t: 1.0, value: 0.10 },
        ]},
        { path: 'rotation.z', keyframes: [
          { t: 0.0, value: 0.0, ease: 'easeInOut' },
          { t: 1.0, value: -0.03 },
        ]},
      ],
    },
    layers: [
      {
        id: 'bg',
        asset: 'heroBg',
        // 满幅背景标成不透明：见 LayerConfig.opaque 的注释（否则会盖住前景模型）
        opaque: true,
        z: -30,
        overscan: 1.16,
        offset: [0, 0],
        tint: '#ffffff',
        tracks: [
          // 远景几乎不动 —— 视差的最外层
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.05, ease: 'easeInOut' }, { t: 1, value: -0.05 },
          ]},
          { path: 'scale.x', keyframes: [
            { t: 0, value: 1.0, ease: 'easeOutCubic' }, { t: 1, value: 1.05 },
          ]},
        ],
      },
      {
        id: 'mid',
        fit: 'contain',
        asset: 'heroMid',
        z: -11,
        overscan: 0.88,
        // 右移 + 略微下沉，给左侧标题让位，也让剪影落在视口下半部
        offset: [0.28, -0.06],
        tracks: [
          // 中景：主体，位移最明显
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.18, ease: 'easeInOut' }, { t: 1, value: -0.16 },
          ]},
          { path: 'position.x', keyframes: [
            { t: 0, value: 0.04, ease: 'easeInOut' }, { t: 1, value: -0.03 },
          ]},
          { path: 'rotation.z', keyframes: [
            { t: 0, value: 0.0, ease: 'easeInOut' }, { t: 1, value: 0.035 },
          ]},
        ],
      },
      {
        id: 'fg',
        fit: 'contain',
        asset: 'heroFg',
        z: -2.4,
        overscan: 1.4,
        offset: [0, -0.34],
        tracks: [
          // 前景：跑得最快 —— 视差最强
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.12, ease: 'easeInOut' }, { t: 1, value: -0.26 },
          ]},
          { path: 'scale.y', keyframes: [
            { t: 0, value: 1.0, ease: 'easeOutCubic' }, { t: 1, value: 1.12 },
          ]},
        ],
      },
    ],
  },

  /* ======================================================== 02 Sidekick */
  {
    id: 'scene-sidekick',
    handle: 'sidekick',
    index: 1,
    eyebrow: 'Edition 02',
    title: 'Sidekick',
    body: '冷色章节。相机反向拉远，配合斜向擦除的阈值场，形成与上一章完全不同的进入方式。',
    accent: '#8fd6e8',
    background: '#0a1424',
    heightVh: DESIGN.sectionHeightVh,
    earlyCrossfade: crossfadeFor(1),
    isHero: false,
    fadeCenter: [0, 0, 0],
    camera: {
      z: 5.2,
      fov: 24,
      tracks: [
        // 与 Hero 相反：拉远 + 视角变宽
        { path: 'position.z', keyframes: [
          { t: 0.0, value: 5.20, ease: 'easeInOut' },
          { t: 1.0, value: 7.60 },
        ]},
        { path: 'fov', keyframes: [
          { t: 0.0, value: 24.0, ease: 'easeInOut' },
          { t: 1.0, value: 29.0 },
        ]},
        { path: 'position.x', keyframes: [
          { t: 0.0, value: -0.30, ease: 'easeInOut' },
          { t: 1.0, value: 0.26 },
        ]},
      ],
    },
    layers: [
      {
        id: 'bg',
        asset: 'sidekickBg',
        opaque: true,
        z: -32,
        overscan: 1.12,
        offset: [0, 0],
        tracks: [
          { path: 'position.x', keyframes: [
            { t: 0, value: 0.03, ease: 'easeInOut' }, { t: 1, value: -0.03 },
          ]},
        ],
      },
      {
        id: 'mid',
        fit: 'contain',
        asset: 'sidekickMid',
        z: -9,
        overscan: 0.92,
        offset: [0.14, -0.02],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: -0.14, ease: 'easeInOut' }, { t: 1, value: 0.12 },
          ]},
          { path: 'rotation.z', keyframes: [
            { t: 0, value: -0.06, ease: 'easeInOut' }, { t: 1, value: 0.05 },
          ]},
          { path: 'scale.x', keyframes: [
            { t: 0, value: 0.94, ease: 'easeOutCubic' }, { t: 1, value: 1.08 },
          ]},
        ],
      },
      {
        id: 'fg',
        fit: 'contain',
        asset: 'sidekickFg',
        z: -2.4,
        overscan: 1.4,
        offset: [0, -0.30],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: -0.10, ease: 'easeInOut' }, { t: 1, value: 0.16 },
          ]},
        ],
      },
    ],
  },

  /* ========================================================== 03 Retail */
  {
    id: 'scene-retail',
    handle: 'retail',
    index: 2,
    eyebrow: 'Edition 03',
    title: 'Retail',
    body:
      '这一章刻意复用了 01/02 的素材，只靠 config 里的色调、z 深度、相机轨道和 earlyCrossfade 做出全新章节 —— ' +
      '这就是"config 驱动 scene"的意义：加章节不用写组件。',
    accent: '#d9a0ff',
    background: '#150f22',
    heightVh: DESIGN.sectionHeightVh,
    earlyCrossfade: crossfadeFor(2), // ← index>=2，所以这里是 0.2
    isHero: false,
    fadeCenter: [0, 0, 0],
    camera: {
      z: 8.4,
      fov: 30,
      tracks: [
        { path: 'position.z', keyframes: [
          { t: 0.0, value: 8.40, ease: 'easeInOut' },
          { t: 1.0, value: 5.60 },
        ]},
        { path: 'fov', keyframes: [
          { t: 0.0, value: 30.0, ease: 'easeInOut' },
          { t: 1.0, value: 24.0 },
        ]},
        { path: 'position.y', keyframes: [
          { t: 0.0, value: 0.20, ease: 'easeInOut' },
          { t: 1.0, value: -0.18 },
        ]},
      ],
    },
    layers: [
      {
        id: 'bg',
        asset: 'heroBg',
        opaque: true,
        z: -34,
        overscan: 1.2,
        offset: [0, 0],
        tint: '#8f9fd4', // ← 同一张暖色图，靠 tint 变成冷紫
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: -0.04, ease: 'easeInOut' }, { t: 1, value: 0.06 },
          ]},
        ],
      },
      {
        id: 'mid',
        fit: 'contain',
        asset: 'sidekickMid',
        z: -10,
        overscan: 1.0,
        offset: [0.24, 0.02],
        tint: '#c9a8ff',
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.20, ease: 'easeInOut' }, { t: 1, value: -0.18 },
          ]},
          { path: 'rotation.z', keyframes: [
            { t: 0, value: 0.05, ease: 'easeInOut' }, { t: 1, value: -0.07 },
          ]},
        ],
      },
      {
        id: 'fg',
        fit: 'contain',
        asset: 'heroFg',
        z: -2.2,
        overscan: 1.45,
        offset: [0, -0.36],
        tint: '#6e5f9a',
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.16, ease: 'easeInOut' }, { t: 1, value: -0.30 },
          ]},
        ],
      },
    ],
  },
];

/* ==========================================================================
   场景组 B —— 原站真实素材
   ---------------------------------------------------------------------------
   用 http://127.0.0.1:5173/?assets=original 打开。

   与场景组 A 的区别不只是"图更好看"，而是**结构也不同**：
     A：三层平面（bg / mid / fg），全部 MeshBasicMaterial，纯 2D 合成
     B：KTX2 背景平面 + GLB 前景模型（带骨骼、带动画），原站的真实构成

   也刻意做成**章节数不同**（A 三章 / B 四章），用来证明章节数完全由配置决定 ——
   DOM 章节、总滚动高度、导航点都是从 SCENES 推出来的，不写死。

   这正是把素材抓下来之后才做得成的 —— 报告里写"19/37 个模型用 unlit"、
   "Hero 有 170 根骨骼"，只有真把 GLB 加载起来才算亲眼验证。

   ⚠️ 这些是原站内容副本，版权归 Shopify 及原权利人，仅限个人研究。
   ========================================================================== */

const ORIGINAL_SCENES: SceneConfig[] = [
  /* ==================================================== B1 Hero（原站素材） */
  {
    id: 'o-scene-hero',
    handle: 'hero',
    index: 0,
    eyebrow: 'Original 01',
    title: 'Winter 2026',
    body:
      '原站真实素材：KTX2 背景 + GLB 前景模型（36,125 顶点 / 170 骨骼 / 6 段动画）。' +
      '动画由滚动进度驱动 —— 原站是挂在 Theatre.js 时间轴上被 sequence.position 拖着走的。',
    accent: '#e8c08a',
    background: '#1a1210',
    heightVh: DESIGN.sectionHeightVh,
    earlyCrossfade: crossfadeFor(0),
    isHero: true,
    fadeCenter: [0, 0, 0],
    camera: {
      z: 6.44,
      fov: 25,
      tracks: [
        { path: 'position.z', keyframes: [
          { t: 0.0, value: 6.44, ease: 'easeInOut' },
          { t: 1.0, value: 4.60 },
        ]},
        { path: 'fov', keyframes: [
          { t: 0.0, value: 25.0, ease: 'easeInOut' },
          { t: 1.0, value: 22.27 },
        ]},
      ],
    },
    layers: [
      {
        id: 'bg',
        type: 'plane',
        asset: 'oHeroBg',
        opaque: true,
        z: -30,
        overscan: 1.16,
        offset: [0, 0],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.05, ease: 'easeInOut' }, { t: 1, value: -0.05 },
          ]},
          { path: 'scale.x', keyframes: [
            { t: 0, value: 1.0, ease: 'easeOutCubic' }, { t: 1, value: 1.05 },
          ]},
        ],
      },
      {
        id: 'model',
        type: 'model',
        asset: 'oHeroModel',
        modelHeight: 0.86,
        scrubAnimations: true,
        z: -8,
        overscan: 1,
        offset: [0.06, -0.05],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.16, ease: 'easeInOut' }, { t: 1, value: -0.14 },
          ]},
          { path: 'position.x', keyframes: [
            { t: 0, value: 0.03, ease: 'easeInOut' }, { t: 1, value: -0.02 },
          ]},
          { path: 'rotation.z', keyframes: [
            { t: 0, value: 0.0, ease: 'easeInOut' }, { t: 1, value: 0.03 },
          ]},
        ],
      },
    ],
  },

  /* ================================================ B2 Sidekick（原站素材） */
  {
    id: 'o-scene-sidekick',
    handle: 'sidekick',
    index: 1,
    eyebrow: 'Original 02',
    title: 'Sidekick',
    body:
      '星空背景本身也是一个 GLB —— 但它只有 4 个顶点、2 个三角面，' +
      '就是一块 quad，KTX2 贴图直接烘在 GLB 里。这是 04 报告第 2 节的现场验证。',
    accent: '#8fd6e8',
    background: '#0a1424',
    heightVh: DESIGN.sectionHeightVh,
    earlyCrossfade: crossfadeFor(1),
    isHero: false,
    fadeCenter: [0, 0, 0],
    camera: {
      z: 5.2,
      fov: 24,
      tracks: [
        { path: 'position.z', keyframes: [
          { t: 0.0, value: 5.20, ease: 'easeInOut' },
          { t: 1.0, value: 7.20 },
        ]},
        { path: 'fov', keyframes: [
          { t: 0.0, value: 24.0, ease: 'easeInOut' },
          { t: 1.0, value: 28.0 },
        ]},
        { path: 'position.x', keyframes: [
          { t: 0.0, value: -0.26, ease: 'easeInOut' },
          { t: 1.0, value: 0.22 },
        ]},
      ],
    },
    layers: [
      {
        id: 'stars',
        type: 'model',
        asset: 'oSidekickStars',
        modelHeight: 1.35,
        z: -32,
        overscan: 1,
        offset: [0, 0],
        tracks: [
          { path: 'position.x', keyframes: [
            { t: 0, value: 0.03, ease: 'easeInOut' }, { t: 1, value: -0.03 },
          ]},
        ],
      },
      {
        id: 'model',
        type: 'model',
        asset: 'oSidekickModel',
        modelHeight: 0.9,
        z: -9,
        overscan: 1,
        offset: [0.1, -0.02],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: -0.12, ease: 'easeInOut' }, { t: 1, value: 0.12 },
          ]},
          { path: 'rotation.z', keyframes: [
            { t: 0, value: -0.05, ease: 'easeInOut' }, { t: 1, value: 0.04 },
          ]},
        ],
      },
    ],
  },

  /* ============================================= B3 Operations（原站素材） */
  {
    id: 'o-scene-operations',
    handle: 'operations',
    index: 2,
    eyebrow: 'Original 03',
    title: 'Operations',
    body:
      '全站最大的模型：144,040 顶点 / 65,780 三角面 / 20 骨骼。' +
      'Draco 压缩后只有 726 KB —— 这个压缩比就是原站敢在首屏放几十个模型的底气。',
    accent: '#a8e0b0',
    background: '#0e1a14',
    heightVh: DESIGN.sectionHeightVh,
    earlyCrossfade: crossfadeFor(2),
    isHero: false,
    fadeCenter: [0, 0, 0],
    camera: {
      z: 7.0,
      fov: 26,
      tracks: [
        { path: 'position.z', keyframes: [
          { t: 0.0, value: 7.00, ease: 'easeInOut' },
          { t: 1.0, value: 5.40 },
        ]},
        { path: 'fov', keyframes: [
          { t: 0.0, value: 26.0, ease: 'easeInOut' },
          { t: 1.0, value: 23.0 },
        ]},
        { path: 'position.y', keyframes: [
          { t: 0.0, value: 0.14, ease: 'easeInOut' },
          { t: 1.0, value: -0.12 },
        ]},
      ],
    },
    layers: [
      {
        id: 'bg',
        type: 'plane',
        asset: 'oOperationsBg',
        opaque: true,
        z: -34,
        overscan: 1.18,
        offset: [0, 0],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: -0.03, ease: 'easeInOut' }, { t: 1, value: 0.05 },
          ]},
        ],
      },
      {
        id: 'model',
        type: 'model',
        asset: 'oOperationsModel',
        modelHeight: 0.82,
        scrubAnimations: true,
        z: -10,
        overscan: 1,
        offset: [0.02, -0.04],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.14, ease: 'easeInOut' }, { t: 1, value: -0.14 },
          ]},
        ],
      },
    ],
  },

  /* ================================================= B4 Finance（原站素材） */
  {
    id: 'o-scene-finance',
    handle: 'finance',
    index: 3,
    eyebrow: 'Original 04',
    title: 'Finance',
    body:
      '48,384 顶点 / 46,793 三角面 / 66 骨骼。这个模型声明了 KHR_materials_unlit —— ' +
      '也就是它**不参与光照计算**，直接输出贴图色。和 Hero 正好构成两种材质的对照。',
    accent: '#f0c46a',
    background: '#1a1508',
    heightVh: DESIGN.sectionHeightVh,
    earlyCrossfade: crossfadeFor(3),
    isHero: false,
    fadeCenter: [0, 0, 0],
    camera: {
      z: 7.6,
      fov: 27,
      tracks: [
        { path: 'position.z', keyframes: [
          { t: 0.0, value: 7.60, ease: 'easeInOut' },
          { t: 1.0, value: 5.80 },
        ]},
        { path: 'fov', keyframes: [
          { t: 0.0, value: 27.0, ease: 'easeInOut' },
          { t: 1.0, value: 24.0 },
        ]},
        { path: 'position.x', keyframes: [
          { t: 0.0, value: 0.18, ease: 'easeInOut' },
          { t: 1.0, value: -0.16 },
        ]},
      ],
    },
    layers: [
      {
        id: 'bg',
        type: 'plane',
        asset: 'oFinanceBg',
        opaque: true,
        z: -33,
        overscan: 1.16,
        offset: [0, 0],
        tracks: [
          { path: 'position.x', keyframes: [
            { t: 0, value: -0.03, ease: 'easeInOut' }, { t: 1, value: 0.03 },
          ]},
        ],
      },
      {
        id: 'model',
        type: 'model',
        asset: 'oFinanceModel',
        modelHeight: 0.84,
        scrubAnimations: true,
        z: -9,
        overscan: 1,
        offset: [-0.04, -0.03],
        tracks: [
          { path: 'position.y', keyframes: [
            { t: 0, value: 0.13, ease: 'easeInOut' }, { t: 1, value: -0.13 },
          ]},
          { path: 'rotation.z', keyframes: [
            { t: 0, value: 0.02, ease: 'easeInOut' }, { t: 1, value: -0.02 },
          ]},
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ 派生 */

/**
 * 当前生效的场景组。
 *
 * 通过 URL 参数切换：`?assets=original`
 * 为什么不做运行时热切换 —— 换素材意味着纹理、几何、材质全都要重建，
 * 等于重新初始化一遍渲染器。刷新页面更干净，也没有中间状态。
 */
export const SCENES: SceneConfig[] = useOriginalAssets() ? ORIGINAL_SCENES : PLACEHOLDER_SCENES;

/** 是否正在用原站真实素材（DOM 层用来显示提示） */
export const USING_ORIGINAL = useOriginalAssets();

/** 章节总高度（px）—— 用于给 DOM 章节分配高度、并算出整页滚动长度 */
export const totalVh = SCENES.reduce((sum, s) => sum + s.heightVh, 0);

/** 所有被场景引用到的素材 key（用于统一预加载） */
export const USED_ASSETS: AssetKey[] = Array.from(
  new Set<AssetKey>([
    ...SCENES.flatMap((s) => s.layers.map((l) => l.asset)),
    'noise',
    'mudNormal',
  ]),
);
