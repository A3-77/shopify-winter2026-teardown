import * as THREE from 'three';
import type { AssetKey } from '../config/assets';
import { SCENES } from '../config/scenes';
import { sectionStore } from '../store/sectionStore';
import { sceneTime, transitionProgress } from '../animation/scrollProgress';
import { buildScene, type BuiltScene } from './SceneBuilder';
import type { ModelAsset } from './loaders';
import { createFullscreenQuad, type FullscreenQuad } from './fullscreenQuad';
import { FULLSCREEN_VERTEX } from '../shaders/fullscreen';
import { TRANSITION_FRAGMENT } from '../shaders/transition';
import {
  BLOOM_BRIGHT_FRAGMENT,
  BLOOM_BLUR_FRAGMENT,
  BLOOM_COMPOSITE_FRAGMENT,
} from '../shaders/bloom';

/**
 * ★ 渲染管线 —— 整站视觉的骨架
 * ---------------------------------------------------------------------------
 * 每帧做这几件事（顺序不能变）：
 *
 *   ① 求值两个场景      current 场景按 current.progress 求值，
 *                        next 场景按 next.progress 求值（这是"两张图同时在动"的前提）
 *   ② 场景 → 离屏纹理    current 渲到 rtCurrent，next 渲到 rtNext
 *   ③ 双纹理 → 过渡      transition shader 读 rtCurrent + rtNext，
 *                       用阈值场决定每个像素显示谁，输出到 rtComposite
 *   ④ 高光提取 + 模糊    rtComposite → 亮度阈值 → 半分辨率高斯（横竖各一次）
 *   ⑤ 合成 → 屏幕        原图 + bloom * strength
 *
 * 为什么要绕这么多离屏纹理，而不是"直接渲染两个场景到屏幕再混合"？
 *   因为 WebGL 没有"读回当前 framebuffer 再混合"的廉价手段。
 *   过渡效果需要同时访问两张完整画面（还要对它们做 fwidth 导数运算），
 *   唯一可行且高性能的方式就是各自先渲到纹理。真实站点用的
 *   pmndrs/postprocessing 的 EffectComposer 走的是同一条路
 *   （实测它的 Buffer 是 1279×812，Bloom 内部降到 640×406）。
 */
export interface ComposerStats {
  currentIndex: number;
  nextIndex: number;
  progress: number;
  nextProgress: number;
  /** 上一帧的 draw call 数（renderer.info.render.calls） */
  drawCalls: number;
  triangles: number;
  bloom: boolean;
  drawSize: string;
}

export interface ComposerOptions {
  gl: THREE.WebGLRenderer;
  textures: Map<AssetKey, THREE.Texture>;
  /** GLB 模型表。用占位素材时为空 Map */
  models: Map<AssetKey, ModelAsset>;
  /** 是否启用 bloom（默认 true）。关掉可以看清过渡 shader 的原始输出 */
  bloom?: boolean;
  /** 高光阈值 0..1 */
  bloomThreshold?: number;
  /** bloom 叠加强度 */
  bloomStrength?: number;
}

export class Composer {
  private gl: THREE.WebGLRenderer;
  private scenes: BuiltScene[];
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  private rtCurrent!: THREE.WebGLRenderTarget;
  private rtNext!: THREE.WebGLRenderTarget;
  private rtComposite!: THREE.WebGLRenderTarget;
  private rtBright!: THREE.WebGLRenderTarget;
  private rtBlurA!: THREE.WebGLRenderTarget;
  private rtBlurB!: THREE.WebGLRenderTarget;

  private transitionQuad: FullscreenQuad;
  private brightQuad: FullscreenQuad;
  private blurQuad: FullscreenQuad;
  private compositeQuad: FullscreenQuad;
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private projView = new THREE.Matrix4();
  private enableBloom: boolean;

  readonly stats: ComposerStats = {
    currentIndex: 0,
    nextIndex: -1,
    progress: 0,
    nextProgress: 0,
    drawCalls: 0,
    triangles: 0,
    bloom: true,
    drawSize: '0×0',
  };

