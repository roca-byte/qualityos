/* Genera las capturas de la guía (docs/img/*.png) y el recorrido animado (docs/img/demo.gif).
 *
 * Uso:  node tools/demo.js
 * Necesita Playwright y ffmpeg. Usa el Supabase simulado de las pruebas y datos de
 * ejemplo FICTICIOS: no toca el proyecto real ni datos de ninguna empresa.
 * Volver a correrlo cada vez que cambie algo visible de la app.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { servidor, RAIZ } = require('./servidor');
const CONFIG = require('../js/demo.js').CONFIG_EJEMPLO;
const SALIDA = path.join(RAIZ, 'docs', 'img');


const BASE = {
  usuarios: {
    'laura@plantademo.com': { id: 'u-2', email: 'laura@plantademo.com', clave: 'demo1234', confirmado: true },
    'admin@plantademo.com': { id: 'u-1', email: 'admin@plantademo.com', clave: 'demo1234', confirmado: true }
  },
  plataforma: ['u-1'], confirmarEmail: false,
  empresas: [{ id: 'e-1', nombre: 'Planta Demo', config: CONFIG }],
  miembros: [
    { empresa_id: 'e-1', user_id: 'u-1', nombre: 'Maxi Roca', rol: 'admin', activo: true },
    { empresa_id: 'e-1', user_id: 'u-2', nombre: 'Laura Gómez', rol: 'checker', activo: true },
    { empresa_id: 'e-1', user_id: 'u-3', nombre: 'Pablo Díaz', rol: 'coordinacion', activo: true }
  ],
  invitaciones: [{ empresa_id: 'e-1', email: 'turno.noche@plantademo.com', rol: 'checker' }],
  lotes: []
};

// Lotes de ejemplo: los mismos del modo demo (js/demo.js). Corre dentro de la página.
function sembrarLotes() {
  const db = JSON.parse(localStorage.getItem('__db'));
  db.lotes = Demo.lotesEjemplo('e-1');
  localStorage.setItem('__db', JSON.stringify(db));
}

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const srv = servidor().listen(0);
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  // --lang: los campos de fecha y hora toman el idioma del navegador (dd/mm/aaaa, 24 h).
  const browser = await chromium.launch({ args: ['--lang=es-AR'] });
  const capturas = [];

  async function contexto(opciones) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', colorScheme: 'light',
      locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' }, opciones || {}));
    await ctx.addInitScript(db => { if (!localStorage.getItem('__db')) localStorage.setItem('__db', JSON.stringify(db)); }, BASE);
    const page = await ctx.newPage();
    // Reloj fijo en el 11/11: los campos de fecha muestran el formato del navegador
    // (acá mm/dd) y ese día se lee igual en dd/mm.
    await page.clock.setFixedTime(new Date('2026-11-11T10:30:00-03:00'));
    page.on('dialog', d => d.accept());
    page.on('pageerror', e => { throw e; });
    return { ctx, page };
  }
  async function entrar(page, email) {
    await page.goto(url);
    await page.evaluate(sembrarLotesSiFalta, sembrarLotes.toString());
    await page.reload(); // el Supabase simulado lee los datos al cargar la página
    await page.fill('input[name=email]', email);
    await page.fill('input[name=clave]', 'demo1234');
    await page.click('button[type=submit]');
  }
  // Siembra los lotes una sola vez (la página ya tiene Reglas cargado).
  function sembrarLotesSiFalta(fuente) {
    if (JSON.parse(localStorage.getItem('__db')).lotes.length) return;
    (new Function('return ' + fuente)())();
  }
  async function foto(page, nombre, selector) {
    await page.waitForTimeout(300);
    const destino = path.join(SALIDA, nombre + '.png');
    if (selector) {
      // En un recorte la barra superior fija se superpone a lo que se captura: se suelta un momento.
      const estilo = await page.addStyleTag({ content: '.barra { position: static !important; }' });
      await page.locator(selector).first().screenshot({ path: destino });
      await estilo.evaluate(e => e.remove());
    }
    else await page.screenshot({ path: destino });
    capturas.push(nombre);
  }
  // Captura desde el principio de "desde" hasta el final de "hasta" (para no mostrar una lista larga entera).
  async function recorte(page, nombre, desde, hasta) {
    const estilo = await page.addStyleTag({ content: '.barra { position: static !important; }' });
    // Coordenadas respecto de la página entera (no de la parte visible), que es lo que usa fullPage.
    // "desde" es el bloque (section) que contiene a ese elemento: así entra el título.
    const caja = await page.evaluate(([d, h]) => {
      const a = document.querySelector(d).closest('section').getBoundingClientRect();
      const b = document.querySelector(h).getBoundingClientRect();
      return { x: a.left + scrollX, y: a.top + scrollY, width: a.width, height: b.bottom - a.top + 12 };
    }, [desde, hasta]);
    await page.screenshot({ path: path.join(SALIDA, nombre + '.png'), fullPage: true, clip: caja });
    await estilo.evaluate(e => e.remove());
    capturas.push(nombre);
  }
  const boton = texto => 'button:has-text("' + texto + '")';

  // ── Capturas: Inspector de Calidad ──
  let { ctx, page } = await contexto();
  await page.goto(url);
  await foto(page, '01-acceso');
  await entrar(page, 'laura@plantademo.com');
  await page.waitForSelector('text=Cómo empezar');
  await foto(page, '02-bienvenida');
  await page.click('button[type=submit]:has-text("Empezar")');
  await page.waitForSelector('.lote-item');
  await foto(page, '03-inicio');

  await page.click(boton('+ Nuevo lote'));
  // El producto sale del catálogo: completa plantilla, rangos, inductora y cantidades.
  await page.fill('input[name=prod]', 'Aceite girasol 1,5 L');
  await page.press('input[name=prod]', 'Enter');
  await page.waitForSelector('text=Completado desde el catálogo');
  await page.fill('input[name=lote]', 'L-2611-015');
  await page.fill('input[name=cliente]', 'Almacén Central');
  await page.fill('input[name=linea]', 'Env-04');
  await page.selectOption('[name="dato-turno"]', 'Mañana');
  await foto(page, '04-nuevo-lote');

  await page.click(':nth-match(.lote-item, 1)').catch(() => {});
  await page.goto(url);
  await page.click('.lote-item:has-text("L-2611-014")');
  await page.waitForSelector('#cl-1');
  await foto(page, '05-control-en-linea', '#cl-1');
  await foto(page, '06-reproceso', '#cl-2');
  await page.locator('#cf-0').scrollIntoViewIfNeeded();
  await recorte(page, '07-control-final', '#cf-0', '#cf-2');
  await page.click('#cf-3 >> text=✓ Todo OK');
  await page.click('#cf-4 >> text=✓ Todo OK');
  await page.click('#cf-5 >> text=✓ Todo OK');
  await foto(page, '08-dictamen', 'section:has(.dictamenes)');
  await page.click('.dict.ok');
  await page.waitForSelector('.dict-final');
  await foto(page, '09-dictaminado', 'section:has(.dict-final)');

  // No conformidades: se crean desde los desvíos del lote recién dictaminado.
  await page.click('summary:has-text("Desvíos detectados")');
  await foto(page, '18-nc-desde-lote', 'section:has(.nc-lote)');
  await page.click(boton('desde los desvíos'));
  await page.waitForFunction(() => Store.pendientes().length === 0, null, { timeout: 15000 });   // el servidor las numera
  await page.click('[data-act=inicio]');
  await page.click('button[data-tab="nc"]');
  await page.waitForSelector('.nc-item >> text=NC-2026-001');
  await foto(page, '19-nc-lista');
  await page.click('.nc-item:has-text("Peso por pico")');
  await page.selectOption('[name="tipo"]', { index: 2 });
  await page.fill('[name="ac"]', 'Se recalibró el pico 2 y se re-pesó el pallet');
  await page.fill('[name="resp"]', 'Laura Gómez');
  await foto(page, '20-nc-ficha', 'section:has([data-form=nc])');
  await page.click('button[type=submit]:has-text("Guardar")');
  await page.goto(url);

  await page.click(boton('Imprimir / PDF')).catch(() => {});
  await page.evaluate(() => {
    const l = Store.lotes().find(x => x.datos.cab.lote === 'L-2611-014');
    document.getElementById('imprimir').innerHTML = Imprimir.html(l, Object.assign({}, Store.perfil().config), Store.perfil().empresa);
  });
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.emulateMedia({ media: 'print' });
  await foto(page, '10-registro-pdf', '#imprimir');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click('[data-act=inicio]').catch(() => {});
  await page.goto(url);
  await page.click(boton('Historial'));
  await page.waitForSelector('.lote-item');
  await foto(page, '11-historial');
  await ctx.close();

  // ── Capturas: Administración ──
  ({ ctx, page } = await contexto());
  await entrar(page, 'admin@plantademo.com');
  await page.waitForSelector('text=Cómo empezar');
  await foto(page, '12-bienvenida-admin', '.bienvenida');
  await page.click('button[type=submit]:has-text("Empezar")');
  await page.click('[data-act=config]');
  await page.waitForSelector('#miembros select');
  await foto(page, '13-configuracion', 'section:has([data-form=config])');
  await foto(page, '14-personas', '#miembros');
  await foto(page, '15-plantillas', '#plantillas');
  await foto(page, '21-productos', '#productos');
  await page.click('.fila-plantilla:has-text("Envasado de alimentos") >> text=Editar');
  await page.waitForSelector('.ed-item');
  await recorte(page, '16-editor-plantilla', '[data-form=plantilla]', '.ed-item[data-sec="linea"][data-i="1"]');
  await page.click('button[data-act=config]');
  await page.click('[data-act=inicio]');
  await page.click('button[data-tab="historial"]');
  await page.click('.lote-item:has-text("Y-2611-031")');
  await page.waitForSelector('#cl-1');
  await foto(page, '17-lote-alimentos', '#cl-1');
  await ctx.close();

  // ── Recorrido animado: crear, controlar y dictaminar un lote ──
  const carpetaVideo = fs.mkdtempSync(path.join(os.tmpdir(), 'qos-video-'));
  ({ ctx, page } = await contexto({ deviceScaleFactor: 1, recordVideo: { dir: carpetaVideo, size: { width: 390, height: 844 } } }));
  await entrar(page, 'laura@plantademo.com');
  await page.click('button[type=submit]:has-text("Empezar")');
  await page.waitForTimeout(800);
  const tipear = async (sel, txt) => { await page.click(sel); await page.type(sel, txt, { delay: 45 }); };
  await page.click(boton('+ Nuevo lote'));
  await page.waitForTimeout(400);
  await tipear('input[name=prod]', 'Aceite girasol 1,5 L');
  await page.press('input[name=prod]', 'Enter');   // del catálogo: completa rangos, inductora y cantidades
  await page.waitForTimeout(700);
  await page.type('input[name=lote]', 'L-2611-015', { delay: 45 });
  await tipear('input[name=cliente]', 'Almacén Central');
  await page.selectOption('[name="dato-turno"]', 'Mañana');
  await page.fill('input[name=cantFinal]', '2');
  await page.waitForTimeout(400);
  await page.click(boton('Crear lote'));
  await page.waitForTimeout(700);
  const pico = n => '#cl-0 input[data-item=peso][data-l="' + n + '"]';
  for (const [n, v] of [[0, '10.5'], [1, '10.7'], [2, '11.4']]) await tipear(pico(n), v);
  await page.waitForTimeout(900);
  await page.fill(pico(2), '');
  await tipear(pico(2), '10.6');
  await tipear(pico(3), '10.5');
  await tipear('#cl-0 input[data-item=ind]', '1.2');
  for (const k of ['qr', 'pack', 'plt']) { await page.click('#cl-0 [data-item=' + k + '][data-v=true]'); await page.waitForTimeout(250); }
  await page.waitForTimeout(500);
  await page.locator('#cf-0').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.click('#cf-0 >> text=✓ Todo OK');
  await page.waitForTimeout(400);
  await page.click('#cf-1 >> text=✓ Todo OK');
  await page.waitForTimeout(500);
  await page.locator('.dictamenes').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await page.click('.dict.ok');
  await page.waitForTimeout(1800);
  const video = await page.video().path();
  await ctx.close();
  await browser.close();
  srv.close();

  // webm → GIF liviano (paleta propia, 8 cuadros por segundo, 360 px de ancho).
  const gif = path.join(SALIDA, 'demo.gif');
  const filtro = 'fps=8,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', filtro, gif]);
  fs.rmSync(carpetaVideo, { recursive: true, force: true });

  console.log('Capturas:', capturas.join(', '));
  console.log('GIF:', path.relative(RAIZ, gif), Math.round(fs.statSync(gif).size / 1024) + ' KB');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
