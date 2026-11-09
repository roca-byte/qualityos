/* Plantillas de control: armar una propia en ⚙ y usarla en un lote.
 * Uso:  node tests/e2e/plantillas.js [carpeta-para-capturas]
 *
 * Caso: una planta de bebidas parte del ejemplo "Bebidas", lo ajusta (saca un ítem, agrega
 * una medición con tolerancia fija, marca un ítem del control final como no obligatorio),
 * crea un lote con esa plantilla y lo dictamina. Se verifica que el lote muestre SOLO lo de
 * su plantilla (nada de inducción ni peso por pico) y que el PDF también.
 * Corre en el modo demo (entra como Administración), así que no hace falta cuenta.
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
  const dialogos = [];
  page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
  const paso = t => console.log('✓ ' + t);
  const foto = async n => { if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, n + '.png'), fullPage: true }); };
  const item = (sec, i) => `.ed-item[data-sec="${sec}"][data-i="${i}"]`;

  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.click('button[data-act="demo"]');
  await page.click('button[type=submit]:has-text("Empezar")');
  await page.click('[data-act=config]');
  await page.waitForSelector('#plantillas');
  assert.match(await page.textContent('#plantillas'), /Envasado de líquidos[\s\S]*Envasado de alimentos/);
  paso('⚙ lista las plantillas de la empresa');

  // Nueva plantilla desde el ejemplo de bebidas
  await page.selectOption('#ejemplo-plantilla', 'bebidas');
  await page.click('button[data-act="nueva-plantilla"]');
  await page.waitForSelector('text=Nueva plantilla');
  assert.equal(await page.inputValue('[name="p-nombre"]'), 'Envasado de bebidas');
  await page.fill('[name="p-nombre"]', 'Jugos 1 L');
  // Sin código el navegador no deja guardar (campo obligatorio) y queda en el editor.
  await page.click('button:has-text("Guardar plantilla")');
  assert.ok(await page.evaluate(() => document.querySelector('[name="d-codigo"]').validity.valueMissing));
  assert.ok(await page.isVisible('text=Nueva plantilla'));
  await page.fill('[name="d-codigo"]', 'REG-01');
  await page.fill('[name="d-elaboro"]', 'Laura Gómez');
  await page.fill('[name="d-aprobo"]', 'Pablo Díaz');
  // Sacar °Brix (3er ítem del control en línea)
  assert.equal(await page.inputValue(item('linea', 2) + ' [name=nombre]'), '°Brix');
  await page.click(item('linea', 2) + ' [data-act="item-quitar"]');
  assert.equal(await page.locator('.ed-item[data-sec="linea"]').count(), 4);
  // Agregar una medición con tolerancia fija: pH entre 3 y 4
  await page.click('button[data-act="item-agregar"][data-sec="linea"]');
  const nuevo = item('linea', 4);
  await page.fill(nuevo + ' [name=nombre]', 'pH');
  await page.selectOption(nuevo + ' [name=tipo]', 'medicion');
  await page.waitForSelector(nuevo + ' [name=tolerancia]');
  assert.equal(await page.inputValue(item('linea', 4) + ' [name=nombre]'), 'pH', 'cambiar el tipo no borra lo escrito');
  await page.selectOption(nuevo + ' [name=tolerancia]', 'fija');
  await page.waitForSelector(nuevo + ' [name=min]');
  await page.fill(nuevo + ' [name=min]', '4');
  await page.fill(nuevo + ' [name=max]', '3');
  await page.check(nuevo + ' [name=semaforo]');
  // Subirlo al primer lugar
  for (let i = 4; i > 0; i--) await page.click(item('linea', i) + ' [data-act="item-mover"][data-d="-1"]');
  assert.equal(await page.inputValue(item('linea', 0) + ' [name=nombre]'), 'pH');
  // La etiqueta del control final no es obligatoria para dictaminar
  await page.uncheck(item('final', 1) + ' [name=obligatorio]');
  // Datos del lote: el ejemplo trae el Turno; se agrega la llenadora como lista obligatoria
  assert.equal(await page.inputValue(item('cabecera', 0) + ' [name=nombre]'), 'Turno');
  await page.click('button[data-act="item-agregar"][data-sec="cabecera"]');
  await page.fill(item('cabecera', 1) + ' [name=nombre]', 'Llenadora');
  await page.selectOption(item('cabecera', 1) + ' [name=tipo]', 'lista');
  await page.waitForSelector(item('cabecera', 1) + ' [name=opciones]');
  assert.equal(await page.inputValue(item('cabecera', 1) + ' [name=nombre]'), 'Llenadora', 'cambiar el tipo no borra lo escrito');
  await page.check(item('cabecera', 1) + ' [name=obligatorio]');
  await page.click('button:has-text("Guardar plantilla")');
  // Se avisa en el orden del formulario: primero los datos del lote, después los ítems.
  await page.waitForSelector('text="Llenadora": escribí las opciones de la lista');
  await page.fill(item('cabecera', 1) + ' [name=opciones]', 'Llenadora A, Llenadora B ,');
  await page.click('button:has-text("Guardar plantilla")');
  await page.waitForSelector('text=el mínimo es mayor que el máximo');
  await page.fill(item('linea', 0) + ' [name=min]', '3');
  await page.fill(item('linea', 0) + ' [name=max]', '4');
  await page.click('button:has-text("Guardar plantilla")');
  await page.waitForSelector('text=El código REG-01 ya lo usa la plantilla "Envasado de líquidos"');
  await page.fill('[name="d-codigo"]', 'REG-05');
  await foto('editor');
  await page.click('button:has-text("Guardar plantilla")');
  await page.waitForSelector('.fila-plantilla:has-text("Jugos 1 L") >> text=REG-05 · versión 00');
  paso('codificación: el código es obligatorio y no se puede repetir');
  await page.waitForSelector('#plantillas >> text=Jugos 1 L');
  paso('nueva plantilla desde un ejemplo: quitar, agregar, cambiar tipo, mover, validar y guardar');

  // Lote con la plantilla nueva
  await page.click('[data-act=inicio]');
  await page.click('text=+ Nuevo lote');
  await page.fill('input[name=prod]', 'Jugo naranja 1 L');
  await page.selectOption('select[name=plantilla]', { label: 'Jugos 1 L' });
  await page.waitForSelector('input[name="min-vol"]');
  assert.equal(await page.inputValue('input[name=prod]'), 'Jugo naranja 1 L', 'cambiar de plantilla conserva lo escrito');
  assert.equal(await page.locator('input[name="min-peso"]').count(), 0, 'no pide rangos de otra plantilla');
  await page.fill('input[name=lote]', 'J-0001');
  await page.fill('input[name="min-vol"]', '995');
  await page.fill('input[name="max-vol"]', '1010');
  await page.fill('input[name="min-torque"]', '1.2');
  await page.fill('input[name="max-torque"]', '2.0');
  assert.match(await page.textContent('form'), /Cantidad de muestras del control final/);
  await page.fill('input[name=cantFinal]', '2');
  // Los datos del lote obligatorios: sin elegirlos el navegador no deja crear el lote
  assert.deepEqual(await page.locator('select[name="dato-' + (await page.evaluate(() =>
    Store.perfil().config.plantillas.find(p => p.nombre === 'Jugos 1 L').cabecera[1].id)) + '"] option').allTextContents(),
    ['—', 'Llenadora A', 'Llenadora B'], 'las opciones quedan limpias');
  await page.click('text=Crear lote');
  assert.ok(await page.evaluate(() => document.querySelector('[name="dato-turno"]').validity.valueMissing), 'el turno es obligatorio');
  await page.selectOption('[name="dato-turno"]', 'Tarde');
  await page.selectOption('select[name^="dato-"]:not([name="dato-turno"])', 'Llenadora B');
  await page.click('text=Crear lote');
  await page.waitForSelector('#cl-0');
  const tarjeta = await page.textContent('#cl-0');
  assert.match(tarjeta, /pH[\s\S]*Volumen[\s\S]*Torque de tapa[\s\S]*Codificado de fecha[\s\S]*Etiqueta/);
  assert.doesNotMatch(tarjeta, /Inducción|Peso por pico|Brix/, 'solo lo de su plantilla');
  assert.match(await page.textContent('.cab-lote'), /Jugos 1 L \(REG-05 v00\) · Turno: Tarde · Llenadora: Llenadora B · Volumen \/ nivel de llenado 995–1010 ml/);
  assert.match(await page.evaluate(() => Imprimir.html(Store.lotes().find(x => x.datos.cab.lote === 'J-0001'), Store.perfil().config, 'X')),
    /Datos del lote<\/th><td colspan="5">Turno: Tarde · Llenadora: Llenadora B/);
  paso('el lote muestra solo los controles de su plantilla, sus datos (turno, llenadora) y los rangos cargados');

  // Control: pH fuera de tolerancia fija → NOK; se corrige
  await page.fill('#cl-0 input[data-item][data-l="0"] >> nth=0', '4.6');
  await page.waitForSelector('#cl-0 >> text=fuera de rango');
  assert.match(await page.getAttribute('#cl-0', 'class'), /e-nok/);
  assert.equal(await page.locator('#cl-0 .sem.nok').count(), 1, 'semáforo en rojo');
  await page.fill('#cl-0 input[data-item][data-l="0"] >> nth=0', '3.5');
  await page.waitForSelector('#cl-0 .sem.ok');
  for (const [l, v] of [['0', '1000'], ['1', '1002'], ['2', '998']]) await page.fill(`#cl-0 input[data-item=vol][data-l="${l}"]`, v);
  for (const [l, v] of [['0', '1.5'], ['1', '1.6'], ['2', '1.4']]) await page.fill(`#cl-0 input[data-item=torque][data-l="${l}"]`, v);
  await page.click('#cl-0 [data-item=codif][data-v=true]');
  await page.click('#cl-0 [data-item=etiqueta][data-v=true]');
  assert.match(await page.getAttribute('#cl-0', 'class'), /e-ok/);
  await foto('lote-bebidas');
  paso('medición con tolerancia fija: semáforo y fuera de rango; promedio de lecturas');

  // Control final: la etiqueta no es obligatoria → se puede dictaminar sin cargarla
  for (const i of [0, 1]) {
    await page.click(`#cf-${i} [data-item=herm][data-v=true]`);
    await page.click(`#cf-${i} [data-item=pallet][data-v=true]`);
  }
  assert.equal(await page.locator('text=Faltan completar').count(), 0, 'lo no obligatorio no bloquea el dictamen');
  assert.match(await page.textContent('.dict.ok'), /sugerido/);
  await page.click('.dict.ok');
  await page.waitForSelector('.dict-final.aprobado');
  paso('ítem no obligatorio: no bloquea el dictamen');

  const informe = await page.evaluate(() => {
    const l = Store.lotes().find(x => x.datos.cab.lote === 'J-0001');
    return Imprimir.html(l, Store.perfil().config, Store.perfil().empresa);
  });
  assert.match(informe, /Jugos 1 L/);
  assert.match(informe, /pH/);
  assert.doesNotMatch(informe, /Inducción|Peso por pico/);
  assert.match(informe, /Volumen \/ nivel de llenado \(ml\)/);
  assert.match(informe, /Código: REG-05<br>Versión: 00/);
  assert.match(informe, /Elaboró<\/th><td>Laura Gómez/);
  assert.match(await page.textContent('.cab-lote'), /Jugos 1 L \(REG-05 v00\)/);
  paso('el PDF arma sus columnas con la plantilla del lote');

  // Cambiar la plantilla después NO cambia el lote ya creado
  await page.click('text=← Lotes');
  await page.click('[data-act=config]');
  await page.click('.fila-plantilla:has-text("Jugos 1 L") >> text=Editar');
  await page.click(item('linea', 0) + ' [data-act="item-quitar"]');
  await page.fill('[name="d-cambio"]', 'Se quita el pH: lo mide el laboratorio');
  dialogos.length = 0;
  await page.click('button:has-text("Guardar plantilla")');
  await page.waitForSelector('#plantillas');
  assert.match(dialogos[0] || '', /la versión sigue siendo 00[\s\S]*versión 01/, 'ofrece subir la versión');
  await page.waitForSelector('.fila-plantilla:has-text("Jugos 1 L") >> text=REG-05 · versión 01');
  const doc = await page.evaluate(() => Store.perfil().config.plantillas.find(p => p.nombre === 'Jugos 1 L').doc);
  assert.deepEqual(doc.historial.map(h => h.version + ' ' + h.cambio),
    ['00 Creación del registro', '01 Se quita el pH: lo mide el laboratorio']);
  paso('cambiar qué se controla ofrece versión nueva y la anota en el historial');
  const copia = await page.evaluate(() => Store.lotes().find(x => x.datos.cab.lote === 'J-0001').datos.plantilla);
  assert.equal(copia.linea[0].nombre, 'pH', 'el lote conserva la plantilla con la que se creó');
  assert.equal(copia.doc.version, '00');
  const pdfViejo = await page.evaluate(() => Imprimir.html(Store.lotes().find(x => x.datos.cab.lote === 'J-0001'), Store.perfil().config, 'X'));
  assert.match(pdfViejo, /Versión: 00/, 'el PDF del lote viejo sigue con su versión');
  paso('editar la plantilla no cambia los lotes ya creados ni su codificación');

  // Cambiar solo el nombre no pide versión nueva
  await page.click('.fila-plantilla:has-text("Jugos 1 L") >> text=Editar');
  await page.fill('[name="p-nombre"]', 'Jugos 1 L (cítricos)');
  dialogos.length = 0;
  await page.click('button:has-text("Guardar plantilla")');
  await page.waitForSelector('.fila-plantilla:has-text("Jugos 1 L (cítricos)") >> text=REG-05 · versión 01');
  assert.equal(dialogos.length, 0, 'un cambio de nombre no pide versión');
  paso('un cambio de nombre no pide versión nueva');

  assert.deepEqual(errores, []);
  console.log('\nPlantillas: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
