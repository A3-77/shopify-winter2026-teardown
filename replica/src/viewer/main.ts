/**
 * 原站素材浏览器
 * ===========================================================================
 * 为什么需要这个页面
 * ---------------------------------------------------------------------------
 * 逆向报告里我列了「37 个 GLB、873,416 顶点、19/37 用 KHR_materials_unlit、
 * 7 个背景模型只有 4 顶点」这些结论。但如果素材只是躺在文件夹里，
 * 你既没法验证这些数字，也没法判断哪个模型对应哪一章、能不能拿来用。
 *
 * 所以这个页面做三件事：
 *   1. 把 assets-original/ 里的素材列出来（含每个 GLB 的顶点/三角面/骨骼数）
 *   2. 用 three.js 现场加载，让你亲眼看到模型长什么样
 *   3. 带动画的模型可以直接播放、拖时间轴 —— 原站 25/37 个模型带动画，
 *      这些动画就是页面滚动的"素材层"，看一遍就明白滚动驱动的到底是什么
 *
 * 加载链路刻意与原站一致（Draco 解几何 + KTX2 解贴图），
 * 解码器用的是 three 包自带的 wasm，全程离线，不碰任何 CDN。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import './viewer.css';

/* ------------------------------------------------------------- 常量 */

const BASE = import.meta.env.BASE_URL || './';
const ROOT = `${BASE.replace(/\/$/, '')}/original/`;

const CATEGORIES = [
  { key: 'models', label: '模型', ext: ['.glb'] },
  { key: 'textures', label: '贴图', ext: ['.ktx2'] },
  { key: 'images', label: '图片', ext: ['.png', '.webp', '.jpg', '.jpeg', '.svg'] },
  { key: 'video', label: '视频', ext: ['.mp4', '.webm'] },
  { key: 'data', label: '数据', ext: ['.json'] },
  { key: 'fonts', label: '字体', ext: ['.woff2'] },
];

/* ------------------------------------------------------------- 类型 */

interface AssetFile {
  url: string;
  path: string;
  src_name?: string;
  bytes: number;
  sha256: string;
  status: string;
  meta?: {
    vertices?: number;
    triangles?: number;
    nodes?: number;
    meshes?: number;
    materials?: number;
    textures?: number;
    skins?: number;
    bones?: number;
    animations?: number;
    draco?: boolean;
    extensions_used?: string[];
    generator?: string;
  };
}

interface Manifest {
  generated: string;
  source: string;
  count: number;
  ok: number;
  total_bytes: number;
  files: AssetFile[];
}

/* ------------------------------------------------------------- 工具 */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少 DOM 节点 #${id}`);
  return el as T;
};

