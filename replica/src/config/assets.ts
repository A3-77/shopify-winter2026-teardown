/**
 * ★ 素材路径的唯一出口（Single Source of Truth）
 * ---------------------------------------------------------------------------
 * 真实站点把 1247 个资产 URL 全部放在 CMS 下发的 sections JSON 里，
 * 前端代码里不出现任何硬编码路径（我用 `ASSETS_full.json` 抓全了那 1247 条）。
 * 这里沿用同样的思路：
 *
 *   ▸ 想换成你自己的图 → 直接覆盖 public/assets/ 下的同名文件，一行代码都不用改。
 *   ▸ 文件名不一样    → 只改本文件，其余所有地方统一走 resolveAsset()。
 *
 * 所以：任何组件里都不要出现 "/assets/xxx.png" 这种字符串。
 *
 * ---------------------------------------------------------------------------
 * 关于 `kind`
 * ---------------------------------------------------------------------------
 * 素材有三种加载方式，必须显式声明，因为**加载器没法从扩展名猜**：
 *
 *   'image' —— 普通位图，走 TextureLoader
 *   'ktx2'  —— Basis Universal 压缩纹理，必须走 KTX2Loader（需要 wasm 转码器）
 *   'glb'   —— 整个 3D 模型，走 GLTFLoader（还要挂 Draco + KTX2 解码器）
 *
 * 把 kind 写在注册表里而不是让加载器嗅探扩展名，好处是：
 * 换素材时如果忘了改 kind，加载器会**明确报错**，而不是静默走错分支。
 */

export type AssetKind = 'image' | 'ktx2' | 'glb';

export interface AssetDef {
  /** 相对 public/ 的路径 */
  path: string;
  kind: AssetKind;
}

export const ASSETS = {
  /* ================================================== 占位素材（可自由替换）
   * 这 8 张是 tools/gen_assets.py 程序化生成的抽象图，
   * 目的是让 Demo 开箱即跑，且**不携带任何原站美术资产**。
   * 想换成自己的图：直接覆盖 replica/public/assets/ 下的同名文件即可。
   */
  heroBg: { path: 'assets/hero-bg.png', kind: 'image' },
  heroMid: { path: 'assets/hero-mid.png', kind: 'image' },
  heroFg: { path: 'assets/hero-fg.png', kind: 'image' },

  sidekickBg: { path: 'assets/sidekick-bg.png', kind: 'image' },
  sidekickMid: { path: 'assets/sidekick-mid.png', kind: 'image' },
  sidekickFg: { path: 'assets/sidekick-fg.png', kind: 'image' },

  /** 过渡扰动用的噪声图（灰度，R 通道即噪声值） */
  noise: { path: 'assets/noise.png', kind: 'image' },
  /** 过渡扰动用的法线图（R 通道被用作位移偏移，与真实 shader 一致） */
  mudNormal: { path: 'assets/mud-normal.png', kind: 'image' },

  /* ============================================ 原站真实素材（前缀 o = original）
   * 来自仓库根的 assets-original/，由 tools/fetch_assets.py 从公开 CDN 拉取。
   * 通过 vite.config.ts 里的中间件映射到 /original/ 路径，dev 与 build 都可用。
   *
   * 用它们跑：http://127.0.0.1:5173/?assets=original
   *
   * 注意：这些是原站内容副本，版权归原权利人，仅限个人研究（见仓库 README）。
   */

  // ---- Hero 首屏 ----
  oHeroBg: { path: 'original/textures/Hero-bg-hires-optimized.ktx2', kind: 'ktx2' },
  oHeroModel: {
    path: 'original/models/EW26_Hero_251207v3_compressed-optimized.glb',
    kind: 'glb',
  },

  // ---- Sidekick ----
  // 注意：Sidekick 的背景不是贴图平面，而是一个**模型**
  // （EW26_Sidekick_bg_stars，4 顶点 quad + 内嵌 KTX2）。
  // 所以这里没有 oSidekickBg —— 背景走 oSidekickStars 那条路。
  oSidekickModel: {
    path: 'original/models/EW26_Sidekick_251208_compressed-optimized.glb',
    kind: 'glb',
  },
  /** Sidekick 的星空背景是独立模型（4 顶点 quad + 内嵌 KTX2） */
  oSidekickStars: {
    path: 'original/models/EW26_Sidekick_bg_stars-optimized.glb',
    kind: 'glb',
  },

  // ---- Operations（用最大的那个模型，144k 顶点）----
  oOperationsBg: {
    path: 'original/textures/Operations_bg_diffuse-optimized.ktx2',
    kind: 'ktx2',
  },
  oOperationsModel: {
    path: 'original/models/Operations_fg_smaller_251127_compressed-optimized.glb',
    kind: 'glb',
  },

  // ---- Finance ----
  oFinanceBg: { path: 'original/textures/Finance_bg-optimized.ktx2', kind: 'ktx2' },
  oFinanceModel: {
    path: 'original/models/EW26_Finance_251208v2_compressed-optimized.glb',
    kind: 'glb',
  },
} as const satisfies Record<string, AssetDef>;

export type AssetKey = keyof typeof ASSETS;

const BASE = (import.meta.env.BASE_URL as string | undefined) || '/';

/** 把资产 key 解析成可直接喂给加载器的 URL */
export function resolveAsset(key: AssetKey): string {
  const base = BASE.endsWith('/') ? BASE : `${BASE}/`;
  return `${base}${ASSETS[key].path}`;
}

/** 该资产该用哪个加载器 */
export function assetKind(key: AssetKey): AssetKind {
  return ASSETS[key].kind;
}

/** 是否是原站真实素材（UI 上用来提示版权） */
export function isOriginalAsset(key: AssetKey): boolean {
  return key.startsWith('o') && ASSETS[key].path.startsWith('original/');
}

/**
 * 是否使用原站真实素材。读 URL 参数：`?assets=original`
 *
 * 为什么用 URL 参数而不是运行时开关：切换素材意味着要重建全部场景
 * （纹理、几何、材质都不一样），重建等于重新初始化一遍渲染器。
 * 与其写一套热切换逻辑，不如刷新页面 —— 干净、无中间状态。
 */
export function useOriginalAssets(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('assets') === 'original';
}

/**
 * 预加载实现见 `src/engine/loaders.ts`。
 * 本文件只负责"路径 + 加载方式"这两件事 —— 加载策略（并发、缓存、降级）
 * 是引擎层的事，分开之后换加载方式不用动配置。
 */
