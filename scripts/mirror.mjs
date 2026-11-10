import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const origin = 'https://monrix.run/';
const outputUrl = new URL('../site/', import.meta.url);
const output = fileURLToPath(outputUrl);
const seeds = [
  '/', '/index.html', '/guide.html', '/app.html', '/terminal.html',
  '/download.html', '/privacy.html', '/vault.html', '/exchange.html',
  '/agent.html', '/network.html',
  '/banner.png',
];
const queue = [...seeds];
const seen = new Set();
const failed = [];

function normalized(ref, base) {
  if (!ref || /^(?:data:|blob:|mailto:|tel:|javascript:|#)/i.test(ref)) return null;
  let url;
  try { url = new URL(ref, `${origin}${base}`); } catch { return null; }
  if (url.origin !== origin) return null;
  url.hash = '';
  url.search = '';
  const path = url.pathname || '/';
  if (/^\/(?:api|rpc)\//.test(path)) return null;
  const extension = extname(path).toLowerCase();
  const allowed = new Set(['.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2', '.wasm', '.txt', '.map']);
  if (path !== '/' && !path.endsWith('/') && (!extension || !allowed.has(extension))) return null;
  return path;
}

function destination(path) {
  if (path === '/' || path.endsWith('/')) return join(output, path, 'index.html');
  return join(output, path);
}

function references(text, path) {
  const refs = new Set();
  const patterns = [
    /(?:href|src|poster)\s*=\s*["']([^"']+)["']/gi,
    /\b(?:import|from)\s*(?:\(\s*)?["']((?:\.{0,2}\/)[^"']+)["']/g,
    /new\s+URL\(\s*["']([^"']+)["']/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /["'`](\/(?:assets|shots|fonts|images)\/[^"'`?#\s)]+)["'`]/g,
    /["'`](\/(?:logo|banner|favicon)[^"'`?#\s)]*)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalized(match[1], path);
      if (value) refs.add(value);
    }
  }
  return refs;
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
while (queue.length) {
  const path = queue.shift();
  if (!path || seen.has(path)) continue;
  seen.add(path);
  const result = spawnSync('curl.exe', [
    '--fail', '--location', '--silent', '--show-error',
    '--retry', '3', '--retry-delay', '1', '--connect-timeout', '12', '--max-time', '45',
    `${origin}${path}`,
  ], { encoding: null, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout?.length) {
    failed.push({ path, error: result.stderr?.toString('utf8').trim() || `curl ${result.status}` });
    continue;
  }
  const file = destination(path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, result.stdout);

  const extension = extname(path).toLowerCase();
  if (path === '/' || path.endsWith('/') || ['.html', '.js', '.css', '.json', '.svg', '.txt'].includes(extension)) {
    const text = result.stdout.toString('utf8');
    for (const ref of references(text, path === '/' ? '/' : path)) {
      if (extension === '.js' && ref.endsWith('.html')) continue;
      if (!seen.has(ref)) queue.push(ref);
    }
  }
  process.stdout.write(`saved ${path}\n`);
}

const report = {
  source: origin,
  mirroredAt: new Date().toISOString(),
  downloaded: seen.size - failed.length,
  failed,
};
await writeFile(new URL('../mirror-report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Finished: ${report.downloaded} files, ${failed.length} failed.`);
