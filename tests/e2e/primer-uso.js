/* Primer uso de una persona nueva, con un Supabase simulado.
 * Uso:  node tests/e2e/primer-uso.js [carpeta-para-capturas]
 *
 * Caso 1: alguien invitado como Inspector/a crea su cuenta (con confirmación de
 *         email, como en el proyecto real), entra por primera vez, ve la bienvenida,
 *         carga su nombre y crea su primer lote con su nombre ya puesto.
 * Caso 2: alguien SIN invitación crea su cuenta: no puede crear empresas y la app le
 *         explica que lo tienen que invitar.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const RAIZ = path.join(__dirname, '..', '..');
const CAPTURAS = process.argv[2] || null;
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Estado inicial del "servidor": la plataforma con una empresa y una invitación pendiente.
const BASE = {
  usuarios: { 'admin@planta.com': { id: 'u-1', email: 'admin@planta.com', clave: 'secreta1', confirmado: true } },
  plataforma: ['u-1'], confirmarEmail: true,
  empresas: [{ id: 'e-1', nombre: 'Planta Demo', config: {} }],
  miembros: [{ empresa_id: 'e-1', user_id: 'u-1', nombre: 'Maxi', rol: 'admin', activo: true }],
  invitaciones: [{ empresa_id: 'e-1', email: 'nuevo@planta.com', rol: 'checker' }],
  lotes: []
};

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
  const paso = t => console.log('✓ ' + t);

  async function pagina() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await ctx.addInitScript(db => { if (!localStorage.getItem('__db')) localStorage.setItem('__db', JSON.stringify(db)); }, BASE);
    const page = await ctx.newPage();
    page.errores = [];
    page.on('pageerror', e => page.errores.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(url);
    return page;
  }
  const foto = async (page, nombre) => { if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, nombre + '.png') }); };

  // ── Caso 1: invitado ──
  let page = await pagina();
  await page.fill('input[name=email]', 'nuevo@planta.com');
  await page.fill('input[name=clave]', 'clave123');
  await page.click('text=Crear cuenta nueva');
  await page.waitForSelector('text=Te mandamos un email para confirmar');
  await page.fill('input[name=clave]', 'clave123');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Todavía no confirmaste el email');
  paso('crear cuenta: pide confirmar el email y no deja entrar antes');

  // La persona toca el link del mail (acá se simula marcando la cuenta como confirmada).
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('__db'));
    d.usuarios['nuevo@planta.com'].confirmado = true;
    localStorage.setItem('__db', JSON.stringify(d));
    Object.assign(window.__db, d);
  });
  await page.fill('input[name=clave]', 'clave123');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Cómo empezar');
  assert.equal(await page.inputValue('input[name=nombre]'), '', 'todavía no tiene nombre');
  assert.match(await page.textContent('.pasos'), /Creá el lote/, 'pasos de Inspector de Calidad');
  assert.match(await page.textContent('main'), /Planta Demo · Inspector de Calidad/);
  await foto(page, 'bienvenida-inspector');
  await page.click('button[type=submit]:has-text("Empezar")');
  assert.ok(await page.isVisible('text=Cómo empezar'), 'sin nombre no avanza');
  await page.fill('input[name=nombre]', 'Laura Gómez');
  await page.click('button[type=submit]:has-text("Empezar")');
  await page.waitForSelector('text=Tocá + Nuevo lote para empezar');
  await foto(page, 'inicio-vacio');
  const servidorNombre = await page.evaluate(() => JSON.parse(localStorage.getItem('__db')).miembros.find(m => m.user_id === 'u-2').nombre);
  assert.equal(servidorNombre, 'Laura Gómez', 'el nombre se guardó en el servidor');
  paso('primera entrada: bienvenida con pasos del rol; el nombre es obligatorio y se guarda');

  await page.click('text=+ Nuevo lote');
  assert.equal(await page.inputValue('input[name=checker]'), 'Laura Gómez', 'el lote ya trae su nombre');
  paso('primer lote: el campo Inspector de Calidad viene con su nombre');

  await page.reload();
  await page.waitForSelector('text=+ Nuevo lote');
  assert.ok(!(await page.isVisible('text=Cómo empezar')), 'la bienvenida no se repite');
  await page.click('[data-act=config]');
  await page.click('text=Ver la guía de bienvenida');
  await page.waitForSelector('text=Cómo empezar');
  assert.equal(await page.inputValue('input[name=nombre]'), 'Laura Gómez');
  paso('la bienvenida no se repite, pero se puede volver a ver desde ⚙');
  assert.deepEqual(page.errores, []);

  // ── Caso 2: sin invitación ──
  page = await pagina();
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('__db')); d.confirmarEmail = false;
    localStorage.setItem('__db', JSON.stringify(d));
  });
  await page.reload();
  await page.fill('input[name=email]', 'curioso@otra.com');
  await page.fill('input[name=clave]', 'clave123');
  await page.click('text=Crear cuenta nueva');
  await page.waitForSelector('text=te tiene que invitar el administrador');
  assert.equal(await page.locator('input[name=empresa]').count(), 0, 'no ve el formulario para crear empresas');
  await page.fill('input[name=nombre]', 'Curioso');
  await page.click('button[data-act="buscar-invitaciones"]');
  await page.waitForSelector('text=No hay invitaciones para tu email');
  await foto(page, 'sin-invitacion');
  paso('sin invitación: no puede crear empresas y la app le explica qué hacer');
  assert.deepEqual(page.errores, []);

  console.log('\nPrimer uso: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
