/* Genera las capturas de la guía (docs/img/*.png) y el recorrido animado (docs/img/demo.gif).
 *
 * Uso:  node tools/demo.js
 * Necesita Playwright y ffmpeg. Usa el Supabase simulado de las pruebas y datos de
 * ejemplo FICTICIOS: no toca el proyecto real ni datos de ninguna empresa.
 * Volver a correrlo cada vez que cambie algo visible de la app.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'docs', 'img');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const CONFIG = {
  inductoras: [
    { id: 'A', nombre: 'Inductora Línea 1', tolMin: 1.0, tolMax: 1.4, unidad: '', semaforo: true },
    { id: 'B', nombre: 'Inductora Línea 2', tolMin: 0.9, tolMax: 1.3, unidad: '', semaforo: true }
  ],
  lineas: ['Env-01', 'Env-02', 'Env-04'],
  docCodigo: 'REG-01', docVersion: '03', docElab: 'Laura Gómez', docAprob: 'Coordinación de Calidad'
};

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

function servidor() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p === '/vendor/supabase.js') p = '/tests/e2e/supabase-falso.js';
    if (p === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end("window.QOS_CONFIG = { supabaseUrl: 'http://demo', supabaseKey: 'demo' };");
    }
    const archivo = path.join(RAIZ, p);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
}

// Lotes de ejemplo, armados con las mismas reglas de la app (corre dentro de la página).
function sembrarLotes() {
  const hoy = new Date();
  const dia = n => Reglas.hoy(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n));
  const ok = { idOK: true, qrOK: true, paletOK: true, indCFOK: true };
  const pl = (n, extra) => Object.assign(Reglas.nuevoPalletLinea(n), {
    hora: '0' + (6 + n) + ':1' + n, p1: '10.4', p2: '10.6', p3: '10.5', p4: '10.5',
    // Fechas con día = mes (11/11): se leen igual en dd/mm y en mm/dd, sea cual sea el idioma del navegador.
    lote: 'L-' + n, codProd: '7790123', fProd: '2026-11-11', fVenc: '2027-11-11',
    indOK: true, indVal: '1.2', qrLineaOK: true, packOK: true, pltOK: true
  }, extra || {});
  const lote = (cab, estado, dictamen, finales, linea, por) => {
    const l = Reglas.nuevoLote(Object.assign({ indId: 'A', pesoMin: '10', pesoMax: '11', checker: 'Laura Gómez' }, cab), 0);
    l.linea = linea;
    l.final.pallets = finales.map(f => Object.assign(Reglas.nuevoPalletFinal(), f));
    l.final.ltsPorPallet = '1000';
    if (dictamen) {
      l.estado = estado; l.final.dictamen = dictamen;
      l.final.fechaDictamen = Reglas.fechaLarga(cab.fecha) + ', 15:40';
      l.final.dictaminadoPor = por; l.final.dictaminadoRol = por === 'Pablo Díaz' ? 'Coordinación' : 'Inspector de Calidad';
    }
    return l;
  };
  const datos = [
    lote({ prod: 'Aceite girasol 1,5 L', lote: 'L-2611-014', cliente: 'Distribuidora Norte SA', linea: 'Env-04', fecha: dia(0) },
      'activo', null, [ok, ok, ok, {}, {}, {}], [pl(1), pl(2, { p3: '11.3' }), pl(3, { packOK: false, packRepro: true })]),
    lote({ prod: 'Aceite oliva 500 ml', lote: 'L-2611-012', cliente: 'Almacén Central', linea: 'Env-01', fecha: dia(1) },
      'aprobado', 'APROBADO', [ok, ok, ok, ok], [pl(1), pl(2)], 'Laura Gómez'),
    lote({ prod: 'Vinagre de alcohol 1 L', lote: 'L-2611-009', cliente: 'Supermercados del Sur', linea: 'Env-02', fecha: dia(2) },
      'aprobado_parcial', 'APROBADO_PARCIAL', [ok, ok, Object.assign({}, ok, { qrOK: false }), ok], [pl(1)], 'Laura Gómez'),
    lote({ prod: 'Aceite girasol 900 ml', lote: 'L-2611-007', cliente: 'Distribuidora Norte SA', linea: 'Env-04', fecha: dia(3) },
      'retenido', 'RETENIDO', [Object.assign({}, ok, { indCFOK: false }), Object.assign({}, ok, { indCFOK: false })], [pl(1, { indOK: false, indVal: '0.7' })], 'Pablo Díaz')
  ];
  const db = JSON.parse(localStorage.getItem('__db'));
  datos.forEach((d, i) => db.lotes.push({
    id: '00000000-0000-4000-8000-00000000000' + i, empresa_id: 'e-1', datos: d, version: 1, borrado: false,
    modificado: new Date(Date.now() - i * 60000).toISOString()
  }));
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
  await page.fill('input[name=prod]', 'Aceite girasol 1,5 L');
  await page.fill('input[name=lote]', 'L-2611-015');
  await page.fill('input[name=cliente]', 'Almacén Central');
  await page.fill('input[name=linea]', 'Env-04');
  await page.fill('input[name=pesoMin]', '10');
  await page.fill('input[name=pesoMax]', '11');
  await page.fill('input[name=pallets]', '4');
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
  await foto(page, '13-configuracion', 'section:has(#inductoras)');
  await foto(page, '14-personas', '#miembros');
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
  await tipear('input[name=lote]', 'L-2611-015');
  await tipear('input[name=cliente]', 'Almacén Central');
  await tipear('input[name=pesoMin]', '10');
  await tipear('input[name=pesoMax]', '11');
  await page.fill('input[name=pallets]', '2');
  await page.waitForTimeout(400);
  await page.click(boton('Crear lote'));
  await page.waitForTimeout(700);
  for (const [k, v] of [['p1', '10.5'], ['p2', '10.7'], ['p3', '11.4']]) await tipear('#cl-0 input[data-k=' + k + ']', v);
  await page.waitForTimeout(900);
  await page.fill('#cl-0 input[data-k=p3]', '');
  await tipear('#cl-0 input[data-k=p3]', '10.6');
  await tipear('#cl-0 input[data-k=p4]', '10.5');
  await page.click('#cl-0 [data-k=indOK][data-v=true]');
  await tipear('#cl-0 input[data-k=indVal]', '1.2');
  for (const k of ['qrLineaOK', 'packOK', 'pltOK']) { await page.click('#cl-0 [data-k=' + k + '][data-v=true]'); await page.waitForTimeout(250); }
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
