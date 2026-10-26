/**
 * 락토코리아 바이어 데스크 — Google Apps Script 서버
 *
 * 처음 설정 (구글 계정만 있으면 됩니다)
 *   1) 이 코드를 구글 시트의 확장 프로그램 → Apps Script에 붙여 넣고 저장
 *   2) 위쪽 함수 목록에서 setup 을 골라 ▶ 실행 (권한 허용)
 *   3) 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자)
 *   팀 접속 코드는 setup 이 자동으로 만들어 시트의 '시작하기' 탭에 적어 둡니다.
 *
 * 저장 위치
 *   - 시트 탭 4개: shows / buyers / meetings / followups (열: id | updatedAt | data(JSON)).
 *     사이트가 읽고 쓰는 원본입니다. 직접 고치지 마세요.
 *   - '바이어 리스트' 탭: 사람이 보기 위한 표. 10분마다, 또는 메뉴에서 새로고침됩니다.
 *   - 상담 사진(명함, 바이어와 함께 찍은 사진 등): 내 드라이브의 '락토코리아 바이어 데스크 사진' 폴더.
 *
 * 명함 자동 인식은 구글 드라이브의 글자 인식(OCR)을 씁니다. 별도 API 키나 비용이 없습니다.
 */

const COLLECTIONS = ['shows', 'buyers', 'meetings', 'followups'];
const VIEW_SHEET = '바이어 리스트';
const START_SHEET = '시작하기';
const SITE_URL = 'https://psl212158.github.io/lacto-buyer-desk/';
const PHOTO_FOLDER_NAME = '락토코리아 바이어 데스크 사진';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const OCR_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const STAGE_LABELS = {met: '상담완료', info: '자료발송', sample: '샘플발송', quote: '견적·협상', order: '오더 성사', hold: '보류', lost: '종료'};

/* ---------------- web app ---------------- */

function doGet() {
  return json_({ok: true, service: 'lacto-buyer-desk'});
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return json_({ok: false, error: 'bad_request', message: '요청 형식이 JSON이 아닙니다.'}); }
  const code = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!code) return json_({ok: false, error: 'setup_required', message: 'setup을 먼저 실행하세요.'});
  if (String(p.code || '') !== code) return json_({ok: false, error: 'unauthorized'});
  try {
    switch (p.action) {
      case 'ping': return json_({ok: true, ocr: true, photos: true});
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

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* fall back to the bound sheet */ }
  }
  const active = SpreadsheetApp.getActive();
  if (!active) fail_('setup_required', '연결된 시트가 없습니다. setup을 먼저 실행하세요.');
  return active;
}

function sheet_(name) {
  const ss = ss_();
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

/* ---------------- business cards: Google Drive OCR ---------------- */

function ocr_(images) {
  if (!Array.isArray(images) || !images.length || images.length > 2) fail_('bad_request', '명함 사진은 1~2장이어야 합니다.');
  const text = images.map(function (im) {
    if (!im || OCR_TYPES.indexOf(im.media_type) < 0 || typeof im.data !== 'string' || im.data.length > 7000000) fail_('image_rejected', 'JPG·PNG 사진만 읽을 수 있습니다.');
    return driveOcr_(Utilities.base64Decode(im.data), im.media_type);
  }).join('\n');
  return {ok: true, card: parseCardText_(text), text: text.slice(0, 4000)};
}

// Uploads the photo as a Google Doc (Drive runs OCR on conversion), reads the text, then trashes the temp doc.
function driveOcr_(bytes, mediaType) {
  const token = ScriptApp.getOAuthToken();
  const boundary = 'lkocr' + Date.now();
  const meta = {name: 'lk-ocr-' + Date.now(), mimeType: 'application/vnd.google-apps.document', parents: [photoFolder_().getId()]};
  const head = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
    '\r\n--' + boundary + '\r\nContent-Type: ' + mediaType + '\r\n\r\n').getBytes();
  const tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary,
    payload: head.concat(bytes, tail), headers: {Authorization: 'Bearer ' + token}, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) fail_('ocr_failed', '구글 드라이브 글자 인식 요청 실패 (HTTP ' + res.getResponseCode() + ')');
  const docId = JSON.parse(res.getContentText()).id;
  try {
    const out = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(docId) + '/export?mimeType=text/plain', {
      headers: {Authorization: 'Bearer ' + token}, muteHttpExceptions: true
    });
    if (out.getResponseCode() !== 200) fail_('ocr_failed', '인식한 글자를 읽지 못했습니다 (HTTP ' + out.getResponseCode() + ')');
    return out.getContentText('UTF-8');
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { /* already gone */ }
  }
}

