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
 */

export const ASSETS = {
  /** 章节 01 —— 暖色油画感背景 */
  heroBg: 'assets/hero-bg.png',
  /** 章节 01 —— 中景（人物剪影，带 alpha） */
  heroMid: 'assets/hero-mid.png',
  /** 章节 01 —— 前景（植被/山脊剪影，带 alpha） */
  heroFg: 'assets/hero-fg.png',

  /** 章节 02 —— 冷色科技感背景 */
  sidekickBg: 'assets/sidekick-bg.png',
  /** 章节 02 —— 中景（等距立方体，带 alpha） */
  sidekickMid: 'assets/sidekick-mid.png',
  /** 章节 02 —— 前景剪影 */
  sidekickFg: 'assets/sidekick-fg.png',

  /** 过渡扰动用的噪声图（灰度，R 通道即噪声值） */
  noise: 'assets/noise.png',
  /** 过渡扰动用的法线图（R 通道被用作位移偏移，与真实 shader 一致） */
  mudNormal: 'assets/mud-normal.png',
} as const;

export type AssetKey = keyof typeof ASSETS;

const BASE = (import.meta.env.BASE_URL as string | undefined) || '/';

/** 把资产 key 解析成可直接喂给 TextureLoader 的 URL */
export function resolveAsset(key: AssetKey): string {
  const base = BASE.endsWith('/') ? BASE : `${BASE}/`;
  return `${base}${ASSETS[key]}`;
}

/**
 * 预加载实现见 `src/engine/loaders.ts`。
 * 本文件只负责"路径"这一件事 —— 加载策略（KTX2 / PNG / 压缩）是引擎层的事，
 * 分开之后换加载方式不用动配置。
 */
