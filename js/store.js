/* Store: los datos que viven en la tablet (localStorage).
 *
 * La planta muchas veces no tiene señal, así que la app SIEMPRE trabaja contra
 * esta copia local. Cada cambio marca el lote como "pendiente" (bandeja de
 * salida) y Nube.sincronizar() lo sube cuando hay conexión.
 *
 * Forma de los datos (clave 'qualityos.v1'):
 * {
 *   perfil: { userId, email, nombre, empresaId, empresa, rol, config } | null,
 *   guias: { <userId>: true },   // ya vio la bienvenida en este equipo
 *   empresas: {
 *     <empresaId>: {
 *       lotes: { <id>: { datos, version, modificado, borrado, pendiente, cambios, borrar } },
 *       ultimaBajada: '<fecha del servidor>' | null,
 *       conflictos: [{ id, datos, cuando }]
 *     }
 *   }
 * }
 * version   = la versión del servidor sobre la que se está editando (0 = nunca subió).
 * cambios   = contador de ediciones locales; sirve para saber si el usuario siguió
 *             editando mientras se subía (en ese caso queda pendiente).
 */
var Store = (function () {
  'use strict';

  var CLAVE = 'qualityos.v1';
  var estado = leer();

  function leer() {
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE));
      if (s && s.empresas) return s;
    } catch (e) { /* datos rotos: se arranca de cero */ }
    return { perfil: null, empresas: {} };
  }

  function guardar() {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  }

  function nuevoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Navegadores viejos: UUID v4 armado a mano.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function empresa() {
    var id = estado.perfil && estado.perfil.empresaId;
    if (!id) throw new Error('No hay empresa elegida');
    if (!estado.empresas[id]) estado.empresas[id] = { lotes: {}, ultimaBajada: null, conflictos: [] };
    return estado.empresas[id];
  }

  // ── Perfil (quién está usando la tablet y en qué empresa) ──
  function perfil() { return estado.perfil; }
  function setPerfil(p) { estado.perfil = p; guardar(); }

  // ── Bienvenida: se muestra una vez por persona en cada equipo ──
  function guiaVista(userId) { return !!(estado.guias && estado.guias[userId]); }
  function marcarGuiaVista(userId) {
    estado.guias = estado.guias || {};
    estado.guias[userId] = true;
    guardar();
  }

  // ── Lotes ──
  function lotes() {
    var ls = empresa().lotes;
    return Object.keys(ls).map(function (id) { return conId(id, ls[id]); })
      .filter(function (l) { return !l.borrado && !l.borrar; });
  }

  function conId(id, reg) {
    return { id: id, datos: reg.datos, version: reg.version, modificado: reg.modificado, pendiente: reg.pendiente };
  }

  function lote(id) {
    var reg = empresa().lotes[id];
    return reg && !reg.borrado && !reg.borrar ? conId(id, reg) : null;
  }

  function crear(datos) {
    var id = nuevoId();
    empresa().lotes[id] = { datos: datos, version: 0, modificado: null, borrado: false, pendiente: true, cambios: 1 };
    guardar();
    return id;
  }

  // Aplica un cambio a los datos de un lote y lo deja en la bandeja de salida.
  function cambiar(id, mutar) {
    var reg = empresa().lotes[id];
    if (!reg) return;
    mutar(reg.datos);
    reg.pendiente = true;
    reg.cambios = (reg.cambios || 0) + 1;
    guardar();
  }

  function borrar(id) {
    var reg = empresa().lotes[id];
    if (!reg) return;
    if (reg.version === 0) delete empresa().lotes[id]; // nunca subió: se borra y listo
    else { reg.borrar = true; reg.pendiente = true; reg.cambios = (reg.cambios || 0) + 1; }
    guardar();
  }

  // ── Para la sincronización ──
  function pendientes() {
    var ls = empresa().lotes;
    return Object.keys(ls).filter(function (id) { return ls[id].pendiente; }).map(function (id) {
      var r = ls[id];
      return { id: id, datos: r.datos, version: r.version, borrar: !!r.borrar, cambios: r.cambios };
    });
  }

  // El servidor aceptó lo que se subió. "fila" es la fila de la tabla lotes.
  function confirmar(id, cambiosEnviados, fila) {
    var reg = empresa().lotes[id];
    if (!reg) return;
    reg.version = fila.version;
    reg.modificado = fila.modificado;
    reg.borrado = fila.borrado;
    // Si el usuario siguió editando mientras se subía, queda pendiente
    // (y la próxima subida parte de la versión nueva).
    if (reg.cambios === cambiosEnviados) reg.pendiente = false;
    if (reg.borrado) delete empresa().lotes[id];
    guardar();
  }

  // Otro equipo cambió el lote antes que nosotros. Nada se pierde: la versión
  // local va a "conflictos" y la tablet se queda con la del servidor. El usuario
  // elige después si recupera la suya (resolverConflicto).
  function conflicto(id, filaServidor) {
    var e = empresa();
    var reg = e.lotes[id];
    if (reg) e.conflictos.push({ id: id, datos: reg.datos, cuando: new Date().toISOString() });
    if (filaServidor && !filaServidor.borrado) {
      e.lotes[id] = { datos: filaServidor.datos, version: filaServidor.version, modificado: filaServidor.modificado,
        borrado: false, pendiente: false, cambios: 0 };
    } else {
      delete e.lotes[id];
    }
    guardar();
  }

  function conflictos() { return empresa().conflictos.slice(); }

  // 'mia' = vuelve a aplicar la versión local encima de la del servidor.
  // 'descartar' = se queda con la del servidor.
  function resolverConflicto(indice, accion) {
    var e = empresa();
    var c = e.conflictos[indice];
    if (!c) return;
    if (accion === 'mia') {
      var reg = e.lotes[c.id];
      if (reg) {
        reg.datos = c.datos; reg.pendiente = true; reg.cambios = (reg.cambios || 0) + 1;
      } else {
        // El lote fue borrado en el servidor: se recupera como lote nuevo.
        e.lotes[nuevoId()] = { datos: c.datos, version: 0, modificado: null, borrado: false, pendiente: true, cambios: 1 };
      }
    }
    e.conflictos.splice(indice, 1);
    guardar();
  }

  // Llegó una fila desde el servidor. Si acá hay cambios sin subir, se
  // conservan: al subirlos el servidor dirá si hay conflicto.
  function aplicarRemoto(fila) {
    var e = empresa();
    var reg = e.lotes[fila.id];
    if (reg && reg.pendiente) return;
    if (reg && reg.version >= fila.version) return;
    if (fila.borrado) delete e.lotes[fila.id];
    else e.lotes[fila.id] = { datos: fila.datos, version: fila.version, modificado: fila.modificado,
      borrado: false, pendiente: false, cambios: 0 };
  }

  function ultimaBajada() { return empresa().ultimaBajada; }
  function setUltimaBajada(f) { empresa().ultimaBajada = f; guardar(); }

  // Respaldo manual: por si se quiere guardar una copia fuera de la app.
  function respaldo() {
    return { app: 'qualityos', version: 1, fecha: new Date().toISOString(),
      empresa: estado.perfil && estado.perfil.empresa, lotes: lotes() };
  }

  return {
    perfil: perfil, setPerfil: setPerfil, guiaVista: guiaVista, marcarGuiaVista: marcarGuiaVista,
    lotes: lotes, lote: lote, crear: crear, cambiar: cambiar, borrar: borrar,
    pendientes: pendientes, confirmar: confirmar, conflicto: conflicto,
    conflictos: conflictos, resolverConflicto: resolverConflicto,
    aplicarRemoto: aplicarRemoto, guardar: guardar,
    ultimaBajada: ultimaBajada, setUltimaBajada: setUltimaBajada,
    respaldo: respaldo
  };
})();
