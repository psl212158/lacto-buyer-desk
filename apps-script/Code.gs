/**
 * 락토코리아 바이어 데스크 — Google Apps Script 서버
 *
 * 저장 위치
 *   - 이 스크립트가 붙어 있는 구글 시트의 탭 4개: shows / buyers / meetings / followups
 *     (열: id | updatedAt | data(JSON)). 사이트가 읽고 쓰는 원본입니다. 직접 고치지 마세요.
 *   - '바이어 리스트' 탭: 사람이 보기 위한 표. 10분마다, 또는 메뉴에서 새로고침됩니다.
 *   - 상담 사진(명함, 바이어와 함께 찍은 사진 등): 내 드라이브의 '락토코리아 바이어 데스크 사진' 폴더.
 *
 * 스크립트 속성 (프로젝트 설정 → 스크립트 속성)
 *   ACCESS_CODE        팀이 사이트에 입력할 접속 코드 (필수)
 *   ANTHROPIC_API_KEY  명함 자동 인식에 쓰는 Claude API 키 (선택, 없으면 명함 인식만 꺼짐)
 */

const COLLECTIONS = ['shows', 'buyers', 'meetings', 'followups'];
const VIEW_SHEET = '바이어 리스트';
const PHOTO_FOLDER_NAME = '락토코리아 바이어 데스크 사진';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Claude API (명함 인식)
const MODEL = 'claude-opus-5-5';
const API_VERSION = '2026-10-21';
const USE_FALLBACKS = true; // 안전 분류기가 요청을 거절하면 서버가 권장 모델로 다시 실행

const STAGE_LABELS = {met: '상담완료', info: '자료발송', sample: '샘플발송', quote: '견적·협상', order: '오더 성사', hold: '보류', lost: '종료'};

const CARD_PROMPT = [
  'The attached photo(s) show ONE business card (front, and possibly back) collected at an international food trade show.',
  'Read it exactly as printed and fill in the JSON fields.',
  'Rules:',
  '- Keep the original spelling of person and company names. If the card shows several scripts, use the Latin-script version and put the other version in notes.',
  '- country: English country name such as "France". If it is not printed, infer it from the address, phone country code or website domain; otherwise "".',
  '- phone: international format with country code, e.g. "+33 1 23 45 67 89". Put the mobile number first and join several numbers with " / ".',
  '- msg: WhatsApp, WeChat, LINE or KakaoTalk IDs if printed, with the app name, e.g. "WhatsApp +971 50 123 4567".',
  '- website: domain only, without "https://".',
  '- bizHint: exactly one of 수입상, 유통사, 도매, 리테일, 외식·급식, 제조사, 에이전트, 온라인, 기타 — only when the card makes it obvious; otherwise "".',
  '- notes: other useful printed facts in short Korean (street address, product categories). "" if none.',
  '- contacts: one entry per person printed on the card (usually one).',
  '- Use "" for anything not on the card. Never invent data.',
  '- error: "" for a readable business card. If the image is not a business card or cannot be read, put a short reason in Korean here and leave the other fields empty.'
].join('\n');

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    company: {type: 'string'}, country: {type: 'string'}, city: {type: 'string'}, website: {type: 'string'},
    bizHint: {type: 'string'}, notes: {type: 'string'}, error: {type: 'string'},
    contacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {name: {type: 'string'}, title: {type: 'string'}, email: {type: 'string'}, phone: {type: 'string'}, msg: {type: 'string'}},
        required: ['name', 'title', 'email', 'phone', 'msg'],
        additionalProperties: false
      }
    }
  },
  required: ['company', 'country', 'city', 'website', 'bizHint', 'notes', 'contacts', 'error'],
  additionalProperties: false
};

/* ---------------- web app ---------------- */

