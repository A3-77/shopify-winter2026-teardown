import { CanvasHost } from './components/CanvasHost';
import { ScrollSections, SectionNav } from './components/ScrollSections';
import { DebugHUD } from './components/DebugHUD';

/**
 * 页面结构（三层，顺序不能反）：
 *
 *   1. CanvasHost     —— sticky 钉住的 WebGL 画布，负 margin 把自己抽离文档流
 *   2. ScrollSections —— 透明的 DOM 章节，提供滚动高度 + 文案，叠在画布之上
 *   3. SectionNav / DebugHUD —— 固定定位的 UI
 */
export default function App() {
  return (
    <div className="app">
      <CanvasHost />
      <ScrollSections />
      <SectionNav />
      <DebugHUD />
    </div>
  );
}
