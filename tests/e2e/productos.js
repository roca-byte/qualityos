/* Catálogo de productos: elegir el producto al crear el lote completa lo demás.
 * Uso:  node tests/e2e/productos.js [carpeta-para-capturas]
 *
 * Caso (en la demo, como Administración): crear lotes desde productos del catálogo (con su
 * plantilla, rangos, datos del lote y cantidad por pallet), guardar como producto uno nuevo,
 * administrar el catálogo en ⚙ y comprobar que corregirlo no cambia los lotes ya hechos.
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
  const lote = numero => page.evaluate(n => Store.lotes().find(l => l.datos.cab.lote === n).datos, numero);
  // Escribir el producto y salir del campo (así lo hace la persona: elige de la lista o tipea y sigue).
  const producto = async texto => { await page.fill('[name=prod]', texto); await page.dispatchEvent('[name=prod]', 'change'); };

  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.click('button[data-act="demo"]');
  await page.click('button[type=submit]:has-text("Empezar")');

  // ── Lote desde un producto del catálogo ──
  await page.click('text=+ Nuevo lote');
  assert.deepEqual(await page.locator('#lista-productos option').evaluateAll(os => os.map(o => o.value)),
    ['Aceite girasol 1,5 L', 'Aceite oliva 500 ml', 'Yogur frutilla 190 g'], 'el campo sugiere los productos del catálogo');
  await producto('  aceite OLIVA 500 ml ');
  await page.waitForSelector('text=Completado desde el catálogo');
  assert.equal(await page.inputValue('[name=prod]'), 'Aceite oliva 500 ml', 'queda con el nombre del catálogo');
  assert.equal(await page.inputValue('[name="min-peso"]'), '9.6');
  assert.equal(await page.inputValue('[name="max-peso"]'), '10.2');
  assert.equal(await page.inputValue('[name="dato-inductora"]'), 'Inductora 1');
  assert.equal(await page.inputValue('[name=cantFinal]'), '4');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'lote', 'el cursor pasa al n° de lote');
  await foto('prod-01-completado');
  await page.fill('[name=lote]', 'L-2611-020');
  await page.selectOption('[name="dato-turno"]', 'Tarde');
  await page.click('text=Crear lote');
  await page.waitForSelector('#cl-0');
  let d = await lote('L-2611-020');
  assert.equal(d.cab.productoId, 'pr-ao05');
  assert.equal(d.final.cantPorUnidad, '960', 'la cantidad por pallet viene del producto');
  assert.equal(d.final.unidades.length, 4);
  assert.deepEqual(d.cab.extra, { inductora: 'Inductora 1', turno: 'Tarde' });
  paso('elegir un producto del catálogo completa plantilla, rangos, datos del lote y cantidades');

  // ── Otro producto con otra plantilla; después uno nuevo que se guarda en el catálogo ──
  await page.click('[data-act=inicio]');
  await page.click('text=+ Nuevo lote');
  // Por código y con Enter: completa y pasa al n° de lote, sin crear el lote a medio llenar
  const lotesAntes = await page.evaluate(() => Store.lotes().length);
  await page.fill('[name=prod]', 'YF-190');
  await page.press('[name=prod]', 'Enter');
  await page.waitForSelector('text=Completado desde el catálogo');
  assert.equal(await page.evaluate(() => Store.lotes().length), lotesAntes, 'Enter en el producto no crea el lote');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'lote');
  assert.equal(await page.inputValue('[name=plantilla]'), 'alimentos', 'cambia a la plantilla del producto');
  assert.equal(await page.inputValue('[name="min-temp"]'), '2');
  assert.equal(await page.inputValue('[name="dato-equipo"]'), 'Envasadora 3');
  assert.equal(await page.locator('[name=guardarProducto]').count(), 0, 'un producto que ya está no se ofrece guardar');
  await producto('Yogur durazno 190 g');
  await page.waitForSelector('[name=guardarProducto]');
  assert.equal(await page.locator('text=Completado desde el catálogo').count(), 0, 'otro producto: ya no figura como del catálogo');
  assert.equal(await page.inputValue('[name="max-peso"]'), '196', 'lo ya completado se conserva para editarlo');
  await page.fill('[name="max-temp"]', '5');
  await page.fill('[name=lote]', 'Y-2611-040');
  await page.selectOption('[name="dato-turno"]', 'Mañana');
  await page.check('[name=guardarProducto]');
  await page.click('text=Crear lote');
  await page.waitForSelector('#aviso.visible >> text=producto guardado en el catálogo');
  const nuevo = await page.evaluate(() => Store.perfil().config.productos.find(p => p.nombre === 'Yogur durazno 190 g'));
  assert.equal(nuevo.plantillaId, 'alimentos');
  assert.deepEqual(nuevo.rangos.temp, { min: '2', max: '5' });
  assert.equal(nuevo.extra.equipo, 'Envasadora 3');
  assert.equal((await lote('Y-2611-040')).cab.productoId, '', 'el lote se creó antes de que el producto existiera');
  paso('un producto nuevo se guarda en el catálogo desde el lote');

  // ── ⚙ Productos ──
  await page.click('[data-act=config]');
  await page.waitForSelector('#productos');
  assert.equal(await page.locator('#productos .fila-plantilla').count(), 4);
  await page.click('#productos >> text=+ Nuevo producto');
  await page.fill('[data-form=producto] [name=nombre]', 'aceite girasol 1,5 l');
  await page.click('text=Guardar producto');
  await page.waitForSelector('#aviso.visible >> text=Ya hay un producto llamado');
  await page.fill('[data-form=producto] [name=nombre]', 'Vinagre 1 L');
  await page.fill('[data-form=producto] [name=codigo]', 'VA-1');
  await page.fill('[name="min-peso"]', '11');
  await page.fill('[name="max-peso"]', '10');
  await page.click('text=Guardar producto');
  await page.waitForSelector('#aviso.visible >> text=el mínimo es mayor que el máximo');
  await page.fill('[name="min-peso"]', '9.8');
  await page.fill('[name="max-peso"]', '10.3');
  await page.fill('[name=cantPorUnidad]', '1000');
  await page.selectOption('[data-form=producto] [name="dato-inductora"]', 'Inductora 1');
  assert.equal(await page.evaluate(() => document.querySelector('[data-form=producto] [name="dato-turno"]').required), false,
    'en el producto los datos son por defecto: ninguno es obligatorio');
  await foto('prod-02-ficha');
  await page.click('text=Guardar producto');
  await page.waitForSelector('#productos >> text=Vinagre 1 L');
  // Cambiar la plantilla de un producto muestra los rangos de la otra
  await page.click('#productos .fila-plantilla:has-text("Yogur durazno") >> text=Editar');
  assert.equal(await page.locator('[name="min-temp"]').count(), 1);
  await page.fill('[data-form=producto] [name=codigo]', 'YD-190');
  await page.selectOption('[data-form=producto] [name=plantilla]', 'agro');
  await page.waitForSelector('[name="dato-inductora"]');
  assert.equal(await page.locator('[name="min-temp"]').count(), 0);
  assert.equal(await page.inputValue('[data-form=producto] [name=codigo]'), 'YD-190', 'cambiar la plantilla no borra lo escrito');
  await page.click('[data-form=producto] >> text=Cancelar');
  // Borrar un producto: los lotes hechos con él no cambian
  await page.click('#productos .fila-plantilla:has-text("Aceite oliva") >> text=Borrar');
  await page.waitForSelector('#aviso.visible >> text=Producto borrado');
  assert.match(dialogos.pop(), /Los lotes ya creados no cambian/);
  d = await lote('L-2611-020');
  assert.deepEqual(d.cab.rangos.peso, { min: '9.6', max: '10.2' });
  await foto('prod-03-lista');
  paso('⚙ Productos: alta con validación, cambio de plantilla, borrar sin tocar lotes');

  // ── Un inspector usa el catálogo pero no lo administra ──
  await page.evaluate(() => Store.setPerfil(Object.assign({}, Store.perfil(), { rol: 'checker' })));
  await page.click('[data-act=inicio]');
  await page.click('text=+ Nuevo lote');
  await producto('Producto que no está');
  assert.equal(await page.locator('[name=guardarProducto]').count(), 0, 'solo Administración guarda en el catálogo');
  await producto('VA-1');
  await page.waitForSelector('text=Completado desde el catálogo');
  await page.click('[data-act=inicio]');
  await page.click('[data-act=config]');
  assert.equal(await page.locator('#productos').count(), 0);
  paso('el inspector usa el catálogo pero no lo modifica');

  assert.deepEqual(errores, []);
  console.log('\nProductos: OK');
  await browser.close();
  srv.close();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