const PHONE_CODES = [
  ['971', 'United Arab Emirates'], ['966', 'Saudi Arabia'], ['974', 'Qatar'], ['965', 'Kuwait'], ['973', 'Bahrain'], ['968', 'Oman'],
  ['972', 'Israel'], ['962', 'Jordan'], ['961', 'Lebanon'], ['852', 'Hong Kong'], ['853', 'Macau'], ['886', 'Taiwan'], ['976', 'Mongolia'],
  ['351', 'Portugal'], ['352', 'Luxembourg'], ['353', 'Ireland'], ['358', 'Finland'], ['420', 'Czech Republic'], ['421', 'Slovakia'],
  ['212', 'Morocco'], ['216', 'Tunisia'], ['213', 'Algeria'], ['234', 'Nigeria'], ['254', 'Kenya'], ['880', 'Bangladesh'],
  ['998', 'Uzbekistan'], ['380', 'Ukraine'], ['385', 'Croatia'], ['386', 'Slovenia'], ['359', 'Bulgaria'], ['370', 'Lithuania'],
  ['371', 'Latvia'], ['372', 'Estonia'], ['33', 'France'], ['49', 'Germany'], ['39', 'Italy'], ['34', 'Spain'], ['44', 'United Kingdom'],
  ['31', 'Netherlands'], ['32', 'Belgium'], ['41', 'Switzerland'], ['43', 'Austria'], ['48', 'Poland'], ['30', 'Greece'], ['46', 'Sweden'],
  ['47', 'Norway'], ['45', 'Denmark'], ['90', 'Turkey'], ['36', 'Hungary'], ['40', 'Romania'], ['20', 'Egypt'], ['27', 'South Africa'],
  ['91', 'India'], ['92', 'Pakistan'], ['86', 'China'], ['81', 'Japan'], ['82', 'Korea'], ['84', 'Vietnam'], ['66', 'Thailand'],
  ['65', 'Singapore'], ['60', 'Malaysia'], ['62', 'Indonesia'], ['63', 'Philippines'], ['61', 'Australia'], ['64', 'New Zealand'],
  ['55', 'Brazil'], ['52', 'Mexico'], ['56', 'Chile'], ['54', 'Argentina'], ['57', 'Colombia'], ['7', 'Russia'], ['1', 'United States']
];
const TLD_COUNTRY = {
  fr: 'France', de: 'Germany', it: 'Italy', es: 'Spain', nl: 'Netherlands', be: 'Belgium', ch: 'Switzerland', at: 'Austria', pl: 'Poland',
  pt: 'Portugal', uk: 'United Kingdom', ie: 'Ireland', se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland', gr: 'Greece', tr: 'Turkey',
  ae: 'United Arab Emirates', sa: 'Saudi Arabia', qa: 'Qatar', kw: 'Kuwait', jp: 'Japan', cn: 'China', hk: 'Hong Kong', tw: 'Taiwan',
  kr: 'Korea', vn: 'Vietnam', th: 'Thailand', sg: 'Singapore', my: 'Malaysia', id: 'Indonesia', ph: 'Philippines', au: 'Australia',
  nz: 'New Zealand', in: 'India', ca: 'Canada', mx: 'Mexico', br: 'Brazil', za: 'South Africa', eg: 'Egypt', ma: 'Morocco', il: 'Israel',
  lu: 'Luxembourg', cz: 'Czech Republic', hu: 'Hungary', ro: 'Romania'
};
const COUNTRY_WORDS = [
  ['united arab emirates', 'United Arab Emirates'], ['u\\.a\\.e\\.?', 'United Arab Emirates'], ['uae', 'United Arab Emirates'], ['dubai', 'United Arab Emirates'], ['abu dhabi', 'United Arab Emirates'],
  ['saudi arabia', 'Saudi Arabia'], ['ksa', 'Saudi Arabia'], ['qatar', 'Qatar'], ['kuwait', 'Kuwait'], ['bahrain', 'Bahrain'], ['oman', 'Oman'],
  ['france', 'France'], ['germany', 'Germany'], ['deutschland', 'Germany'], ['italy', 'Italy'], ['italia', 'Italy'], ['spain', 'Spain'], ['españa', 'Spain'], ['espana', 'Spain'],
  ['the netherlands', 'Netherlands'], ['netherlands', 'Netherlands'], ['nederland', 'Netherlands'], ['holland', 'Netherlands'], ['belgium', 'Belgium'], ['belgique', 'Belgium'], ['belgië', 'Belgium'],
  ['switzerland', 'Switzerland'], ['schweiz', 'Switzerland'], ['suisse', 'Switzerland'], ['austria', 'Austria'], ['österreich', 'Austria'], ['poland', 'Poland'], ['polska', 'Poland'],
  ['portugal', 'Portugal'], ['united kingdom', 'United Kingdom'], ['england', 'United Kingdom'], ['ireland', 'Ireland'], ['sweden', 'Sweden'], ['sverige', 'Sweden'],
  ['norway', 'Norway'], ['norge', 'Norway'], ['denmark', 'Denmark'], ['danmark', 'Denmark'], ['finland', 'Finland'], ['greece', 'Greece'], ['türkiye', 'Turkey'], ['turkey', 'Turkey'],
  ['japan', 'Japan'], ['china', 'China'], ['hong kong', 'Hong Kong'], ['taiwan', 'Taiwan'], ['south korea', 'Korea'], ['korea', 'Korea'], ['viet nam', 'Vietnam'], ['vietnam', 'Vietnam'],
  ['thailand', 'Thailand'], ['singapore', 'Singapore'], ['malaysia', 'Malaysia'], ['indonesia', 'Indonesia'], ['philippines', 'Philippines'], ['australia', 'Australia'],
  ['new zealand', 'New Zealand'], ['india', 'India'], ['canada', 'Canada'], ['united states', 'United States'], ['u\\.s\\.a\\.?', 'United States'], ['usa', 'United States'],
  ['mexico', 'Mexico'], ['brazil', 'Brazil'], ['south africa', 'South Africa'], ['egypt', 'Egypt'], ['morocco', 'Morocco'], ['maroc', 'Morocco'], ['israel', 'Israel'],
  ['luxembourg', 'Luxembourg'], ['czech republic', 'Czech Republic'], ['hungary', 'Hungary'], ['romania', 'Romania']
];
const KNOWN_CITIES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Riyadh', 'Jeddah', 'Doha', 'Kuwait City', 'Manama', 'Muscat', 'Singapore', 'Hong Kong', 'Tokyo', 'Osaka',
  'Shanghai', 'Beijing', 'Guangzhou', 'Shenzhen', 'Seoul', 'Busan', 'Paris', 'Lyon', 'Marseille', 'Lille', 'Bordeaux', 'Toulouse', 'Nantes', 'Rungis', 'London',
  'Manchester', 'Madrid', 'Barcelona', 'Valencia', 'Milano', 'Milan', 'Roma', 'Rome', 'Bologna', 'Torino', 'Berlin', 'Hamburg', 'München', 'Munich', 'Frankfurt',
  'Köln', 'Cologne', 'Düsseldorf', 'Amsterdam', 'Rotterdam', 'Brussels', 'Bruxelles', 'Antwerp', 'Antwerpen', 'Vienna', 'Wien', 'Zürich', 'Zurich', 'Geneva', 'Genève',
  'Warsaw', 'Warszawa', 'Lisbon', 'Lisboa', 'Istanbul', 'Bangkok', 'Ho Chi Minh', 'Hanoi', 'Kuala Lumpur', 'Jakarta', 'Manila', 'Sydney', 'Melbourne', 'Auckland',
  'Toronto', 'Vancouver', 'Montreal', 'New York', 'Los Angeles', 'Chicago', 'Mumbai', 'New Delhi', 'Delhi', 'Cairo', 'Casablanca', 'Johannesburg', 'Cape Town',
  'Stockholm', 'Oslo', 'Copenhagen', 'Helsinki', 'Athens', 'Dublin', 'Luxembourg', 'Prague', 'Budapest', 'Bucharest'];
