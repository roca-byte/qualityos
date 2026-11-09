// Pruebas de las reglas de No Conformidades (js/reglas.js). Correr con:  node --test 'tests/*.test.js'
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reglas.js');

const PESO = { id: 'peso', nombre: 'Peso por pico', tipo: 'medicion', unidad: 'kg', lecturas: 2, tolerancia: 'fija', min: 10, max: 11, obligatorio: true };
const QR = { id: 'qr', nombre: 'QR', tipo: 'okNok', reproceso: true, obligatorio: true };
const ROT = { id: 'rot', nombre: 'Rotulado / etiqueta incorrecta', tipo: 'okNok', reproceso: true, obligatorio: true };

function loteConDesvios() {
  const p = { nombre: 'Prueba', unidad: 'Pallet', unidades: 'Pallets', cantidad: 'L', linea: [PESO, QR], final: [ROT] };
  const l = R.nuevoLote({ prod: 'Jugo 1 L', lote: 'J-77', cliente: 'Cliente Uno', fecha: '2026-11-06' }, p, 0);
  const u = (n, v, r, obs) => Object.assign(R.nuevaUnidad(n), { v, r: r || {}, obs: obs || '' });
  l.linea = [
    u(1, { peso: ['9.5', '10.2'], qr: true }),
    u(2, { peso: ['10.5', '9.8'], qr: false }, { qr: true }, 'se reetiquetó'),
    u(3, { peso: ['9.6', '9.7'], qr: true }, {}, 'pico 3 tapado')
  ];
  l.final.unidades = [u(1, { rot: false })];
  return l;
}

test('NC desde un lote: un control que falla en varias unidades es una sola NC', () => {
  const tipos = [{ nombre: 'Rotulado / etiqueta incorrecta', sev: 'Moderado' }];
  const ncs = R.ncsDesdeLote(loteConDesvios(), 'lote-1', tipos, 5, []);
  assert.equal(ncs.length, 3, 'peso (3 pallets) + QR reprocesado + rotulado del control final');
  const [peso, qr, rot] = ncs;
  assert.equal(peso.desc, 'Peso por pico · Pallet 1: fuera de rango (9.5 / 10.2 kg); Pallet 2: fuera de rango (10.5 / 9.8 kg) — se reetiquetó; ' +
    'Pallet 3: fuera de rango (9.6 / 9.7 kg) — pico 3 tapado');
  assert.equal(peso.estado, 'abierta');
  assert.equal(peso.plazo, '2026-11-13', '5 días hábiles desde la fecha del lote');
  assert.equal(peso.loteId, 'lote-1'); assert.equal(peso.lote, 'J-77'); assert.equal(peso.cliente, 'Cliente Uno');
  assert.equal(peso.unidadCant, 'L');
  assert.equal(qr.estado, 'cerrada', 'lo reprocesado en el momento entra cerrado');
  assert.equal(qr.cierre, '2026-11-06'); assert.equal(qr.plazo, '');
  assert.equal(rot.deteccion, 'Control final');
  assert.equal(rot.tipo, 'Rotulado / etiqueta incorrecta', 'si el control coincide con un tipo, se usa');
  assert.equal(rot.sev, 'Moderado');
  ncs.forEach(d => assert.equal(R.validarNc(d), null));
  // Volver a crear desde el mismo lote no duplica
  assert.equal(R.ncsDesdeLote(loteConDesvios(), 'lote-1', tipos, 5, ncs.map(d => d.origen)).length, 0);
});

test('validar NC (lo mismo que exige el servidor)', () => {
  const ok = R.nuevaNc({ fecha: '2026-11-05', tipo: 'Envase dañado' });
  assert.equal(R.validarNc(ok), null);
  assert.match(R.validarNc(Object.assign({}, ok, { fecha: '' })), /fecha de detección/);
  assert.match(R.validarNc(Object.assign({}, ok, { tipo: '', desc: ' ' })), /tipo de desvío/);
  assert.match(R.validarNc(Object.assign({}, ok, { estado: 'cerrada' })), /fecha de cierre/);
  assert.match(R.validarNc(Object.assign({}, ok, { sev: 'Grave' })), /Gravedad/);
});

