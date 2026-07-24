// 개발 프리뷰용 초간단 정적 서버 (frontend/ 전용)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath 로 OS 네이티브 경로(Windows 는 F:\...\frontend)를 얻는다.
// (URL.pathname 은 '/F:/...' 형태라 Windows 에서 join/normalize 결과와 startsWith 비교가 깨져 403 이 났다)
const ROOT = fileURLToPath(new URL('../frontend', import.meta.url));
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
  '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(8787, () => console.log('preview on :8787'));
