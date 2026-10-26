// Drives index.html against Code.gs (via gas-stub) in Chromium. Needs Playwright: npm i -D playwright
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const {makeRuntime} = require('./gas-stub');
const OUT = path.join(__dirname, 'out') + '/';
fs.mkdirSync(OUT, {recursive: true});
const SITE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CARDS = path.join(__dirname, 'fixtures') + '/';
const rt = makeRuntime({props:{ACCESS_CODE:'lacto-test'}, ocrText: () => 'TEST CARD FOODS SARL\nMarie Exemple\nBuyer\n10 Rue Exemple\n69002 Lyon, France\nMob: +33 6 00 00 00 00\nmarie@testcardfoods.fr\nwww.testcardfoods.fr'});
rt.api.setup();
const fix = () => { const D = Date; const fixed = new D('2026-10-26T12:00:00+09:00').getTime(); window.Date = class extends D { constructor(...a){ super(...(a.length ? a : [fixed])); } static now(){ return fixed; } }; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({viewport:{width:1360,height:900}}); await ctx.addInitScript(fix);
  await ctx.route('https://script.google.com/**', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(rt.post(body))});
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.goto(SITE); await pg.waitForTimeout(300);
  await pg.screenshot({path: OUT + 'gh-login.png'});
  await pg.fill('#lg-api', 'https://script.google.com/macros/s/TEST/exec');
  await pg.fill('#lg-code', 'wrong'); await pg.fill('#lg-name', '테스터');
  await pg.click('#lg-go'); await pg.waitForTimeout(300);
  console.log('wrong code msg:', await pg.textContent('#lg-err'));
  await pg.fill('#lg-code', 'lacto-test'); await pg.click('#lg-go'); await pg.waitForTimeout(500);
  console.log('login hidden:', await pg.evaluate(() => document.getElementById('login').hidden));
  // single consultation with card OCR + a photo with the buyer
  await pg.click('#hdr-actions .btn-primary'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#fm-cz-file', [CARDS + 'card0.jpg']); await pg.waitForTimeout(800);
  console.log('ocr company:', await pg.inputValue('#fm-company'));
  await pg.setInputFiles('#fm-ph-file', [CARDS + 'card1.jpg']); await pg.waitForTimeout(500);
  const kinds = await pg.$$eval('.ph-kind', els => els.map(e => e.value));
  console.log('photo kinds in form:', kinds.join(','));
  await pg.fill('.ph[data-ph="p2"] .ph-cap', '부스에서 함께'); 
  await pg.evaluate(() => document.getElementById('fm-ph-fs').scrollIntoView());
  await pg.screenshot({path: OUT + 'gh-form-photos.png'});
  await pg.click('#m-save'); await pg.waitForTimeout(900);
  let ld = rt.post({action:'load', code:'lacto-test'});
  console.log('meeting photos saved:', JSON.stringify(ld.meetings[0].photos.map(p => [p.kind, p.caption, !!p.thumb])));
  await pg.waitForTimeout(400);
  await pg.screenshot({path: OUT + 'gh-drawer.png'});
  // lightbox
  await pg.click('.cardthumbs button'); await pg.waitForTimeout(400);
  console.log('lightbox caption:', await pg.textContent('#lightbox-cap'));
  await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(300);
  console.log('after next:', await pg.textContent('#lightbox-cap'));
  await pg.screenshot({path: OUT + 'gh-lightbox.png'});
  await pg.keyboard.press('Escape');
  // edit: remove one photo
  await pg.click('[data-act="edit-meeting"]'); await pg.waitForTimeout(500);
  console.log('edit form photos:', await pg.$$eval('.ph', els => els.length));
  await pg.click('.ph[data-ph="p1"] .ph-del'); await pg.waitForTimeout(100);
  await pg.click('#m-save'); await pg.waitForTimeout(900);
  ld = rt.post({action:'load', code:'lacto-test'});
  const trashed = [...rt.files.values()].filter(f => f.trashed).length;
  console.log('after edit photos:', ld.meetings[0].photos.length, 'trashed files:', trashed);
  await pg.click('[data-act="close-drawer"].icon-btn');
  // batch import
  await pg.click('#hdr-card'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#cb-file', [CARDS + 'card0.jpg', CARDS + 'card1.jpg']); await pg.waitForTimeout(1500);
  await pg.click('#m-save'); await pg.waitForTimeout(1500);
  ld = rt.post({action:'load', code:'lacto-test'});
  console.log('after batch buyers/meetings:', ld.buyers.length, ld.meetings.length, 'photos per meeting:', ld.meetings.map(m => (m.photos || []).length).join(','));
  rt.api.rebuildBuyerSheet();
  console.log('sheet rows:', rt.sheets.get('바이어 리스트').rows.length - 1);
  // mobile
  const m = await b.newContext({viewport:{width:390,height:844}, colorScheme:'dark'}); await m.addInitScript(fix);
  await m.route('https://script.google.com/**', async route => { const body = JSON.parse(route.request().postData() || '{}'); await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(rt.post(body))}); });
  const mp = await m.newPage(); mp.on('pageerror', e => errs.push('mobile: ' + e.message));
  await mp.goto(SITE); await mp.fill('#lg-api', 'https://script.google.com/macros/s/TEST/exec'); await mp.fill('#lg-code', 'lacto-test'); await mp.fill('#lg-name', '테스터'); await mp.click('#lg-go'); await mp.waitForTimeout(600);
  await mp.click('.badge'); await mp.waitForTimeout(300); await mp.click('.mrow'); await mp.waitForTimeout(600);
  await mp.screenshot({path: OUT + 'gh-mobile-drawer.png'});
  console.log('mobile scrollWidth', await mp.evaluate(() => document.documentElement.scrollWidth));
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