const TITLE_WORDS = /\b(manager|director|directeur|directrice|direttore|directora?|ceo|cfo|coo|cto|founder|co-founder|owner|president|vice president|vp|chairman|partner|buyer|acheteu(?:r|se)|purchas\w*|procurement|sourcing|sales|head of|chief|officer|coordinator|executive|category|business development|marketing|account|responsable|chef de|gérant|gerant|geschäftsführer|geschaftsfuhrer|einkauf\w*|leiter\w*|gerente|compras|comercial|responsabile|acquisti|commerciale|assistant|specialist|supervisor|consultant|representative|trader|agent|managing|general manager|md)\b/i;
const COMPANY_LEGAL = /(\bs\.?a\.?s\.?\b|\bs\.?a\.?r\.?l\.?\b|\bs\.a\.?\b|\bgmbh\b|\bag\b|\bkg\b|\bltd\.?\b|\blimited\b|\bllc\b|\bl\.l\.c\.?\b|\binc\.?\b|\bcorp\.?\b|\bcorporation\b|\bco\.,?\s?ltd\b|\bb\.?v\.?\b|\bn\.?v\.?\b|\bs\.?p\.?a\.?\b|\bs\.?r\.?l\.?\b|\bs\.l\.?\b|\bpty\b|\bllp\b|\bplc\b|\boy\b|\ba\/s\b|\bfze\b|\bfzco\b|\bfz-llc\b|\bbvba\b|\bsprl\b|\bkft\b)/i;
const COMPANY_HINT = /\b(trading|foods?|import\w*|export\w*|group|company|distribu\w*|international|industr\w*|enterprises?|holding|gida|ticaret|épicerie|market)\b/i;
const COMPANY_WORDS = new RegExp(COMPANY_LEGAL.source + '|' + COMPANY_HINT.source, 'i');
const ADDRESS_WORDS = /(\d.*\b(rue|avenue|av\.|bd|boulevard|str\.|straße|strasse|via|viale|calle|avda|road|rd\.|street|st\.|lane|drive|way|plaza|platz|weg|laan|straat|chaussée|place|allée|quai|route|building|bldg|floor|suite|unit|office|zone|p\.?o\.? box)\b)|(\b(rue|avenue|boulevard|straße|strasse|street|road|p\.?o\.? box|industrial area|free zone|cedex)\b)|(\p{L}(straße|strasse|str\.)\s?\d)|(\p{L}(weg|laan|straat|gasse)\s\d)/iu;
const GENERIC_MAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|gmx|web|orange|free|wanadoo|sfr|laposte|naver|daum|hanmail|kakao|qq|163|126|sina|mail|yandex|proton|protonmail)\./i;
const BIZ_HINTS = [[/\bimport\w*\b/i, '수입상'], [/\bdistribu\w*/i, '유통사'], [/\b(wholesale\w*|grossiste|großhandel|grosshandel)\b/i, '도매'],
  [/\b(retail\w*|supermarket\w*|hypermarket\w*|épicerie|grocery)\b/i, '리테일'], [/\b(restaurant\w*|catering|food ?service|horeca)\b/i, '외식·급식'],
  [/\b(manufactur\w*|factory|fabricant|production)\b/i, '제조사'], [/\b(agent|agency|broker|brokerage|representative)\b/i, '에이전트'], [/\b(e-?commerce|online)\b/i, '온라인']];

