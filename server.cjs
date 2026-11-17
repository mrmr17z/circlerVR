// خادم محلي بسيط: node server.js  (HTTP على 8080، وHTTPS على 8443 إذا وُجدت cert.pem و key.pem)
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const root = __dirname;
const handler = (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, path.normalize(p));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  // لا تُقدَّم الملفات المخفية (مثل .env الذي فيه المفتاح) ولا مفاتيح الشهادة
  if (path.relative(root, f).split(path.sep).some(x => x.startsWith('.')) || /^(key|cert).pem$/.test(path.basename(f))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  });
};
const port = +process.env.PORT || 8080;
http.createServer(handler).listen(port, () => console.log(`http://localhost:${port}`));
if (fs.existsSync(path.join(root, 'cert.pem'))) {
  https.createServer({ key: fs.readFileSync(path.join(root, 'key.pem')), cert: fs.readFileSync(path.join(root, 'cert.pem')) }, handler)
    .listen(8443, () => console.log('https://<عنوان-جهازك-في-الشبكة>:8443  (للنظارة)'));
}
