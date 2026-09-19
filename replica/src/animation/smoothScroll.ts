import Lenis from 'lenis';
import { sectionStore } from '../store/sectionStore';
import { computeSectionProgress, computeActiveSection } from './scrollProgress';

/**
 * 平滑滚动。
 *
 * 真实站点用的是 Lenis 1.3.23（bundle 里能直接 grep 到版本字符串，
 * 以及 `onLenisReady` / `getLenisInstance` 这类对外暴露的钩子）。
 *
 * 为什么这类站必须上平滑滚动？
 *   原生滚动的事件频率和 rAF 不同步（Chrome 下 wheel 事件可以到 100+Hz，
 *   但滚动位置的更新是离散跳变的）。过渡 shader 的阈值场对 progress 的
 *   微小跳变非常敏感 —— 直接吃原生 scrollY 会让溶解边界肉眼可见地"跳帧"。
 *   Lenis 把滚动位置插值成每帧连续的浮点值，边界才顺滑。
 *
 * 注意：这里读的是 `lenis.scroll`（插值后的值），不是 `window.scrollY`。
 */
export interface ScrollEngine {
  lenis: Lenis;
  /** 手动跳转到某一章（调试面板用） */
  scrollToSection(index: number): void;
  dispose(): void;
}

export function createScrollEngine(): ScrollEngine {
  const lenis = new Lenis({
    // 数值未在真实 bundle 中显式暴露（用的是默认值），这里给一个接近的阻尼时长
    duration: 1.1,
    smoothWheel: true,
    wheelMultiplier: 1,
    touchMultiplier: 1.4,
  });

  const sync = (): void => {
    const { heights, viewportH } = sectionStore.getState();
    const y = lenis.scroll;

    const result = computeSectionProgress(y, heights, viewportH);

    sectionStore.setState({
      scrollY: y,
      current: result.current,
      next: result.next,
      activeSection: computeActiveSection(y, heights, viewportH),
    });
  };

  lenis.on('scroll', sync);
  sync();

  return {
    lenis,

    scrollToSection(index: number): void {
      const { heights } = sectionStore.getState();
      let target = 0;
      for (let i = 0; i < index && i < heights.length; i++) target += heights[i];
      lenis.scrollTo(target, { duration: 1.2 });
    },

    dispose(): void {
      lenis.off('scroll', sync);
      lenis.destroy();
    },
  };
}
