// Pruebas del control en línea por horario (js/reglas.js). Correr con:  node --test 'tests/*.test.js'
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reglas.js');

function lote(cadaMin, horas, fecha) {
  const p = Object.assign(R.plantillaEjemplo('blanco'), { frecuencia: { modo: 'horario', cadaMin } });
  const l = R.nuevoLote({ prod: 'X', lote: 'L1', fecha: fecha || '2026-11-09' }, p, 0);
  l.linea = horas.map((h, i) => Object.assign(R.nuevaUnidad(i + 1), { hora: h }));
  return l;
}

test('frecuencia y su texto', () => {
  assert.deepEqual(R.frecuencia({}), { modo: 'unidad', cadaMin: 0 }, 'las plantillas de antes son por unidad');
  assert.deepEqual(R.frecuencia({ frecuencia: { modo: 'horario', cadaMin: 0 } }), { modo: 'unidad', cadaMin: 0 }, 'sin intervalo no hay horario');
  assert.equal(R.textoFrecuencia({ frecuencia: { modo: 'horario', cadaMin: 120 } }), 'cada 2 h');
  assert.equal(R.textoFrecuencia({ frecuencia: { modo: 'horario', cadaMin: 90 } }), 'cada 1 h 30 min');
  assert.equal(R.textoFrecuencia({ frecuencia: { modo: 'horario', cadaMin: 45 } }), 'cada 45 min');
  assert.equal(R.textoFrecuencia({}), '');
  assert.equal(R.frecuencia(R.plantillaEjemplo('alimentos')).modo, 'horario', 'el ejemplo de alimentos es cada 2 h');
});

test('próximo control: cada X desde el último', () => {
  assert.deepEqual(R.proximoControl(lote(120, [])), { primero: true });
  assert.deepEqual(R.proximoControl(lote(120, ['', ''])), { primero: true }, 'controles sin hora no cuentan');
  const p = R.proximoControl(lote(120, ['08:05', '10:10']));
  assert.equal(p.hora, '12:10'); assert.equal(p.fecha, '2026-11-09');
  assert.equal(R.controlAtrasado(lote(120, ['08:05', '10:10']), new Date(2026, 10, 9, 12, 10)), false, 'justo a la hora todavía no');
  assert.equal(R.controlAtrasado(lote(120, ['08:05', '10:10']), new Date(2026, 10, 9, 12, 11)), true);
});

test('turno noche: pasar la medianoche', () => {
  const l = lote(120, ['22:00', '23:50', '01:40']);
  const p = R.proximoControl(l);
  assert.equal(p.hora, '03:40'); assert.equal(p.fecha, '2026-11-10');
  const p2 = R.proximoControl(lote(180, ['22:30']));
  assert.equal(p2.hora, '01:30'); assert.equal(p2.fecha, '2026-11-10', 'el próximo cae al otro día');
});

test('sin recordatorio: por unidad o lote dictaminado', () => {
  const porUnidad = lote(120, ['08:00']);
  porUnidad.plantilla.frecuencia = { modo: 'unidad' };
  assert.equal(R.proximoControl(porUnidad), null);
  const cerrado = lote(120, ['08:00']);
  cerrado.estado = 'aprobado';
  assert.equal(R.proximoControl(cerrado), null);
  assert.equal(R.controlAtrasado(cerrado, new Date(2030, 0, 1)), false);
});

test('cambiar la frecuencia pide versión nueva', () => {
  const a = R.plantillaEjemplo('agro');
  const b = R.copia(a);
  b.frecuencia = { modo: 'horario', cadaMin: 60 };
  assert.equal(R.cambioContenido(a, b), true);
});
