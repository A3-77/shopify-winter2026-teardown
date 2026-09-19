/**
 * ★ 过渡 Shader —— 网站视觉的核心，从真实站点逐行还原
 * ---------------------------------------------------------------------------
 * 来源：真实站点的 postprocessing `EffectPass`（我提取了完整 118 行源码，
 *      落在 evidence/SHADER_transition.glsl）。
 *
 * 唯一的改动是把入口从 postprocessing 的
 *     void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor)
 * 换成标准的
 *     void main() { ... gl_FragColor = outputColor; }
 * 以及把 `texture()` 换成 GLSL1 的 `texture2D()`（three 的 ShaderMaterial 默认 GLSL1）。
 * 中间每一个数学步骤、每一个常量都是原值。
 *
 * ---------------------------------------------------------------------------
 * 它到底在做什么（这是"为什么能达到这个效果"的答案）：
 *
 *   1. 【双纹理】同时持有「当前章节」和「下一章节」两张离屏渲染结果。
 *      这就是为什么它能做出"两个场景互相咬合"的溶解，而不是简单的透明度渐变。
 *
 *   2. 【阈值场 threshold】这是整个效果的灵魂。
 *      它不是用 alpha 做过渡，而是在屏幕上铺一张「空间变化的阈值图」，
 *      然后比较 `progress - threshold` 的正负来决定每个像素显示 current 还是 next。
 *      ▸ 阈值图本身由三部分叠加而成：
 *           dist      —— 到"溶解中心"的圆形距离（hero 模式：圆形扩散）
 *                       或 uv.y / uv.x（普通模式：斜向擦除）
 *           noise     —— 预烘焙噪声图 + 时间滚动 → 边界永远在抖，不会像机械蒙版
 *           mudNormal —— 法线图 R 通道 × 正弦调制 → 让边界有"泥浆流动"的有机感
 *       ▸ 这就是为什么它的过渡边界是"活"的，而普通 mask 过渡是死的。
 *
 *   3. 【fwidth 线稿】硬件导数 fwidth() 求亮度梯度 → 得到边缘强度。
 *      把 current/next 分别和它的边缘图混合，过渡时会浮现一层"铅笔线稿"。
 *      强度随 progress 从 5.0 涨到 10.0 —— 越接近切完，线稿越强。
 *      这一步是免费拿到高质量边缘的经典技巧：fwidth 是 GPU 硬件导数，
 *      不需要任何后处理卷积，一个指令就够。
 *
 *   4. 【抗锯齿】`aa = fwidth(edge) * 10.0` 再 smoothstep —— 用同一个导数
 *      算出屏幕空间的边缘宽度，让溶解边界永远不会出现锯齿或硬切。
 *
 *   5. 【边界发光】`glowFactor = smoothstep(0.0, glowThreshold, abs(edge))`，
 *      越靠近边界（edge≈0）越亮。hero 模式发光强度高达 40 倍，
 *      配合 Bloom 后处理形成过渡瞬间的强光爆开。
 *
 *   6. 【hero 专属处理】
 *      ▸ progress 先过一遍 smoothstep(0, 1.5, p) —— 前段被压平，起步更"沉"
 *      ▸ 圆形扩散以 3D 场景原点为中心（uProjectionView 投影到屏幕空间）
 *      ▸ 加入 10% 鼠标影响 → 溶解中心会跟着鼠标微微偏移
 *      ▸ current/next 各自做 ±10% 的缩放（推进/拉出），制造纵深
 */

