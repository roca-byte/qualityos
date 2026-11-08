// Pruebas de js/reglas.js. Correr con:  node --test 'tests/*.test.js'
// Usan solo lo que trae Node (node:test), sin instalar nada.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reglas.js');

const PESO = { id: 'peso', nombre: 'Peso por pico', tipo: 'medicion', unidad: 'kg', lecturas: 4, tolerancia: 'lote', obligatorio: true };
const IND = { id: 'ind', nombre: 'Inducción', tipo: 'medicion', unidad: '', lecturas: 1, tolerancia: 'fija', min: 1.0, max: 1.4, semaforo: true, reproceso: true, obligatorio: true };
const QR = { id: 'qr', nombre: 'QR', tipo: 'okNok', reproceso: true, obligatorio: true };
const LOTE_ENV = { id: 'le', nombre: 'Lote en envase', tipo: 'texto', obligatorio: true };
const VENC = { id: 'fv', nombre: 'Vencimiento', tipo: 'fecha', obligatorio: false };
const CAB = { rangos: { peso: { min: '10', max: '11' } } };

function unidad(v, r) { return Object.assign(R.nuevaUnidad(1), { v: v || {}, r: r || {} }); }
function lote(final, unidades, extra) {
  const p = { nombre: 'Prueba', unidad: 'Pallet', unidades: 'Pallets', cantidad: 'L', linea: [PESO, IND, QR], final: final };
  const l = R.nuevoLote(CAB, p, 0);
  l.final.unidades = unidades;
  return Object.assign(l, extra || {});
}

test('semáforo: dentro, cerca y lejos de la tolerancia', () => {
  const r = { min: 1.0, max: 1.4 };
  assert.equal(R.semaforo('1.2', r), 'ok');
  assert.equal(R.semaforo('1,0', r), 'ok', 'acepta coma decimal');
  assert.equal(R.semaforo('1.5', r), 'warn', 'hasta 30 % del rango por fuera');
  assert.equal(R.semaforo('2', r), 'nok');
  assert.equal(R.semaforo('', r), '');
  assert.equal(R.semaforo('5', { min: NaN, max: 4 }), 'nok', 'con un solo límite no hay amarillo');
  assert.equal(R.semaforo('3', { min: NaN, max: 4 }), 'ok');
});

test('rango: fijo en la plantilla, cargado en el lote o ninguno', () => {
  assert.deepEqual(R.rango(IND, {}), { min: 1.0, max: 1.4 });
  assert.deepEqual(R.rango(PESO, CAB), { min: 10, max: 11 });
  assert.equal(R.rango(PESO, { rangos: {} }), null, 'sin rango en el lote no se juzga');
  assert.equal(R.rango(Object.assign({}, PESO, { tolerancia: 'ninguna' }), CAB), null);
  assert.equal(R.rango(QR, CAB), null);
});

test('medición: lecturas, promedio, fuera de rango y reproceso', () => {
  assert.equal(R.evaluar(PESO, ['10.5', '', '', ''], false, CAB).estado, 'pendiente', 'faltan lecturas');
  const e = R.evaluar(PESO, ['10', '11', '10.5', '10.5'], false, CAB);
  assert.equal(e.estado, 'ok');
  assert.equal(e.promedio, 10.5);
  assert.equal(R.evaluar(PESO, ['10.5', '11.6', '', ''], false, CAB).estado, 'nok', 'un pico afuera alcanza');
  assert.equal(R.evaluar(PESO, ['10.5', '11.6', '', ''], true, CAB).estado, 'repro');
  assert.equal(R.evaluar(IND, ['1.2'], false, {}).sem, 'ok');
  assert.equal(R.evaluar(IND, ['1.5'], false, {}).sem, 'warn');
  assert.equal(R.evaluar(IND, ['1.5'], false, {}).estado, 'nok', 'amarillo también es fuera de tolerancia');
  assert.equal(R.evaluar(Object.assign({}, PESO, { tolerancia: 'ninguna' }), ['1', '2', '3', '4'], false, CAB).estado, 'ok', 'sin tolerancia solo se registra');
});