function doGet() {
  return json_({ok: true, service: 'lacto-buyer-desk'});
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return json_({ok: false, error: 'bad_request', message: '요청 형식이 JSON이 아닙니다.'}); }
  const props = PropertiesService.getScriptProperties();
  const code = props.getProperty('ACCESS_CODE');
  if (!code) return json_({ok: false, error: 'setup_required', message: 'ACCESS_CODE 스크립트 속성이 없습니다.'});
  if (String(p.code || '') !== code) return json_({ok: false, error: 'unauthorized'});
  try {
    switch (p.action) {
      case 'ping': return json_({ok: true, ocr: !!props.getProperty('ANTHROPIC_API_KEY'), photos: true});
      case 'load': return json_(load_());
      case 'save': return json_(withLock_(function () { return save_(p.collection, p.id, p.doc); }));
      case 'patch': return json_(withLock_(function () { return patch_(p.collection, p.id, p.fields); }));
      case 'remove': return json_(withLock_(function () { return remove_(p.collection, p.id); }));
      case 'ocr': return json_(ocr_(p.images));
      case 'uploadPhoto': return json_(uploadPhoto_(p.media_type, p.data));
      case 'getPhoto': return json_(getPhoto_(p.id));
      case 'deletePhoto': return json_(deletePhoto_(p.id));
      default: return json_({ok: false, error: 'bad_request', message: '알 수 없는 요청입니다.'});
    }
  } catch (err) {
    if (err && err.lk) return json_({ok: false, error: err.lk, message: err.message || ''});
    return json_({ok: false, error: 'server_error', message: String((err && err.message) || err)});
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  throw {lk: code, message: message || ''};
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('busy', '다른 저장이 진행 중입니다.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------------- documents ---------------- */

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 3).setValues([['id', 'updatedAt', 'data']]);
    sh.getRange('A:A').setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function check_(collection, id) {
  if (COLLECTIONS.indexOf(collection) < 0) fail_('bad_request', '알 수 없는 컬렉션입니다.');
  if (!ID_RE.test(String(id || ''))) fail_('bad_request', '문서 id 형식이 맞지 않습니다.');
}

function findRow_(sh, id) {
  const n = sh.getLastRow();
  if (n < 2) return -1;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function load_() {
  const out = {ok: true, serverTime: Date.now()};
  COLLECTIONS.forEach(function (name) {
    const sh = sheet_(name);
    const n = sh.getLastRow();
    const docs = [];
    if (n >= 2) {
      sh.getRange(2, 1, n - 1, 3).getValues().forEach(function (r) {
        if (!r[0]) return;
        try { const d = JSON.parse(r[2]); d.id = String(r[0]); docs.push(d); } catch (e) { /* skip a damaged row */ }
      });
    }
    out[name] = docs;
  });
  return out;
}

function write_(sh, id, doc) {
  const clean = {};
  Object.keys(doc).forEach(function (k) { if (k !== 'id') clean[k] = doc[k]; });
  const text = JSON.stringify(clean);
  if (text.length > 45000) fail_('too_large', '문서가 너무 큽니다.');
  const row = findRow_(sh, id);
  const values = [[id, Date.now(), text]];
  if (row > 0) sh.getRange(row, 1, 1, 3).setValues(values);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues(values);
  clean.id = id;
  return clean;
}

function save_(collection, id, doc) {
  check_(collection, id);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail_('bad_request', '문서 내용이 없습니다.');
  return {ok: true, doc: write_(sheet_(collection), id, doc)};
}

function patch_(collection, id, fields) {
  check_(collection, id);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail_('bad_request', '바꿀 내용이 없습니다.');
  const sh = sheet_(collection);
  const row = findRow_(sh, id);
  if (row < 0) fail_('not_found', '문서를 찾을 수 없습니다.');
  let cur = {};
  try { cur = JSON.parse(sh.getRange(row, 3).getValue()) || {}; } catch (e) { cur = {}; }
  Object.keys(fields).forEach(function (k) { if (k !== 'id') cur[k] = fields[k]; });
  return {ok: true, doc: write_(sh, id, cur)};
}

function remove_(collection, id) {
  check_(collection, id);
  const sh = sheet_(collection);
  const row = findRow_(sh, id);
  if (row > 0) sh.deleteRow(row);
  return {ok: true};
}

/* ---------------- business cards: Claude API ---------------- */

function callClaude_(body, withFallbacks) {
  const headers = {
    'x-api-key': PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
    'anthropic-version': API_VERSION
  };
  const payload = JSON.parse(JSON.stringify(body));
  if (withFallbacks) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    payload.fallbacks = 'default';
  }
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  let parsed = null;
  try { parsed = JSON.parse(res.getContentText()); } catch (e) { parsed = null; }
  return {status: res.getResponseCode(), body: parsed};
}

function ocr_(images) {
  if (!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')) return {ok: false, error: 'no_api_key'};
  if (!Array.isArray(images) || !images.length || images.length > 2) fail_('bad_request', '명함 사진은 1~2장이어야 합니다.');
  const content = images.map(function (im) {
    if (!im || PHOTO_TYPES.indexOf(im.media_type) < 0 || typeof im.data !== 'string' || im.data.length > 7000000) fail_('image_rejected', '지원하지 않는 사진입니다.');
    return {type: 'image', source: {type: 'base64', media_type: im.media_type, data: im.data}};
  });
  content.push({type: 'text', text: CARD_PROMPT});
  const body = {
    model: MODEL,
    max_tokens: 16000,
    output_config: {effort: 'low', format: {type: 'json_schema', schema: CARD_SCHEMA}},
    messages: [{role: 'user', content: content}]
  };

  let r = callClaude_(body, USE_FALLBACKS);
  // 계정에서 fallbacks 베타를 받지 않으면 그 옵션만 빼고 한 번 더 요청
  if (r.status === 400 && USE_FALLBACKS && /fallback/i.test(JSON.stringify(r.body || {}))) r = callClaude_(body, false);
  if (r.status === 429 || r.status === 529 || r.status >= 500) {
    Utilities.sleep(2500);
    r = callClaude_(body, false);
  }
  if (r.status === 429 || r.status === 529 || r.status >= 500) return {ok: false, error: 'busy_api'};
  if (r.status !== 200 || !r.body) {
    const msg = r.body && r.body.error && r.body.error.message;
    return {ok: false, error: 'api_error', message: msg || ('HTTP ' + r.status)};
  }
  const m = r.body;
  if (m.stop_reason === 'refusal') return {ok: false, error: 'refused'};
  if (m.stop_reason === 'max_tokens') return {ok: false, error: 'truncated'};
  const text = (m.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  let card;
  try { card = JSON.parse(text); } catch (e) { return {ok: false, error: 'parse_error'}; }
  return {ok: true, card: card, model: m.model};
}

/* ---------------- consultation photos (Drive) ---------------- */

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function photoFile_(id) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(id || ''))) fail_('bad_request', '사진 id 형식이 맞지 않습니다.');
  const folderId = photoFolder_().getId();
  let file;
  try { file = DriveApp.getFileById(id); } catch (e) { fail_('not_found', '사진을 찾을 수 없습니다.'); }
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return file;
  fail_('not_found', '바이어 데스크 사진 폴더의 파일이 아닙니다.');
}

