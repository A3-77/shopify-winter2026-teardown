import * as THREE from 'three';
import type { AssetKey } from '../config/assets';
import type { LayerConfig, SceneConfig } from '../config/scenes';
import { evaluateTracks } from '../animation/timeline';

/**
 * 按 config 构建一个可渲染的场景。
 *
 * ★ 关于"视差是怎么来的" —— 这是整个 2.5D 效果的原理，值得说清楚：
 *
 *   真实站点实测（three devtools 钩子抓的运行时场景图）：
 *     asset-1  Group  position(-0.233, 0.141, -7.09)  scale(2,2,3)
 *     asset-2  Group  position(0, 0, -25.46)          scale 18.901
 *
 *   注意这两个平面的 z 差了 18 个单位。配一台 PerspectiveCamera 时，
 *   相机往前推 1 个单位，z=-7 的层在屏幕上放大的倍率远大于 z=-25 的层 ——
 *   视差不需要写任何代码，它是透视投影的几何后果，是硬件免费给的。
 *
 *   所以这里刻意"不在每帧重算平面尺寸"。平面的世界尺寸只在初始化时按
 *   「起始相机状态」定一次，之后相机怎么动都不改 —— 一旦每帧按当前距离重算，
 *   平面就会跟着相机一起缩放，视差会被完全抵消掉（这是最容易踩的坑）。
 */

export interface BuiltLayer {
  config: LayerConfig;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** 基准状态下该深度处「刚好铺满视口」的世界高度。轨道数值的 1.0 = 一个视口高 */
  baseVisibleH: number;
  /** 基准位置（config 里的 offset），轨道位移叠加在它之上 */
  baseX: number;
  baseY: number;
  /** 每帧复用的求值缓存，避免 60fps 下疯狂分配对象 */
  values: Record<string, number>;
}

export interface BuiltScene {
  config: SceneConfig;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  layers: BuiltLayer[];
  /** 按归一化时间轴 0..1 更新相机与所有图层 */
  applyTime(t: number): void;
  /** 视口比例变化时重算平面几何 */
  setAspect(aspect: number): void;
  dispose(): void;
}

function textureAspect(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (image?.width && image?.height) return image.width / image.height;
  return 1;
}

/**
 * 算一个图层平面的世界尺寸。
 *
 * ★ fit: 'contain' 是必须的，否则竖版人像会被横向拉成三角形。
 *   之前我漏了这一步，截图里中景直接变成一个大三角 —— 因为平面尺寸按
 *   视口比例（约 1.95）算，而贴图是 900×1200（0.75），拉伸了 2.6 倍。
 *
 *   逻辑等价于 CSS 的 object-fit：
 *     cover   → 直接铺满视口（可能裁切）
 *     contain → 按纹理宽高比完整放入（先试高度适配，宽度超了就改按宽度适配）
 *
 * visibleH 始终返回「视口在该深度处的高度」——
 * 它是轨道位移的单位（1.0 = 移动一个视口高），与平面自身尺寸无关。
 */
function computePlaneSize(
  config: SceneConfig,
  layer: LayerConfig,
  texture: THREE.Texture,
  aspect: number,
): { width: number; height: number; visibleH: number } {
  const baseDist = Math.abs(config.camera.z - layer.z);
  const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(config.camera.fov) / 2) * baseDist;
  const viewW = visibleH * aspect;

  let width: number;
  let height: number;

  if ((layer.fit ?? 'cover') === 'contain') {
    const texAspect = textureAspect(texture);
    height = visibleH;
    width = height * texAspect;
    if (width > viewW) {
      width = viewW;
      height = width / texAspect;
    }
  } else {
    height = visibleH;
    width = viewW;
  }

  return {
    width: width * layer.overscan,
    height: height * layer.overscan,
    visibleH,
  };
}

