/**
 * 设计 token —— 数值来自对真实站点的运行时实测（见 03-深度还原.md §5）
 *
 * 实测依据：
 *   H2 computed style = font-size 149.386px / font-weight 700
 *                       letter-spacing -0.03em / line-height 0.9
 *   字体族：NeueMontreal（正文/标题）、HWCigars（展示）、ImperialScript（手写）
 *   tailwind v4.2.2，@layer theme/base/components/utilities/properties/transitions
 */

export const DESIGN = {
  font: {
    sans: '"NeueMontreal","Helvetica Neue",Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif',
    display: '"HWCigars","NeueMontreal",Georgia,"Songti SC",serif',
    script: '"ImperialScript","Snell Roundhand",cursive',
  },

  type: {
    /** 真实站点 H2 的实测值，这里用 clamp 做流式缩放，上限对齐 149.386px */
    h2: {
      fontSize: 'clamp(40px, 9.3vw, 149.386px)',
      fontWeight: 700,
      letterSpacing: '-0.03em',
      lineHeight: 0.9,
    },
    h3: {
      fontSize: 'clamp(24px, 3.2vw, 52px)',
      fontWeight: 700,
      letterSpacing: '-0.02em',
      lineHeight: 0.95,
    },
    eyebrow: {
      fontSize: 'clamp(11px, 0.85vw, 13px)',
      fontWeight: 500,
      letterSpacing: '0.18em',
      textTransform: 'uppercase' as const,
    },
    body: {
      fontSize: 'clamp(14px, 1.05vw, 17px)',
      fontWeight: 400,
      lineHeight: 1.55,
      letterSpacing: '-0.01em',
    },
  },

  /** 章节高度（vh 倍数）—— 决定"滚多远换一章" */
  sectionHeightVh: 1.2,

  /**
   * 交叉溶解提前量。
   * 真实实现：`earlyCrossfade: sectionIndex >= 2 ? 0.2 : 0`
   * 即从第 3 章开始，下一章提前 20% 视口高度开始参与溶解。
   */
  earlyCrossfadeFrom: 2,
  earlyCrossfadeAmount: 0.2,

  /** 过渡参数（对齐真实 shader 的常量） */
  transition: {
    /** hero 的 progress 用 smoothstep(0, 1.5, p) 重新映射 */
    heroSmoothstepMax: 1.5,
    /** 阈值场整体缩放：threshold / 1.2 */
    thresholdDivisor: 1.2,
    /** 噪声对阈值的权重 */
    noiseWeight: 0.2,
    /** fwidth 线稿强度区间 */
    edgeStrength: [5.0, 10.0] as [number, number],
    /** 抗锯齿带宽倍数 */
    aaWidth: 10.0,
    /** 溶解中心的鼠标影响权重 */
    mouseInfluence: 0.1,
  },
} as const;
