/* Supabase falso SOLO para las pruebas de la interfaz.
 * Reemplaza a vendor/supabase.js cuando corren tests/e2e/*.js y tools/demo.js.
 * Usa el mismo servidor de mentira que el modo demo (js/demo.js), guardando sus
 * datos en localStorage['__db'] para que las pruebas los puedan mirar o modificar.
 * Las reglas de seguridad de verdad se prueban contra Postgres en tests/sql/.
 */
(function () {
  if (!localStorage.getItem('__db')) {
    localStorage.setItem('__db', JSON.stringify({
      usuarios: { 'checker@uno.com': { id: 'u-1', email: 'checker@uno.com', clave: 'secreta1', confirmado: true } },
      plataforma: ['u-1'],          // dueños de la plataforma: pueden crear empresas
      confirmarEmail: false,        // true = como Supabase con "Confirm email" activado
      empresas: [], miembros: [], invitaciones: [], lotes: []
    }));
  }
  // Compatibilidad con pruebas que "tocan" el servidor: los datos se releen de localStorage
  // en cada operación, así que alcanza con cambiar localStorage['__db'].
  window.__db = {};
  window.__dbGuardar = function () {};
  // Demo (js/demo.js) se carga después que este archivo, pero createClient se llama más tarde.
  window.supabase = { createClient: function () { return Demo.cliente('__db'); } };
})();