test('OK/NOK, texto y fecha', () => {
  assert.equal(R.evaluar(QR, null).estado, 'pendiente');
  assert.equal(R.evaluar(QR, true).estado, 'ok');
  assert.equal(R.evaluar(QR, false).estado, 'nok');
  assert.equal(R.evaluar(QR, false, true).estado, 'repro');
  assert.equal(R.evaluar(LOTE_ENV, '').estado, 'pendiente');
  assert.equal(R.evaluar(LOTE_ENV, 'L-1').estado, 'ok');
  assert.ok(R.vacio(VENC, '') && !R.vacio(VENC, '2026-11-11'));
});

test('unidad del control en línea', () => {
  const items = [PESO, IND, QR];
  assert.equal(R.estadoUnidadLinea(items, unidad(), CAB), 'pendiente');
  assert.equal(R.estadoUnidadLinea(items, unidad({ qr: true }), CAB), 'ok');
  assert.equal(R.estadoUnidadLinea(items, unidad({ qr: false }, { qr: true }), CAB), 'repro');
  assert.equal(R.estadoUnidadLinea(items, unidad({ qr: true, peso: ['12'] }), CAB), 'nok', 'peso fuera de rango manda');
});

test('unidad del control final: obligatorios, NOK y reproceso', () => {
  const items = [QR, LOTE_ENV, VENC];
  assert.equal(R.estadoUnidadFinal(items, unidad({ qr: true, le: 'L-1' }), CAB), 'aprobado', 'el vencimiento no es obligatorio');
  assert.equal(R.estadoUnidadFinal(items, unidad({ qr: true }), CAB), 'pendiente');
  assert.equal(R.estadoUnidadFinal(items, unidad({ qr: false, le: 'L-1' }), CAB), 'retenido');
  assert.equal(R.estadoUnidadFinal(items, unidad({ qr: false, le: 'L-1' }, { qr: true }), CAB), 'aprobado', 'NOK reprocesado cuenta como corregido');
  assert.deepEqual(R.faltantes(items, unidad({ qr: true })).map(i => i.nombre), ['Lote en envase']);
});

test('resumen final con cantidad por unidad y propia', () => {
  const l = lote([QR], [unidad({ qr: true }), Object.assign(unidad({ qr: true }), { cant: '300' }), unidad({ qr: false }), unidad({})]);
  l.final.cantPorUnidad = '1000';
  const r = R.resumenFinal(l);
  assert.deepEqual([r.aprobados, r.retenidos, r.pendientes], [2, 1, 1]);
  assert.equal(r.cantAprobada, 1300);
  assert.equal(r.cantRetenida, 1000);
  l.plantilla.cantidad = '';
  assert.equal(R.resumenFinal(l).cantAprobada, null, 'sin cantidad en la plantilla se informa en unidades');
});

test('dictamen sugerido y unidades faltantes', () => {
  assert.equal(R.sugerirDictamen(lote([QR], [])), null);
  assert.equal(R.sugerirDictamen(lote([QR], [unidad()])), null, 'todo pendiente');
  assert.equal(R.sugerirDictamen(lote([QR], [unidad({ qr: true })])), 'APROBADO');
  assert.equal(R.sugerirDictamen(lote([QR], [unidad({ qr: false })])), 'RETENIDO');
  assert.equal(R.sugerirDictamen(lote([QR], [unidad({ qr: true }), unidad({ qr: false })])), 'APROBADO_PARCIAL');
  assert.deepEqual(R.unidadesFaltantes(lote([QR, LOTE_ENV], [unidad({ qr: true, le: 'x' }), unidad({ qr: true })])),
    [{ numero: 2, campos: ['Lote en envase'] }]);
});

