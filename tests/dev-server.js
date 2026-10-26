// Serves the site on localhost with Code.gs (via gas-stub) behind /api, so it can be tried in a browser without Google.
// usage: node tests/dev-server.js [port]   then open http://localhost:<port>/  (test code lacto-test, already signed in)
const fs = require('fs');
const http = require('http');
const path = require('path');
const {makeRuntime} = require('./gas-stub');

const PORT = +process.argv[2] || 8797;
const ROOT = path.resolve(__dirname, '..');
const CODE = 'lacto-test';
const rt = makeRuntime({props: {ACCESS_CODE: CODE}, ocrText: () => 'TEST CARD FOODS SARL\nMarie Exemple\nBuyer\nmarie@testcardfoods.fr'});
rt.api.setup();

// sample data: two buyers met on 10/19 and one pending photo
const img = name => fs.readFileSync(path.join(__dirname, 'fixtures', name)).toString('base64');
const up = name => rt.post({action: 'uploadPhoto', code: CODE, media_type: 'image/jpeg', data: img(name)}).id;
const save = (collection, id, doc) => rt.post({action: 'save', code: CODE, collection, id, doc});
const now = Date.now();
[['b1', 'Exemple Foods SARL', 'France', 'Marie Exemple'], ['b2', 'Muster Handel GmbH', 'Germany', 'Hans Muster']].forEach(([id, company, country, name], i) => {
  save('buyers', id, {company, country, grade: 'B', stage: 'met', contacts: [{name, title: 'Buyer', email: '', phone: '', msg: ''}], showIds: ['sial-paris-2026'], tags: [], createdAt: now + i, updatedAt: now + i});
  save('meetings', 'm' + id, {buyerId: id, showId: 'sial-paris-2026', date: '2026-10-19', time: '', staff: '', interests: [], requests: [], notes: '', photos: [], source: 'manual', createdAt: now + i, updatedAt: now + i});
});
save('gallery', 'g1', {showId: 'sial-paris-2026', date: '2026-10-19', photo: {id: up('card1.jpg'), thumb: '', kind: 'people', caption: '오후, 프랑스 바이어로 보임'}, createdAt: now, updatedAt: now});

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css'};
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try { out = rt.post(JSON.parse(body)); } catch (e) { out = {ok: false, error: 'bad_request', message: String(e)}; }
      res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(out));
    });
    return;
  }
  if (url === '/config.js') {
    res.writeHead(200, {'Content-Type': TYPES['.js']});
    res.end(`window.LK_CONFIG = {apiUrl: location.origin + '/api'};\ntry { localStorage.setItem('lk-code', '${CODE}'); if (!localStorage.getItem('lk-name')) localStorage.setItem('lk-name', '테스터'); } catch (e) {}\n`);
    return;
  }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`buyer desk dev server: http://localhost:${PORT}/`));