function titleCase_(s) {
  return s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); });
}

/** Turns OCR text from a business card into the fields the site fills in. */
function parseCardText_(raw) {
  const empty = {company: '', country: '', city: '', website: '', bizHint: '', notes: '', error: '', contacts: [{name: '', title: '', email: '', phone: '', msg: ''}]};
  const text = String(raw || '').replace(/﻿/g, '').replace(/\r/g, '');
  const lines = text.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(function (l) { return l && !/^[_\W]{1,3}$/.test(l); });
  if (!lines.length) { empty.error = '명함에서 글자를 찾지 못했습니다'; return empty; }
  const all = lines.join('\n');
  const lower = all.toLowerCase();

  // email
  const emails = (all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(function (e) { return e.toLowerCase(); });
  const email = emails[0] || '';
  const mailDomain = email ? email.split('@')[1] : '';

  // website
  let website = '';
  const noMail = all.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
  const webRe = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.([a-z]{2,6}))(?:\/[^\s]*)?/gi;
  let wm;
  const okTld = /^(com|net|org|biz|info|co|eu|asia|shop|store|food|ae|sa|qa|kw|bh|om|uk|fr|de|it|es|nl|be|ch|at|pl|pt|ie|se|no|dk|fi|gr|tr|jp|cn|hk|tw|kr|vn|th|sg|my|id|ph|au|nz|in|ca|mx|br|za|eg|ma|il|lu|cz|hu|ro)$/i;
  while ((wm = webRe.exec(noMail))) {
    if (!okTld.test(wm[2])) continue;
    const cand = wm[1].replace(/^https?:\/\//i, '').toLowerCase();
    if (/^www\./.test(cand) || (mailDomain && cand.indexOf(mailDomain) >= 0) || /^https?:/i.test(wm[1]) || !website) {
      website = cand;
      if (/^www\./.test(cand)) break;
    }
  }
  if (!website && mailDomain && !GENERIC_MAIL.test(mailDomain)) website = mailDomain;
  const domainLabel = (website || (mailDomain && !GENERIC_MAIL.test(mailDomain) ? mailDomain : '')).replace(/^www\./, '').split('.')[0];

  // phones and messengers
  const mobiles = [], others = [];
  let msg = '';
  let phoneCountry = '';
  lines.forEach(function (l) {
    const ll = l.toLowerCase();
    const messenger = (ll.match(/\b(whatsapp|wechat|we chat|line id|line|kakao(?:talk)?|telegram|viber|skype)\b/) || [])[1];
    const nums = (l.match(/\+?\(?\d[\d\s().\/-]{5,}\d/g) || []).filter(function (n) {
      const d = n.replace(/\D/g, '');
      return d.length >= 7 && d.length <= 15 && !/^\d{4}[-\/.]\d{2}[-\/.]\d{2}$/.test(n.trim());
    });
    if (messenger && !msg) {
      const id = nums[0] || (l.split(/[:：]/)[1] || '').trim();
      if (id) msg = messenger.replace(/^\w/, function (c) { return c.toUpperCase(); }).replace('Whatsapp', 'WhatsApp').replace('Wechat', 'WeChat') + ' ' + id.trim();
    }
    if (!nums.length || /\bfax\b|\bf[:.]\s*\+?\d/i.test(ll) && !/\b(tel|mob|phone|m[:.])/i.test(ll)) return;
    nums.forEach(function (n) {
      let p = n.trim().replace(/^00/, '+').replace(/\(0\)\s*/g, '').replace(/\s+/g, ' ');
      if (!phoneCountry && /^\+/.test(p)) {
        const digits = p.replace(/\D/g, '');
        for (let i = 0; i < PHONE_CODES.length; i++) if (digits.indexOf(PHONE_CODES[i][0]) === 0) { phoneCountry = PHONE_CODES[i][1]; break; }
      }
      if (/\b(mob|mobile|cell|gsm|port|portable|handy|hp|cel|m)\b\s*[:.]?/i.test(ll) || messenger === 'whatsapp') mobiles.push(p); else others.push(p);
    });
  });
  const phones = mobiles.concat(others).filter(function (p, i, a) { return a.indexOf(p) === i; }).slice(0, 3);

  // country
  let country = '';
  for (let i = 0; i < COUNTRY_WORDS.length && !country; i++) {
    if (new RegExp('(^|[^\\p{L}])' + COUNTRY_WORDS[i][0] + '($|[^\\p{L}])', 'iu').test(lower)) country = COUNTRY_WORDS[i][1];
  }
  if (!country) country = phoneCountry;
  if (!country && website) {
    const tld = website.split('/')[0].split('.').pop();
    country = TLD_COUNTRY[tld] || '';
  }

  // address lines → city + notes
  const addr = lines.filter(function (l) { return ADDRESS_WORDS.test(l) || /\b(?:[A-Z]{1,2}-)?\d{4,5}\s+\p{Lu}\p{L}+/u.test(l); })
    .filter(function (l) { return l.indexOf('@') < 0 && !/\b(tel|phone|mob|fax)\b/i.test(l); });
  let city = '';
  for (let i = 0; i < lines.length && !city; i++) {
    const m = lines[i].match(/\b(?:[A-Z]{1,2}-)?\d{4,5}(?:\s?[A-Z]{2})?\s+(\p{Lu}[\p{L}'’.\- ]{1,40})/u);
    if (m && lines[i].indexOf('@') < 0 && !/\b(tel|phone|mob|fax)\b/i.test(lines[i])) city = m[1].split(/[,–|]/)[0].replace(/\b(cedex|france|germany|deutschland|italy|italia|spain|españa|netherlands|belgium|uae)\b.*$/i, '').trim();
  }
  if (!city) {
    for (let i = 0; i < KNOWN_CITIES.length && !city; i++) {
      if (new RegExp('(^|[^\\p{L}])' + KNOWN_CITIES[i].replace('.', '\\.') + '($|[^\\p{L}])', 'iu').test(all)) city = KNOWN_CITIES[i];
    }
  }
  city = city.replace(/\s+\d.*$/, '').replace(/[.\-\s]+$/, '');
  if (city.length > 30) city = '';

  // classify lines
  const isContactLine = function (l) { return l.indexOf('@') >= 0 || /\bwww\.|https?:/i.test(l) || (l.replace(/\D/g, '').length >= 7); };
  const titleIdx = [], companyScore = [];
  lines.forEach(function (l, i) {
    if (!isContactLine(l) && TITLE_WORDS.test(l) && l.length <= 70) titleIdx.push(i);
    let s = 0;
    if (COMPANY_LEGAL.test(l)) s += 3; else if (COMPANY_HINT.test(l)) s += 2;
    const squash = l.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (domainLabel && domainLabel.length >= 3 && squash.length >= 3 && (squash.indexOf(domainLabel.replace(/[^a-z0-9]/g, '')) >= 0 || domainLabel.replace(/[^a-z0-9]/g, '').indexOf(squash) >= 0)) s += 3;
    if (/^[^a-z]*$/.test(l) && /[A-Z]{2}/.test(l) && l.split(' ').length <= 6) s += 1;
    if (/\d/.test(l)) s -= 2;
    if (isContactLine(l)) s -= 6;
    if (TITLE_WORDS.test(l) && !COMPANY_LEGAL.test(l)) s -= 3;
    if (ADDRESS_WORDS.test(l)) s -= 3;
    if (l.length > 50) s -= 2;
    companyScore.push(s);
  });
  const looksName = function (l) {
    if (isContactLine(l) || /\d/.test(l) || l.length > 40 || COMPANY_WORDS.test(l) || ADDRESS_WORDS.test(l)) return false;
    if (/^[가-힣]{2,4}$/.test(l.replace(/\s/g, ''))) return true;
    const w = l.split(' ');
    if (w.length < 2 || w.length > 4) return false;
    return w.every(function (x) { return /^(\p{Lu}[\p{L}'’\-]*\.?|\p{Lu}\.)$/u.test(x) || /^(de|da|del|van|von|der|di|la|le|al|el|bin|ben)$/i.test(x); });
  };

  const nameAt = function (i) { return i >= 0 && i < lines.length && looksName(lines[i]) && companyScore[i] < 3 && titleIdx.indexOf(i) < 0 ? lines[i] : ''; };
  // prefer a line with a rank word (manager, director …), then one that sits next to a person's name
  const RANK = /\b(manager|director|directeur|directrice|direttore|head|chief|ceo|cfo|coo|founder|owner|president|chairman|buyer|acheteu(?:r|se)|officer|responsable|gérant|gerant|geschäftsführer|leiter\w*|gerente|coordinator|specialist|executive|partner|vp|supervisor)\b/i;
  let ti, tiScore = -1;
  titleIdx.forEach(function (i) {
    const sc = (RANK.test(lines[i]) ? 2 : 0) + (nameAt(i - 1) || nameAt(i + 1) ? 1 : 0);
    if (sc > tiScore) { tiScore = sc; ti = i; }
  });
  let title = ti === undefined ? '' : lines[ti];
  let name = ti === undefined ? '' : (nameAt(ti - 1) || nameAt(ti + 1));
  if (!name && email) {
    const local = email.split('@')[0].toLowerCase().split(/[._-]/).filter(function (x) { return x.length >= 3; });
    for (let i = 0; i < lines.length && !name; i++) if (nameAt(i) && local.some(function (t) { return lines[i].toLowerCase().indexOf(t) >= 0; })) name = lines[i];
  }
  if (!name) for (let i = 0; i < lines.length && !name; i++) name = nameAt(i);
  if (name && name === name.toUpperCase() && /[A-Z]/.test(name)) name = titleCase_(name);

  let company = '';
  let best = 1;
  lines.forEach(function (l, i) { if (companyScore[i] > best && l !== name && i !== ti) { best = companyScore[i]; company = l; } });
  if (!company && domainLabel) company = titleCase_(domainLabel.replace(/[-_]+/g, ' '));

  let bizHint = '';
  for (let i = 0; i < BIZ_HINTS.length && !bizHint; i++) if (BIZ_HINTS[i][0].test(all)) bizHint = BIZ_HINTS[i][1];

  const notes = addr.length ? '주소: ' + addr.slice(0, 2).join(', ') : '';
  const card = {
    company: company, country: country, city: city, website: website, bizHint: bizHint, notes: notes, error: '',
    contacts: [{name: name, title: title, email: email, phone: phones.join(' / '), msg: msg}]
  };
  if (!company && !name && !email && !phones.length) card.error = '명함 내용을 알아보지 못했습니다';
  return card;
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
  const ss = ss_();
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
    .addItem('초기 설정 · 접속 코드 반영', 'setup')
    .addToUi();
}

/**
 * 처음 한 번 실행: 탭 생성, SIAL Paris 2026 등록, 사진 폴더 생성, 10분 주기 새로고침 등록, 접속 코드 생성.
 * 접속 코드를 바꾸려면 '시작하기' 탭의 접속 코드 칸을 고친 뒤 다시 실행하세요.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss = SpreadsheetApp.getActive();
  if (!ss && props.getProperty('SHEET_ID')) {
    try { ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID')); } catch (e) { ss = null; }
  }
  if (!ss) ss = SpreadsheetApp.create('락토코리아 바이어 데스크');
  props.setProperty('SHEET_ID', ss.getId());

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

  // team access code: keep the current one, take a new one typed into the start sheet, or make one
  const start = ss.getSheetByName(START_SHEET) || ss.insertSheet(START_SHEET, 0);
  let code = props.getProperty('ACCESS_CODE') || '';
  const typed = String(start.getRange('B4').getValue() || '').trim();
  if (typed.length >= 4 && typed !== code) code = typed;
  if (!code) code = 'lacto-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  props.setProperty('ACCESS_CODE', code);

  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (!/\/exec$/.test(url)) url = '';
  start.clearContents();
  start.getRange(1, 1, 12, 2).setValues([
    ['락토코리아 바이어 데스크 · 시작하기', ''],
    ['', ''],
    ['사이트', SITE_URL],
    ['접속 코드', cell_(code)],
    ['서버 주소 (웹 앱 URL)', url || '배포 → 새 배포 → 웹 앱으로 배포한 뒤 나오는 …/exec 주소'],
    ['', ''],
    ['처음 설정 순서', '1) Apps Script에서 setup 실행  2) 배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자)  3) 사이트에서 서버 주소·접속 코드·이름 입력'],
    ['접속 코드 바꾸기', '위 접속 코드 칸을 고친 뒤 메뉴 바이어 데스크 → 초기 설정 · 접속 코드 반영'],
    ['데이터 탭', 'shows / buyers / meetings / followups 탭은 사이트가 쓰는 원본이라 직접 고치지 마세요'],
    ['사람용 표', '바이어 리스트 탭 (10분마다 자동 새로고침)'],
    ['사진 폴더', '내 드라이브 → ' + PHOTO_FOLDER_NAME],
    ['명함 인식', '구글 드라이브 글자 인식(OCR) 사용 · 별도 키나 비용 없음']
  ]);
  start.getRange('A1').setFontWeight('bold').setFontSize(14);
  start.getRange('A3:A12').setFontWeight('bold');
  start.getRange('B4').setFontWeight('bold').setFontSize(13);
  start.setColumnWidth(1, 170);
  start.setColumnWidth(2, 640);

  Logger.log('시트: ' + ss.getUrl());
  Logger.log('접속 코드: ' + code);
  Logger.log('서버 주소: ' + (url || '아직 배포 전입니다 — 배포 → 새 배포 → 웹 앱'));
}
