/* Prueba de punta a punta de la interfaz, con un Supabase falso en memoria.
 * Uso:  node tests/e2e/flujo.js [carpeta-para-capturas]
 * Necesita Playwright (require('playwright')). Levanta un servidor local propio.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const RAIZ = path.join(__dirname, '..', '..');
const CAPTURAS = process.argv[2] || null;
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function servidor() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p === '/vendor/supabase.js') p = '/tests/e2e/supabase-falso.js';
    if (p === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end("window.QOS_CONFIG = { supabaseUrl: 'http://falso', supabaseKey: 'falsa' };");
    }
    const archivo = path.join(RAIZ, p);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
}

(async () => {
  const srv = servidor().listen(0);
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  let dialogos = [];
  page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
  const foto = async nombre => { if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, nombre + '.png'), fullPage: true }); };
  const servidorLote = () => page.evaluate(() => JSON.parse(localStorage.getItem('__db')).lotes[0]);
  const sincronizar = async () => { await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.waitForTimeout(400); };
  const paso = t => console.log('✓ ' + t);

  await page.goto(url);

  // 1. Ingreso y creación de la empresa
  await page.fill('input[name=email]', 'checker@uno.com');
  await page.fill('input[name=clave]', 'mala-clave');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Email o clave incorrectos.');
  await page.fill('input[name=clave]', 'secreta1');
  await page.click('button[type=submit]');
  await page.fill('input[name=nombre]', 'Maxi');
  await page.fill('input[name=empresa]', 'Planta <Prueba>');
  await page.click('text=Crear empresa');
  // Primera vez: bienvenida con los pasos de Administración y el nombre ya cargado.
  await page.waitForSelector('text=Cómo empezar');
  assert.equal(await page.inputValue('input[name=nombre]'), 'Maxi');
  assert.match(await page.textContent('.pasos'), /Invitá a tu equipo/);
  await page.click('button[type=submit]:has-text("Empezar")');
  await page.waitForSelector('text=+ Nuevo lote');
  assert.match(await page.textContent('main'), /armá tus plantillas de control/, 'admin sin configurar: pista de ⚙');
  assert.equal(await page.textContent('#empresa-nombre'), 'Planta <Prueba>', 'el nombre se muestra como texto, no HTML');
  paso('ingreso con error de clave, creación de empresa');

  // 2. Lote nuevo
  await page.click('text=+ Nuevo lote');
  await page.fill('input[name=prod]', 'Aceite 1L');
  await page.fill('input[name=lote]', 'L-2026-001');
  await page.fill('input[name=cliente]', '  coca   cola SA ');
  await page.fill('input[name=linea]', 'Env-04');
  await page.fill('input[name=min-peso]', '10');
  await page.fill('input[name=max-peso]', '11');
  await page.fill('input[name=cantFinal]', '2');
  await page.click('text=Crear lote');
  await page.waitForSelector('text=Control en línea');
  assert.match(await page.textContent('.cab-lote .meta'), /Coca Cola SA/);
  paso('lote creado, cliente normalizado');

  // 3. Control en línea: peso fuera de rango, inducción con semáforo, texto peligroso
  await page.fill('#cl-0 input[data-item=peso][data-l="0"]', '10.5');
  await page.fill('#cl-0 input[data-item=peso][data-l="1"]', '11.6');
  await page.waitForSelector('#cl-0 >> text=fuera de rango');
  assert.match(await page.getAttribute('#cl-0', 'class'), /e-nok/);
  await page.fill('#cl-0 input[data-item=peso][data-l="1"]', '10.8');
  await page.fill('#cl-0 input[data-item=ind]', '1.2');
  await page.waitForSelector('#cl-0 .sem.ok');
  await page.click('#cl-0 [data-act=check][data-item=pack][data-v=false]');
  await page.click('#cl-0 [data-act=repro][data-item=pack]');
  assert.match(await page.getAttribute('#cl-0', 'class'), /e-repro/);
  await page.fill('#cl-0 input[data-campo=obs]', '<img src=x onerror="window.__xss=1">');
  await page.click('text=+ Pallet');
  assert.equal(await page.locator('.pcard[id^=cl-]').count(), 2);
  await foto('1-control-en-linea');
  await sincronizar();
  let srvLote = await servidorLote();
  assert.ok(srvLote && srvLote.datos.linea[0].v.peso[0] === '10.5', 'el lote subió al servidor');
  paso('control en línea: peso, semáforo, reproceso; sube al servidor');

  // 4. Sin señal: se sigue trabajando y queda en la bandeja de salida
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.click('#cf-0 >> text=✓ Todo OK');
  await page.click('#cf-1 [data-item=idPal][data-v=true]');
  await page.waitForSelector('#nube >> text=Sin señal · 1 por subir');
  await page.waitForSelector('text=Faltan completar 1 pallet');
  await page.click('#cf-1 >> text=✓ Todo OK');
  await page.click('#cf-1 [data-item=traz][data-v=false]');
  assert.equal(await page.textContent('.r-nok b'), '1 pallet');
  assert.match(await page.textContent('.dict.warn'), /sugerido/, 'sugiere aprobado parcial');
  await page.click('#cf-1 [data-item=traz][data-v=true]');
  assert.match(await page.textContent('.dict.ok'), /sugerido/);
  await foto('2-sin-senal');
  assert.ok((await servidorLote()).datos.final.unidades[0].v.idPal == null, 'sin señal no subió nada');
  await ctx.setOffline(false);
  await sincronizar();
  srvLote = await servidorLote();
  assert.equal(srvLote.datos.final.unidades[1].v.traz, true, 'al volver la señal se subió');
  await page.waitForSelector('#nube >> text=Al día');
  paso('sin señal: trabaja local, sube al volver la conexión');

  // 5. Conflicto: otro equipo cambió el lote mientras esta tablet editaba
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('__db'));
    db.lotes[0].version += 1;
    db.lotes[0].datos.hallazgos.push({ ts: 'otro equipo', txt: 'cambio ajeno' });
    localStorage.setItem('__db', JSON.stringify(db));
    Object.assign(window.__db, db);
  });
  await page.fill('#nuevo-hallazgo', 'Etiqueta corrida en pallet 2');
  await page.click('text=Agregar observación');
  await sincronizar();
  await page.waitForSelector('#nube >> text=1 conflicto');
  assert.match(await page.textContent('.hallazgos'), /cambio ajeno/, 'la tablet queda con la versión del servidor');
  await page.click('#nube');
  await page.waitForSelector('text=Usar la mía');
  await foto('3-conflicto');
  await page.click('text=Usar la mía');
  await sincronizar();
  srvLote = await servidorLote();
  assert.ok(srvLote.datos.hallazgos.some(h => h.txt === 'Etiqueta corrida en pallet 2'), 'la versión local se recuperó');
  paso('conflicto detectado, nada se pierde, se elige la versión');

  // 6. Dictamen
  await page.waitForSelector('text=+ Nuevo lote');
  await page.click('.lote-item');
  dialogos = [];
  await page.click('.dict.ok');
  assert.match(dialogos[0], /Aprobado/);
  await page.waitForSelector('.dict-final.aprobado');
  assert.match(await page.textContent('main'), /Dictaminó Maxi \(Administración\)/);
  assert.equal(await page.locator('fieldset.planilla').getAttribute('disabled'), null, 'admin puede seguir editando');
  await sincronizar();
  srvLote = await servidorLote();
  assert.equal(srvLote.datos.estado, 'aprobado');
  await foto('4-dictamen');
  paso('dictamen registrado con autor y subido');

  // 7. Informe imprimible, con el texto del usuario escapado
  const informe = await page.evaluate(() => Imprimir.html(Store.lote(Store.lotes()[0].id), { inductoras: [] }, 'Planta'));
  assert.ok(informe.includes('&lt;img src=x'), 'el texto del usuario se escapa en el PDF');
  await page.evaluate(() => { document.getElementById('imprimir').innerHTML = Imprimir.html(Store.lote(Store.lotes()[0].id), Object.assign({ inductoras: [] }, Store.perfil().config), Store.perfil().empresa); });
  if (CAPTURAS) {
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(CAPTURAS, '5-informe.pdf'), format: 'A4', landscape: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
  }
  paso('informe imprimible');

  // 8. Historial y recarga: los datos siguen ahí
  await page.reload();
  await page.click('text=Historial');
  await page.waitForSelector('text=L-2026-001');
  await foto('5-historial');
  paso('recarga: la sesión y los datos persisten; el lote aparece en historial');

  assert.equal(await page.evaluate(() => window.__xss), undefined, 'no se ejecutó código inyectado');
  assert.deepEqual(errores, [], 'sin errores en la consola');
  console.log('\nFlujo completo: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