test('plazo automático: se recalcula con la fecha salvo que se haya puesto a mano', () => {
  const d = R.nuevaNc({ fecha: '2026-11-06' }, 3);
  assert.equal(d.plazo, '2026-11-11');
  d.fecha = '2026-11-09'; R.actualizarPlazo(d, 3);
  assert.equal(d.plazo, '2026-11-12');
  d.plazo = '2026-12-01'; d.fecha = '2026-11-10'; R.actualizarPlazo(d, 3);
  assert.equal(d.plazo, '2026-12-01', 'un plazo puesto a mano no se pisa');
  assert.equal(R.plazoNcDias({ ncPlazoDias: '10' }), 10);
  assert.equal(R.plazoNcDias({}), 5);
});

test('vista por mes y de abiertas', () => {
  const l = [{ fecha: '2026-10-30', estado: 'abierta' }, { fecha: '2026-11-02', estado: 'cerrada' }, { fecha: '2026-11-03', estado: 'en_proceso' }];
  assert.deepEqual(R.mesesNc(l, '2026-11'), ['2026-11', '2026-10']);
  assert.deepEqual(R.mesesNc([], '2026-12'), ['2026-12']);
  assert.equal(R.filtrarNc(l, '2026-11').length, 2);
  assert.deepEqual(R.filtrarNc(l, 'abiertas').map(d => d.fecha), ['2026-10-30', '2026-11-03']);
  assert.equal(R.nombreMes('2026-11'), 'Noviembre 2026');
});

test('indicadores del registro', () => {
  const k = R.kpisNc([
    { estado: 'cerrada', tipo: 'A', sev: 'Leve', cantNC: '10', cantTot: '100', plazo: '2026-11-10', cierre: '2026-11-09' },
    { estado: 'cerrada', tipo: 'A', sev: 'Crítico', cantNC: '5', cantTot: '100', plazo: '2026-11-10', cierre: '2026-11-12' },
    { estado: 'abierta', tipo: 'B', sev: 'Crítico', plazo: '2000-01-01' },
    { estado: 'anulada', tipo: 'B', sev: 'Crítico', cantNC: '999', cantTot: '1000' }
  ]);
  assert.equal(k.total, 3); assert.equal(k.abiertas, 1);
  assert.equal(k.tasa, 7.5);
  assert.equal(k.masFrecuente.tipo, 'A');
  assert.equal(k.enPlazo, 50);
  assert.equal(k.vencidas, 1);
  assert.deepEqual(k.sev, { Leve: 1, Moderado: 0, 'Crítico': 2 });
  const v = R.kpisNc([]);
  assert.equal(v.tasa, null); assert.equal(v.masFrecuente, null); assert.equal(v.enPlazo, null);
});

test('tipos de desvío de la empresa', () => {
  assert.equal(R.tiposNc({}).length, R.TIPOS_NC_INICIALES.length, 'sin configurar, los iniciales');
  assert.deepEqual(R.tiposNc({ tiposNc: [] }), [], 'una lista vacía guardada a propósito se respeta');
  assert.deepEqual(R.normalizarTiposNc([{ nombre: ' Sabor ', sev: 'Crítico' }, { nombre: 'sabor', sev: 'Leve' }, { nombre: '', sev: 'Leve' }, { nombre: 'X', sev: 'Raro' }]),
    [{ nombre: 'Sabor', sev: 'Crítico' }, { nombre: 'X', sev: '' }]);
  R.TIPOS_NC_INICIALES.forEach(t => assert.ok(R.SEVERIDADES.includes(t.sev)));
});

test('importar del registro individual (calidad-no-conformidades)', () => {
  const d = R.desdeRegistroIndividual({ id: 'abc', fecha: '2026-10-20', lote: 'A-1', prod: 'Herbicida', tipo: 'Inducción débil', sev: 'Crítico',
    detec: 'CONTROL LÍNEA', litNC: '200', litTot: '4000', est: 'Finalizado', cierre: '2026-10-22', eficacia: 'Eficaz', resp: 'Laura' });
  assert.equal(d.estado, 'cerrada'); assert.equal(d.eficacia, 'eficaz'); assert.equal(d.deteccion, 'Control en línea');
  assert.equal(d.cantNC, '200'); assert.equal(d.unidadCant, 'L'); assert.equal(d.importadoDe, 'abc');
  assert.equal(R.validarNc(d), null);
  assert.equal(R.desdeRegistroIndividual({ est: 'Anulado', fecha: '2026-10-01', desc: 'x' }).estado, 'anulada');
  assert.match(R.validarNc(R.desdeRegistroIndividual({ est: 'Pendiente' })), /fecha/, 'una fila sin fecha no pasa');
});
