import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Composer } from '../engine/Composer';
import { disposeTextures, loadTextures } from '../engine/loaders';
import { createScrollEngine, type ScrollEngine } from '../animation/smoothScroll';
import { sectionStore } from '../store/sectionStore';
import { USED_ASSETS } from '../config/scenes';
import type { AssetKey } from '../config/assets';

/**
 * WebGL 宿主。
 *
 * ★ 布局机制（这是"画布钉住"的实现，不是 GSAP pin）：
 *   真实站点实测的 class 是
 *     `sticky top-0 left-0 w-full h-[100vh] -mb-[100vh]`
 *   即：sticky 钉住 + 一个负的 margin-bottom 把自己从文档流里"抽掉"。
 *   结果就是 —— canvas 永远停在视口，而后面的章节照常滚动并叠在它上面。
 *   全程零 JS 参与定位，滚动性能完全交给合成器。
 *   （我全量 grep 过 bundle：GSAP / ScrollTrigger 命中 0 次，确认没有用 pin。）
 *
 * ★ 降级条件：真实站点的实测条件是 `canvas.getContext('webgl2') !== null`，
 *   不是视口宽度。我一开始按"移动端降级"写进报告，后来把视口缩到 502px 重载，
 *   发现 canvasCount 仍是 5、`.canvas-wrapper` 的 opacity 仍是 1，才改正过来。
 */
export function CanvasHost() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let composer: Composer | null = null;
    let textures: Map<AssetKey, THREE.Texture> | null = null;
    let scrollEngine: ScrollEngine | null = null;
    let ro: ResizeObserver | null = null;

    const readHeights = (): number[] =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-section-id]')).map(
        (el) => el.offsetHeight,
      );

    const syncLayout = (): void => {
      sectionStore.setState({
        heights: readHeights(),
        viewportH: window.innerHeight,
      });
    };

    void (async () => {
      try {
        // ---- WebGL2 能力检测（真实站点的降级条件）----
        if (!document.createElement('canvas').getContext('webgl2')) {
          throw new Error('当前浏览器/设备不支持 WebGL2');
        }

        renderer = new THREE.WebGLRenderer({
          // 全屏后处理下 MSAA 既昂贵又几乎看不出差别（真实站点实测也是关掉的）
          antialias: false,
          alpha: false,
          stencil: false,
          depth: true,
          powerPreference: 'high-performance',
        });

        // sRGB 直通：这是一层"图像合成"，不做线性化才不会让画面整体偏暗
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.setClearColor(0x000000, 1);

        const el = renderer.domElement;
        el.style.display = 'block';
        el.style.width = '100%';
        el.style.height = '100%';
        host.appendChild(el);

        // ---- 素材 ----
        textures = await loadTextures(USED_ASSETS);
        if (disposed) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = host.clientWidth || window.innerWidth;
        const h = host.clientHeight || window.innerHeight;

        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);

        composer = new Composer({ gl: renderer, textures });
        composer.setSize(w, h, dpr);

        // 先量章节高度，再启动滚动 —— 顺序反了的话第一帧进度会算错
        syncLayout();
        scrollEngine = createScrollEngine();

        sectionStore.setState({ loaded: true });

        // 调试入口：控制台里可以直接 __REPLICA__.composer.stats 看实时状态
        (window as unknown as Record<string, unknown>).__REPLICA__ = {
          composer,
          scrollEngine,
          renderer,
          sectionStore,
        };

        const start = performance.now();
        let readyFlagged = false;

        const loop = (): void => {
          if (disposed) return;
          raf = requestAnimationFrame(loop);

          const now = performance.now();
          // Lenis 必须在 rAF 里推进，它才会把滚动位置插值成逐帧连续值
          scrollEngine!.lenis.raf(now);
          composer!.render((now - start) / 1000);

          if (!readyFlagged) {
            readyFlagged = true;
            sectionStore.setState({ ready: true });
          }
        };
        raf = requestAnimationFrame(loop);

        // ---- 尺寸变化 ----
        const onResize = (): void => {
          if (!renderer || !composer) return;
          const nw = host.clientWidth || window.innerWidth;
          const nh = host.clientHeight || window.innerHeight;
          const ndpr = Math.min(window.devicePixelRatio || 1, 2);

          renderer.setPixelRatio(ndpr);
          renderer.setSize(nw, nh, false);
          composer.setSize(nw, nh, ndpr);
          syncLayout();
        };
        window.addEventListener('resize', onResize);

        ro = new ResizeObserver(() => syncLayout());
        document
          .querySelectorAll<HTMLElement>('[data-section-id]')
          .forEach((node) => ro!.observe(node));

        // 字体加载完高度可能变，再量一次
        void document.fonts?.ready.then(() => {
          if (!disposed) syncLayout();
        });
      } catch (err) {
        console.error('[CanvasHost] 初始化失败:', err);
        sectionStore.setState({ error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      scrollEngine?.dispose();
      composer?.dispose();
      if (textures) disposeTextures(textures);
      renderer?.dispose();
      renderer?.domElement.remove();
      delete (window as unknown as Record<string, unknown>).__REPLICA__;
    };
  }, []);

  return <div ref={hostRef} className="canvas-host" aria-hidden="true" />;
}
