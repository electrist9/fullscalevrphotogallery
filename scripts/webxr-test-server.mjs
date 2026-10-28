// WebXR HTTPS 事前検証サーバ (推奨A: mkcert 証明書)
// 起動: node scripts/webxr-test-server.mjs
// 終了: Ctrl+C
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8443;

const key = fs.readFileSync(path.join(root, 'certs', 'server.key'));
const cert = fs.readFileSync(path.join(root, 'certs', 'server.crt'));

const page = fs.readFileSync(path.join(root, 'webxr-test', 'index.html'));

const server = https.createServer({ key, cert }, (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) ips.push(`${name}: ${a.address}`);
    }
  }
  console.log(`WebXR 事前検証サーバ起動 (HTTPS)`);
  console.log(`  PC 用:       https://localhost:${PORT}/`);
  for (const ip of ips) console.log(`  HMD 用 (LAN): https://${ip.split(': ')[1]}:${PORT}/  (${ip.split(': ')[0]})`);
  console.log('Ctrl+C で終了');
});
