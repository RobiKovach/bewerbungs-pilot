// Standalone voice check: serves ONE page on 127.0.0.1 so the browser's Web Speech API can be tried at home.
// Not part of the app, not in the release archive. Stores and sends nothing itself. Stop with Ctrl+C.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-voice.html'));

const server = http.createServer((req, res) => {
  const url = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'",
    });
    res.end(page);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`Перевірка голосу: http://127.0.0.1:${port}/`);
  console.log('Відкрий цю адресу в Edge або Chrome. Зупинити: Ctrl+C.');
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