export const TRANSITION_FRAGMENT = /* glsl */ `
uniform sampler2D tCurrent;
uniform sampler2D tNext;
uniform sampler2D tMudNormal;
uniform sampler2D tNoise;
uniform float uProgress;
uniform float uAspect;
uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;
uniform float uIsHero;
uniform float uIsFallback;
uniform mat4  uProjectionView;
uniform vec3  uFadeCenterPoint;
uniform float uDarken;

varying vec2 vUv;

// Sample pre-computed noise texture (normalized to [-1, 1])
float sampleNoise(vec2 uv) {
  return texture2D(tNoise, uv).r * 2.0 - 1.0;
}

float easeInOutCubic(float t) {
  return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
}

void main() {
  vec2 uv = vUv;

  bool isHero = uIsHero > 0.5;
  bool isFallback = uIsFallback > 0.5;

  // Progress smoothing differs between modes
  float progress = isHero ? smoothstep(0.0, 1.5, uProgress) : uProgress;

  // Project 3D fade center point to screen space (fallback uses fixed center)
  vec2 sceneCenter;
  if (isFallback) {
    sceneCenter = vec2(0.5, 0.65);
  } else {
    vec4 clipPos = uProjectionView * vec4(uFadeCenterPoint, 1.0);
    sceneCenter = (clipPos.xy / clipPos.w) * 0.5 + 0.5;
  }

  // UV transformation (fancy mode has zoom effect centered on 3D scene origin)
  vec2 currentUV = uv;
  vec2 nextUV = uv;
  if (isHero) {
    currentUV = (uv - sceneCenter) * (1.0 - smoothstep(0.2, 1.0, uProgress) * 0.1) + sceneCenter;
    nextUV    = (uv - sceneCenter) * (1.0 + smoothstep(0.8, 0.0, uProgress) * 0.1) + sceneCenter;
  } else {
    if (isFallback) {
      currentUV.y -= easeInOutCubic(uProgress) * 0.1;
      nextUV.y    += easeInOutCubic(1.0 - uProgress) * 0.1;
    }
  }

  vec4 current = texture2D(tCurrent, currentUV);
  vec4 next    = texture2D(tNext,    nextUV);

  // Edge detection using hardware derivatives (fwidth) - only compute during transitions
  vec3 currentEdges = vec3(0.0);
  vec3 nextEdges    = vec3(0.0);
  if ((uProgress > 0.01 && uProgress < 0.99) || uDarken > 0.001) {
    float currentLuma = dot(current.rgb, vec3(0.299, 0.587, 0.114));
    currentEdges = vec3(fwidth(currentLuma) * mix(5.0, 10.0, progress));

    float nextLuma = dot(next.rgb, vec3(0.299, 0.587, 0.114));
    nextEdges = vec3(fwidth(nextLuma) * mix(5.0, 10.0, 1.0 - progress));
  }

  // Mud normal offset
  vec3 mudNormal = texture2D(tMudNormal, uv * 2.0).rgb;
  float mudStrength = isHero ? mix(0.2, 0.4, 0.5 + 0.5 * sin(uTime - uv.x * 10.0))
                             : mix(0.3, 0.6, 0.5 + 0.5 * sin(uTime - uv.x * 10.0));
  float mudOffset = (mudNormal.r - 0.5) * mudStrength;

  // Noise (sampled from pre-computed texture)
  vec2 aspectUv = vec2(uv.x * uAspect, uv.y) + vec2(0.0, uTime * 0.02);
  float noiseSpeed = isHero ? 0.07 : 0.05;
  float currentNoise = sampleNoise(aspectUv * 0.25 - uTime * noiseSpeed * 0.125);

  // Mask center (hero uses 3D scene center with mouse influence)
  vec2 maskCenter = isHero ? mix(sceneCenter, uMouse, 0.1) : vec2(0.5);

  // Threshold calculation
  float threshold;
  if (isHero) {
    // Aspect-correct the distance for circular (not oval) reveal
    float dist = length((uv - maskCenter) * vec2(uAspect, 1.0)) * 0.8;
    threshold = mix(dist, uv.x,
                    smoothstep(0.6, -0.4, abs(uv.x - sceneCenter.x)) *
                    mix(0.0, 0.4, smoothstep(0.05, 0.5, progress)));
    threshold = mix(threshold, 0.0, smoothstep(0.9, 1.0, uProgress));
  } else {
    float ease = mix(progress * progress * (3.0 - 2.0 * progress), progress, 0.25);
    threshold = mix(uv.y, uv.x, smoothstep(0.6, -0.4, abs(uv.x - 0.5)) * 0.5);
    progress = ease; // Use eased progress for simple mode
  }
  threshold = threshold * 2.0 - 1.0;
  threshold = threshold / 1.2 + currentNoise * 0.2 + mudOffset;
  threshold = threshold * 0.5 + 0.5;

  float edge = progress - threshold;
  float aa = fwidth(edge) * 10.0;
  float blendFactor = smoothstep(-aa, aa, edge);

  // Edge mixing
  current = mix(current, vec4(currentEdges, 1.0), smoothstep(0.0, 0.5, progress));
  next    = mix(next,    vec4(nextEdges,    1.0), smoothstep(0.2, 0.8, 1.0 - progress));

  if (uDarken > 0.001) {
    current = mix(current, vec4(0.02 * uDarken + currentEdges * 0.1, 1.0), uDarken);
  }

  vec4 outputColor = mix(current, next, blendFactor);

  // Glow effect
  float glowStrength = isHero ? mix(40.0, 8.0, smoothstep(0.05, 0.25, progress))
                              : mix(2.0, 10.0, 0.5);
  float glowThreshold = isHero ? glowStrength * 0.001 : 0.003;
  float glowFactor = smoothstep(0.0, glowThreshold, abs(edge));
  float glowMult = isHero
    ? mix(glowStrength * 0.5, glowStrength, 0.5 + 0.5 * currentNoise * sin(uTime + uv.x * 10.0))
    : mix(2.0, 10.0, 0.5 + 0.5 * currentNoise * sin(uTime + uv.x * 10.0));
  outputColor = mix(outputColor, outputColor * glowMult, 1.0 - glowFactor);

  gl_FragColor = outputColor;
}
`;
