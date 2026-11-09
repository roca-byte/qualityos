// Pruebas del catálogo de productos (js/reglas.js). Correr con:  node --test 'tests/*.test.js'
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reglas.js');

const agro = Object.assign(R.plantillaEjemplo('agro'), { id: 'agro' });
const alim = Object.assign(R.plantillaEjemplo('alimentos'), { id: 'alim' });
const ACEITE = { id: 'p1', nombre: 'Aceite girasol 1,5 L', codigo: 'AG15', plantillaId: 'agro',
  rangos: { peso: { min: '10', max: '11' }, otro: { min: '1', max: '2' } }, cantPorUnidad: '1000', cantFinal: 6,
  extra: { inductora: 'Inductora 2', turno: '', noExiste: 'x' } };

test('buscar producto por nombre o código, sin importar mayúsculas ni espacios', () => {
  const lista = [ACEITE];
  assert.equal(R.buscarProducto(lista, '  aceite   GIRASOL 1,5 l '), ACEITE);
  assert.equal(R.buscarProducto(lista, 'ag15'), ACEITE);
  assert.equal(R.buscarProducto(lista, 'Aceite'), null, 'no completa con una coincidencia parcial');
  assert.equal(R.buscarProducto(lista, ''), null);
  assert.deepEqual(R.productos({}), []);
});

test('lo que el producto completa en el lote: solo lo que su plantilla tiene', () => {
  const v = R.valoresDeProducto(ACEITE, agro);
  assert.deepEqual(v.rangos, { peso: { min: '10', max: '11' } }, 'un rango de un ítem que la plantilla no tiene no se copia');
  assert.deepEqual(v.extra, { inductora: 'Inductora 2' }, 'ni un dato que la plantilla no pide, ni uno vacío');
  assert.equal(v.cantPorUnidad, '1000'); assert.equal(v.cantFinal, 6);
  assert.equal(v.prod, 'Aceite girasol 1,5 L'); assert.equal(v.productoId, 'p1');
  // Con otra plantilla (alimentos: peso, temp y tempF por lote) no trae los rangos de líquidos
  assert.deepEqual(R.valoresDeProducto({ nombre: 'Yogur', rangos: { peso: { min: 188, max: 196 } } }, alim).rangos, { peso: { min: '188', max: '196' } });
  assert.deepEqual(R.itemsConRango(alim).map(i => i.id), ['peso', 'temp', 'tempF']);
});

test('guardar como producto lo cargado en un lote', () => {
  const cab = { prod: ' Vinagre 1 L ', rangos: { peso: { min: '9.8', max: '10.3' }, ind: { min: '', max: '' } }, extra: { inductora: 'Inductora 1', turno: 'Tarde' } };
  const p = R.productoDesdeLote(cab, agro, 4, '900');
  assert.equal(p.nombre, 'Vinagre 1 L'); assert.equal(p.plantillaId, 'agro');
  assert.deepEqual(p.rangos, { peso: { min: '9.8', max: '10.3' } });
  assert.deepEqual(p.extra, { inductora: 'Inductora 1', turno: 'Tarde' });
  assert.equal(p.cantFinal, 4); assert.equal(p.cantPorUnidad, '900');
  assert.match(p.id, /^pr/);
});

test('validar producto', () => {
  const ps = [agro, alim];
  const lista = [ACEITE];
  assert.equal(R.validarProducto(ACEITE, lista, 0, ps), '', 'editarse a sí mismo no es repetirse');
  assert.match(R.validarProducto(Object.assign({}, ACEITE, { id: 'p2' }), lista, -1, ps), /Ya hay un producto llamado/);
  assert.match(R.validarProducto({ nombre: 'Otro', codigo: 'ag15', plantillaId: 'agro' }, lista, -1, ps), /código AG15|código ag15/);
  assert.match(R.validarProducto({ nombre: ' ', plantillaId: 'agro' }, lista, -1, ps), /necesita un nombre/);
  assert.match(R.validarProducto({ nombre: 'Otro', plantillaId: 'borrada' }, lista, -1, ps), /Elegí la plantilla/);
  assert.match(R.validarProducto({ nombre: 'Otro', plantillaId: 'agro', rangos: { peso: { min: '11', max: '10' } } }, lista, -1, ps), /Peso por pico": el mínimo es mayor/);
});
