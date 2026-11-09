// Pruebas de lo que la app muestra de la firma (js/reglas.js). La firma en sí la hace el servidor:
// sus reglas se prueban en tests/sql/pruebas.sql.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/reglas.js');

test('texto de la firma: quién, rol, cuándo (hora local), qué significa y código', () => {
  const cuando = new Date(2026, 10, 9, 10, 32).toISOString();
  const t = R.textoFirma({ nombre: 'Laura Gómez', rol: 'checker', cuando, significado: 'Dictamen: APROBADO', codigo: '4F2A-91C0' });
  assert.equal(t, 'Firmado electrónicamente por Laura Gómez (Inspector de Calidad) · 09/11/2026 10:32 · Dictamen: APROBADO · Código de verificación 4F2A-91C0');
  assert.equal(R.textoFirma(null), '');
  assert.equal(R.fechaHora('no es fecha'), '');
});

test('qué queda pendiente de firma', () => {
  assert.equal(R.pendienteDeFirma('lote', { estado: 'activo' }, null), false, 'un lote en control todavía no se firma');
  assert.equal(R.pendienteDeFirma('lote', { estado: 'retenido' }, null), true);
  assert.equal(R.pendienteDeFirma('lote', { estado: 'aprobado' }, { codigo: 'X' }), false);
  assert.equal(R.pendienteDeFirma('nc', { estado: 'abierta' }, null), false);
  assert.equal(R.pendienteDeFirma('nc', { estado: 'cerrada' }, null), true);
  assert.equal(R.pendienteDeFirma('nc', { estado: 'anulada' }, null), false, 'una NC anulada no se firma');
});
