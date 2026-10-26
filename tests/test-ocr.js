const assert = require('assert');
const {makeRuntime} = require('./gas-stub');
const rt = makeRuntime({props: {}});
const P = rt.api.parseCardText_;
const show = (label, c) => console.log(label, JSON.stringify({co: c.company, ctry: c.country, city: c.city, web: c.website, biz: c.bizHint, ...c.contacts[0], notes: c.notes, err: c.error}));

const fr = P(`MAISON EXEMPLE
Épicerie fine & Import
Jean-Marc Dupuis
Responsable Achats
12 Rue de l'Exemple
75008 Paris, France
Tél : +33 (0)1 23 45 67 89
Mob : +33 6 12 34 56 78
jm.dupuis@maison-exemple.fr
www.maison-exemple.fr`);
show('FR', fr);
assert.strictEqual(fr.company, 'MAISON EXEMPLE'); assert.strictEqual(fr.contacts[0].name, 'Jean-Marc Dupuis');
assert.strictEqual(fr.contacts[0].title, 'Responsable Achats'); assert.strictEqual(fr.country, 'France'); assert.strictEqual(fr.city, 'Paris');
assert.strictEqual(fr.website, 'www.maison-exemple.fr'); assert.strictEqual(fr.contacts[0].email, 'jm.dupuis@maison-exemple.fr');
assert.strictEqual(fr.contacts[0].phone.split(' / ')[0], '+33 6 12 34 56 78');

const de = P(`Beispiel Feinkost GmbH
Dr. Anna Muster
Head of Purchasing
Musterstraße 5
D-20095 Hamburg
Germany
T +49 40 1234567
M +49 170 1234567
a.muster@beispiel-feinkost.de`);
show('DE', de);
assert.strictEqual(de.company, 'Beispiel Feinkost GmbH'); assert.strictEqual(de.contacts[0].name, 'Dr. Anna Muster');
assert.strictEqual(de.city, 'Hamburg'); assert.strictEqual(de.country, 'Germany'); assert.strictEqual(de.website, 'beispiel-feinkost.de');
assert.strictEqual(de.contacts[0].phone.split(' / ')[0], '+49 170 1234567');

const ae = P(`GULF EXAMPLE TRADING LLC
Omar Example
Purchasing Manager
P.O. Box 12345, Dubai, U.A.E.
Tel: +971 4 123 4567
Mobile/WhatsApp: +971 50 123 4567
omar@gulfexample.ae
www.gulfexample.ae`);
show('AE', ae);
assert.strictEqual(ae.company, 'GULF EXAMPLE TRADING LLC'); assert.strictEqual(ae.contacts[0].name, 'Omar Example');
assert.strictEqual(ae.country, 'United Arab Emirates'); assert.strictEqual(ae.city, 'Dubai');
assert(/^WhatsApp \+971 50 123 4567$/.test(ae.contacts[0].msg), 'msg'); assert.strictEqual(ae.contacts[0].phone.split(' / ')[0], '+971 50 123 4567');

const es = P(`CARLOS EJEMPLO
Director Comercial
Distribuciones Ejemplo S.L.
Calle Mayor 10, 28013 Madrid
+34 600 123 456
carlos.ejemplo@gmail.com`);
show('ES', es);
assert.strictEqual(es.company, 'Distribuciones Ejemplo S.L.'); assert.strictEqual(es.contacts[0].name, 'Carlos Ejemplo');
assert.strictEqual(es.country, 'Spain'); assert.strictEqual(es.city, 'Madrid'); assert.strictEqual(es.website, ''); assert.strictEqual(es.bizHint, '유통사');

const nl = P(`Voorbeeld Foods B.V.
Sales & Export
Pieter van Dijk
Export Manager
Voorbeeldstraat 1
1012 AB Amsterdam
The Netherlands
+31 20 123 4567
pieter@voorbeeldfoods.nl`);
show('NL', nl);
assert.strictEqual(nl.company, 'Voorbeeld Foods B.V.'); assert.strictEqual(nl.contacts[0].name, 'Pieter van Dijk'); assert.strictEqual(nl.city, 'Amsterdam'); assert.strictEqual(nl.contacts[0].title, 'Export Manager');

const none = P('  \n ');
assert(none.error, 'empty error');
const junk = P('~~~\n###');
assert(junk.error, 'junk error');

// full ocr action path: Drive upload + export + trash
const rt2 = makeRuntime({props: {ACCESS_CODE: 'c'}, ocrText: () => 'GULF EXAMPLE TRADING LLC\nOmar Example\nomar@gulfexample.ae'});
const r = rt2.post({action: 'ocr', code: 'c', images: [{media_type: 'image/jpeg', data: Buffer.from('jpegbytes').toString('base64')}]});
assert(r.ok && r.card.company === 'GULF EXAMPLE TRADING LLC', JSON.stringify(r));
const up = rt2.fetchLog.find(x => /upload\/drive/.test(x.url));
assert(/multipart\/related; boundary=/.test(up.o.contentType) && up.o.headers.Authorization === 'Bearer token');
assert(Buffer.from(up.o.payload).toString().includes('application/vnd.google-apps.document'));
assert(Buffer.from(up.o.payload).toString().includes('jpegbytes'), 'image bytes in multipart body');
assert.strictEqual(rt2.post({action: 'ocr', code: 'c', images: [{media_type: 'image/webp', data: 'AAAA'}]}).error, 'image_rejected');
const rt3 = makeRuntime({props: {ACCESS_CODE: 'c'}, ocrStatus: 403});
assert.strictEqual(rt3.post({action: 'ocr', code: 'c', images: [{media_type: 'image/png', data: 'AAAA'}]}).error, 'ocr_failed');
const ping = rt2.post({action: 'ping', code: 'c'});
assert(ping.ok && ping.ocr === true && ping.photos === true);
console.log('OCR parser + Drive OCR path tests passed');
