/* Modo demo ("Probar sin cuenta").
 * Uso:  node tests/e2e/demo.js
 *
 * Corre con la librería REAL de Supabase y una configuración que apunta a un proyecto:
 * cualquier pedido a Supabase queda registrado y la prueba falla si hubo alguno.
 * Así se comprueba que la demo nunca toca la base real.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const RAIZ = path.join(__dirname, '..', '..');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function servidor() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end("window.QOS_CONFIG = { supabaseUrl: 'https://proyecto-real.supabase.co', supabaseKey: 'sb_publishable_x' };");
    }
    const archivo = path.join(RAIZ, p);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
}

(async () => {
  const srv = servidor().listen(0);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const aSupabase = [];
  await ctx.route(/supabase\.co/, r => { aSupabase.push(r.request().url()); r.abort(); });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('dialog', d => d.accept());
  const paso = t => console.log('✓ ' + t);
  const empezar = () => page.click('button[type=submit]:has-text("Empezar")');

  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.click('button[data-act="demo"]');
  await page.waitForSelector('text=Estás en el modo demo');
  assert.equal(await page.inputValue('input[name=nombre]'), 'Visitante');
  assert.match(await page.textContent('.pasos'), /Creá el lote/, 'en la demo se muestran los pasos del día a día');
  await empezar();
  await page.waitForSelector('.lote-item');
  assert.ok(await page.isVisible('#franja-demo'), 'la franja de demo está a la vista');
  assert.equal(await page.textContent('#empresa-nombre'), 'Planta Demo');
  assert.equal(await page.locator('.lote-item').count(), 1, 'un lote en control');
  paso('entra sin cuenta, con bienvenida de demo y datos de ejemplo');

  await page.click('.lote-item');
  for (const i of [3, 4, 5]) await page.click(`#cf-${i} >> text=✓ Todo OK`);
  await page.click('.dict.ok');
  await page.waitForSelector('.dict-final.aprobado');
  await page.click('text=← Lotes');
  await page.click('button[data-tab="historial"]');
  await page.waitForSelector('.lote-item');
  assert.equal(await page.locator('.lote-item').count(), 5, 'el lote dictaminado pasa al historial');
  await page.fill('input[name=q]', 'vinagre');
  await page.click('text=Buscar en todo el historial');
  await page.waitForSelector('text=Resultados del servidor');
  assert.equal(await page.locator('.lote-item').count(), 1, 'la búsqueda filtra');
  paso('se puede controlar, dictaminar y buscar en el historial');

  await page.click('[data-act=config]');
  await page.waitForSelector('#miembros select');
  assert.match(await page.textContent('#miembros'), /Laura Gómez[\s\S]*Pablo Díaz/);
  paso('⚙ muestra la configuración y las personas de ejemplo');

  await page.click('#franja-demo >> text=Salir de la demo');
  await page.waitForSelector('button[data-act="demo"]');
  assert.ok(!(await page.isVisible('#franja-demo')));
  await page.click('button[data-act="demo"]');
  await page.waitForSelector('text=Estás en el modo demo');
  await empezar();
  await page.waitForSelector('.lote-item');
  assert.equal(await page.locator('.lote-item').count(), 1, 'al volver a entrar, la demo arranca de cero');
  paso('salir de la demo y volver a entrar la reinicia');

  await page.reload();
  await page.waitForSelector('.lote-item');
  assert.ok(await page.isVisible('#franja-demo'), 'recargando sigue en demo');
  paso('recargar la página mantiene la demo');

  assert.deepEqual(aSupabase, [], 'la demo no hizo ningún pedido a Supabase');
  assert.deepEqual(errores, []);
  paso('ningún pedido a Supabase');
  console.log('\nModo demo: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
