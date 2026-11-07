// Pruebas de js/reglas.js. Correr con:  node --test tests/
// Usan solo lo que trae Node (node:test), sin instalar nada.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reglas.js');

const IND = { id: 'A', nombre: 'DCGY', tolMin: 1.0, tolMax: 1.4, semaforo: true };

function palletFinal(valores) { return Object.assign(R.nuevoPalletFinal(), valores); }
const TODO_OK = { idOK: true, qrOK: true, paletOK: true, indCFOK: true };

function lote(pallets, extra) {
  const l = R.nuevoLote({ prod: 'Aceite', lote: 'L1', pesoMin: '10', pesoMax: '11' }, 0);
  l.final.pallets = pallets;
  return Object.assign(l, extra || {});
}

test('semáforo: dentro, cerca y lejos de la tolerancia', () => {
  assert.equal(R.semaforo('1.2', IND), 'ok');
  assert.equal(R.semaforo('1,0', IND), 'ok', 'acepta coma decimal');
  assert.equal(R.semaforo('1.5', IND), 'warn', 'hasta 30 % del rango por fuera');
  assert.equal(R.semaforo('0.88', IND), 'warn');
  assert.equal(R.semaforo('2', IND), 'nok');
  assert.equal(R.semaforo('', IND), '');
  assert.equal(R.semaforo('1.2', Object.assign({}, IND, { semaforo: false })), '');
  assert.equal(R.semaforo('1.2', null), '');
});

test('peso: todos los picos cargados dentro del rango', () => {
  const cab = { pesoMin: '10', pesoMax: '11' };
  assert.equal(R.pesoOK({ p1: '10.5', p2: '', p3: '', p4: '' }, cab), true);
  assert.equal(R.pesoOK({ p1: '10.5', p2: '11.2', p3: '', p4: '' }, cab), false);
  assert.equal(R.pesoOK({ p1: '', p2: '', p3: '', p4: '' }, cab), null, 'sin picos no se juzga');
  assert.equal(R.pesoOK({ p1: '50' }, { pesoMin: '', pesoMax: '' }), null, 'sin rango no se juzga');
  assert.equal(R.promedioPeso({ p1: '10', p2: '11', p3: '', p4: '' }), 10.5);
});

test('pallet de control en línea: NOK, reproceso y peso', () => {
  const cab = { pesoMin: '10', pesoMax: '11' };
  const p = R.nuevoPalletLinea(1);
  assert.equal(R.estadoPalletLinea(p, cab), 'pendiente');
  p.indOK = true;
  assert.equal(R.estadoPalletLinea(p, cab), 'ok');
  p.packOK = false;
  assert.equal(R.estadoPalletLinea(p, cab), 'nok');
  p.packRepro = true;
  assert.equal(R.estadoPalletLinea(p, cab), 'repro');
  p.p1 = '12';
  assert.equal(R.estadoPalletLinea(p, cab), 'nok', 'peso fuera de rango manda');
});

test('pallet de control final: aprobado, retenido, pendiente', () => {
  assert.equal(R.estadoPalletFinal(palletFinal(TODO_OK)), 'aprobado');
  assert.equal(R.estadoPalletFinal(palletFinal(Object.assign({}, TODO_OK, { qrOK: false }))), 'retenido');
  assert.equal(R.estadoPalletFinal(palletFinal(Object.assign({}, TODO_OK, { qrOK: false, qrRepro: true }))), 'aprobado',
    'NOK reprocesado cuenta como corregido');
  assert.equal(R.estadoPalletFinal(palletFinal({ idOK: true })), 'pendiente');
  // En la versión vieja un pallet con un solo reproceso y el resto sin controlar
  // contaba como aprobado. Ahora exige todos los checks.
  assert.equal(R.estadoPalletFinal(palletFinal({ idOK: false, idRepro: true })), 'pendiente');
});

test('resumen final: litros por pallet y litros propios', () => {
  const l = lote([
    palletFinal(TODO_OK),
    palletFinal(Object.assign({}, TODO_OK, { litrosParcial: '300' })),
    palletFinal(Object.assign({}, TODO_OK, { indCFOK: false })),
    palletFinal({})
  ]);
  l.final.ltsPorPallet = '1000';
  const r = R.resumenFinal(l);
  assert.deepEqual([r.aprobados, r.retenidos, r.pendientes], [2, 1, 1]);
  assert.equal(r.ltsAprobados, 1300);
  assert.equal(r.ltsRetenidos, 1000);
  l.final.ltsPorPallet = '';
  l.final.pallets[1].litrosParcial = '';
  assert.equal(R.resumenFinal(l).ltsAprobados, null, 'sin litros cargados se informa en pallets');
});

test('dictamen sugerido', () => {
  assert.equal(R.sugerirDictamen(lote([])), null);
  assert.equal(R.sugerirDictamen(lote([palletFinal({})])), null, 'todo pendiente');
  assert.equal(R.sugerirDictamen(lote([palletFinal(TODO_OK)])), 'APROBADO');
  assert.equal(R.sugerirDictamen(lote([palletFinal(Object.assign({}, TODO_OK, { idOK: false }))])), 'RETENIDO');
  assert.equal(R.sugerirDictamen(lote([palletFinal(TODO_OK), palletFinal(Object.assign({}, TODO_OK, { idOK: false }))])),
    'APROBADO_PARCIAL');
});

test('pallets faltantes en control final', () => {
  const f = R.palletsFaltantes(lote([palletFinal(TODO_OK), palletFinal({ idOK: true, qrOK: false })]));
  assert.deepEqual(f, [{ numero: 2, campos: ['Estado del pallet', 'Inducción'] }]);
});

test('estado por dictamen conserva el parcial', () => {
  assert.equal(R.estadoPorDictamen('APROBADO_PARCIAL'), 'aprobado_parcial');
  assert.equal(R.estadoPorDictamen('RETENIDO'), 'retenido');
  assert.equal(R.estadoPorDictamen(null), 'activo');
});

test('normalizar cliente', () => {
  assert.equal(R.normalizarCliente('  coca   cola SA '), 'Coca Cola SA');
  assert.equal(R.normalizarCliente(''), '');
});

test('desvíos para el registro de NC', () => {
  const l = lote([palletFinal(Object.assign({}, TODO_OK, { qrOK: false, qrRepro: true }))]);
  const p = R.nuevoPalletLinea(1);
  p.indOK = false; p.p1 = '20';
  l.linea = [p];
  const d = R.desvios(l);
  assert.deepEqual(d.map(x => x.control + (x.corregido ? '*' : '')), ['Inducción', 'Peso', 'Trazabilidad / QR*']);
});

test('fecha local, no UTC', () => {
  // 23:30 del 7/11 en hora local tiene que seguir siendo el 7/11.
  assert.equal(R.hoy(new Date(2026, 10, 7, 23, 30)), '2026-11-07');
  assert.equal(R.fechaLarga('2026-11-07'), '07/11/2026');
});