test('desvíos para el registro de NC', () => {
  const l = lote([QR], [unidad({ qr: false }, { qr: true })]);
  l.linea = [unidad({ peso: ['20'], qr: false })];
  const d = R.desvios(l);
  assert.deepEqual(d.map(x => x.control + (x.corregido ? '*' : '')), ['Peso por pico', 'QR', 'QR*']);
  assert.match(d[0].detalle, /fuera de rango \(20 kg\)/);
});

test('plantillas de ejemplo por rubro: todas válidas', () => {
  for (const clave of Object.keys(R.EJEMPLOS)) {
    const p = R.plantillaEjemplo(clave);
    assert.equal(R.validarPlantilla(p), '', clave);
    const ids = p.linea.concat(p.final).map(i => i.id);
    assert.equal(new Set(ids).size, ids.length, clave + ': ids únicos');
  }
});

test('validar plantilla', () => {
  const p = R.plantillaEjemplo('blanco');
  assert.equal(R.validarPlantilla(Object.assign({}, p, { nombre: ' ' })), 'La plantilla necesita un nombre.');
  assert.match(R.validarPlantilla(Object.assign({}, p, { linea: [], final: [] })), /al menos un ítem/);
  const malo = Object.assign({}, p, { linea: [{ id: 'x', nombre: 'Temp', tipo: 'medicion', tolerancia: 'fija', min: 5, max: 2 }] });
  assert.match(R.validarPlantilla(malo), /mínimo es mayor/);
});

test('lote del formato anterior se convierte sin perder datos', () => {
  const viejo = {
    estado: 'aprobado',
    cab: { prod: 'Aceite', lote: 'L1', cliente: 'X', linea: 'Env-04', fecha: '2026-11-07', indId: 'B', pesoMin: '10', pesoMax: '11', checker: 'Ana' },
    linea: [{ nPal: '1', hora: '07:10', p1: '10.5', p2: '12', p3: '', p4: '', lote: 'L-1', codProd: '77', fProd: '2026-11-07', fVenc: '2027-11-07',
      indOK: true, indVal: '1.2', repro: false, qrLineaOK: true, qrRepro: false, packOK: false, packRepro: true, pltOK: true, pltRepro: false, obs: 'ok' }],
    final: { ltsPorPallet: '1000', dictamen: 'APROBADO', fechaDictamen: 'x', dictaminadoPor: 'Ana', dictaminadoRol: 'Checker',
      pallets: [{ idOK: true, qrOK: true, paletOK: true, indCFOK: true, litrosParcial: '', obs: '' }] },
    hallazgos: []
  };
  const config = { inductoras: [{ id: 'A', nombre: 'Uno', tolMin: 1.0, tolMax: 1.4 }, { id: 'B', nombre: 'Dos', tolMin: 0.9, tolMax: 1.3 }] };
  const n = R.migrarLote(viejo, config);
  assert.equal(n.formato, 2);
  assert.deepEqual(n.cab.rangos.peso, { min: '10', max: '11' });
  assert.equal(R.estadoUnidadLinea(n.plantilla.linea, n.linea[0], n.cab), 'nok', 'el pico de 12 kg sigue siendo desvío');
  assert.equal(n.linea[0].r.pack, true);
  assert.equal(R.rango(n.plantilla.linea.find(i => i.id === 'ind'), n.cab).max, 1.3, 'toma la tolerancia de la inductora del lote');
  assert.equal(R.resumenFinal(n).cantAprobada, 1000);
  assert.match(n.hallazgos[0].txt, /Inductora usada: Dos/);
  assert.equal(R.migrarLote(n), n, 'un lote nuevo no se toca');
});

test('normalizar cliente y fechas locales', () => {
  assert.equal(R.normalizarCliente('  coca   cola SA '), 'Coca Cola SA');
  assert.equal(R.hoy(new Date(2026, 10, 7, 23, 30)), '2026-11-07');
  assert.equal(R.fechaLarga('2026-11-07'), '07/11/2026');
  assert.equal(R.estadoPorDictamen('APROBADO_PARCIAL'), 'aprobado_parcial');
});
