/* Graba el video de demostración: docs/video/qualityos-demo.mp4
 *
 * Uso:  node tools/video.js
 * Necesita Playwright y ffmpeg. Recorre la app en el MODO DEMO real ("Probar sin cuenta"),
 * como lo vería un visitante, con carteles que explican cada paso, un círculo en cada
 * toque y placas de apertura y cierre. No toca la base real.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { servidor, RAIZ } = require('./servidor');

const SALIDA = path.join(RAIZ, 'docs', 'video');
const ANCHO = 390, ALTO = 844;

// Se inyecta en la página: carteles, placas y marca de toques. Vive fuera de <main>,
// así sobrevive a los redibujos de la app.
function preparar() {
  const css = document.createElement('style');
  css.textContent = `
    #v-cartel { position: fixed; left: 12px; right: 12px; bottom: 18px; z-index: 99; padding: 12px 16px; pointer-events: none;
      background: rgba(10, 70, 84, .94); color: #fff; border-radius: 14px; font: 600 17px/1.35 "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,.25); transition: opacity .35s, transform .35s; }
    #v-cartel.oculto { opacity: 0; transform: translateY(14px); }
    #v-cartel small { display: block; font-weight: 400; font-size: 14px; opacity: .85; margin-top: 2px; }
    #v-placa { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 14px; text-align: center; padding: 24px; background: #0f5c6e; color: #fff;
      font-family: "Segoe UI", Roboto, sans-serif; transition: opacity .6s; }
    #v-placa.oculto { opacity: 0; pointer-events: none; }
    #v-placa img { width: 112px; height: 112px; }
    #v-placa h1 { margin: 0; font-size: 34px; } #v-placa h1 span { color: #00c896; }
    #v-placa p { margin: 0; font-size: 18px; opacity: .9; max-width: 300px; line-height: 1.4; }
    #v-placa b { color: #00c896; }
    .v-toque { position: fixed; z-index: 98; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      background: rgba(0, 200, 150, .35); border: 3px solid #00c896; pointer-events: none; animation: v-toque .6s ease-out forwards; }
    @keyframes v-toque { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }`;
  document.head.appendChild(css);
  const cartel = document.createElement('div');
  cartel.id = 'v-cartel'; cartel.className = 'oculto';
  document.body.appendChild(cartel);
  const placa = document.createElement('div');
  placa.id = 'v-placa'; placa.className = 'oculto';
  document.body.appendChild(placa);
  document.addEventListener('pointerdown', e => {
    const t = document.createElement('div');
    t.className = 'v-toque'; t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 700);
  }, true);
  window.vCartel = (titulo, detalle) => {
    cartel.innerHTML = titulo ? titulo + (detalle ? '<small>' + detalle + '</small>' : '') : '';
    cartel.className = titulo ? '' : 'oculto';
  };
  window.vPlaca = html => {
    if (html) placa.innerHTML = html;
    placa.className = html ? '' : 'oculto';
  };
}

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const srv = servidor().listen(0);
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'qos-video-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: ANCHO, height: ALTO }, deviceScaleFactor: 2, serviceWorkers: 'block',
    locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', colorScheme: 'light'
  });
  const page = await ctx.newPage();

  // Grabación: capturas de pantalla seguidas a resolución doble, cada una con su hora.
  // (La grabación propia de Playwright y la transmisión de Chrome dan cuadros de 390 px,
  // que en un celular moderno se ven borrosos.) Después se arma el video respetando
  // cuánto estuvo cada cuadro en pantalla.
  const cuadros = [];
  let grabando = false;
  async function grabar() {
    while (grabando) {
      const t = Date.now() / 1000;
      const archivo = path.join(carpeta, 'c' + String(cuadros.length).padStart(5, '0') + '.jpg');
      try {
        await page.screenshot({ path: archivo, type: 'jpeg', quality: 88, animations: 'allow', caret: 'initial' });
        cuadros.push({ archivo, t });
      } catch (e) { /* la página se está redibujando: se saltea el cuadro */ }
    }
  }
  // Reloj en el 11/11: los campos de fecha muestran el formato del navegador y ese día se lee igual.
  await page.clock.setFixedTime(new Date('2026-11-11T10:30:00-03:00'));
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => { throw e; });

  const espera = ms => page.waitForTimeout(ms);
  const cartel = async (t, d, ms) => { await page.evaluate(([a, b]) => window.vCartel(a, b), [t, d || '']); await espera(ms || 2200); };
  const placa = async (html, ms) => { await page.evaluate(h => window.vPlaca(h), html); await espera(ms); };
  // Lleva el elemento al centro de la pantalla (despacio, para que se vea) y lo toca.
  const ver = async sel => {
    await page.locator(sel).first().evaluate(e => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await espera(700);
  };
  const tocar = async (sel, ms) => { await ver(sel); await page.locator(sel).first().click(); await espera(ms || 600); };
  const tipear = async (sel, txt) => { await ver(sel); await page.locator(sel).first().click(); await page.keyboard.type(txt, { delay: 70 }); await espera(250); };
  const boton = t => 'button:has-text("' + t + '")';

  await page.goto(url);
  await page.evaluate(preparar);
  grabando = true;
  const grabacion = grabar();
  await espera(300);
  const logo = await page.evaluate(() => new URL('icons/qualityos.svg', location.href).href);

  // ── Apertura ──
  await placa('<img src="' + logo + '" alt=""><h1>Quality<span>OS</span></h1>' +
    '<p>Control de calidad de lotes, del control en línea al dictamen.</p><p><b>Desde la tablet y aunque no haya señal.</b></p>', 3800);
  await placa('', 900);

  // ── Acceso y demo ──
  await cartel('Se entra por invitación de tu empresa', 'Para conocerla, hay un modo demo sin cuenta');
  await tocar('button[data-act="demo"]', 1200);
  await cartel('La primera vez, una guía según tu rol', 'Tu nombre queda en la firma de cada dictamen', 2600);
  await ver('.pasos li:nth-child(4)');
  await espera(1200);
  await tocar('button[type=submit]:has-text("Empezar")', 900);

  // ── Lote nuevo ──
  await cartel('Lotes en control e historial', 'Arrancamos uno nuevo');
  await tocar(boton('+ Nuevo lote'), 700);
  await cartel('1 · Creá el lote', 'Producto, n° de lote, cliente, línea y rango de peso por pico', 800);
  await tipear('input[name=prod]', 'Aceite girasol 1,5 L');
  await tipear('input[name=lote]', 'L-2611-015');
  await tipear('input[name=cliente]', 'Almacén Central');
  await page.selectOption('select[name=indId]', 'A').catch(() => {});
  await tipear('input[name=linea]', 'Env-04');
  await tipear('input[name="min-peso"]', '10');
  await tipear('input[name="max-peso"]', '11');
  await ver('input[name=cantFinal]');
  await page.fill('input[name=cantFinal]', '2');
  await espera(500);
  await tocar(boton('Crear lote'), 900);

  // ── Control en línea ──
  await cartel('2 · Control en línea, pallet por pallet', 'Los 4 pesos por pico, con el rango del lote', 900);
  await tocar('#cl-0 [data-act="hora"]', 400);
  const pico = n => '#cl-0 input[data-item=peso][data-l="' + n + '"]';
  await tipear(pico(0), '10.5');
  await tipear(pico(1), '10.7');
  await tipear(pico(2), '11.4');
  await cartel('⚖ Un pico fuera de rango salta al instante', 'Se corrige y vuelve a quedar en verde', 2400);
  await page.fill(pico(2), '');
  await tipear(pico(2), '10.6');
  await tipear(pico(3), '10.5');
  await espera(600);
  await cartel('Identificación del pallet', 'Al agregar otro pallet se copia del anterior', 600);
  await tipear('#cl-0 input[data-item=loteEnv]', 'L-2611-015');
  await tipear('#cl-0 input[data-item=codigo]', '7790123');
  // Fechas con día = mes: se leen igual en dd/mm y en mm/dd.
  await ver('#cl-0 input[data-item=fprod]');
  await page.fill('#cl-0 input[data-item=fprod]', '2026-11-11');
  await page.fill('#cl-0 input[data-item=fvenc]', '2027-11-11');
  await espera(1000);
  await cartel('Mediciones con semáforo', 'Verde dentro de tolerancia, amarillo cerca, rojo afuera', 700);
  await tipear('#cl-0 input[data-item=ind]', '1.2');
  await espera(900);
  await tocar('#cl-0 [data-item=qr][data-v=true]', 300);
  await tocar('#cl-0 [data-item=pack][data-v=false]', 400);
  await cartel('¿Un NOK corregido en el momento?', 'Se marca como Reprocesado y queda registrado', 900);
  await tocar('#cl-0 [data-act=repro][data-item=pack]', 900);
  await tocar('#cl-0 [data-item=plt][data-v=true]', 900);

  // ── Control final ──
  await cartel('3 · Control final antes del despacho', '“Todo OK” completa un pallet de un toque', 900);
  await tipear('input[data-campo=cantPorUnidad]', '1000');
  await tocar('#cf-0 >> text=✓ Todo OK', 700);
  await tocar('#cf-1 >> text=✓ Todo OK', 900);

  // ── Dictamen ──
  await ver('.dictamenes');
  await cartel('4 · La app suma litros y sugiere el dictamen', 'Aprobado, Aprobado parcial o Retenido: decidís vos', 3000);
  await tocar('.dict.ok', 1400);
  await cartel('Queda firmado: quién, con qué rol y cuándo', 'Y el registro del lote sale listo para PDF', 3000);

  // ── Historial ──
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await espera(700);
  await tocar('text=← Lotes', 500);
  await tocar('button[data-tab="historial"]', 600);
  await cartel('5 · Todo queda en el historial', 'Con búsqueda por lote, producto o cliente', 2600);

  // ── Plantillas: sirve para cualquier rubro ──
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await tocar('[data-act=config]', 500);
  await ver('#plantillas');
  await cartel('Cada planta define qué controla', 'Plantillas por producto o línea, con ejemplos por rubro', 2800);
  await tocar('.fila-plantilla:has-text("Envasado de alimentos") >> text=Editar', 600);
  await cartel('Mediciones con tolerancia, OK/NOK, datos y fechas', 'Alimentos, bebidas, químicos, cosmética…', 1600);
  await ver('.ed-item[data-sec="linea"][data-i="1"]');
  await espera(1400);
  await ver('.ed-item[data-sec="linea"][data-i="2"]');
  await espera(1200);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await tocar('button[data-act=config]', 400);
  await tocar('[data-act=inicio]', 500);

  // ── Sin señal ──
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await cartel('¿Sin señal en planta? Se sigue trabajando', 'Arriba ves lo que falta subir; se sube solo cuando vuelve', 3000);
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await espera(1500);
  await cartel('', '', 300);

  // ── Cierre ──
  await placa('<img src="' + logo + '" alt=""><h1>Quality<span>OS</span></h1>' +
    '<p>Probala sin cuenta en</p><p><b>roca-byte.github.io/qualityos</b></p><p>→ “Probar sin cuenta (demo)”</p>', 4200);

  grabando = false;
  await grabacion;
  const fin = Date.now() / 1000;
  await ctx.close();
  await browser.close();
  srv.close();

  // Lista de cuadros con cuánto dura cada uno en pantalla (hasta que llega el siguiente).
  const lista = path.join(carpeta, 'lista.txt');
  fs.writeFileSync(lista, cuadros.map((c, i) => {
    const hasta = i + 1 < cuadros.length ? cuadros[i + 1].t : fin;
    return "file '" + c.archivo + "'\nduration " + Math.max(0.04, hasta - c.t).toFixed(3);
  }).join('\n') + "\nfile '" + cuadros[cuadros.length - 1].archivo + "'\n");

  // Cuadros → MP4 (H.264) a 25 cuadros por segundo: se reproduce en celulares, WhatsApp,
  // LinkedIn y YouTube. El ancho y el alto tienen que ser pares para H.264.
  const mp4 = path.join(SALIDA, 'qualityos-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista,
    '-vf', 'fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
    '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(carpeta, { recursive: true, force: true });
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim();
  console.log('Cuadros:', cuadros.length, '≈', (cuadros.length / (fin - cuadros[0].t)).toFixed(1), 'por segundo');
  console.log('Video:', path.relative(RAIZ, mp4), Math.round(fs.statSync(mp4).size / 1024) + ' KB,', Math.round(dur) + ' s');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
