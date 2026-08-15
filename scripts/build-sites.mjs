import { access, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await access('dist/client/index.html');
await mkdir('dist/server', { recursive: true });
await build({
  entryPoints: ['worker/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  minify: true,
});
