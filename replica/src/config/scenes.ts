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

export const SCENES: SceneConfig[] = [
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

/* ------------------------------------------------------------------ 派生 */

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
