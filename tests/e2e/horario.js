/* Control en línea por horario ("cada 2 h desde el último control").
 * Uso:  node tests/e2e/horario.js [carpeta-para-capturas]
 *
 * Caso (en la demo, con el reloj del navegador fijo y adelantado a mano): un lote de yogur (su
 * plantilla de alimentos es cada 2 h) muestra cuándo toca el próximo control, avisa solo cuando
 * se atrasa (en el lote y en la lista), y al hacer el control nuevo el aviso se va. Después se
 * pasa una plantilla de por unidad a por horario en el editor.
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
  await ctx.clock.install({ time: new Date(2026, 10, 9, 8, 0, 0) });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('dialog', d => d.accept());
  const paso = t => console.log('✓ ' + t);
  const foto = async n => { if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, n + '.png'), fullPage: true }); };
  const aviso = () => page.textContent('#prox-control');

  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.click('button[data-act="demo"]');
  await page.click('button[type=submit]:has-text("Empezar")');

  // ── Lote de un producto cuya plantilla es por horario ──
  await page.click('text=+ Nuevo lote');
  await page.fill('[name=prod]', 'Yogur frutilla 190 g');
  await page.press('[name=prod]', 'Enter');
  await page.waitForSelector('text=Completado desde el catálogo');
  await page.fill('[name=lote]', 'Y-2611-050');
  await page.selectOption('[name="dato-turno"]', 'Mañana');
  await page.click('text=Crear lote');
  await page.waitForSelector('#prox-control');
  assert.match(await page.textContent('section:has(#prox-control) h3'), /Control en línea.*cada 2 h/);
  assert.match(await aviso(), /Hacé el primer control/);
  await page.click('#cl-0 [data-act="hora"]');
  await page.waitForSelector('#prox-control >> text=Próximo control: 10:00');
  paso('el lote dice cuándo toca el próximo control (cada 2 h desde el último)');

  // ── Pasan 2 h: el aviso aparece solo ──
  await page.clock.fastForward('02:01:00');
  await page.waitForSelector('#prox-control >> text=Control atrasado');
  assert.match(await aviso(), /tocaba a las 10:00/);
  await foto('horario-01-atrasado');
  await page.click('[data-act="inicio"]');
  await page.waitForSelector('.lote-item:has-text("Y-2611-050") >> text=control atrasado');
  assert.equal(await page.locator('.lote-item:has-text("L-2611-014") >> text=control atrasado').count(), 0,
    'un lote por unidad no tiene aviso');
  await foto('horario-02-lista');
  paso('pasada la hora, el aviso de atrasado aparece solo en el lote y en la lista');

  // ── El control nuevo queda con su hora y el aviso se va ──
  await page.click('.lote-item:has-text("Y-2611-050")');
  await page.click('button[data-act="agregar-unidad"][data-sec="linea"]');
  assert.equal(await page.inputValue('#cl-1 [data-campo="hora"]'), '10:01', 'el control nuevo trae la hora actual');
  assert.match(await aviso(), /Próximo control: 12:01/);
  await page.fill('#cl-1 [data-campo="hora"]', '09:50');
  await page.waitForSelector('#prox-control >> text=Próximo control: 11:50');
  await page.click('[data-act="inicio"]');
  assert.equal(await page.locator('.lote-item:has-text("Y-2611-050") >> text=control atrasado').count(), 0);
  const pdf = await page.evaluate(() => Imprimir.html(Store.lotes().find(x => x.datos.cab.lote === 'Y-2611-050'), Store.perfil().config, 'X'));
  assert.match(pdf, /Control en línea · 2 muestras · cada 2 h/);
  paso('el control nuevo trae la hora; corregirla actualiza el próximo; el PDF dice la frecuencia');

  // ── Editor: pasar una plantilla a por horario ──
  await page.click('[data-act=config]');
  await page.click('.fila-plantilla:has-text("Envasado de líquidos") >> text=Editar');
  assert.equal(await page.inputValue('[name="p-frecuencia"]'), 'unidad');
  assert.equal(await page.locator('[name="p-cadaHoras"]').count(), 0);
  await page.selectOption('[name="p-frecuencia"]', 'horario');
  await page.waitForSelector('[name="p-cadaHoras"]');
  assert.equal(await page.inputValue('[name="p-cadaHoras"]'), '2', 'arranca en cada 2 h');
  await page.fill('[name="p-cadaHoras"]', '1,5');
  await page.click('button:has-text("Guardar plantilla")');
  await page.waitForSelector('#plantillas >> text=versión 04');
  const f = await page.evaluate(() => Store.perfil().config.plantillas.find(p => p.id === 'agro').frecuencia);
  assert.deepEqual(f, { modo: 'horario', cadaMin: 90 });
  const copia = await page.evaluate(() => Store.lotes().find(x => x.datos.cab.lote === 'L-2611-014').datos.plantilla.frecuencia);
  assert.equal(copia, undefined, 'el lote ya creado sigue por unidad (tiene su copia de la plantilla)');
  paso('editor: por unidad → por horario cada 1,5 h, con versión nueva; los lotes hechos no cambian');

  assert.deepEqual(errores, []);
  console.log('\nHorario: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