function uploadPhoto_(mediaType, data) {
  if (PHOTO_TYPES.indexOf(mediaType) < 0 || typeof data !== 'string' || !data || data.length > 7000000) fail_('image_rejected', '지원하지 않는 사진입니다.');
  const ext = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'}[mediaType];
  const name = 'photo_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss') + '_' + Math.random().toString(36).slice(2, 6) + ext;
  const file = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(data), mediaType, name));
  return {ok: true, id: file.getId()};
}

function getPhoto_(id) {
  const file = photoFile_(id);
  return {ok: true, media_type: file.getMimeType(), data: Utilities.base64Encode(file.getBlob().getBytes())};
}

function deletePhoto_(id) {
  photoFile_(id).setTrashed(true);
  return {ok: true};
}

/* ---------------- readable sheet ---------------- */

function cell_(v) {
  const s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function rebuildBuyerSheet() {
  const data = load_();
  const shows = {};
  data.shows.forEach(function (s) { shows[s.id] = s; });
  const byBuyer = function (list) {
    const m = {};
    list.forEach(function (x) { (m[x.buyerId] = m[x.buyerId] || []).push(x); });
    Object.keys(m).forEach(function (k) { m[k].sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); }); });
    return m;
  };
  const mBy = byBuyer(data.meetings), fBy = byBuyer(data.followups);
  const head = ['전시회', '첫 상담일', '회사명', '국가', '도시', '업종', '등급', '진행 단계', '담당자', '직책', '이메일', '전화', '메신저', '추가 담당자',
    '관심 제품', '요청사항', '상담 메모', '최근 팔로우업일', '최근 팔로우업 내용', '다음 액션', '예정일', '사진 수'];
  const rows = data.buyers.map(function (b) {
    const ms = mBy[b.id] || [], fs = fBy[b.id] || [];
    const c = (b.contacts || [])[0] || {};
    const f = fs[fs.length - 1] || {};
    const showNames = (b.showIds || []).map(function (id) { return shows[id] ? shows[id].name : ''; }).filter(String).join(', ');
    const uniq = function (a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); };
    return [showNames, (ms[0] || {}).date || '', b.company, b.country, b.city, b.bizType, b.grade, STAGE_LABELS[b.stage] || '상담완료',
      c.name, c.title, c.email, c.phone, c.msg,
      (b.contacts || []).slice(1).map(function (x) { return [x.name, x.title, x.email, x.phone].filter(String).join(' / '); }).join(' | '),
      uniq([].concat.apply([], ms.map(function (m) { return m.interests || []; }))).join(', '),
      uniq([].concat.apply([], ms.map(function (m) { return m.requests || []; }))).join(', '),
      ms.map(function (m) { return '[' + m.date + '] ' + (m.notes || ''); }).join(' / '),
      f.date || '', f.content || '', b.nextAction, b.nextDate,
      ms.reduce(function (n, m) { return n + (Array.isArray(m.photos) ? m.photos.length : 0); }, 0)
    ].map(cell_);
  }).sort(function (a, b) { return (a[0] + a[1]).localeCompare(b[0] + b[1]); });
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(VIEW_SHEET) || ss.insertSheet(VIEW_SHEET, 0);
  sh.clearContents();
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.setFrozenRows(1);
}