  constructor(options: ComposerOptions) {
    const { gl, textures, models } = options;
    this.gl = gl;
    this.enableBloom = options.bloom ?? true;
    this.stats.bloom = this.enableBloom;

    // 建场景。注意每个 section 一个独立 THREE.Scene + 独立 PerspectiveCamera
    // （真实站点也是这样：每个章节有自己的 camera 关键帧轨道，互不干扰）
    this.scenes = SCENES.map((cfg) => buildScene(cfg, textures, models, 1));

    // ---- 过渡 quad ----
    const transitionMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: TRANSITION_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tCurrent: { value: null },
        tNext: { value: null },
        tMudNormal: { value: textures.get('mudNormal') ?? null },
        tNoise: { value: textures.get('noise') ?? null },
        uProgress: { value: 0 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uIsHero: { value: 1 },
        uIsFallback: { value: 0 },
        uProjectionView: { value: new THREE.Matrix4() },
        uFadeCenterPoint: { value: new THREE.Vector3() },
        uDarken: { value: 0 },
      },
    });
    this.transitionQuad = createFullscreenQuad(transitionMaterial, this.quadCamera);

    // ---- bloom quads ----
    this.brightQuad = createFullscreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: BLOOM_BRIGHT_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tDiffuse: { value: null },
          uThreshold: { value: options.bloomThreshold ?? 0.62 },
          uSoftKnee: { value: 0.55 },
        },
      }),
      this.quadCamera,
    );

    this.blurQuad = createFullscreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: BLOOM_BLUR_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          tDiffuse: { value: null },
          uDirection: { value: new THREE.Vector2() },
        },
      }),
      this.quadCamera,
    );

    this.compositeQuad = createFullscreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERTEX,
        fragmentShader: BLOOM_COMPOSITE_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        uStrength: { value: options.bloomStrength ?? 0.85 },
      },
    }),
      this.quadCamera,
    );

    // 关掉 three 的自动重置：默认每次 gl.render() 都会清空 info，
    // 那样 stats 只能读到最后一个 pass（也就是 1 个 draw call）。
    // 手动在每帧开头 reset，才能统计到整帧全部 pass 的累计值。
    gl.info.autoReset = false;
  }

  /* ------------------------------------------------------------ 尺寸 */

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = pixelRatio;

    const w = Math.floor(this.width * pixelRatio);
    const h = Math.floor(this.height * pixelRatio);

    const disposeRT = (rt?: THREE.WebGLRenderTarget) => rt?.dispose();

    disposeRT(this.rtCurrent);
    disposeRT(this.rtNext);
    disposeRT(this.rtComposite);
    disposeRT(this.rtBright);
    disposeRT(this.rtBlurA);
    disposeRT(this.rtBlurB);

    // HalfFloat：给 bloom 留出 >1 的余量，高光叠加不会被 clamp 成死白
    const rtOptions: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };

    this.rtCurrent = new THREE.WebGLRenderTarget(w, h, rtOptions);
    this.rtNext = new THREE.WebGLRenderTarget(w, h, rtOptions);
    this.rtComposite = new THREE.WebGLRenderTarget(w, h, rtOptions);

    // bloom 走半分辨率：真实站点实测 Bloom 内部降到 640×406（约 1/2）后开始上采样
    const bw = Math.max(1, Math.floor(w / 2));
    const bh = Math.max(1, Math.floor(h / 2));
    this.rtBright = new THREE.WebGLRenderTarget(bw, bh, { ...rtOptions, depthBuffer: false });
    this.rtBlurA = new THREE.WebGLRenderTarget(bw, bh, { ...rtOptions, depthBuffer: false });
    this.rtBlurB = new THREE.WebGLRenderTarget(bw, bh, { ...rtOptions, depthBuffer: false });

    const aspect = this.width / this.height;
    for (const s of this.scenes) s.setAspect(aspect);

    (this.transitionQuad.mesh.material.uniforms.uResolution.value as THREE.Vector2).set(w, h);
    (this.transitionQuad.mesh.material.uniforms.uAspect.value as number) = aspect;

    this.stats.drawSize = `${w}×${h}`;
  }

  /* ------------------------------------------------------------ 每帧 */

  render(timeSec: number): void {
    const gl = this.gl;
    gl.info.reset(); // 手动重置，配合构造函数里的 info.autoReset = false
    const state = sectionStore.getState();
    const { current, next, heights, viewportH, mouse } = state;

    const currentScene = this.scenes[current.index] ?? this.scenes[0];

    // ① 求值 current 场景
    currentScene.applyTime(sceneTime(current.index, current.progress, heights, viewportH));

    // ② current → rtCurrent
    gl.setRenderTarget(this.rtCurrent);
    gl.clear();
    gl.render(currentScene.scene, currentScene.camera);

    // ③ next → rtNext（没有 next 时复用 rtCurrent 的纹理，
    //    这样即使过渡 shader 因噪声扰动渗出一点 blendFactor，混合的也是同一张图，不会出现残影）
    let nextTexture: THREE.Texture = this.rtCurrent.texture;
    let nextProgress = 0;

    if (next) {
      const nextScene = this.scenes[next.index];
      if (nextScene) {
        nextProgress = sceneTime(next.index, next.progress, heights, viewportH);
        nextScene.applyTime(nextProgress);

        gl.setRenderTarget(this.rtNext);
        gl.clear();
        gl.render(nextScene.scene, nextScene.camera);

        nextTexture = this.rtNext.texture;
      }
    }

    // ④ 双纹理 → 过渡
    //    uProgress 用「本章尾段」重新归一化后的值，而不是 raw progress ——
    //    否则章节切换的瞬间画面会跳变（原因见 scrollProgress.ts 里 transitionProgress 的注释）
    const uProgress = transitionProgress(
      current.progress,
      heights[current.index] ?? 0,
      viewportH,
    );

    const u = this.transitionQuad.mesh.material.uniforms;
    u.tCurrent.value = this.rtCurrent.texture;
    u.tNext.value = nextTexture;
    u.uProgress.value = uProgress;
    u.uTime.value = timeSec;
    u.uMouse.value.set(mouse[0], 1 - mouse[1]);
    u.uIsHero.value = currentScene.config.isHero ? 1 : 0;
    u.uIsFallback.value = 0; // Demo 不走 DOM fallback 分支
    u.uDarken.value = 0;
    (u.uFadeCenterPoint.value as THREE.Vector3).fromArray(currentScene.config.fadeCenter);

    // uProjectionView：把世界坐标的"溶解中心"投影到屏幕空间
    currentScene.camera.updateMatrixWorld();
    this.projView.multiplyMatrices(
      currentScene.camera.projectionMatrix,
      currentScene.camera.matrixWorldInverse,
    );
    (u.uProjectionView.value as THREE.Matrix4).copy(this.projView);

    if (!this.enableBloom) {
      // 省掉两次全屏 blit，直接把过渡结果打到屏幕
      gl.setRenderTarget(null);
      gl.clear();
      gl.render(this.transitionQuad.scene, this.quadCamera);
    } else {
      gl.setRenderTarget(this.rtComposite);
      gl.clear();
      gl.render(this.transitionQuad.scene, this.quadCamera);

      // ⑤ 亮度提取
      const brightU = this.brightQuad.mesh.material.uniforms;
      brightU.tDiffuse.value = this.rtComposite.texture;
      gl.setRenderTarget(this.rtBright);
      gl.clear();
      gl.render(this.brightQuad.scene, this.quadCamera);

      // ⑥ 可分离高斯：横 → 竖
      const blurU = this.blurQuad.mesh.material.uniforms;
      const bw = this.rtBright.width;
      const bh = this.rtBright.height;

      blurU.tDiffuse.value = this.rtBright.texture;
      (blurU.uDirection.value as THREE.Vector2).set(1 / bw, 0);
      gl.setRenderTarget(this.rtBlurA);
      gl.clear();
      gl.render(this.blurQuad.scene, this.quadCamera);

      blurU.tDiffuse.value = this.rtBlurA.texture;
      (blurU.uDirection.value as THREE.Vector2).set(0, 1 / bh);
      gl.setRenderTarget(this.rtBlurB);
      gl.clear();
      gl.render(this.blurQuad.scene, this.quadCamera);

      // ⑦ 合成 → 屏幕
      const compU = this.compositeQuad.mesh.material.uniforms;
      compU.tDiffuse.value = this.rtComposite.texture;
      compU.tBloom.value = this.rtBlurB.texture;
      gl.setRenderTarget(null);
      gl.clear();
      gl.render(this.compositeQuad.scene, this.quadCamera);
    }

    // ---- stats ----
    this.stats.currentIndex = current.index;
    this.stats.nextIndex = next ? next.index : -1;
    this.stats.progress = uProgress;
    this.stats.nextProgress = nextProgress;
    this.stats.drawCalls = gl.info.render.calls;
    this.stats.triangles = gl.info.render.triangles;
  }

  /* ------------------------------------------------------------ 清理 */

  dispose(): void {
    this.rtCurrent?.dispose();
    this.rtNext?.dispose();
    this.rtComposite?.dispose();
    this.rtBright?.dispose();
    this.rtBlurA?.dispose();
    this.rtBlurB?.dispose();
    this.transitionQuad.dispose();
    this.brightQuad.dispose();
    this.blurQuad.dispose();
    this.compositeQuad.dispose();
    this.scenes.forEach((s) => s.dispose());
  }
}
