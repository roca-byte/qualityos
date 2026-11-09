/* No conformidades: el registro que se carga todos los días y se entrega por mes.
 * Uso:  node tests/e2e/nc.js [carpeta-para-capturas]
 *
 * Caso: en la demo (con el reloj fijo en el 09/11/2026) se crean las NC desde los desvíos de un
 * lote, se completa y se cierra una, se carga otra a mano, se crea otra sin señal (recibe número
 * al volver la conexión), se configuran los tipos de desvío, se importa el respaldo de la app
 * individual y se imprime el registro del mes.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const { servidor } = require('../../tools/servidor');

const CAPTURAS = process.argv[2] || null;

(async () => {
  const srv = servidor().listen(0);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.clock.install({ time: new Date(2026, 10, 9, 10, 0, 0) });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  const dialogos = [];
  page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
  const paso = t => console.log('✓ ' + t);
  const foto = async n => { if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, n + '.png'), fullPage: true }); };
  const tarjetas = () => page.locator('.nc-item').count();
  // Espera a que la tablet suba todo (la sincronización corre a los 3 s de cada cambio).
  const sincronizado = async () => { await page.clock.runFor(4000); await page.waitForFunction(() => Store.pendientes().length === 0); };

  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.click('button[data-act="demo"]');
  await page.click('button[type=submit]:has-text("Empezar")');
  await page.waitForSelector('.tabs');
  assert.match(await page.textContent('[data-tab="nc"]'), /NC · 3 abiertas/);
  paso('la pestaña NC muestra cuántas hay abiertas');

  await page.click('[data-tab="nc"]');
  assert.equal(await page.inputValue('[data-act-change="nc-filtro"]'), '2026-11', 'arranca en el mes actual');
  assert.equal(await tarjetas(), 3);
  assert.match(await page.textContent('.nc-item >> nth=0'), /NC-2026-005/, 'la más nueva arriba');
  await foto('nc-01-mes');
  await page.selectOption('[data-act-change="nc-filtro"]', 'abiertas');
  assert.equal(await tarjetas(), 3);
  assert.match(await page.textContent('.nc-kpis'), /1\s*plazo vencido/, 'la de octubre tiene el plazo vencido');
  await page.selectOption('[data-act-change="nc-filtro"]', '2026-10');
  assert.equal(await tarjetas(), 2);
  paso('vista por mes y de abiertas de todos los meses, con indicadores');

  // ── Crear NC desde los desvíos de un lote ──
  await page.click('[data-tab="activos"]');
  await page.click('.lote-item:has-text("L-2611-014")');
  await page.click('summary:has-text("Desvíos detectados")');
  await page.click('button:has-text("Crear 2 NC desde los desvíos")');
  assert.match(dialogos.pop(), /Se van a crear 2 NC/);
  await page.waitForSelector('.nc-lote >> text=NC de este lote');
  assert.equal(await page.locator('.nc-lote button[data-act="abrir-nc"]').count(), 2);
  assert.equal(await page.locator('text=desde los desvíos').count(), 0, 'no se pueden crear dos veces');
  await foto('nc-02-desde-lote');
  await sincronizado();
  await page.click('[data-act="inicio"]');
  await page.click('[data-tab="nc"]');
  await page.selectOption('[data-act-change="nc-filtro"]', '2026-11');   // el filtro quedó en octubre
  const numeros = await page.locator('.nc-item .li-num').allTextContents();
  assert.ok(numeros.includes('NC-2026-006') && numeros.includes('NC-2026-007'), 'el servidor numeró las nuevas: ' + numeros);
  const ncs = await page.evaluate(() => Store.ncs().filter(n => n.datos.lote === 'L-2611-014').map(n => n.datos));
  const peso = ncs.find(d => d.desc.startsWith('Peso por pico'));
  const pack = ncs.find(d => d.desc.startsWith('Packaging'));
  assert.equal(peso.estado, 'abierta'); assert.equal(peso.plazo, '2026-11-16');
  assert.equal(pack.estado, 'cerrada', 'lo reprocesado en el momento entra cerrado');
  paso('crear NC desde el lote: una por control con desvío, numeradas por el servidor');

  // ── Completar y cerrar la NC de peso ──
  await page.click('.nc-item:has-text("Peso por pico")');
  await page.selectOption('[name="tipo"]', 'Peso / volumen fuera de rango');
  assert.equal(await page.inputValue('[name="sev"]'), 'Leve', 'el tipo sugiere la gravedad');
  await page.fill('[name="ac"]', 'Se recalibró el pico 2 y se re-pesó el pallet');
  await page.fill('[name="resp"]', 'Laura Gómez');
  await page.selectOption('[name="estado"]', 'en_proceso');
  await foto('nc-03-ficha');
  await page.click('button[type=submit]:has-text("Guardar")');
  await page.waitForSelector('.nc-item:has-text("Peso / volumen") >> text=En proceso');
  await page.click('.nc-item:has-text("Peso / volumen")');
  await page.click('button:has-text("Cerrar NC")');
  await page.waitForSelector('text=Verificación de eficacia');
  assert.match(await page.textContent('.info'), /Cerrada el 09\/11\/2026 por Visitante \(Administración\)/);
  await page.selectOption('[name="eficacia"]', 'eficaz');
  await page.click('button[type=submit]:has-text("Guardar")');
  await page.waitForSelector('.nc-item:has-text("Peso / volumen") >> text=Cerrada');
  const cerrada = await page.evaluate(() => Store.ncs().find(n => n.datos.tipo === 'Peso / volumen fuera de rango').datos);
  assert.equal(cerrada.eficacia, 'eficaz'); assert.equal(cerrada.cierre, '2026-11-09');
  paso('completar, cerrar y verificar la eficacia');

  // ── NC a mano (un reclamo) ──
  await page.click('button:has-text("+ Nueva NC")');
  assert.equal(await page.inputValue('[name="fecha"]'), '2026-11-09', 'la NC nueva trae la fecha de hoy');
  await page.click('button[type=submit]:has-text("Crear NC")');
  await page.waitForSelector('#aviso.visible >> text=Elegí el tipo de desvío');
  await page.selectOption('[name="deteccion"]', 'Reclamo de cliente');
  await page.fill('[name="desc"]', 'Botellas con <etiqueta> & "manchas"');
  await page.fill('[name="cliente"]', 'almacén central');
  await page.click('button[type=submit]:has-text("Crear NC")');
  await page.waitForSelector('.nc-item:has-text("<etiqueta>")');
  assert.equal(await page.evaluate(() => Store.ncs().find(n => n.datos.desc.includes('etiqueta')).datos.cliente), 'Almacén Central');
  paso('NC a mano: valida lo mínimo y escapa el texto');

  // ── Sin señal: se crea igual y recibe número al volver la conexión ──
  await sincronizado();
  await ctx.setOffline(true);
  await page.click('button:has-text("+ Nueva NC")');
  await page.selectOption('[name="tipo"]', 'Envase dañado');
  await page.click('button[type=submit]:has-text("Crear NC")');
  await page.waitForSelector('.nc-item:has-text("Envase dañado") >> text=NC nueva');
  assert.match(await page.textContent('#nube'), /Sin señal · 1 por subir/);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('.nc-item:has-text("Envase dañado") >> text=NC-2026-009');
  paso('sin señal se carga igual; al volver la conexión sube y recibe número');

  // ── ⚙ Tipos de desvío de la empresa ──
  await page.click('[data-act=config]');
  await page.waitForSelector('#config-nc');
  await page.click('button:has-text("+ Tipo de desvío")');
  await page.locator('[name="tipo-nombre"]').last().fill('Tapa floja');
  await page.locator('[name="tipo-sev"]').last().selectOption('Crítico');
  await page.fill('[name="ncVersion"]', '03');
  await page.click('[data-form="config-nc"] button[type=submit]');
  await page.waitForSelector('#aviso.visible >> text=configuración guardada');
  const cfg = await page.evaluate(() => Store.perfil().config);
  assert.deepEqual(cfg.tiposNc.at(-1), { nombre: 'Tapa floja', sev: 'Crítico' });
  assert.equal(cfg.ncVersion, '03');
  assert.equal(cfg.plantillas.length, 2, 'guardar los tipos no toca las plantillas');
  paso('⚙: tipos de desvío y codificación del registro');

  // ── Importar el respaldo de la app individual ──
  const archivo = path.join(os.tmpdir(), 'backup_registro_nc_prueba.json');
  fs.writeFileSync(archivo, JSON.stringify({ app: 'registro_nc', version: 2, filas: [
    { id: 'vieja-1', fecha: '2026-09-15', lote: 'A-9', prod: 'Herbicida 20 L', tipo: 'Inducción débil', sev: 'Crítico', est: 'Finalizado', cierre: '2026-09-17', eficacia: 'Eficaz' },
    { id: 'vieja-2', fecha: '2026-11-03', lote: 'A-10', desc: 'Tapas cruzadas', est: 'Pendiente' },
    { id: 'vieja-3', lote: 'sin fecha', est: 'Pendiente' }
  ] }));
  await page.click('[data-act="inicio"]');
  await page.click('[data-tab="nc"]');
  await page.setInputFiles('[data-act-change="importar-nc"]', archivo);
  await page.waitForSelector('#aviso.visible >> text=2 NC importadas');
  assert.match(dialogos.pop(), /importar 2 NC \(1 se saltean/);
  await page.setInputFiles('[data-act-change="importar-nc"]', archivo);
  await page.waitForSelector('#aviso.visible >> text=No hay NC nuevas');
  await page.selectOption('[data-act-change="nc-filtro"]', '2026-09');
  assert.equal(await tarjetas(), 1, 'la NC de septiembre aparece en su mes');
  paso('importar del registro individual sin repetir');

  // ── Registro del mes para imprimir ──
  await page.selectOption('[data-act-change="nc-filtro"]', '2026-11');
  await foto('nc-04-registro');
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('button:has-text("Imprimir registro")');
  const informe = await page.textContent('#imprimir');
  assert.match(informe, /Registro de No Conformidades/);
  assert.match(informe, /Noviembre 2026/);
  assert.match(informe, /Versión: 03/);
  assert.match(informe, /NC-2026-003[\s\S]*NC-2026-006/, 'ordenadas por fecha');
  assert.match(informe, /Eficaz/);
  assert.match(informe, /Inspector de Calidad/);
  assert.ok(!(await page.innerHTML('#imprimir')).includes('<etiqueta>'), 'el informe escapa el texto');
  if (CAPTURAS) {
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(CAPTURAS, 'registro-nc.pdf'), format: 'A4', landscape: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
  }
  paso('imprimir el registro del mes');

  assert.deepEqual(errores, []);
  console.log('\nNo conformidades: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
