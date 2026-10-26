const assert = require('assert');
const {makeRuntime} = require('./gas-stub');
// setup with no properties: makes an access code, start sheet, seed show
const rt = makeRuntime({props: {}});
assert.strictEqual(rt.post({action: 'ping', code: ''}).error, 'setup_required');
rt.api.setup();
const code = rt.props.ACCESS_CODE;
assert(/^lacto-[0-9a-f]{8}$/.test(code), 'generated code ' + code);
const start = rt.sheets.get('시작하기').rows;
assert.strictEqual(start[3][0], '접속 코드'); assert.strictEqual(start[3][1], code);
assert.strictEqual(rt.props.SHEET_ID, 'sheet0000001');
assert.strictEqual(rt.post({action: 'ping', code: 'nope'}).error, 'unauthorized');
const ping = rt.post({action: 'ping', code});
assert(ping.ok && ping.ocr && ping.photos, 'ping');
let load = rt.post({action: 'load', code});
assert.strictEqual(load.shows.length, 1); assert.strictEqual(load.shows[0].id, 'sial-paris-2026');
// rerun keeps the code; a code typed into the start sheet replaces it
rt.api.setup(); assert.strictEqual(rt.props.ACCESS_CODE, code);
rt.sheets.get('시작하기').rows[3][1] = 'team-2026';
rt.api.setup(); assert.strictEqual(rt.props.ACCESS_CODE, 'team-2026');
assert.strictEqual(rt.sheets.get('shows').getLastRow(), 2, 'seed not duplicated');
// documents
let r = rt.post({action: 'save', code: 'team-2026', collection: 'buyers', id: 'mgb1abc', doc: {company: 'Acme', grade: 'A', contacts: [{name: '+Phone'}]}});
assert(r.ok && r.doc.id === 'mgb1abc');
r = rt.post({action: 'patch', code: 'team-2026', collection: 'buyers', id: 'mgb1abc', fields: {stage: 'sample'}});
assert(r.ok && r.doc.company === 'Acme' && r.doc.stage === 'sample');
assert.strictEqual(rt.post({action: 'patch', code: 'team-2026', collection: 'buyers', id: 'missing1', fields: {a: 1}}).error, 'not_found');
assert.strictEqual(rt.post({action: 'save', code: 'team-2026', collection: 'evil', id: 'x1', doc: {}}).error, 'bad_request');
// photos
const img = Buffer.from('fakejpegbytes').toString('base64');
const up = rt.post({action: 'uploadPhoto', code: 'team-2026', media_type: 'image/jpeg', data: img});
assert(up.ok && up.id);
const got = rt.post({action: 'getPhoto', code: 'team-2026', id: up.id});
assert(got.ok && got.data === img && got.media_type === 'image/jpeg');
rt.post({action: 'save', code: 'team-2026', collection: 'meetings', id: 'mgm1abc', doc: {buyerId: 'mgb1abc', showId: 'sial-paris-2026', date: '2026-10-18', photos: [{id: up.id, kind: 'people'}], notes: '=SUM(1)'}});
assert(rt.post({action: 'deletePhoto', code: 'team-2026', id: up.id}).ok);
assert.strictEqual(rt.post({action: 'getPhoto', code: 'team-2026', id: up.id}).error, 'not_found');
// readable sheet
rt.api.rebuildBuyerSheet();
const view = rt.sheets.get('바이어 리스트').rows;
assert.strictEqual(view[1][2], 'Acme'); assert.strictEqual(view[1][7], '샘플발송');
assert.strictEqual(view[1][8], "'+Phone"); assert.strictEqual(view[1][16], "[2026-10-18] =SUM(1)"); assert.strictEqual(String(view[1][21]), '1');
// standalone script (no bound sheet): setup creates/attaches a sheet
const sa = makeRuntime({props: {}, bound: false});
sa.api.setup();
assert.strictEqual(sa.props.SHEET_ID, 'sheet0000001');
assert(sa.post({action: 'load', code: sa.props.ACCESS_CODE}).ok);
console.log('Code.gs server tests passed');