export function buildScene(
  config: SceneConfig,
  textures: Map<AssetKey, THREE.Texture>,
  aspect: number,
): BuiltScene {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(config.camera.fov, aspect, 0.1, 1000);
  camera.position.set(0, 0, config.camera.z);
  scene.add(camera);

  const camValues: Record<string, number> = {};

  const layers: BuiltLayer[] = config.layers.map((layerConfig, i) => {
    const map = textures.get(layerConfig.asset);
    if (!map) {
      throw new Error(
        `[SceneBuilder] 素材缺失: ${layerConfig.asset}（场景 ${config.id} / 图层 ${layerConfig.id}）。` +
          `请确认 public/assets/ 下有对应文件，或检查 src/config/assets.ts 的声明。`,
      );
    }

    // ★ 基准尺寸：用「起始相机状态」算一次，之后相机怎么动都不再重算 ——
    //    一旦每帧按当前距离重算，平面就会跟着相机一起缩放，视差会被完全抵消
    const size = computePlaneSize(config, layerConfig, map, aspect);
    const baseVisibleH = size.visibleH;

    // 尺寸烘进 geometry，把 mesh.scale 完整留给轨道使用
    const geometry = new THREE.PlaneGeometry(size.width, size.height);

    const material = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      // 纯 2D 分层合成：关掉深度测试，靠 renderOrder 决定前后覆盖
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      // 关掉色调映射 —— 这是一层"图像合成"，不是 PBR 光照，映射会改变原图颜色
      toneMapped: false,
    });

    if (layerConfig.tint) material.color.set(layerConfig.tint);
    if (layerConfig.blending === 'additive') material.blending = THREE.AdditiveBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = i;
    // 顶点着色器/矩阵都在掌控内，关掉剔除避免误判
    mesh.frustumCulled = false;

    const baseX = layerConfig.offset[0] * baseVisibleH * aspect;
    const baseY = layerConfig.offset[1] * baseVisibleH;
    mesh.position.set(baseX, baseY, layerConfig.z);

    scene.add(mesh);

    return { config: layerConfig, mesh, baseVisibleH, baseX, baseY, values: {} };
  });

  function applyTime(t: number): void {
    // ---- 相机 ----
    evaluateTracks(config.camera.tracks, t, camValues);
    camera.position.set(
      camValues['position.x'] ?? 0,
      camValues['position.y'] ?? 0,
      camValues['position.z'] ?? config.camera.z,
    );
    camera.rotation.z = camValues['rotation.z'] ?? 0;
    const fov = camValues['fov'] ?? config.camera.fov;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // ---- 图层 ----
    for (const layer of layers) {
      const v = layer.values;
      evaluateTracks(layer.config.tracks, t, v);

      layer.mesh.position.set(
        layer.baseX + (v['position.x'] ?? 0) * layer.baseVisibleH * aspect,
        layer.baseY + (v['position.y'] ?? 0) * layer.baseVisibleH,
        layer.config.z + (v['position.z'] ?? 0),
      );

      layer.mesh.scale.set(v['scale.x'] ?? 1, v['scale.y'] ?? 1, 1);
      layer.mesh.rotation.z = v['rotation.z'] ?? 0;

      if ('opacity' in v) layer.mesh.material.opacity = v['opacity'];
    }
  }

  function setAspect(next: number): void {
    camera.aspect = next;
    camera.updateProjectionMatrix();

    for (const layer of layers) {
      const map = layer.mesh.material.map;
      if (!map) continue;

      const size = computePlaneSize(config, layer.config, map, next);

      // 重建几何：PlaneGeometry 的宽高是烘在顶点里的，改 aspect 必须重建
      layer.mesh.geometry.dispose();
      layer.mesh.geometry = new THREE.PlaneGeometry(size.width, size.height);

      layer.baseVisibleH = size.visibleH;
      layer.baseX = layer.config.offset[0] * size.visibleH * next;
      layer.baseY = layer.config.offset[1] * size.visibleH;
    }
  }

  function dispose(): void {
    for (const layer of layers) {
      layer.mesh.geometry.dispose();
      layer.mesh.material.dispose();
    }
    scene.clear();
  }

  // 先跑一次，保证首帧就是正确状态（否则会闪一帧未初始化的画面）
  applyTime(0);

  return { config, scene, camera, layers, applyTime, setAspect, dispose };
}
