import * as THREE from 'three';
import { type AssetKey, resolveAsset } from '../config/assets';

/**
 * 素材加载。
 *
 * 真实站点的纹理管线（实测结论，见 03-深度还原.md §8）：
 *   KTX2 容器 + Basis Universal 超压缩 + ZSTD 熵编码 + BC7(BPTC) 块压缩
 *   → GPU 直接上传，零解码开销；不生成 mipmap，anisotropy = 1，flipY = false
 *
 * Demo 用 PNG 是为了「你能直接替换成自己的图」这个目标 —— 换成 KTX2 需要
 * 额外的构建步骤，会破坏"拖一张图进去就能用"的体验。
 * 但保留了实测到的三个关键设置：LinearFilter / 不生成 mipmap / ClampToEdge。
 */
export async function loadTextures(keys: AssetKey[]): Promise<Map<AssetKey, THREE.Texture>> {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const pairs = await Promise.all(
    keys.map(async (key) => {
      const texture = await loader.loadAsync(resolveAsset(key));

      // ★ 关键：整条链路走 sRGB 直通，不做线性化。
      //   因为这是个纯 2D 合成 Demo（图层都是 MeshBasicMaterial，没有光照），
      //   线性化只会让最终画面偏暗，还得在 shader 末尾补一次编码。
      //   直通 = 屏幕上的像素值 == 原图数值，所见即所得。
      texture.colorSpace = THREE.LinearSRGBColorSpace;

      // 对齐真实站点的采样器设置
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;

      return [key, texture] as const;
    }),
  );

  return new Map(pairs);
}

export function disposeTextures(map: Map<AssetKey, THREE.Texture>): void {
  map.forEach((t) => t.dispose());
  map.clear();
}