/* ---------------- setup ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('바이어 데스크')
    .addItem('바이어 리스트 새로고침', 'rebuildBuyerSheet')
    .addItem('초기 설정 실행', 'setup')
    .addToUi();
}

/** 처음 한 번 실행: 탭 생성, SIAL Paris 2026 등록, 사진 폴더 생성, 10분 주기 새로고침 등록 */
function setup() {
  COLLECTIONS.forEach(sheet_);
  const shows = sheet_('shows');
  if (shows.getLastRow() < 2) {
    write_(shows, 'sial-paris-2026', {
      name: 'SIAL Paris 2026', venue: 'Paris Nord Villepinte', city: 'Paris', country: 'France',
      startDate: '2026-10-17', endDate: '2026-10-21', booth: '', color: '#2349C9', createdAt: Date.now(), updatedAt: Date.now()
    });
  }
  photoFolder_();
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'rebuildBuyerSheet'; });
  if (!has) ScriptApp.newTrigger('rebuildBuyerSheet').timeBased().everyMinutes(10).create();
  rebuildBuyerSheet();
  const props = PropertiesService.getScriptProperties();
  Logger.log('ACCESS_CODE: ' + (props.getProperty('ACCESS_CODE') ? '설정됨' : '없음 — 프로젝트 설정 → 스크립트 속성에서 추가하세요'));
  Logger.log('ANTHROPIC_API_KEY: ' + (props.getProperty('ANTHROPIC_API_KEY') ? '설정됨' : '없음 — 명함 자동 인식이 꺼집니다'));
}