function human(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

const num = (n?: number): string => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

/** 本地文件名带 -<sha1:8> 后缀，展示时去掉，露出 CDN 上的真名 */
function displayName(f: AssetFile): string {
  return f.src_name ?? f.path.split('/').pop() ?? f.path;
}

function categoryOf(f: AssetFile): string {
  const lower = f.path.toLowerCase();
  for (const c of CATEGORIES) {
    if (c.ext.some((e) => lower.endsWith(e))) return c.key;
  }
  return 'misc';
}

/**
 * 拼素材 URL。
 * 防御性把反斜杠换成正斜杠 —— manifest 现在写的是 POSIX 路径，
 * 但早期版本在 Windows 上生成过 "models\\x.glb"，浏览器虽然能容忍，
 * 下游工具不一定。多这一行不亏。
 */
function assetUrl(f: AssetFile): string {
  return ROOT + f.path.replace(/\\/g, '/');
}

/* ------------------------------------------------------------- 渲染器 */

const canvas = $<HTMLCanvasElement>('gl');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// 原站材质大量使用 KHR_materials_unlit（无光照），
// 这里同样关掉色调映射，避免颜色与原站不一致。
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xeeeeeb, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
camera.position.set(0, 0, 5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

// 18/37 个模型用 PBR 材质，需要光照；unlit 的模型不受影响。
scene.add(new THREE.AmbientLight(0xffffff, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.8);
rim.position.set(-4, -2, -3);
scene.add(rim);

/* --------------------------------------------------- 解码器（离线） */

const draco = new DRACOLoader().setDecoderPath(`${BASE}decoders/draco/`);
const ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}decoders/basis/`).detectSupport(renderer);
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
const texLoader = new THREE.TextureLoader();

/* ------------------------------------------------------------- 状态 */

let current: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let currentAction: THREE.AnimationAction | null = null;
let clips: THREE.AnimationClip[] = [];
let playing = true;
const clock = new THREE.Clock();

const emptyEl = $('empty');
const loadingEl = $('loading');
const loadingText = $('loading-text');
const errorEl = $('error');
const hudEl = $('hud');
const animEl = $('anim');
const playBtn = $<HTMLButtonElement>('playBtn');
const seek = $<HTMLInputElement>('seek');
const animTime = $<HTMLSpanElement>('animTime');
const clipSel = $<HTMLSelectElement>('clipSel');

function showError(msg: string) {
  errorEl.hidden = false;
  errorEl.textContent = msg;
  console.error(msg);
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function setLoading(on: boolean, text = '加载中…') {
  loadingEl.hidden = !on;
  loadingText.textContent = text;
}

function resetStage() {
  if (current) {
    scene.remove(current);
    current.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    current = null;
  }
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
  }
  currentAction = null;
  clips = [];
  animEl.hidden = true;
}

/** 把相机框到物体的包围盒上（保证任何尺寸的模型一进来就是合适的构图） */
function frameObject(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const fitDist = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

  camera.near = maxDim / 500;
  camera.far = maxDim * 500;
  camera.position.copy(center).add(new THREE.Vector3(0.35, 0.28, 1).normalize().multiplyScalar(fitDist * 1.5));
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = maxDim * 0.02;
  controls.maxDistance = fitDist * 12;
  controls.update();
}

/* --------------------------------------------------------- 加载 GLB */

async function loadModel(f: AssetFile) {
  setLoading(true, '解码几何 + 贴图…');
  const url = assetUrl(f);
  const t0 = performance.now();

  try {
    const gltf = await gltfLoader.loadAsync(url);
    const ms = Math.round(performance.now() - t0);

    resetStage();
    current = gltf.scene;
    scene.add(gltf.scene);

    // 蒙皮模型如果不关剔除，动画时会被误裁掉
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) m.frustumCulled = false;
    });

    frameObject(gltf.scene);

    // ---- 动画 ----
    clips = gltf.animations ?? [];
    if (clips.length) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      clipSel.innerHTML = '';
      clips.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `${c.name || `clip ${i}`} · ${c.duration.toFixed(2)}s`;
        clipSel.appendChild(opt);
      });
      playClip(0);
      animEl.hidden = false;
    }

    // ---- HUD ----
    const m = f.meta;
    const rows: string[] = [];
    rows.push(`<b>${displayName(f)}</b>`);
    rows.push(`${f.path}  ·  ${human(f.bytes)}`);
    rows.push(`解码耗时 <span class="ok">${ms} ms</span>`);
    rows.push('');
    if (m) {
      rows.push(`顶点 <b>${num(m.vertices)}</b>   三角面 <b>${num(m.triangles)}</b>`);
      rows.push(`节点 ${num(m.nodes)}   网格 ${num(m.meshes)}   材质 ${num(m.materials)}`);
      rows.push(`贴图 ${num(m.textures)}   蒙皮 ${num(m.skins)}   骨骼 ${num(m.bones)}`);
      if (m.extensions_used?.length) {
        rows.push('');
        rows.push(`<span class="warn">${m.extensions_used.join('\n')}</span>`);
      }
      if (!m.vertices || m.vertices <= 4) {
        rows.push('');
        rows.push('<span class="warn">只有 4 个顶点 —— 这不是模型，是一块 quad，</span>');
        rows.push('<span class="warn">贴图直接烘在 GLB 里（见 04 报告第 2 节）。</span>');
      }
    } else {
      rows.push('<span class="warn">（无预存元数据，以下为运行时实测）</span>');
    }
    hudEl.innerHTML = rows.join('\n');
    hudEl.style.display = 'block';
  } catch (e) {
    showError(`加载 ${displayName(f)} 失败：\n${(e as Error).message}\n\n${url}`);
  } finally {
    setLoading(false);
  }
}

function playClip(index: number) {
  if (!mixer || !clips[index]) return;
  const next = mixer.clipAction(clips[index]);
  if (currentAction && currentAction !== next) currentAction.stop();
  currentAction = next;
  next.reset().play();
  playing = true;
  playBtn.textContent = '❚❚';
}

/* ------------------------------------------------- 加载贴图 / 图片 / 视频 */

function loadFlatTexture(f: AssetFile) {
  setLoading(true, '解码 KTX2…');
  clearError();
  const url = assetUrl(f);
  const t0 = performance.now();

  const isKtx2 = f.path.toLowerCase().endsWith('.ktx2');
  const lower = f.path.toLowerCase();
  // KTX2 里既有颜色贴图也有法线/遮罩。颜色贴图要按 sRGB 解释，
  // 数据贴图必须保持线性，否则显示出来会发灰。
  const isData = /normal|_nrm|mask|rough|metal|mud/.test(lower);

  const onLoaded = (tex: THREE.Texture) => {
    tex.colorSpace = isData ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    resetStage();
    const img = tex.image as { width?: number; height?: number } | undefined;
    const aspect = img?.width && img?.height ? img.width / img.height : 1;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * aspect, 2),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }),
    );
    current = mesh;
    scene.add(mesh);

    // 贴图是平面，直接用正交式构图：把相机摆在正前方
    controls.target.set(0, 0, 0);
    camera.position.set(0, 0, 3);
    camera.near = 0.01;
    camera.far = 100;
    camera.updateProjectionMatrix();
    controls.update();

    const ms = Math.round(performance.now() - t0);
    const rows = [
      `<b>${displayName(f)}</b>`,
      `${f.path}  ·  ${human(f.bytes)}`,
      `解码耗时 <span class="ok">${ms} ms</span>`,
      '',
      `尺寸 ${img?.width ?? '?'} × ${img?.height ?? '?'}`,
      `色彩空间 ${isData ? 'NoColorSpace（数据贴图）' : 'sRGB（颜色贴图）'}`,
    ];
    if (isKtx2) {
      const comp = (tex as THREE.CompressedTexture).format;
      rows.push('');
      rows.push('<span class="warn">KTX2 / Basis Universal，GPU 侧直接解压，</span>');
      rows.push('<span class="warn">不经 CPU 展开 —— 这是原站纹理管线的关键。</span>');
      if (typeof comp === 'number') rows.push(`压缩格式常量 ${comp}`);
    }
    hudEl.innerHTML = rows.join('\n');
    hudEl.style.display = 'block';
    setLoading(false);
  };

  if (isKtx2) {
    ktx2.load(url, onLoaded, undefined, (e) =>
      (showError(`KTX2 解码失败：${(e as Error).message}`), setLoading(false)));
  } else {
    texLoader.load(url, onLoaded, undefined, (e) =>
      (showError(`贴图加载失败：${(e as Error).message}`), setLoading(false)));
  }
}

function loadVideo(f: AssetFile) {
  clearError();
  resetStage();
  setLoading(true, '加载视频…');
  const url = assetUrl(f);

  const video = document.createElement('video');
  video.src = url;
  video.loop = true;
  video.muted = true; // 必须静音，否则浏览器不允许自动播放
  video.playsInline = true;

  video.addEventListener('loadeddata', () => {
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    const aspect = video.videoWidth / video.videoHeight || 1;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * aspect, 2),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }),
    );
    current = mesh;
    scene.add(mesh);

    controls.target.set(0, 0, 0);
    camera.position.set(0, 0, 3);
    camera.near = 0.01;
    camera.far = 100;
    camera.updateProjectionMatrix();
    controls.update();

    void video.play();
    hudEl.innerHTML = [
      `<b>${displayName(f)}</b>`,
      `${f.path}  ·  ${human(f.bytes)}`,
      '',
      `${video.videoWidth} × ${video.videoHeight}`,
      `时长 ${video.duration.toFixed(2)}s`,
    ].join('\n');
    hudEl.style.display = 'block';
    setLoading(false);
  });

  video.addEventListener('error', () => {
    showError(`视频加载失败：${url}`);
    setLoading(false);
  });
}

/* ------------------------------------------------------------- 侧栏 */

let manifest: Manifest | null = null;
let activeTab = 'models';
let query = '';

const listEl = $('list');
const tabsEl = $('tabs');
const footEl = $('foot');
const searchEl = $<HTMLInputElement>('search');

function renderTabs() {
  if (!manifest) return;
  tabsEl.innerHTML = '';
  for (const c of CATEGORIES) {
    const items = manifest.files.filter((f) => categoryOf(f) === c.key);
    if (!items.length) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(activeTab === c.key));
    b.innerHTML = `${c.label} <span class="n">${items.length}</span>`;
    b.onclick = () => {
      activeTab = c.key;
      renderTabs();
      renderList();
    };
    tabsEl.appendChild(b);
  }
}

function renderList() {
  if (!manifest) return;
  const q = query.trim().toLowerCase();

  let items = manifest.files.filter((f) => categoryOf(f) === activeTab);
  if (q) items = items.filter((f) => displayName(f).toLowerCase().includes(q));

  // 模型按三角面降序 —— 大模型排前面，符合"先看主体"的直觉
  if (activeTab === 'models') {
    items = items.slice().sort((a, b) => (b.meta?.triangles ?? 0) - (a.meta?.triangles ?? 0));
  } else {
    items = items.slice().sort((a, b) => b.bytes - a.bytes);
  }

  listEl.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'side-foot';
    p.textContent = q ? '没有匹配的素材。' : '这一类还没有下载到本地。';
    listEl.appendChild(p);
    return;
  }

  for (const f of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item';

    const m = f.meta;
    const facts =
      activeTab === 'models' && m?.triangles
        ? `${num(m.triangles)} 面 · ${num(m.vertices)} 顶点${m.bones ? ` · ${m.bones} 骨骼` : ''}`
        : human(f.bytes);

    b.innerHTML =
      `<span class="name">${displayName(f)}</span>` +
      `<span class="facts">${facts}</span>`;

    b.onclick = () => {
      listEl.querySelectorAll('.item').forEach((x) => x.setAttribute('aria-selected', 'false'));
      b.setAttribute('aria-selected', 'true');
      emptyEl.hidden = true;
      clearError();

      const cat = categoryOf(f);
      if (cat === 'models') void loadModel(f);
      else if (cat === 'video') loadVideo(f);
      else if (cat === 'images' || cat === 'textures') loadFlatTexture(f);
      else {
        hudEl.innerHTML = `<b>${displayName(f)}</b>\n${f.path}\n${human(f.bytes)}\n\n数据/字体文件，无预览。`;
        hudEl.style.display = 'block';
      }
    };
    listEl.appendChild(b);
  }
}

searchEl.addEventListener('input', () => {
  query = searchEl.value;
  renderList();
});

/* ------------------------------------------------------- 动画控制条 */

playBtn.onclick = () => {
  if (!currentAction) return;
  playing = !playing;
  if (playing) {
    currentAction.paused = false;
    playBtn.textContent = '❚❚';
  } else {
    currentAction.paused = true;
    playBtn.textContent = '▶';
  }
};

seek.addEventListener('input', () => {
  if (!mixer || !currentAction || !clips[Number(clipSel.value)]) return;
  const clip = clips[Number(clipSel.value)];
  const t = (Number(seek.value) / 1000) * clip.duration;
  currentAction.time = t;
  mixer.update(0);
});

clipSel.onchange = () => {
  playClip(Number(clipSel.value));
  seek.value = '0';
};

/* ------------------------------------------------------------- 主循环 */

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

function tick() {
  requestAnimationFrame(tick);
  const dt = clock.getDelta();

  if (mixer && currentAction) {
    if (playing) {
      mixer.update(dt);
      const clip = currentAction.getClip();
      if (clip.duration > 0) {
        seek.value = String(Math.round((currentAction.time / clip.duration) * 1000));
        animTime.textContent = `${currentAction.time.toFixed(2)} / ${clip.duration.toFixed(2)}s`;
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------- 启动 */

async function boot() {
  try {
    const res = await fetch(`${ROOT}manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as Manifest;
  } catch (e) {
    footEl.innerHTML =
      '素材清单读取失败。<br />请先在仓库根运行：<br /><code>python tools/fetch_assets.py</code>';
    showError(
      `读取 ${ROOT}manifest.json 失败：${(e as Error).message}\n\n` +
        'assets-original/ 还没生成，或 dev server 未把 /original 挂上。\n' +
        '修复：在仓库根运行  python tools/fetch_assets.py',
    );
    return;
  }

  const byCat: Record<string, number> = {};
  let bytes = 0;
  for (const f of manifest.files) {
    const c = categoryOf(f);
    byCat[c] = (byCat[c] ?? 0) + 1;
    bytes += f.bytes;
  }

  footEl.innerHTML =
    `${manifest.count} 个文件 · ${human(bytes)}<br />` +
    `采集于 ${manifest.generated?.replace('T', ' ') ?? '—'}<br />` +
    `<code>assets-original/manifest.json</code>`;

  renderTabs();
  renderList();
  resize();
  tick();

  // 默认选中最大的模型，一进来就有东西看
  const first = listEl.querySelector<HTMLButtonElement>('.item');
  first?.click();

  console.info(
    `[viewer] 素材 ${manifest.count} 个 / ${human(bytes)}，分类：`,
    byCat,
  );
}

void boot();
