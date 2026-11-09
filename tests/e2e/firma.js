/* Firma electrónica del dictamen y del cierre de una NC.
 * Uso:  node tests/e2e/firma.js [carpeta-para-capturas]
 *
 * Caso (en la demo): se dictamina un lote, se firma con la clave (primero mal, después bien),
 * el PDF lleva la firma; Coordinación lo reabre y la firma deja de valer; sin señal no se firma.
 * Después se cierra y se firma una NC, y verificar la eficacia no invalida la firma del cierre.
 */
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert/strict');
const { servidor } = require('../../tools/servidor');

const CAPTURAS = process.argv[2] || null;

(async () => {
  const srv = servidor().listen(0);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('dialog', d => d.accept());
  const paso = t => console.log('✓ ' + t);
  const foto = async n => { if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, n + '.png'), fullPage: true }); };
  const subido = () => page.waitForFunction(() => Store.pendientes().length === 0, null, { timeout: 15000 });
  const lote = n => page.evaluate(x => Store.lotes().find(l => l.datos.cab.lote === x), n);

  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.click('button[data-act="demo"]');
  await page.click('button[type=submit]:has-text("Empezar")');

  // ── Las listas marcan lo que falta firmar (en la demo: el aprobado parcial) ──
  await page.click('[data-tab="historial"]');
  assert.match(await page.textContent('.lote-item:has-text("L-2611-009")'), /sin firmar/);
  assert.doesNotMatch(await page.textContent('.lote-item:has-text("L-2611-012")'), /sin firmar/);
  await page.click('.lote-item:has-text("L-2611-012")');
  assert.match(await page.textContent('#firma-bloque'), /Firmado electrónicamente por Laura Gómez \(Inspector de Calidad\).*Dictamen: APROBADO.*Código de verificación/);
  paso('lo firmado muestra quién, cuándo, qué y su código; lo que falta se marca en la lista');

  // ── Dictaminar y firmar ──
  await page.click('[data-act="inicio"]');
  await page.click('[data-tab="activos"]');
  await page.click('.lote-item:has-text("L-2611-014")');
  for (const i of [3, 4, 5]) await page.click(`#cf-${i} >> text=✓ Todo OK`);
  await page.click('.dict.ok');
  await page.waitForSelector('#firma-bloque >> text=Pendiente de firma');
  await subido();
  await page.waitForSelector('#firma-bloque [name=clave]');
  assert.match(await page.textContent('#firma-bloque'), /Firmar el dictamen como Visitante \(Administración\)/);
  await page.fill('#firma-bloque [name=clave]', 'equivocada');
  await page.click('#firma-bloque >> text=✍ Firmar');
  await page.waitForSelector('#aviso.visible >> text=Clave incorrecta');
  assert.equal(await page.inputValue('#firma-bloque [name=clave]'), '', 'la clave equivocada se borra');
  await foto('firma-01-pedir-clave');
  await page.fill('#firma-bloque [name=clave]', 'demo-qualityos');
  await page.click('#firma-bloque >> text=✍ Firmar');
  await page.waitForSelector('.firma-ok');
  assert.match(await page.textContent('.firma-ok'), /Firmado electrónicamente por Visitante \(Administración\) · \d\d\/\d\d\/\d{4} \d\d:\d\d · Dictamen: APROBADO · Código de verificación [0-9A-F]{4}-[0-9A-F]{4}/);
  await foto('firma-02-firmado');
  let l = await lote('L-2611-014');
  assert.ok(l.firma && !l.pendiente);
  const pdf = await page.evaluate(() => Imprimir.html(Store.lotes().find(x => x.datos.cab.lote === 'L-2611-014'), Store.perfil().config, 'X'));
  assert.match(pdf, /Firma electrónica<\/th><td colspan="5">Firmado electrónicamente por Visitante/);
  paso('dictaminar, esperar a que suba y firmar con la clave (la equivocada no firma); el PDF lleva la firma');

  // ── Reabrir: la firma deja de valer ──
  await page.click('button:has-text("Reabrir lote")');
  await subido();
  l = await lote('L-2611-014');
  assert.equal(l.firma, null, 'cambiar lo firmado deja la firma sin vigencia');
  await page.click('.dict.ok');
  await subido();
  await page.waitForSelector('#firma-bloque [name=clave]');
  const pdf2 = await page.evaluate(() => Imprimir.html(Store.lotes().find(x => x.datos.cab.lote === 'L-2611-014'), Store.perfil().config, 'X'));
  assert.match(pdf2, /PENDIENTE DE FIRMA/);
  paso('al reabrir, la firma deja de valer y el PDF dice pendiente de firma');

  // ── Sin señal no se firma ──
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForSelector('#firma-bloque >> text=Sin señal');
  assert.equal(await page.locator('#firma-bloque [name=clave]').count(), 0);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('#firma-bloque [name=clave]');
  paso('sin señal no pide la clave; vuelve la conexión y se puede firmar');

  // ── NC: firmar el cierre; la eficacia no lo invalida ──
  await page.click('[data-act="inicio"]');
  await page.click('[data-tab="nc"]');
  await page.click('.nc-item:has-text("Trazabilidad / QR")');
  await page.click('button:has-text("Cerrar NC")');
  await page.waitForSelector('#firma-bloque >> text=Pendiente de firma');
  await subido();
  await page.waitForSelector('#firma-bloque [name=clave]');
  assert.match(await page.textContent('#firma-bloque'), /Firmar el cierre como Visitante/);
  await page.fill('#firma-bloque [name=clave]', 'demo-qualityos');
  await page.click('#firma-bloque >> text=✍ Firmar');
  await page.waitForSelector('.firma-ok >> text=Cierre de la NC NC-2026-004');
  await page.selectOption('[name="eficacia"]', 'eficaz');
  await page.click('button[type=submit]:has-text("Guardar")');
  await subido();
  const nc = await page.evaluate(() => Store.ncs().find(n => n.numero === 'NC-2026-004'));
  assert.equal(nc.datos.eficacia, 'eficaz');
  assert.ok(nc.firma, 'verificar la eficacia no invalida la firma del cierre');
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('button:has-text("Imprimir registro")');
  assert.match(await page.textContent('#imprimir'), /Firma del cierre[\s\S]*✍ Visitante/);
  paso('NC: firmar el cierre, la eficacia posterior no lo invalida, el registro impreso lleva la firma');

  assert.deepEqual(errores, []);
  console.log('\nFirma: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
