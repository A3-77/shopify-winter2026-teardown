import { createStore } from './createStore';

export interface SectionProgress {
  index: number;
  /** 0..1 */
  progress: number;
}

export interface SectionState {
  /** Lenis 平滑后的滚动位置（不是原生 scrollY —— 原生值会抖） */
  scrollY: number;
  /** 视口高度（px） */
  viewportH: number;
  /** 各章节 DOM 实测高度（px），启动后由 ScrollSections 回填 */
  heights: number[];
  /**
   * 探针线命中的章节。
   * 真实实现：探针线 = scrollY + viewportH * 0.3
   * （提取自 Background-CGKUhMwd.js 的滚动处理器，见 evidence/SCROLL_HANDLER_pretty.txt）
   */
  activeSection: number;
  /** 主场景进度 */
  current: SectionProgress;
  /** 正在参与交叉溶解的下一章；null = 当前没有交叉 */
  next: SectionProgress | null;
  /** 归一化鼠标位置，0..1，供过渡 shader 的 uMouse 使用 */
  mouse: [number, number];
  /** 首帧是否已渲染完成 */
  ready: boolean;
  /** 素材是否全部就绪 */
  loaded: boolean;
  /** 初始化失败时的错误信息（WebGL2 缺失、素材 404 等） */
  error: string | null;
}

export const sectionStore = createStore<SectionState>({
  scrollY: 0,
  viewportH: typeof window !== 'undefined' ? window.innerHeight : 800,
  heights: [],
  activeSection: 0,
  current: { index: 0, progress: 0 },
  next: null,
  mouse: [0.5, 0.5],
  ready: false,
  loaded: false,
  error: null,
});
