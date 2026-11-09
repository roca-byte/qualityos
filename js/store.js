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
 *       ncs:   { <id>: lo mismo + numero (lo pone el servidor: NC-2026-001) },
 *       (lotes y NC llevan además "firma": la firma electrónica vigente, o null)
 *       ultimaBajada: '<fecha del servidor>' | null,      // de lotes
 *       ultimaBajadaNc: '<fecha del servidor>' | null,    // de no conformidades
 *       conflictos: [{ tipo: 'lote' | 'nc', id, datos, cuando }]
 *     }
 *   }
 * }
 * version   = la versión del servidor sobre la que se está editando (0 = nunca subió).
 * cambios   = contador de ediciones locales; sirve para saber si el usuario siguió
 *             editando mientras se subía (en ese caso queda pendiente).
 *
 * Lotes y no conformidades (NC) se guardan y sincronizan igual: las funciones internas reciben
 * la colección ("lote" o "nc") y las públicas de lotes conservan sus nombres de siempre.
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
    var e = estado.empresas[id];
    if (!e.ncs) { e.ncs = {}; e.ultimaBajadaNc = null; }   // tablets que ya tenían datos antes de las NC
    return e;
  }

  // 'lote' → empresa().lotes · 'nc' → empresa().ncs
  function col(tipo) { return tipo === 'nc' ? empresa().ncs : empresa().lotes; }

  // ── Perfil (quién está usando la tablet y en qué empresa) ──
  function perfil() { return estado.perfil; }
  function setPerfil(p) { estado.perfil = p; guardar(); }

  // ── Bienvenida: se muestra una vez por persona en cada equipo ──
  function guiaVista(userId) { return !!(estado.guias && estado.guias[userId]); }
  // Antes de entrar a la demo se borra lo que quedó de la vez anterior en este equipo
  // (lotes de ejemplo y "bienvenida vista"), para que siempre arranque igual.
  function reiniciarDemo(empresaId, userId) {
    delete estado.empresas[empresaId];
    if (estado.guias) delete estado.guias[userId];
    guardar();
  }

  function marcarGuiaVista(userId) {
    estado.guias = estado.guias || {};
    estado.guias[userId] = true;
    guardar();
  }

  // ── Lotes y NC (mismas operaciones, distinta colección) ──
  function listar(tipo) {
    var ls = col(tipo);
    return Object.keys(ls).map(function (id) { return conId(id, ls[id]); })
      .filter(function (l) { return !l.borrado && !l.borrar; });
  }

  function conId(id, reg) {
    return { id: id, datos: reg.datos, version: reg.version, modificado: reg.modificado, pendiente: reg.pendiente, numero: reg.numero || '',
      firma: reg.firma || null };
  }

  function uno(tipo, id) {
    var reg = col(tipo)[id];
    return reg && !reg.borrado && !reg.borrar ? conId(id, reg) : null;
  }

  function crearEn(tipo, datos) {
    var id = nuevoId();
    col(tipo)[id] = { datos: datos, version: 0, modificado: null, borrado: false, pendiente: true, cambios: 1 };
    guardar();
    return id;
  }

  // Aplica un cambio a los datos y lo deja en la bandeja de salida.
  function cambiarEn(tipo, id, mutar) {
    var reg = col(tipo)[id];
    if (!reg) return;
    mutar(reg.datos);
    reg.pendiente = true;
    reg.cambios = (reg.cambios || 0) + 1;
    guardar();
  }

  function borrarEn(tipo, id) {
    var ls = col(tipo), reg = ls[id];
    if (!reg) return;
    if (reg.version === 0) delete ls[id]; // nunca subió: se borra y listo
    else { reg.borrar = true; reg.pendiente = true; reg.cambios = (reg.cambios || 0) + 1; }
    guardar();
  }

  function lotes() { return listar('lote'); }
  function lote(id) { return uno('lote', id); }
  function crear(datos) { return crearEn('lote', datos); }
  function cambiar(id, mutar) { cambiarEn('lote', id, mutar); }
  function borrar(id) { borrarEn('lote', id); }
  function ncs() { return listar('nc'); }
  function nc(id) { return uno('nc', id); }
  function crearNc(datos) { return crearEn('nc', datos); }
  function cambiarNc(id, mutar) { cambiarEn('nc', id, mutar); }
  function borrarNc(id) { borrarEn('nc', id); }

  // Reemplaza los datos de un lote SIN marcarlo para subir: lo usa la conversión de lotes del
  // formato anterior, que es solo una forma distinta de guardar lo mismo. Se sube en el formato
  // nuevo la próxima vez que alguien lo edite de verdad.
  function convertir(id, datos) {
    var reg = empresa().lotes[id];
    if (!reg) return;
    reg.datos = datos;
    guardar();
  }

  // ── Para la sincronización ──
  // Todo lo que falta subir: primero los lotes (una NC puede venir de un lote recién creado).
  function pendientes() {
    return ['lote', 'nc'].reduce(function (out, tipo) {
      var ls = col(tipo);
      return out.concat(Object.keys(ls).filter(function (id) { return ls[id].pendiente; }).map(function (id) {
        var r = ls[id];
        return { tipo: tipo, id: id, datos: r.datos, version: r.version, borrar: !!r.borrar, cambios: r.cambios };
      }));
    }, []);
  }

  // El servidor aceptó lo que se subió. "fila" es la fila de la tabla (lotes o no_conformidades).
  function confirmar(id, cambiosEnviados, fila, tipo) {
    var ls = col(tipo), reg = ls[id];
    if (!reg) return;
    reg.version = fila.version;
    if (fila.numero && tipo === 'nc') reg.numero = fila.numero;
    // Al subir un cambio, el servidor devuelve la firma vigente (null si lo firmado cambió).
    if (fila.firma !== undefined) reg.firma = fila.firma;
    reg.modificado = fila.modificado;
    reg.borrado = fila.borrado;
    // Si el usuario siguió editando mientras se subía, queda pendiente
    // (y la próxima subida parte de la versión nueva).
    if (reg.cambios === cambiosEnviados) reg.pendiente = false;
    if (reg.borrado) delete ls[id];
    guardar();
  }

  // Otro equipo cambió el lote antes que nosotros. Nada se pierde: la versión
  // local va a "conflictos" y la tablet se queda con la del servidor. El usuario
  // elige después si recupera la suya (resolverConflicto).
  function conflicto(id, filaServidor, tipo) {
    var e = empresa(), ls = col(tipo);
    var reg = ls[id];
    if (reg) e.conflictos.push({ tipo: tipo || 'lote', id: id, datos: reg.datos, numero: reg.numero || '', cuando: new Date().toISOString() });
    if (filaServidor && !filaServidor.borrado) {
      ls[id] = { datos: filaServidor.datos, version: filaServidor.version, modificado: filaServidor.modificado,
        numero: filaServidor.numero, firma: filaServidor.firma || null, borrado: false, pendiente: false, cambios: 0 };
    } else {
      delete ls[id];
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
      var ls = col(c.tipo), reg = ls[c.id];
      if (reg) {
        reg.datos = c.datos; reg.pendiente = true; reg.cambios = (reg.cambios || 0) + 1;
      } else {
        // Fue borrado en el servidor: se recupera como nuevo (una NC recibe número nuevo).
        ls[nuevoId()] = { datos: c.datos, version: 0, modificado: null, borrado: false, pendiente: true, cambios: 1 };
      }
    }
    e.conflictos.splice(indice, 1);
    guardar();
  }

  // Llegó una fila desde el servidor. Si acá hay cambios sin subir, se
  // conservan: al subirlos el servidor dirá si hay conflicto.
  function aplicarRemoto(fila, tipo) {
    var ls = col(tipo);
    var reg = ls[fila.id];
    if (reg && reg.pendiente) return;
    if (reg && reg.version >= fila.version) return;
    if (fila.borrado) delete ls[fila.id];
    else ls[fila.id] = { datos: fila.datos, version: fila.version, modificado: fila.modificado, numero: fila.numero,
      firma: fila.firma || null, borrado: false, pendiente: false, cambios: 0 };
  }

  function ultimaBajada(tipo) { return tipo === 'nc' ? empresa().ultimaBajadaNc : empresa().ultimaBajada; }
  function setUltimaBajada(f, tipo) {
    if (tipo === 'nc') empresa().ultimaBajadaNc = f; else empresa().ultimaBajada = f;
    guardar();
  }

  // Respaldo manual: por si se quiere guardar una copia fuera de la app.
  function respaldo() {
    return { app: 'qualityos', version: 1, fecha: new Date().toISOString(),
      empresa: estado.perfil && estado.perfil.empresa, lotes: lotes(), noConformidades: ncs() };
  }

  return {
    perfil: perfil, setPerfil: setPerfil, guiaVista: guiaVista, marcarGuiaVista: marcarGuiaVista, reiniciarDemo: reiniciarDemo,
    lotes: lotes, lote: lote, crear: crear, cambiar: cambiar, convertir: convertir, borrar: borrar,
    ncs: ncs, nc: nc, crearNc: crearNc, cambiarNc: cambiarNc, borrarNc: borrarNc,
    pendientes: pendientes, confirmar: confirmar, conflicto: conflicto,
    conflictos: conflictos, resolverConflicto: resolverConflicto,
    aplicarRemoto: aplicarRemoto, guardar: guardar,
    ultimaBajada: ultimaBajada, setUltimaBajada: setUltimaBajada,
    respaldo: respaldo
  };
})();
