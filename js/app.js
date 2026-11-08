/* App: pantallas y eventos.
 * Todos los clics se manejan con un solo listener (data-act) y todos los campos
 * con otro (data-sec/data-i/data-k). Así no hay onclick="" sueltos en el HTML
 * y cada pantalla es una función que devuelve su HTML.
 */
(function () {
  'use strict';

  var esc = Imprimir.esc;
  var vista = document.getElementById('vista');
  var ui = { pantalla: 'cargando', loteId: null, tab: 'activos', busqueda: '', resultados: null, mensaje: '' };
  var temporizadorSync = null;

  var ROLES = { checker: 'Inspector de Calidad', coordinacion: 'Coordinación', admin: 'Administración' };
  var DICTAMENES = [
    { v: 'APROBADO', txt: 'Aprobado', cls: 'ok' },
    { v: 'APROBADO_PARCIAL', txt: 'Aprobado parcial', cls: 'warn' },
    { v: 'RETENIDO', txt: 'Retenido', cls: 'nok' }
  ];
  var ESTADOS = { activo: 'En control', aprobado: 'Aprobado', aprobado_parcial: 'Aprobado parcial', retenido: 'Retenido' };
  var CONFIG_INICIAL = {
    inductoras: [{ id: 'A', nombre: 'Inductora A', tolMin: 1.0, tolMax: 1.4, unidad: '', semaforo: true }],
    lineas: [], docCodigo: 'REG-01', docVersion: '00', docElab: '', docAprob: ''
  };

  // ───────────────────────── Ayudas ─────────────────────────

  function perfil() { return Store.perfil(); }
  function config() { return Object.assign({}, CONFIG_INICIAL, (perfil() && perfil().config) || {}); }
  function esSuperior() { var r = perfil() && perfil().rol; return r === 'coordinacion' || r === 'admin'; }
  function esAdmin() { return perfil() && perfil().rol === 'admin'; }
  function inductora(id) { return config().inductoras.filter(function (i) { return i.id === id; })[0] || null; }

  // Un lote dictaminado queda bloqueado para el inspector (el servidor también lo exige).
  function editable(lote) { return lote.datos.estado === 'activo' || esSuperior(); }

  function aviso(txt) {
    var t = document.getElementById('aviso');
    t.textContent = txt;
    t.classList.add('visible');
    clearTimeout(aviso.t);
    aviso.t = setTimeout(function () { t.classList.remove('visible'); }, 3200);
  }

  function ir(pantalla, extra) {
    Object.assign(ui, { pantalla: pantalla, mensaje: '', tipoMensaje: '' }, extra || {});
    dibujar();
    window.scrollTo(0, 0);
  }

  function ahora() {
    return new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function opciones(lista, elegido) {
    return lista.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(elegido) ? ' selected' : '') + '>' + esc(o.t) + '</option>';
    }).join('');
  }

  // ───────────────────────── Sincronización ─────────────────────────

  function programarSync(ms) {
    clearTimeout(temporizadorSync);
    temporizadorSync = setTimeout(sincronizar, ms === undefined ? 3000 : ms);
  }

  async function sincronizar() {
    if (!perfil() || !Nube.configurada()) return;
    try {
      var r = await Nube.sincronizar();
      if (r && r.conflictos) aviso('⚠ ' + r.conflictos + ' lote(s) los cambió otro equipo. Revisá "Conflictos".');
      if (r && (r.bajados || r.conflictos) && ui.pantalla === 'inicio') dibujar();
      if (r && r.conflictos && ui.pantalla === 'lote' && !Store.lote(ui.loteId)) ir('inicio');
      else if (r && r.conflictos && ui.pantalla === 'lote') dibujar();
    } catch (e) {
      if (Nube.hayRed()) aviso('No se pudo sincronizar: ' + e.message);
    }
    estadoNube();
  }

  function estadoNube() {
    var el = document.getElementById('nube');
    if (!el) return;
    if (!perfil()) { el.textContent = ''; return; }
    var n = Store.pendientes().length;
    var c = Store.conflictos().length;
    if (c) { el.textContent = '⚠ ' + c + ' conflicto(s)'; el.className = 'nube nok'; el.dataset.act = 'conflictos'; return; }
    delete el.dataset.act;
    if (!Nube.hayRed()) { el.textContent = '✈ Sin señal' + (n ? ' · ' + n + ' por subir' : ''); el.className = 'nube warn'; }
    else if (n) { el.textContent = '⏳ ' + n + ' por subir'; el.className = 'nube warn'; }
    else { el.textContent = '☁ Al día'; el.className = 'nube ok'; }
  }

  // ───────────────────────── Arranque y sesión ─────────────────────────

  async function arrancar() {
    if (!Nube.configurada()) return ir('sinConfig');
    var p = perfil();
    var u = null;
    try { u = await Nube.usuario(); }
    catch (e) {
      // Sin señal: si ya se usó la tablet, se sigue trabajando con lo guardado.
      if (p) return entrarA(p);
      return ir('login', { mensaje: e.message });
    }
    if (!u) {
      if (p && !Nube.hayRed()) return entrarA(p);
      Store.setPerfil(null);
      return ir('login');
    }
    if (p && p.userId === u.id) {
      entrarA(p);
      refrescarPerfil(u); // rol o configuración pueden haber cambiado
      return;
    }
    await elegirEmpresa(u, '');
  }

  function entrarA(p) {
    Store.setPerfil(p);
    ir('inicio');
    programarSync(0);
  }

  async function refrescarPerfil(u) {
    try {
      var ms = await Nube.misEmpresas('');
      var p = perfil();
      var m = ms.filter(function (x) { return x.empresa_id === p.empresaId; })[0];
      if (!m) { Store.setPerfil(null); return ir('login', { mensaje: 'Ya no tenés acceso a esa empresa.' }); }
      Store.setPerfil(Object.assign({}, p, { rol: m.rol, nombre: m.nombre || p.nombre,
        empresa: m.empresas.nombre, config: m.empresas.config }));
      dibujar();
    } catch (e) { /* sin señal: se sigue con lo guardado */ }
  }

  // mostrarSiempre: desde "Cambiar de empresa" se muestra la lista aunque haya una sola
  // (si no, el dueño de la plataforma nunca llegaría al formulario de empresa nueva).
  async function elegirEmpresa(u, nombre, mostrarSiempre) {
    var ms;
    try { ms = await Nube.misEmpresas(nombre); }
    catch (e) { return ir('login', { mensaje: e.message }); }
    ui.usuario = u;
    if (ms.length === 1 && !mostrarSiempre) return usarMembresia(u, ms[0]);
    var puedeCrear = false;
    try { puedeCrear = await Nube.puedoCrearEmpresas(); } catch (e) { /* sin permiso: no se muestra */ }
    ir('empresa', { membresias: ms, puedeCrear: puedeCrear });
  }

  function usarMembresia(u, m) {
    entrarA({ userId: u.id, email: u.email, nombre: m.nombre, empresaId: m.empresa_id,
      empresa: m.empresas.nombre, rol: m.rol, config: m.empresas.config });
  }

  // ───────────────────────── Pantallas ─────────────────────────

  var pantallas = {};

  pantallas.cargando = function () { return '<p class="centro">Cargando…</p>'; };

  pantallas.sinConfig = function () {
    return '<section class="tarjeta"><h2>Falta conectar la base de datos</h2>' +
      '<p>Completá <code>js/config.js</code> con la URL y la clave pública (publishable) de tu proyecto de Supabase. ' +
      'Los pasos están en <code>docs/SUPABASE.md</code>.</p></section>';
  };

  // Íconos de línea (heredados del login de la QualityOS original). currentColor = toman el color del texto.
  var ICONO = {
    mail: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M2 7l8 5 8-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    candado: '<svg width="15" height="16" viewBox="0 0 20 22" fill="none" aria-hidden="true"><rect x="3" y="10" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 10V7a3 3 0 0 1 6 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="15.5" r="1.2" fill="currentColor"/></svg>',
    ojo: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/><line class="tachado" x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };

  // Pantalla de acceso: diseño del login de la QualityOS original (logo grande, tarjeta
  // centrada, íconos, ojito para la clave) adaptado a la paleta y la tipografía de la suite.
  // Solo "Ingresar" es submit: así Enter siempre ingresa y "Crear cuenta" no se dispara sin querer.
  pantallas.login = function () {
    var enLinea = navigator.onLine !== false;
    return '<section class="acceso">' +
      '<div class="acceso-marca">' +
      '<span class="acceso-logo"><img src="./icons/qualityos.svg" alt=""></span>' +
      '<h1 class="acceso-nombre">Quality<span>OS</span></h1>' +
      '<p class="acceso-sub">Sistema de gestión de calidad</p></div>' +
      '<div class="tarjeta acceso-tarjeta"><h2>Ingresar</h2>' +
      (ui.mensaje ? '<p class="' + (ui.tipoMensaje === 'info' ? 'info' : 'error') + '" role="status">' + esc(ui.mensaje) + '</p>' : '') +
      '<form data-form="login">' +
      '<label><span class="etq">' + ICONO.mail + 'Email</span>' +
      '<input name="email" type="email" autocomplete="username" placeholder="usuario@empresa.com" required value="' + esc(ui.email || '') + '"></label>' +
      '<label><span class="etq">' + ICONO.candado + 'Clave</span><span class="con-ojo">' +
      '<input name="clave" type="password" autocomplete="current-password" minlength="6" required>' +
      '<button type="button" class="ojo" data-act="ver-clave" aria-label="Mostrar clave" aria-pressed="false">' + ICONO.ojo + '</button>' +
      '</span></label>' +
      '<button class="btn primario" type="submit">Ingresar</button>' +
      '</form>' +
      '<div class="separador"><span>¿Es tu primera vez?</span></div>' +
      '<button class="btn" type="button" data-act="registrarse">Crear cuenta nueva</button>' +
      '<p class="ayuda">Si te invitaron, creá tu cuenta con el mismo email de la invitación. ' +
      '¿Problemas para ingresar? Pedile ayuda a quien administra tu empresa.</p></div>' +
      '<p class="acceso-pie"><span class="punto' + (enLinea ? '' : ' sin-red') + '"></span>' +
      (enLinea ? 'En línea' : 'Sin señal: vas a poder ingresar cuando vuelva') + '</p>' +
      '</section>';
  };

  // Mientras espera al servidor: botón deshabilitado con spinner (como en la versión original).
  function esperando(boton, texto) {
    boton.disabled = true;
    boton.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + texto;
  }

  pantallas.empresa = function () {
    var ms = ui.membresias || [];
    var lista = ms.length
      ? '<h3>Elegí la empresa</h3>' + ms.map(function (m, i) {
          return '<button class="btn" data-act="usar-empresa" data-i="' + i + '">' + esc(m.empresas.nombre) +
            ' · ' + esc(ROLES[m.rol]) + '</button>';
        }).join('')
      : '<p>Tu cuenta todavía no pertenece a ninguna empresa.</p>' +
        '<p class="ayuda">Para usar QualityOS te tiene que invitar el administrador de tu empresa, ' +
        'con el mismo email de esta cuenta. Cuando te invite, tocá "Buscar invitaciones".</p>';
    return '<section class="tarjeta angosta"><h2>Empresa</h2>' +
      (ui.mensaje ? '<p class="error">' + esc(ui.mensaje) + '</p>' : '') + lista +
      '<form data-form="empresa">' +
      '<label>Tu nombre (sale en la firma del dictamen)<input name="nombre" required></label>' +
      '<button class="btn" type="button" data-act="buscar-invitaciones">Buscar invitaciones</button>' +
      // Crear empresas es solo para los dueños de la plataforma (la base lo exige igual).
      (ui.puedeCrear ? '<label>Nombre de la empresa nueva<input name="empresa"></label>' +
        '<button class="btn primario" type="submit">Crear empresa</button>' : '') +
      '</form><button class="btn chico" data-act="salir">Salir</button></section>';
  };

  pantallas.inicio = function () {
    var todos = Store.lotes().sort(function (a, b) {
      return String(b.datos.cab.fecha).localeCompare(String(a.datos.cab.fecha));
    });
    var activos = todos.filter(function (l) { return l.datos.estado === 'activo'; });
    var cerrados = todos.filter(function (l) { return l.datos.estado !== 'activo'; });
    var tabs = '<div class="tabs">' +
      '<button class="tab' + (ui.tab === 'activos' ? ' activa' : '') + '" data-act="tab" data-tab="activos">En control (' + activos.length + ')</button>' +
      '<button class="tab' + (ui.tab === 'historial' ? ' activa' : '') + '" data-act="tab" data-tab="historial">Historial</button></div>';
    var cuerpo;
    if (ui.tab === 'activos') {
      cuerpo = '<button class="btn primario grande" data-act="nuevo">+ Nuevo lote</button>' +
        (activos.length ? activos.map(tarjetaLote).join('') : '<p class="vacio">No hay lotes en control.</p>');
    } else {
      var t = ui.busqueda.toLowerCase();
      var locales = cerrados.filter(function (l) {
        var c = l.datos.cab;
        return !t || [c.lote, c.prod, c.cliente].join(' ').toLowerCase().indexOf(t) >= 0;
      });
      var lista = ui.resultados
        ? ui.resultados.map(function (f) { return tarjetaLote({ id: f.id, datos: f.datos, remoto: true }); }).join('') ||
          '<p class="vacio">Sin resultados en el servidor.</p>'
        : (locales.length ? locales.map(tarjetaLote).join('') : '<p class="vacio">No hay lotes dictaminados en esta tablet.</p>');
      cuerpo = '<form data-form="buscar" class="buscar"><input name="q" placeholder="Lote, producto o cliente" value="' + esc(ui.busqueda) + '">' +
        '<button class="btn" type="submit">Buscar en todo el historial</button></form>' +
        (ui.resultados ? '<p class="ayuda">Resultados del servidor · <a href="#" data-act="limpiar-busqueda">ver solo esta tablet</a></p>' : '') + lista;
    }
    return tabs + cuerpo;
  };

  function tarjetaLote(l) {
    var d = l.datos, c = d.cab;
    var r = Reglas.resumenFinal(d);
    return '<button class="lote-item estado-' + esc(d.estado) + '" data-act="abrir" data-id="' + esc(l.id) + '"' +
      (l.remoto ? ' data-remoto="1"' : '') + '>' +
      '<span class="li-num">' + esc(c.lote) + '</span>' +
      '<span class="li-prod">' + esc(c.prod) + (c.cliente ? ' · ' + esc(c.cliente) : '') + '</span>' +
      '<span class="li-meta">' + esc(Reglas.fechaLarga(c.fecha)) + (c.linea ? ' · ' + esc(c.linea) : '') +
      ' · CF ' + (r.aprobados + r.retenidos) + '/' + (r.aprobados + r.retenidos + r.pendientes) + '</span>' +
      '<span class="li-estado">' + esc(ESTADOS[d.estado] || d.estado) + (l.pendiente ? ' · ⏳' : '') + '</span></button>';
  }

  // Formulario de cabecera: sirve para lote nuevo y para editar.
  pantallas.nuevo = function () {
    var l = ui.loteId ? Store.lote(ui.loteId) : null;
    var c = l ? l.datos.cab : { fecha: Reglas.hoy(), indId: (config().inductoras[0] || {}).id, checker: perfil().nombre };
    var lineas = config().lineas || [];
    return '<section class="tarjeta"><h2>' + (l ? 'Datos del lote' : 'Nuevo lote') + '</h2>' +
      '<form data-form="cabecera">' +
      '<label>Producto *<input name="prod" required value="' + esc(c.prod || '') + '"></label>' +
      '<label>N° de lote *<input name="lote" required value="' + esc(c.lote || '') + '"></label>' +
      '<label>Cliente<input name="cliente" value="' + esc(c.cliente || '') + '"></label>' +
      '<label>Línea<input name="linea" list="lineas" value="' + esc(c.linea || '') + '"></label>' +
      '<datalist id="lineas">' + lineas.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      '<label>Fecha<input name="fecha" type="date" value="' + esc(c.fecha || '') + '"></label>' +
      '<label>Inductora<select name="indId">' + opciones(config().inductoras.map(function (i) {
        return { v: i.id, t: i.nombre + ' (' + i.tolMin + '–' + i.tolMax + ')' };
      }), c.indId) + '</select></label>' +
      '<div class="fila2"><label>Peso mín. por pico (kg)<input name="pesoMin" inputmode="decimal" value="' + esc(c.pesoMin || '') + '"></label>' +
      '<label>Peso máx. por pico (kg)<input name="pesoMax" inputmode="decimal" value="' + esc(c.pesoMax || '') + '"></label></div>' +
      '<label>Inspector de Calidad<input name="checker" value="' + esc(c.checker || '') + '"></label>' +
      (l ? '' : '<label>Pallets del control final<input name="pallets" type="number" min="0" max="200" value="12"></label>') +
      '<div class="acciones"><button class="btn" type="button" data-act="' + (l ? 'abrir' : 'inicio') + '" data-id="' + esc(ui.loteId || '') + '">Cancelar</button>' +
      '<button class="btn primario" type="submit">' + (l ? 'Guardar' : 'Crear lote') + '</button></div>' +
      '</form></section>';
  };

  // ── Pantalla del lote ──

  pantallas.lote = function () {
    var l = Store.lote(ui.loteId);
    if (!l) return '<p class="vacio">El lote ya no está en esta tablet.</p><button class="btn" data-act="inicio">Volver</button>';
    var d = l.datos, c = d.cab, ed = editable(l);
    var ind = inductora(c.indId);
    var cab = '<section class="tarjeta cab-lote"><div class="cab-fila">' +
      '<button class="btn chico" data-act="inicio">← Lotes</button>' +
      '<span class="li-estado estado-' + esc(d.estado) + '">' + esc(ESTADOS[d.estado]) + '</span></div>' +
      '<h2>' + esc(c.lote) + ' · ' + esc(c.prod) + '</h2>' +
      '<p class="meta">' + [c.cliente, c.linea, Reglas.fechaLarga(c.fecha), ind && ind.nombre,
        c.pesoMin ? 'Peso ' + c.pesoMin + '–' + c.pesoMax + ' kg' : ''].filter(Boolean).map(esc).join(' · ') + '</p>' +
      (ed ? '<button class="btn chico" data-act="editar-cab">Editar datos</button>' : '') +
      (!ed ? '<p class="ayuda">Lote dictaminado: solo coordinación lo puede modificar.</p>' : '') + '</section>';
    return cab + '<fieldset class="planilla"' + (ed ? '' : ' disabled') + '>' +
      seccionLinea(d, ind) + seccionFinal(d) + seccionHallazgos(d) + '</fieldset>' + seccionDictamen(l);
  };

  function botonesCheck(sec, i, campo, valor, campoRepro, repro) {
    var b = function (v, txt, cls) {
      return '<button type="button" class="chk ' + cls + (valor === v ? ' sel' : '') + '" data-act="check" data-sec="' + sec +
        '" data-i="' + i + '" data-k="' + campo + '" data-v="' + v + '">' + txt + '</button>';
    };
    var r = valor === false
      ? '<button type="button" class="chk repro' + (repro ? ' sel' : '') + '" data-act="repro" data-sec="' + sec + '" data-i="' + i +
        '" data-k="' + campoRepro + '">↻ Reprocesado</button>'
      : '';
    return '<span class="chks">' + b(true, 'OK', 'ok') + b(false, 'NOK', 'nok') + r + '</span>';
  }

  function campo(sec, i, k, valor, etiqueta, attrs) {
    return '<label>' + etiqueta + '<input data-sec="' + sec + '" data-i="' + i + '" data-k="' + k + '" value="' + esc(valor) + '" ' + (attrs || '') + '></label>';
  }

  function seccionLinea(d, ind) {
    var cards = d.linea.map(function (p, i) { return cardLinea(d, ind, p, i); }).join('');
    return '<section class="tarjeta"><h3>Control en línea <small>' + d.linea.length + ' pallets</small></h3>' + cards +
      '<button type="button" class="btn" data-act="agregar-linea">+ Pallet</button></section>';
  }

  function derivadosLinea(d, ind, p) {
    var peso = Reglas.pesoOK(p, d.cab);
    var prom = Reglas.promedioPeso(p);
    var sem = Reglas.semaforo(p.indVal, ind);
    return {
      peso: prom === null ? '' : 'Prom. ' + prom + ' kg ' + (peso === false ? '<b class="txt-nok">⚖ fuera de rango</b>' : peso ? '<b class="txt-ok">✓</b>' : ''),
      sem: sem ? '<span class="sem ' + sem + '"></span>' : '',
      estado: Reglas.estadoPalletLinea(p, d.cab)
    };
  }

  function cardLinea(d, ind, p, i) {
    var der = derivadosLinea(d, ind, p);
    var s = 'linea';
    return '<div class="pcard e-' + der.estado + '" id="cl-' + i + '">' +
      '<div class="pcard-cab"><b>Pallet</b>' +
      '<input class="corto" data-sec="linea" data-i="' + i + '" data-k="nPal" value="' + esc(p.nPal) + '" aria-label="Número de pallet">' +
      '<input class="corto" type="time" data-sec="linea" data-i="' + i + '" data-k="hora" value="' + esc(p.hora) + '" aria-label="Hora">' +
      '<button type="button" class="btn chico" data-act="hora" data-i="' + i + '">Ahora</button>' +
      '<button type="button" class="btn chico peligro" data-act="quitar-linea" data-i="' + i + '" aria-label="Quitar pallet">✕</button></div>' +
      '<div class="grupo"><span class="g-tit">Peso por pico (kg)</span><div class="fila4">' +
      Reglas.PICOS.map(function (k, n) { return campo(s, i, k, p[k], 'P' + (n + 1), 'inputmode="decimal"'); }).join('') +
      '</div><span class="der-peso">' + der.peso + '</span></div>' +
      '<div class="grupo"><span class="g-tit">Identificación</span><div class="fila4">' +
      campo(s, i, 'lote', p.lote, 'Lote') + campo(s, i, 'codProd', p.codProd, 'Código') +
      campo(s, i, 'fProd', p.fProd, 'F. prod.', 'type="date"') + campo(s, i, 'fVenc', p.fVenc, 'F. venc.', 'type="date"') + '</div></div>' +
      '<div class="grupo"><span class="g-tit">Inducción</span><div class="fila-check">' +
      botonesCheck(s, i, 'indOK', p.indOK, 'repro', p.repro) +
      '<label class="inline">Valor<input class="corto" inputmode="decimal" data-sec="linea" data-i="' + i + '" data-k="indVal" value="' + esc(p.indVal) + '"></label>' +
      '<span class="der-sem">' + der.sem + '</span></div></div>' +
      '<div class="grupo checks3">' +
      '<div><span class="g-tit">QR</span>' + botonesCheck(s, i, 'qrLineaOK', p.qrLineaOK, 'qrRepro', p.qrRepro) + '</div>' +
      '<div><span class="g-tit">Packaging</span>' + botonesCheck(s, i, 'packOK', p.packOK, 'packRepro', p.packRepro) + '</div>' +
      '<div><span class="g-tit">Paletizado</span>' + botonesCheck(s, i, 'pltOK', p.pltOK, 'pltRepro', p.pltRepro) + '</div></div>' +
      campo(s, i, 'obs', p.obs, 'Observación') + '</div>';
  }

  function seccionFinal(d) {
    var f = d.final;
    var cards = f.pallets.map(function (p, i) {
      var e = Reglas.estadoPalletFinal(p);
      return '<div class="pcard e-' + e + '" id="cf-' + i + '"><div class="pcard-cab"><b>Pallet ' + (i + 1) + '</b>' +
        '<button type="button" class="btn chico" data-act="todo-ok" data-i="' + i + '">✓ Todo OK</button>' +
        '<button type="button" class="btn chico peligro" data-act="quitar-final" data-i="' + i + '" aria-label="Quitar pallet">✕</button></div>' +
        '<div class="checks4">' + Reglas.CHECKS_FINAL.map(function (c) {
          return '<div><span class="g-tit">' + esc(c.nombre) + '</span>' + botonesCheck('final', i, c.campo, p[c.campo], c.repro, p[c.repro]) + '</div>';
        }).join('') + '</div>' +
        '<div class="fila2">' + campo('final', i, 'litrosParcial', p.litrosParcial, 'Litros (si difiere)', 'inputmode="decimal"') +
        campo('final', i, 'obs', p.obs, 'Observación') + '</div></div>';
    }).join('');
    return '<section class="tarjeta"><h3>Control final <small>' + f.pallets.length + ' pallets</small></h3>' +
      '<label>Litros por pallet<input class="corto" inputmode="decimal" data-sec="cf" data-i="0" data-k="ltsPorPallet" value="' + esc(f.ltsPorPallet) + '"></label>' +
      cards + '<button type="button" class="btn" data-act="agregar-final">+ Pallet</button></section>';
  }

  function seccionHallazgos(d) {
    var lista = (d.hallazgos || []).map(function (h, i) {
      return '<li><small>' + esc(h.ts) + ' · ' + esc(h.autor || '') + '</small><p>' + esc(h.txt) + '</p>' +
        '<button type="button" class="btn chico peligro" data-act="quitar-hallazgo" data-i="' + i + '">Quitar</button></li>';
    }).join('');
    return '<section class="tarjeta"><h3>Observaciones del lote</h3><ul class="hallazgos">' + lista + '</ul>' +
      '<textarea id="nuevo-hallazgo" rows="2" placeholder="Algo para dejar registrado"></textarea>' +
      '<button type="button" class="btn" data-act="agregar-hallazgo">Agregar observación</button></section>';
  }

  function seccionDictamen(l) {
    var d = l.datos, f = d.final;
    var r = Reglas.resumenFinal(d);
    var sug = Reglas.sugerirDictamen(d);
    var falt = Reglas.palletsFaltantes(d);
    var cant = function (lts, pal) { return lts !== null ? Math.round(lts) + ' L' : pal + ' pallet(s)'; };
    var resumen = '<div class="resumen"><div class="r-ok"><b>' + cant(r.ltsAprobados, r.aprobados) + '</b><span>Aprobado</span></div>' +
      '<div class="r-nok"><b>' + cant(r.ltsRetenidos, r.retenidos) + '</b><span>Retenido</span></div>' +
      '<div class="r-pend"><b>' + r.pendientes + '</b><span>Sin controlar</span></div></div>';
    var desv = Reglas.desvios(d);
    var desvios = desv.length
      ? '<details><summary>Desvíos detectados (' + desv.length + ')</summary><ul class="desvios">' + desv.map(function (x) {
          return '<li>' + esc(x.etapa) + ' · pallet ' + esc(x.pallet) + ' · ' + esc(x.control) +
            (x.corregido ? ' · <i>reprocesado</i>' : ' · <b class="txt-nok">abierto</b>') + (x.obs ? ' · ' + esc(x.obs) : '') + '</li>';
        }).join('') + '</ul><button type="button" class="btn chico" data-act="copiar-desvios">Copiar para el registro de NC</button></details>'
      : '';
    var acciones;
    if (d.estado === 'activo') {
      var bloqueado = falt.length && !esSuperior();
      acciones = (falt.length ? '<p class="' + (bloqueado ? 'error' : 'ayuda') + '">Faltan completar ' + falt.length +
          ' pallet(s) del control final' + (bloqueado ? '. Completalos o pedile a coordinación que dictamine.' : '. Coordinación puede dictaminar igual.') + '</p>' : '') +
        '<div class="dictamenes">' + DICTAMENES.map(function (x) {
          return '<button class="btn dict ' + x.cls + (sug === x.v ? ' sugerido' : '') + '" data-act="dictaminar" data-v="' + x.v + '"' +
            (bloqueado ? ' disabled' : '') + '>' + x.txt + (sug === x.v ? '<small>sugerido</small>' : '') + '</button>';
        }).join('') + '</div>';
    } else {
      acciones = '<p class="dict-final ' + esc(d.estado) + '">' + esc(ESTADOS[d.estado]) + '</p>' +
        '<p class="ayuda">Dictaminó ' + esc(f.dictaminadoPor || '—') + (f.dictaminadoRol ? ' (' + esc(f.dictaminadoRol) + ')' : '') +
        ' · ' + esc(f.fechaDictamen || '') + '</p>' +
        (d.cierreForzado ? '<p class="ayuda">⚠ Con ' + esc(d.cierreForzado.faltantes) + ' pallet(s) sin completar, autorizado por ' + esc(d.cierreForzado.por) + '</p>' : '') +
        (esSuperior() ? '<button class="btn" data-act="reabrir">Reabrir lote</button>' : '');
    }
    return '<section class="tarjeta"><h3>Dictamen</h3>' + resumen + desvios + acciones +
      '<div class="acciones"><button class="btn" data-act="imprimir">Imprimir / PDF</button>' +
      (esSuperior() ? '<button class="btn peligro" data-act="borrar-lote">Borrar lote</button>' : '') + '</div></section>';
  }

  // ── Conflictos ──
  pantallas.conflictos = function () {
    var cs = Store.conflictos();
    return '<section class="tarjeta"><h2>Conflictos</h2>' +
      '<p class="ayuda">Otro equipo modificó estos lotes mientras esta tablet tenía cambios sin subir. ' +
      'La tablet se quedó con la versión del servidor; acá está la tuya para que decidas.</p>' +
      (cs.length ? cs.map(function (c, i) {
        return '<div class="pcard"><b>' + esc(c.datos.cab.lote) + ' · ' + esc(c.datos.cab.prod) + '</b>' +
          '<p class="meta">Tu versión del ' + esc(new Date(c.cuando).toLocaleString('es-AR')) + ' · estado ' + esc(ESTADOS[c.datos.estado]) + '</p>' +
          '<div class="acciones"><button class="btn" data-act="conflicto" data-i="' + i + '" data-v="descartar">Quedarme con la del servidor</button>' +
          '<button class="btn primario" data-act="conflicto" data-i="' + i + '" data-v="mia">Usar la mía</button></div></div>';
      }).join('') : '<p class="vacio">No hay conflictos.</p>') +
      '<button class="btn" data-act="inicio">Volver</button></section>';
  };

  // ── Configuración ──
  pantallas.config = function () {
    var p = perfil(), cfg = config();
    var html = '<section class="tarjeta"><h2>Mi perfil</h2><p class="meta">' + esc(p.email) + ' · ' + esc(ROLES[p.rol]) + ' en ' + esc(p.empresa) + '</p>' +
      '<form data-form="mi-nombre"><label>Mi nombre<input name="nombre" required value="' + esc(p.nombre) + '"></label>' +
      '<button class="btn" type="submit">Guardar nombre</button></form>' +
      '<div class="acciones"><button class="btn" data-act="respaldo">Descargar respaldo (.json)</button>' +
      '<button class="btn" data-act="cambiar-empresa">Cambiar de empresa</button></div></section>';
    if (!esAdmin()) return html + '<button class="btn" data-act="inicio">Volver</button>';
    html += '<section class="tarjeta"><h2>Empresa</h2><form data-form="config">' +
      '<label>Nombre<input name="nombre" required value="' + esc(p.empresa) + '"></label>' +
      '<div class="fila2"><label>Código del registro<input name="docCodigo" value="' + esc(cfg.docCodigo) + '"></label>' +
      '<label>Versión<input name="docVersion" value="' + esc(cfg.docVersion) + '"></label></div>' +
      '<div class="fila2"><label>Elaboró<input name="docElab" value="' + esc(cfg.docElab) + '"></label>' +
      '<label>Aprobó<input name="docAprob" value="' + esc(cfg.docAprob) + '"></label></div>' +
      '<label>Líneas (separadas por coma)<input name="lineas" value="' + esc((cfg.lineas || []).join(', ')) + '"></label>' +
      '<h3>Inductoras</h3><div id="inductoras">' + cfg.inductoras.map(filaInductora).join('') + '</div>' +
      '<button type="button" class="btn chico" data-act="agregar-inductora">+ Inductora</button>' +
      '<button class="btn primario" type="submit">Guardar configuración</button></form></section>' +
      '<section class="tarjeta" id="miembros"><h2>Personas</h2><p class="ayuda">Cargando…</p></section>' +
      '<button class="btn" data-act="inicio">Volver</button>';
    setTimeout(cargarMiembros, 0);
    return html;
  };

  function filaInductora(ind) {
    return '<div class="fila-ind" data-id="' + esc(ind.id) + '">' +
      '<label>Nombre<input name="ind-nombre" required value="' + esc(ind.nombre) + '"></label>' +
      '<label>Mín.<input name="ind-min" inputmode="decimal" required value="' + esc(ind.tolMin) + '"></label>' +
      '<label>Máx.<input name="ind-max" inputmode="decimal" required value="' + esc(ind.tolMax) + '"></label>' +
      '<label>Unidad<input name="ind-unidad" value="' + esc(ind.unidad || '') + '"></label>' +
      '<label class="inline"><input type="checkbox" name="ind-sem"' + (ind.semaforo !== false ? ' checked' : '') + '> Semáforo</label>' +
      '<button type="button" class="btn chico peligro" data-act="quitar-inductora">✕</button></div>';
  }

  async function cargarMiembros() {
    var cont = document.getElementById('miembros');
    if (!cont) return;
    try {
      var r = await Nube.miembros(perfil().empresaId);
      var rolesOpc = Object.keys(ROLES).map(function (k) { return { v: k, t: ROLES[k] }; });
      cont.innerHTML = '<h2>Personas</h2>' + r.miembros.map(function (m) {
        var yo = m.user_id === perfil().userId;
        return '<div class="fila-miembro"><span>' + esc(m.nombre || '(sin nombre)') + (yo ? ' (vos)' : '') + (m.activo ? '' : ' · inactivo') + '</span>' +
          (yo ? '<span>' + esc(ROLES[m.rol]) + '</span>' :
            '<select data-act-change="rol" data-user="' + esc(m.user_id) + '">' + opciones(rolesOpc, m.rol) + '</select>' +
            '<button class="btn chico" data-act="activo" data-user="' + esc(m.user_id) + '" data-v="' + (!m.activo) + '">' + (m.activo ? 'Desactivar' : 'Activar') + '</button>') +
          '</div>';
      }).join('') +
      (r.invitaciones.length ? '<h3>Invitaciones pendientes</h3>' + r.invitaciones.map(function (i) {
        return '<div class="fila-miembro"><span>' + esc(i.email) + ' · ' + esc(ROLES[i.rol]) + '</span>' +
          '<button class="btn chico peligro" data-act="quitar-invitacion" data-email="' + esc(i.email) + '">Quitar</button></div>';
      }).join('') : '') +
      '<h3>Invitar</h3><form data-form="invitar" class="fila2"><label>Email<input name="email" type="email" required></label>' +
      '<label>Rol<select name="rol">' + opciones(rolesOpc, 'checker') + '</select></label>' +
      '<button class="btn" type="submit">Invitar</button></form>' +
      '<p class="ayuda">La persona crea su cuenta con ese email y al entrar queda sumada.</p>';
    } catch (e) {
      cont.innerHTML = '<h2>Personas</h2><p class="error">Se necesita conexión: ' + esc(e.message) + '</p>';
    }
  }

  function dibujar() {
    var p = perfil();
    document.getElementById('empresa-nombre').textContent = p && ui.pantalla !== 'login' ? p.empresa : '';
    document.getElementById('menu').hidden = !p || ['login', 'empresa', 'sinConfig'].indexOf(ui.pantalla) >= 0;
    // En la pantalla de acceso no va la barra: el logo grande cumple esa función.
    document.body.classList.toggle('en-acceso', ui.pantalla === 'login');
    vista.innerHTML = (pantallas[ui.pantalla] || pantallas.cargando)();
    estadoNube();
  }

  // ───────────────────────── Cambios en un lote ─────────────────────────

  function cambiarLote(mutar, redibujar) {
    Store.cambiar(ui.loteId, mutar);
    programarSync();
    if (redibujar !== false) dibujar();
    else estadoNube();
  }

  function valorCampo(input) {
    return input.type === 'checkbox' ? input.checked : input.value;
  }

  // Al tipear no se redibuja la pantalla (se perdería el foco): solo se
  // actualizan los indicadores de esa tarjeta.
  function alEscribir(input) {
    var sec = input.dataset.sec, i = Number(input.dataset.i), k = input.dataset.k, v = valorCampo(input);
    cambiarLote(function (d) {
      if (sec === 'linea') d.linea[i][k] = v;
      else if (sec === 'final') d.final.pallets[i][k] = v;
      else if (sec === 'cf') d.final[k] = v;
    }, false);
    var l = Store.lote(ui.loteId);
    if (sec === 'linea') {
      var der = derivadosLinea(l.datos, inductora(l.datos.cab.indId), l.datos.linea[i]);
      var card = document.getElementById('cl-' + i);
      card.className = 'pcard e-' + der.estado;
      card.querySelector('.der-peso').innerHTML = der.peso;
      card.querySelector('.der-sem').innerHTML = der.sem;
    }
  }

  async function dictaminar(tipo) {
    var l = Store.lote(ui.loteId);
    var falt = Reglas.palletsFaltantes(l.datos);
    var txt = DICTAMENES.filter(function (x) { return x.v === tipo; })[0].txt;
    if (falt.length && !esSuperior()) return;
    var msg = falt.length
      ? 'Faltan completar ' + falt.length + ' pallet(s) del control final.\n¿Dictaminar "' + txt + '" igual? Queda registrado que lo autorizaste.'
      : '¿Dictaminar el lote como "' + txt + '"?';
    if (!confirm(msg)) return;
    var p = perfil();
    cambiarLote(function (d) {
      d.final.dictamen = tipo;
      d.estado = Reglas.estadoPorDictamen(tipo);
      d.final.fechaDictamen = ahora();
      d.final.dictaminadoPor = p.nombre || p.email;
      d.final.dictaminadoRol = ROLES[p.rol];
      d.cierreForzado = falt.length ? { fecha: new Date().toISOString(), por: p.nombre || p.email, faltantes: falt.length } : null;
    });
    aviso('Dictamen: ' + txt);
    programarSync(0);
  }

  // ───────────────────────── Eventos ─────────────────────────

  var acciones = {
    inicio: function () { ir('inicio'); },
    tab: function (b) { ir('inicio', { tab: b.dataset.tab, resultados: null }); },
    nuevo: function () { ir('nuevo', { loteId: null }); },
    abrir: function (b) {
      if (!b.dataset.id) return ir('inicio');
      if (b.dataset.remoto && !Store.lote(b.dataset.id)) {
        var f = (ui.resultados || []).filter(function (x) { return x.id === b.dataset.id; })[0];
        if (f) { Store.aplicarRemoto(f); Store.guardar(); }
      }
      ir('lote', { loteId: b.dataset.id });
    },
    'editar-cab': function () { ir('nuevo', { loteId: ui.loteId }); },
    config: function () { ir('config'); },
    conflictos: function () { ir('conflictos'); },
    conflicto: function (b) {
      Store.resolverConflicto(Number(b.dataset.i), b.dataset.v);
      programarSync(0);
      if (Store.conflictos().length) dibujar(); else ir('inicio');
    },
    'limpiar-busqueda': function () { ir('inicio', { resultados: null, busqueda: '' }); },

    check: function (b) {
      var sec = b.dataset.sec, i = Number(b.dataset.i), k = b.dataset.k, v = b.dataset.v === 'true';
      cambiarLote(function (d) {
        var p = sec === 'linea' ? d.linea[i] : d.final.pallets[i];
        p[k] = p[k] === v ? null : v; // tocar el mismo otra vez lo deja sin marcar
        if (p[k] !== false) {
          var c = (sec === 'linea' ? Reglas.CHECKS_LINEA : Reglas.CHECKS_FINAL).filter(function (x) { return x.campo === k; })[0];
          if (c) p[c.repro] = false;
        }
      });
    },
    repro: function (b) {
      var sec = b.dataset.sec, i = Number(b.dataset.i), k = b.dataset.k;
      cambiarLote(function (d) { var p = sec === 'linea' ? d.linea[i] : d.final.pallets[i]; p[k] = !p[k]; });
    },
    'todo-ok': function (b) {
      var i = Number(b.dataset.i);
      cambiarLote(function (d) {
        Reglas.CHECKS_FINAL.forEach(function (c) { d.final.pallets[i][c.campo] = true; d.final.pallets[i][c.repro] = false; });
      });
    },
    hora: function (b) {
      var i = Number(b.dataset.i), t = new Date();
      cambiarLote(function (d) { d.linea[i].hora = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); });
    },
    'agregar-linea': function () {
      cambiarLote(function (d) {
        var ult = d.linea[d.linea.length - 1];
        var nuevo = Reglas.nuevoPalletLinea(d.linea.length + 1);
        // La identificación suele repetirse pallet a pallet: se copia del anterior.
        if (ult) ['lote', 'codProd', 'fProd', 'fVenc'].forEach(function (k) { nuevo[k] = ult[k]; });
        d.linea.push(nuevo);
      });
    },
    'quitar-linea': function (b) {
      if (!confirm('¿Quitar este pallet del control en línea?')) return;
      cambiarLote(function (d) { d.linea.splice(Number(b.dataset.i), 1); });
    },
    'agregar-final': function () { cambiarLote(function (d) { d.final.pallets.push(Reglas.nuevoPalletFinal()); }); },
    'quitar-final': function (b) {
      if (!confirm('¿Quitar este pallet del control final?')) return;
      cambiarLote(function (d) { d.final.pallets.splice(Number(b.dataset.i), 1); });
    },
    'agregar-hallazgo': function () {
      var t = document.getElementById('nuevo-hallazgo').value.trim();
      if (!t) return;
      cambiarLote(function (d) { d.hallazgos.push({ ts: ahora(), autor: perfil().nombre, txt: t }); });
    },
    'quitar-hallazgo': function (b) {
      if (!confirm('¿Quitar esta observación?')) return;
      cambiarLote(function (d) { d.hallazgos.splice(Number(b.dataset.i), 1); });
    },
    dictaminar: function (b) { dictaminar(b.dataset.v); },
    reabrir: function () {
      if (!confirm('¿Reabrir el lote? Se borra el dictamen y vuelve a "En control".')) return;
      cambiarLote(function (d) {
        d.estado = 'activo';
        d.final.dictamen = null; d.final.fechaDictamen = null; d.final.dictaminadoPor = ''; d.final.dictaminadoRol = '';
        d.cierreForzado = null;
        d.hallazgos.push({ ts: ahora(), autor: perfil().nombre, txt: 'Lote reabierto' });
      });
    },
    'borrar-lote': function () {
      var l = Store.lote(ui.loteId);
      if (!confirm('¿Borrar el lote ' + l.datos.cab.lote + '? Queda en la auditoría pero desaparece de todos los equipos.')) return;
      Store.borrar(ui.loteId);
      programarSync(0);
      ir('inicio');
    },
    imprimir: function () { var p = perfil(); Imprimir.lote(Store.lote(ui.loteId), config(), p.empresa); },
    'copiar-desvios': function () {
      var l = Store.lote(ui.loteId), c = l.datos.cab;
      var txt = Reglas.desvios(l.datos).map(function (x) {
        return [Reglas.fechaLarga(c.fecha), c.lote, c.cliente, c.prod, x.etapa, 'Pallet ' + x.pallet, x.control,
          x.corregido ? 'Reprocesado' : 'Abierto', x.obs].join('\t');
      }).join('\n');
      navigator.clipboard.writeText(txt).then(function () { aviso('Desvíos copiados: pegalos en el registro de NC'); },
        function () { aviso('No se pudo copiar'); });
    },

    'ver-clave': function (b) {
      var input = b.parentNode.querySelector('input');
      var ver = input.type === 'password';
      input.type = ver ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(ver));
      b.setAttribute('aria-label', ver ? 'Ocultar clave' : 'Mostrar clave');
    },
    registrarse: async function () {
      var f = document.querySelector('[data-form="login"]');
      if (!f.reportValidity()) return;
      ui.email = f.email.value.trim();
      esperando(document.querySelector('[data-act="registrarse"]'), 'Creando cuenta…');
      try {
        var r = await Nube.registrarse(f.email.value.trim(), f.clave.value);
        // No es un error: va con estilo de aviso, no en rojo.
        if (r.necesitaConfirmar) return ir('login', { mensaje: 'Te mandamos un email para confirmar la cuenta. Confirmala y después ingresá.', tipoMensaje: 'info' });
        await elegirEmpresa(r.usuario, '');
      } catch (e) { ir('login', { mensaje: e.message }); }
    },
    'buscar-invitaciones': async function () {
      var f = document.querySelector('[data-form="empresa"]');
      if (!f.nombre.reportValidity()) return;
      ui.mensaje = '';
      await elegirEmpresa(ui.usuario, f.nombre.value.trim());
      if (ui.pantalla === 'empresa' && !(ui.membresias || []).length) ir('empresa', { mensaje: 'No hay invitaciones para tu email.' });
    },
    'usar-empresa': function (b) { usarMembresia(ui.usuario, ui.membresias[Number(b.dataset.i)]); },
    'cambiar-empresa': async function () {
      try { await elegirEmpresa(await Nube.usuario(), '', true); }
      catch (e) { aviso(e.message); }
    },
    salir: async function () {
      if (perfil() && Store.pendientes().length &&
          !confirm('Hay cambios sin subir en esta tablet. Si salís quedan guardados acá y se suben cuando vuelva a entrar alguien de la empresa. ¿Salir?')) return;
      await Nube.salir();
      Store.setPerfil(null);
      ir('login');
    },
    respaldo: function () {
      var blob = new Blob([JSON.stringify(Store.respaldo(), null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qualityos-respaldo-' + Reglas.hoy() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    'agregar-inductora': function () {
      var cont = document.getElementById('inductoras');
      cont.insertAdjacentHTML('beforeend', filaInductora({ id: 'I' + Date.now().toString(36), nombre: '', tolMin: '', tolMax: '', unidad: '', semaforo: true }));
    },
    'quitar-inductora': function (b) { b.closest('.fila-ind').remove(); },
    activo: async function (b) {
      try { await Nube.cambiarMiembro(perfil().empresaId, b.dataset.user, { activo: b.dataset.v === 'true' }); cargarMiembros(); }
      catch (e) { aviso(e.message); }
    },
    'quitar-invitacion': async function (b) {
      try { await Nube.quitarInvitacion(perfil().empresaId, b.dataset.email); cargarMiembros(); }
      catch (e) { aviso(e.message); }
    }
  };

  var formularios = {
    login: async function (f) {
      ui.email = f.email.value.trim(); // si falla, el email no se tiene que volver a tipear
      esperando(f.querySelector('[type=submit]'), 'Ingresando…');
      try {
        var u = await Nube.entrar(f.email.value.trim(), f.clave.value);
        await elegirEmpresa(u, '');
      } catch (e) { ir('login', { mensaje: e.message }); }
    },
    empresa: async function (f) {
      // Sin permiso para crear empresas no hay campo "empresa": Enter busca invitaciones.
      if (!f.empresa) return acciones['buscar-invitaciones']();
      if (!f.empresa.value.trim()) return ir('empresa', { mensaje: 'Escribí el nombre de la empresa nueva.' });
      try {
        await Nube.crearEmpresa(f.empresa.value.trim(), f.nombre.value.trim());
        await elegirEmpresa(ui.usuario, f.nombre.value.trim());
      } catch (e) { ir('empresa', { mensaje: e.message }); }
    },
    cabecera: function (f) {
      var cab = {
        prod: f.prod.value.trim(), lote: f.lote.value.trim(), cliente: Reglas.normalizarCliente(f.cliente.value),
        linea: f.linea.value.trim(), fecha: f.fecha.value, indId: f.indId.value,
        pesoMin: f.pesoMin.value.trim(), pesoMax: f.pesoMax.value.trim(), checker: f.checker.value.trim()
      };
      if (ui.loteId) {
        cambiarLote(function (d) { d.cab = cab; }, false);
      } else {
        var n = Math.max(0, Math.min(200, parseInt(f.pallets.value, 10) || 0));
        ui.loteId = Store.crear(Reglas.nuevoLote(cab, n));
        programarSync();
      }
      ir('lote', { loteId: ui.loteId });
    },
    buscar: async function (f) {
      ui.busqueda = f.q.value.trim();
      if (!Nube.hayRed()) { aviso('Sin señal: se busca solo en esta tablet'); return ir('inicio', { resultados: null }); }
      try { ir('inicio', { resultados: await Nube.buscarLotes(ui.busqueda) }); }
      catch (e) { aviso(e.message); ir('inicio', { resultados: null }); }
    },
    'mi-nombre': async function (f) {
      var nombre = f.nombre.value.trim();
      try {
        await Nube.cambiarMiNombre(perfil().empresaId, nombre);
        Store.setPerfil(Object.assign({}, perfil(), { nombre: nombre }));
        aviso('Nombre guardado');
      } catch (e) { aviso(e.message); }
    },
    config: async function (f) {
      var inductoras = [].map.call(document.querySelectorAll('.fila-ind'), function (fila) {
        var v = function (n) { return fila.querySelector('[name="' + n + '"]'); };
        return { id: fila.dataset.id, nombre: v('ind-nombre').value.trim(), tolMin: Reglas.numero(v('ind-min').value),
          tolMax: Reglas.numero(v('ind-max').value), unidad: v('ind-unidad').value.trim(), semaforo: v('ind-sem').checked };
      });
      if (inductoras.some(function (i) { return isNaN(i.tolMin) || isNaN(i.tolMax) || i.tolMin > i.tolMax; })) {
        return aviso('Revisá las tolerancias: el mínimo tiene que ser menor o igual al máximo.');
      }
      var cfg = Object.assign({}, config(), {
        docCodigo: f.docCodigo.value.trim(), docVersion: f.docVersion.value.trim(),
        docElab: f.docElab.value.trim(), docAprob: f.docAprob.value.trim(),
        lineas: f.lineas.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        inductoras: inductoras
      });
      try {
        await Nube.guardarEmpresa(perfil().empresaId, f.nombre.value.trim(), cfg);
        Store.setPerfil(Object.assign({}, perfil(), { empresa: f.nombre.value.trim(), config: cfg }));
        aviso('Configuración guardada');
        dibujar();
      } catch (e) { aviso(e.message); }
    },
    invitar: async function (f) {
      try {
        await Nube.invitar(perfil().empresaId, f.email.value, f.rol.value);
        aviso('Invitación creada');
        cargarMiembros();
      } catch (e) { aviso(e.message); }
    }
  };

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    if (b.tagName === 'A') ev.preventDefault();
    var fn = acciones[b.dataset.act];
    if (fn) fn(b);
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest('[data-form]');
    if (!f) return;
    ev.preventDefault();
    var fn = formularios[f.dataset.form];
    if (fn) fn(f);
  });

  document.addEventListener('input', function (ev) {
    if (ev.target.dataset && ev.target.dataset.sec && ui.pantalla === 'lote') alEscribir(ev.target);
  });

  document.addEventListener('change', async function (ev) {
    var s = ev.target;
    if (s.dataset && s.dataset.actChange === 'rol') {
      try { await Nube.cambiarMiembro(perfil().empresaId, s.dataset.user, { rol: s.value }); aviso('Rol cambiado'); }
      catch (e) { aviso(e.message); cargarMiembros(); }
    }
  });

  window.addEventListener('online', function () { estadoNube(); programarSync(0); });
  window.addEventListener('offline', estadoNube);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) programarSync(0); });
  setInterval(function () { if (!document.hidden) sincronizar(); }, 60000);

  arrancar();
})();
