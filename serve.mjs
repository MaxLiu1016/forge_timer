// 極簡靜態伺服器（零相依）。本機預覽：node serve.mjs [port]
// 也直接當正式環境用：雲端平台（Railway / Render 之類）會用 PORT 環境變數指定連接埠
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
// 平台指定的 PORT 優先，其次是命令列參數，最後才是預設值
const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 5173;
const IS_PROD = !!process.env.PORT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let path = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''));
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');

    const body = await readFile(path);
    // 開發時一律不快取，免得改了看不到。
    // 正式環境讓靜態檔案走 revalidate（省流量），但 sw.js 和 HTML 一定要拿最新的，
    // 不然改版推上去後使用者永遠拿到舊的 Service Worker。
    const entry = /(?:sw\.js|\.html)$/.test(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path)] || 'application/octet-stream',
      'Cache-Control': !IS_PROD || entry ? 'no-store' : 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(PORT, '0.0.0.0', () => {
  if (IS_PROD) {
    console.log(`FORGE serving on port ${PORT}`);
    return;
  }
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  console.log(`\n  本機：   http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  區網：   http://${ip}:${PORT}   （手機同 Wi-Fi 可開）`));
  console.log('\n  註：Service Worker / 安裝功能只在 localhost 或 HTTPS 生效。\n');
});
