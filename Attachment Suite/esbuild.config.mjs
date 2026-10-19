import esbuild from 'esbuild';
import process from 'process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const prod = process.argv[2] === 'production';

// 可安装插件包目录：目录名必须与插件 id 一致（attachment-suite），
// 整体拷到 .obsidian/plugins/ 下即可被 Obsidian 识别并加载。
const PKG_DIR = 'dist/attachment-suite';

/** 拷贝静态部署文件与 main.js 到插件包目录，使 dist/<id>/ 成为完整可安装包。 */
function assemblePluginPackage() {
  mkdirSync(PKG_DIR, { recursive: true });
  for (const f of ['manifest.json', 'styles.css']) {
    if (existsSync(f)) copyFileSync(f, `${PKG_DIR}/${f}`);
  }
}

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: `${PKG_DIR}/main.js`,
  define: {
    'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
  },
  plugins: [
    {
      name: 'assemble-plugin-package',
      setup(build) {
        build.onEnd(() => assemblePluginPackage());
      },
    },
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}