import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 原站素材存档目录（仓库根下的 assets-original/）。
 *
 * 为什么不把素材直接塞进 replica/public/：
 *   assets-original/ 是"证据/存档"，replica/ 是"复刻 Demo"。两者生命周期不同
 *   —— 你可能只 clone 存档去核对我的报告，也可能只跑 Demo。分成两棵树更清楚。
 *   代价是要让 Vite 知道怎么找到它，于是有了下面这个插件。
 *
 * 为什么不用软链接 / 不复制两份：
 *   软链接在 Windows 上要管理员权限、且 git 不保留；复制两份白占 27 MB 且容易不同步。
 *   一个 20 行的插件把 dev 与 build 两条路都覆盖掉，最省事。
 */
const ORIGINALS_DIR = path.resolve(here, '..', 'assets-original');

/** 极简静态文件中间件（不引 sirv，避免多一个隐式依赖） */
function serveOriginals(): Plugin {
  const MIME: Record<string, string> = {
    '.glb': 'model/gltf-binary',
    '.ktx2': 'image/ktx2',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.json': 'application/json',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };

  return {
    name: 'ew26-original-assets',

    // ---- dev：把 /original/* 映射到 ../assets-original/* ----
    configureServer(server) {
      server.middlewares.use('/original', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
        const full = path.join(ORIGINALS_DIR, rel);

        // 目录穿越防护：解析后必须仍在存档目录内
        if (!full.startsWith(ORIGINALS_DIR)) {
          res.statusCode = 403;
          return res.end('forbidden');
        }
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
          if (!fs.existsSync(ORIGINALS_DIR)) {
            res.statusCode = 404;
            return res.end(
              'assets-original/ 不存在。请先在仓库根运行: python tools/fetch_assets.py',
            );
          }
          return next();
        }

        const stat = fs.statSync(full);
        res.setHeader('Content-Type', MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(full).pipe(res);
      });
    },

    // ---- build：把存档拷进 dist/original/，产物可直接静态托管 ----
    //
    // ★ 默认只拷 3D 核心（models / textures / data / fonts ≈ 27 MB）。
    //   全量是 356 MB —— 那会让 dist/ 膨胀十倍，而 2D 那批图片/视频
    //   对"看模型"这件事没有增量价值。要全量就设 EW26_COPY_ALL=1。
    closeBundle() {
      if (!fs.existsSync(ORIGINALS_DIR)) return;
      const outDir = path.resolve(here, 'dist', 'original');
      const all = process.env.EW26_COPY_ALL === '1';
      const only = ['models', 'textures', 'data', 'fonts'];

      fs.mkdirSync(outDir, { recursive: true });
      for (const e of fs.readdirSync(ORIGINALS_DIR, { withFileTypes: true })) {
        if (!all && e.isDirectory() && !only.includes(e.name)) continue;
        fs.cpSync(path.join(ORIGINALS_DIR, e.name), path.join(outDir, e.name), {
          recursive: true,
        });
      }

      const n = countFiles(outDir);
      const mb = (dirSize(outDir) / 1024 / 1024).toFixed(1);
      this.info(
        `已把 ${all ? 'assets-original/ 全量' : 'assets-original/ 的 3D 核心'} 复制到 dist/original/` +
          `（${n} 个文件 / ${mb} MB）${all ? '' : ' —— 全量请用 EW26_COPY_ALL=1'}`,
      );

      // ★ 清单必须跟着裁剪，否则浏览器里会列出一堆点进去 404 的条目。
      //   存档目录里的 manifest.json 是全量的，这里按实际拷进去的文件重写一份。
      const mfPath = path.join(outDir, 'manifest.json');
      if (fs.existsSync(mfPath)) {
        const mf = JSON.parse(fs.readFileSync(mfPath, 'utf-8')) as {
          files: { path: string }[];
          [k: string]: unknown;
        };
        const kept = mf.files.filter((f) =>
          fs.existsSync(path.join(outDir, ...f.path.split('/'))),
        );
        const dropped = mf.files.length - kept.length;
        fs.writeFileSync(
          mfPath,
          JSON.stringify(
            {
              ...mf,
              files: kept,
              count: kept.length,
              total_bytes: kept.reduce(
                (s, f) => s + ((f as { bytes?: number }).bytes ?? 0),
                0,
              ),
              _pruned: dropped
                ? `构建产物只打包了 3D 核心，已从清单里移除 ${dropped} 个未打包的 2D 素材。` +
                  '要看全量请用 EW26_COPY_ALL=1 重新构建。'
                : undefined,
            },
            null,
            1,
          ),
          'utf-8',
        );
        if (dropped) this.info(`清单已裁剪：移除 ${dropped} 个未打包条目`);
      }
    },
  };
}

function dirSize(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

function countFiles(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

export default defineConfig({
  plugins: [react(), serveOriginals()],
  // 相对 base：构建产物放到任意子目录/静态托管都能直接跑
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
    open: false,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // 两个入口：
      //   index.html  —— 滚动驱动的场景复刻（本次逆向的主体）
      //   viewer.html —— 原站素材浏览器（GLB 3D 预览 + KTX2 贴图预览）
      input: {
        main: path.resolve(here, 'index.html'),
        viewer: path.resolve(here, 'viewer.html'),
      },
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
