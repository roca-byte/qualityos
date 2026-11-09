/* App: pantallas y eventos.
 * Todos los clics se manejan con un solo listener (data-act) y todos los campos
 * con otro (data-sec/data-i/data-k). Así no hay onclick="" sueltos en el HTML
 * y cada pantalla es una función que devuelve su HTML.
 */
(function () {
  'use strict';

  var esc = Imprimir.esc;
  var vista = document.getElementById('vista');
  // ncFiltro: qué NC se ven ('aaaa-mm' o 'abiertas'); null = el mes actual.
  var ui = { pantalla: 'cargando', loteId: null, tab: 'activos', busqueda: '', resultados: null, mensaje: '', ncId: null, ncFiltro: null };
  var temporizadorSync = null;

  var ROLES = { checker: 'Inspector de Calidad', coordinacion: 'Coordinación', admin: 'Administración' };
  var DICTAMENES = [
    { v: 'APROBADO', txt: 'Aprobado', cls: 'ok' },
    { v: 'APROBADO_PARCIAL', txt: 'Aprobado parcial', cls: 'warn' },
    { v: 'RETENIDO', txt: 'Retenido', cls: 'nok' }
  ];
  var ESTADOS = { activo: 'En control', aprobado: 'Aprobado', aprobado_parcial: 'Aprobado parcial', retenido: 'Retenido' };
  var CONFIG_INICIAL = { lineas: [], docCodigo: 'REG-01', docVersion: '00', docElab: '', docAprob: '' };

  // ───────────────────────── Ayudas ─────────────────────────

  function perfil() { return Store.perfil(); }
  function config() { return Object.assign({}, CONFIG_INICIAL, (perfil() && perfil().config) || {}); }
  function esSuperior() { var r = perfil() && perfil().rol; return r === 'coordinacion' || r === 'admin'; }
  function esAdmin() { return perfil() && perfil().rol === 'admin'; }
  // Plantillas de control de la empresa (con configuración vieja, la equivalente).
  function plantillasEmpresa() { return Reglas.plantillas(config()); }
  // No conformidades: tipos de desvío y plazo que configuró la empresa.
  function tiposNc() { return Reglas.tiposNc(config()); }
  function plazoNc() { return Reglas.plazoNcDias(config()); }
  function mesActual() { return Reglas.hoy().slice(0, 7); }
  function quienSoy() { var p = perfil(); return (p.nombre || p.email) + ' (' + ROLES[p.rol] + ')'; }
  // Del más viejo al más nuevo (así se imprime); la lista en pantalla las da vuelta.
  function ordenarNc(lista) {
    return lista.sort(function (a, b) { return a.datos.fecha === b.datos.fecha ? String(a.numero).localeCompare(String(b.numero)) : a.datos.fecha < b.datos.fecha ? -1 : 1; });
  }

  // "pallet" / "pallets" según la plantilla del lote, para los textos.
  function nombreUnidad(p, n) { return String(n === 1 ? p.unidad : p.unidades).toLowerCase(); }

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
      if (r && r.conflictos) aviso('⚠ ' + r.conflictos + ' lote(s) o NC los cambió otro equipo. Revisá "Conflictos".');
      if (r && r.bajados) migrarLotesViejos();
      // r.subidos: una NC recién subida ya tiene número para mostrar.
      if (r && (r.bajados || r.conflictos || r.subidos) && ui.pantalla === 'inicio') dibujar();
      if (r && r.conflictos && ui.pantalla === 'nc' && ui.ncId && !Store.nc(ui.ncId)) ir('inicio', { tab: 'nc' });
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

  // Lotes del formato anterior (campos fijos de agroquímicos) → formato con plantilla.
  // Solo en este equipo (sin marcarlos para subir): un lote viejo ya dictaminado no lo puede
  // modificar un inspector, y el servidor rechazaría la subida.
  function migrarLotesViejos() {
    Store.lotes().forEach(function (l) {
      if (l.datos.formato !== 2) Store.convertir(l.id, Reglas.migrarLote(l.datos, config()));
    });
  }

  function entrarA(p) {
    Store.setPerfil(p);
    migrarLotesViejos();
    // La primera vez de esta persona en este equipo (o si todavía no cargó su nombre,
    // que sale en la firma del dictamen) se muestra la bienvenida en vez de la lista.
    if (!p.nombre || !Store.guiaVista(p.userId)) ir('bienvenida');
    else ir('inicio');
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
      empresa: m.empresas.nombre, rol: m.rol, config: m.empresas.config, demo: Nube.enDemo() });
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
      '<div class="separador"><span>¿Querés verla antes?</span></div>' +
      '<button class="btn" type="button" data-act="demo">Probar sin cuenta (demo)</button>' +
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

  var GUIA_URL = 'https://github.com/roca-byte/qualityos/blob/main/docs/GUIA.md';

  // Pasos de la bienvenida según el rol: cada uno ve lo que le toca hacer primero.
  var PASOS_INSPECTOR = [
    ['Creá el lote', 'Tocá <b>+ Nuevo lote</b>, elegí la plantilla de control y cargá producto, n° de lote, cliente, línea y los rangos que pida.'],
    ['Controlá en línea', 'Unidad por unidad (pallet, caja, muestra…), cargá lo que pide la plantilla: mediciones, OK/NOK y datos. Lo que sale de tolerancia se marca solo. Si corregiste un NOK en el momento, marcalo como <b>Reprocesado</b>.'],
    ['Hacé el control final', 'Revisá cada unidad antes del despacho. Si está todo bien, <b>✓ Todo OK</b> lo completa de un toque.'],
    ['Dictaminá', 'La app sugiere Aprobado, Aprobado parcial o Retenido según el control final. Vos decidís.'],
    ['Registrá las no conformidades', 'Desde el dictamen, <b>Crear NC</b> arma una NC por cada control con desvío. En la pestaña <b>NC</b> ves las abiertas, completás la acción y la cerrás cuando corresponda; el registro se imprime por mes.'],
    ['Guardá el registro', '<b>Imprimir / PDF</b> arma el registro del lote listo para archivar.']
  ];
  var PASOS_ADMIN = [
    ['Armá tus plantillas de control', 'En <b>⚙ → Plantillas</b> definí qué se controla en tu planta (mediciones con tolerancia, OK/NOK, datos). Podés empezar desde un ejemplo de tu rubro. Cada plantilla lleva la codificación del registro (código, versión, vigencia). Cargá también las líneas.'],
    ['Invitá a tu equipo', 'En <b>⚙ → Personas</b> escribí el email y el rol de cada persona. Ellas crean su cuenta con ese mismo email y quedan adentro.'],
    ['Probá un lote', 'Creá un lote de prueba para ver el circuito completo: control en línea, control final, dictamen y PDF.']
  ];

  pantallas.bienvenida = function () {
    var p = perfil();
    // En la demo se muestran los pasos del día a día (los de Inspector), aunque el visitante
    // entre como Administración para poder ver también ⚙.
    var pasos = p.rol === 'admin' && !p.demo ? PASOS_ADMIN : PASOS_INSPECTOR;
    var extra = p.rol === 'coordinacion'
      ? '<p class="ayuda">Como <b>Coordinación</b> además podés dictaminar con unidades pendientes, reabrir o corregir lotes dictaminados y borrar lotes.</p>'
      : '';
    if (p.demo) {
      extra = '<p class="ayuda">Ya hay un lote <b>en control</b> para seguir y otros dictaminados en <b>Historial</b>. ' +
        'En <b>⚙</b> ves la configuración de la empresa y las personas.</p>';
    }
    var demo = p.demo
      ? '<p class="info">Estás en el <b>modo demo</b>: la empresa y los lotes son de ejemplo y lo que cargues queda ' +
        'solo en este navegador. Probá todo lo que quieras.</p>'
      : '';
    return '<section class="tarjeta angosta bienvenida">' +
      '<h2>¡Bienvenido/a a QualityOS!</h2>' +
      '<p class="meta">' + esc(p.empresa) + ' · ' + esc(ROLES[p.rol]) + '</p>' + demo +
      '<form data-form="bienvenida">' +
      '<label>Tu nombre (sale en la firma del dictamen)<input name="nombre" required autocomplete="name" value="' + esc(p.nombre || '') + '"></label>' +
      '<h3>Cómo empezar</h3><ol class="pasos">' + pasos.map(function (x) {
        return '<li><b>' + x[0] + '</b><span>' + x[1] + '</span></li>';
      }).join('') + '</ol>' + extra +
      '<p class="ayuda">📶 <b>Funciona sin señal.</b> Arriba a la derecha ves si está todo subido (☁ Al día) ' +
      'o si quedan cambios por subir: se suben solos cuando vuelve la conexión.</p>' +
      '<button class="btn primario" type="submit">Empezar</button>' +
      '</form>' +
      '<a class="btn chico" href="' + GUIA_URL + '" target="_blank" rel="noopener">Ver la guía completa con capturas</a>' +
      '</section>';
  };

  pantallas.inicio = function () {
    var todos = Store.lotes().sort(function (a, b) {
      return String(b.datos.cab.fecha).localeCompare(String(a.datos.cab.fecha));
    });
    var activos = todos.filter(function (l) { return l.datos.estado === 'activo'; });
    var cerrados = todos.filter(function (l) { return l.datos.estado !== 'activo'; });
    var ncAbiertas = Store.ncs().filter(function (n) { return Reglas.ncAbierta(n.datos); }).length;
    var tabs = '<div class="tabs">' +
      '<button class="tab' + (ui.tab === 'activos' ? ' activa' : '') + '" data-act="tab" data-tab="activos">En control (' + activos.length + ')</button>' +
      '<button class="tab' + (ui.tab === 'historial' ? ' activa' : '') + '" data-act="tab" data-tab="historial">Historial</button>' +
      '<button class="tab' + (ui.tab === 'nc' ? ' activa' : '') + '" data-act="tab" data-tab="nc">NC · ' + ncAbiertas + ' abierta' + (ncAbiertas === 1 ? '' : 's') + '</button></div>';
    var cuerpo;
    if (ui.tab === 'nc') {
      cuerpo = seccionNcs();
    } else if (ui.tab === 'activos') {
      cuerpo = '<button class="btn primario grande" data-act="nuevo">+ Nuevo lote</button>' +
        (activos.length ? activos.map(tarjetaLote).join('') : listaVacia());
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

  // Lista vacía con una pista de qué hacer (sobre todo la primera vez).
  function listaVacia() {
    var sinConfig = esAdmin() && !(perfil().config && perfil().config.plantillas);
    return '<div class="vacio"><p>No hay lotes en control.</p>' +
      (sinConfig
        ? '<p class="ayuda">Antes del primer lote, armá tus plantillas de control en <b>⚙</b>.</p>'
        : '<p class="ayuda">Tocá <b>+ Nuevo lote</b> para empezar.</p>') + '</div>';
  }

  function tarjetaLote(l) {
    // Los resultados de la búsqueda en el servidor pueden venir en el formato anterior.
    var d = l.datos.formato === 2 ? l.datos : Reglas.migrarLote(l.datos, config()), c = d.cab;
    var r = Reglas.resumenFinal(d);
    return '<button class="lote-item estado-' + esc(d.estado) + '" data-act="abrir" data-id="' + esc(l.id) + '"' +
      (l.remoto ? ' data-remoto="1"' : '') + '>' +
      '<span class="li-num">' + esc(c.lote) + '</span>' +
      '<span class="li-prod">' + esc(c.prod) + (c.cliente ? ' · ' + esc(c.cliente) : '') + '</span>' +
      '<span class="li-meta">' + esc(Reglas.fechaLarga(c.fecha)) + (c.linea ? ' · ' + esc(c.linea) : '') +
      ' · CF ' + (r.aprobados + r.retenidos) + '/' + (r.aprobados + r.retenidos + r.pendientes) + '</span>' +
      '<span class="li-estado">' + esc(ESTADOS[d.estado] || d.estado) + (l.pendiente ? ' · ⏳' : '') + '</span></button>';
  }

  // ───────────── No conformidades ─────────────

  // Pestaña NC: se elige el mes (o las abiertas de todos los meses), con sus indicadores.
  function seccionNcs() {
    var filtro = ui.ncFiltro || mesActual();
    var todas = Store.ncs();
    var lista = ordenarNc(todas.filter(function (n) {
      return filtro === 'abiertas' ? Reglas.ncAbierta(n.datos) : Reglas.mesDeNc(n.datos) === filtro;
    }));
    var nAb = todas.filter(function (n) { return Reglas.ncAbierta(n.datos); }).length;
    var opc = [{ v: 'abiertas', t: 'Abiertas, todos los meses (' + nAb + ')' }].concat(
      Reglas.mesesNc(todas.map(function (n) { return n.datos; }), mesActual()).map(function (m) { return { v: m, t: Reglas.nombreMes(m) }; }));
    var k = Reglas.kpisNc(lista.map(function (n) { return n.datos; }));
    var kpi = function (valor, txt, cls) { return '<div class="' + (cls || '') + '"><b>' + esc(valor) + '</b><span>' + txt + '</span></div>'; };
    var kpis = '<div class="nc-kpis">' +
      kpi(k.total, filtro === 'abiertas' ? 'abiertas' : 'NC del mes') +
      (filtro === 'abiertas' ? '' : kpi(k.abiertas, 'abiertas', k.abiertas ? 'warn' : '')) +
      kpi(k.vencidas, 'plazo vencido', k.vencidas ? 'nok' : '') +
      kpi(k.enPlazo === null ? '—' : k.enPlazo + ' %', 'cerradas en plazo') +
      kpi(k.sev['Crítico'], 'críticas', k.sev['Crítico'] ? 'nok' : '') + '</div>' +
      // Solo si algún tipo se repite: con todos distintos, "el más frecuente" no dice nada.
      (k.masFrecuente && k.masFrecuente.veces > 1 ? '<p class="ayuda">Desvío más frecuente: <b>' + esc(k.masFrecuente.tipo) + '</b> (' + k.masFrecuente.veces + ' de ' + k.total + ')</p>' : '');
    return '<div class="nc-barra"><label>Ver<select data-act-change="nc-filtro" aria-label="Qué NC ver">' + opciones(opc, filtro) + '</select></label>' +
      '<button class="btn primario" data-act="nueva-nc">+ Nueva NC</button></div>' + kpis +
      (lista.length ? lista.slice().reverse().map(tarjetaNc).join('')
        : '<p class="vacio">' + (filtro === 'abiertas' ? 'No hay NC abiertas.' : 'Todavía no hay NC en ' + esc(Reglas.nombreMes(filtro)) + '.') + '</p>') +
      '<div class="acciones"><button class="btn" data-act="imprimir-nc">Imprimir registro / PDF</button>' +
      '<label class="btn">Importar del registro individual (.json)<input type="file" accept=".json,application/json" data-act-change="importar-nc" hidden></label></div>' +
      '<p class="ayuda">Importar trae las NC de la app <i>Registro de No Conformidades</i> (su respaldo 💾) para no cargarlas de nuevo.</p>';
  }

  function tarjetaNc(n) {
    var d = n.datos;
    var vencida = Reglas.ncAbierta(d) && d.plazo && d.plazo < Reglas.hoy();
    return '<button class="lote-item nc-item nc-' + esc(d.estado) + ' sev-' + esc(d.sev || 'ninguna') + '" data-act="abrir-nc" data-id="' + esc(n.id) + '">' +
      '<span class="li-num">' + esc(n.numero || 'NC nueva') + '</span>' +
      '<span class="li-prod">' + esc(d.tipo || d.desc) + (d.sev ? ' · ' + esc(d.sev) : '') + '</span>' +
      '<span class="li-meta">' + [Reglas.fechaLarga(d.fecha), d.lote, d.deteccion].filter(Boolean).map(esc).join(' · ') +
      (vencida ? ' · <b class="txt-nok">plazo vencido</b>' : '') + '</span>' +
      '<span class="li-estado">' + esc(Reglas.NC_ESTADOS[d.estado]) + (n.pendiente ? ' · ⏳' : '') + '</span></button>';
  }

  // Ficha de una NC (nueva o existente). Cualquiera de Calidad la edita, la cierra y verifica la eficacia.
  pantallas.nc = function () {
    var n = ui.ncId ? Store.nc(ui.ncId) : null;
    if (ui.ncId && !n) return '<p class="vacio">La NC ya no está en esta tablet.</p><button class="btn" data-act="volver-nc">Volver</button>';
    var d = n ? n.datos : ui.ncNueva;
    var tipos = tiposNc().map(function (t) { return t.nombre; });
    if (d.tipo && tipos.indexOf(d.tipo) < 0) tipos.push(d.tipo);   // un tipo que ya no está en la lista se conserva
    var detecciones = Reglas.DETECCIONES.slice();
    if (d.deteccion && detecciones.indexOf(d.deteccion) < 0) detecciones.push(d.deteccion);
    var lista = function (xs) { return [{ v: '', t: '—' }].concat(xs.map(function (x) { return { v: x, t: x }; })); };
    var campo = function (nombre, etq, attrs) { return '<label>' + etq + '<input name="' + nombre + '" value="' + esc(d[nombre] || '') + '" ' + (attrs || '') + '></label>'; };
    var abierta = Reglas.ncAbierta(d);
    var lote = d.loteId ? Store.lote(d.loteId) : null;
    return '<section class="tarjeta"><div class="cab-fila"><button class="btn chico" data-act="volver-nc">← NC</button>' +
      '<span class="li-estado nc-' + esc(d.estado) + '">' + esc(Reglas.NC_ESTADOS[d.estado]) + '</span></div>' +
      '<h2>' + (n ? esc(n.numero || 'NC sin número') : 'Nueva NC') + '</h2>' +
      (n && !n.numero ? '<p class="ayuda">El número (NC-' + esc(String(d.fecha).slice(0, 4)) + '-…) lo pone el servidor cuando la NC se sube.</p>' : '') +
      (d.creadaPor ? '<p class="meta">Cargó ' + esc(d.creadaPor) + '</p>' : '') +
      '<form data-form="nc">' +
      '<div class="fila2">' + campo('fecha', 'Fecha de detección *', 'type="date" required') +
      '<label>Detección<select name="deteccion">' + opciones(lista(detecciones), d.deteccion) + '</select></label></div>' +
      '<div class="fila2">' + campo('lote', 'N° de lote') + campo('prod', 'Producto') + '</div>' +
      campo('cliente', 'Cliente') +
      (lote ? '<button type="button" class="btn chico" data-act="abrir" data-id="' + esc(d.loteId) + '">Ver el lote ' + esc(lote.datos.cab.lote) + '</button>' : '') +
      '<div class="fila2"><label>Tipo de desvío<select name="tipo" data-act-change="nc-tipo">' + opciones(lista(tipos), d.tipo) + '</select></label>' +
      '<label>Gravedad<select name="sev">' + opciones(lista(Reglas.SEVERIDADES), d.sev) + '</select></label></div>' +
      '<label>Descripción<textarea name="desc" rows="3">' + esc(d.desc) + '</textarea></label>' +
      '<div class="fila3">' + campo('cantNC', 'Cantidad no conforme', 'inputmode="decimal"') + campo('cantTot', 'Cantidad total', 'inputmode="decimal"') +
      campo('unidadCant', 'Unidad', 'placeholder="L, kg, u"') + '</div>' +
      '<label>Acción correctiva / disposición<textarea name="ac" rows="2">' + esc(d.ac) + '</textarea></label>' +
      '<div class="fila2">' + campo('resp', 'Responsable') + campo('plazo', 'Plazo', 'type="date"') + '</div>' +
      (abierta ? '<label>Estado<select name="estado">' + opciones([{ v: 'abierta', t: 'Abierta' }, { v: 'en_proceso', t: 'En proceso' }], d.estado) + '</select></label>' : '') +
      (d.estado === 'cerrada' ? '<p class="info">Cerrada el ' + esc(Reglas.fechaLarga(d.cierre)) + (d.cerradaPor ? ' por ' + esc(d.cerradaPor) : '') + '</p>' +
        '<label>Verificación de eficacia (ISO 9001, 10.2)<select name="eficacia">' +
        opciones(Object.keys(Reglas.EFICACIA).map(function (k) { return { v: k, t: Reglas.EFICACIA[k] }; }), d.eficacia) + '</select></label>' : '') +
      '<div class="acciones"><button class="btn" type="button" data-act="volver-nc">Cancelar</button>' +
      '<button class="btn primario" type="submit">' + (n ? 'Guardar' : 'Crear NC') + '</button></div>' +
      (n ? '<div class="acciones">' +
        (abierta ? '<button class="btn" type="button" data-act="cerrar-nc">✓ Cerrar NC</button>' : '<button class="btn" type="button" data-act="reabrir-nc">Reabrir</button>') +
        (d.estado !== 'anulada' ? '<button class="btn peligro" type="button" data-act="anular-nc">Anular</button>' : '') + '</div>' : '') +
      '</form></section>';
  };

  function leerFormNc(f) {
    var d = {};
    ['fecha', 'deteccion', 'lote', 'prod', 'cliente', 'tipo', 'sev', 'desc', 'cantNC', 'cantTot', 'unidadCant', 'ac', 'resp', 'plazo', 'estado', 'eficacia']
      .forEach(function (k) { if (f[k]) d[k] = f[k].value.trim(); });
    d.cliente = Reglas.normalizarCliente(d.cliente || '');
    return d;
  }

  // Guarda lo del formulario (más "extra": cerrar, reabrir, anular). Devuelve false si falta algo.
  function guardarNc(f, extra) {
    var base = ui.ncId ? Store.nc(ui.ncId).datos : ui.ncNueva;
    var d = Object.assign(Reglas.copia(base), leerFormNc(f), extra || {});
    Reglas.actualizarPlazo(d, plazoNc());
    var problema = Reglas.validarNc(d);
    if (problema) { aviso(problema); return false; }
    if (ui.ncId) Store.cambiarNc(ui.ncId, function (x) { Object.assign(x, d); });
    else ui.ncId = Store.crearNc(d);
    programarSync();
    return true;
  }

  // NC del lote y botón para crearlas desde sus desvíos (sin repetir las ya creadas).
  function seccionNcDelLote(l) {
    var propias = ordenarNc(Store.ncs().filter(function (n) { return n.datos.loteId === l.id; }));
    var porCrear = Reglas.ncsDesdeLote(l.datos, l.id, tiposNc(), plazoNc(),
      propias.map(function (n) { return n.datos.origen; }).filter(Boolean));
    if (!propias.length && !porCrear.length) return '';
    return '<div class="nc-lote">' +
      (propias.length ? '<p class="ayuda">NC de este lote:</p>' + propias.map(function (n) {
        return '<button type="button" class="btn chico" data-act="abrir-nc" data-id="' + esc(n.id) + '">' + esc(n.numero || 'NC nueva') +
          ' · ' + esc(Reglas.NC_ESTADOS[n.datos.estado]) + '</button>';
      }).join('') : '') +
      (porCrear.length ? '<button type="button" class="btn" data-act="crear-nc-lote">Crear ' + porCrear.length + ' NC desde los desvíos</button>' : '') +
      '</div>';
  }

  // ⚙ No conformidades (admin): codificación del registro, plazo y tipos de desvío.
  function seccionConfigNc() {
    var cfg = config();
    var tipos = ui.tiposNcEdit || tiposNc();
    var sevs = [{ v: '', t: '— sin gravedad' }].concat(Reglas.SEVERIDADES.map(function (x) { return { v: x, t: x }; }));
    return '<section class="tarjeta" id="config-nc"><h2>No conformidades</h2><form data-form="config-nc">' +
      '<div class="fila3"><label>Código del registro<input name="ncCodigo" value="' + esc(cfg.ncCodigo || '') + '" placeholder="REG-NC"></label>' +
      '<label>Versión<input name="ncVersion" value="' + esc(cfg.ncVersion || '') + '" placeholder="01"></label>' +
      '<label>Plazo (días hábiles)<input name="ncPlazoDias" type="number" min="1" max="90" value="' + esc(plazoNc()) + '"></label></div>' +
      '<h3>Tipos de desvío</h3><p class="ayuda">Al elegir un tipo en una NC, la gravedad se completa sola (se puede cambiar). ' +
      'Si el nombre coincide con un control de la plantilla (por ejemplo «Inducción»), las NC creadas desde un lote lo toman solas.</p>' +
      tipos.map(function (t, i) {
        return '<div class="fila-tipo"><input name="tipo-nombre" value="' + esc(t.nombre) + '" aria-label="Tipo de desvío ' + (i + 1) + '">' +
          '<select name="tipo-sev" aria-label="Gravedad">' + opciones(sevs, t.sev) + '</select>' +
          '<button type="button" class="btn chico peligro" data-act="tipo-nc-quitar" data-i="' + i + '" aria-label="Quitar">✕</button></div>';
      }).join('') +
      '<button type="button" class="btn" data-act="tipo-nc-agregar">+ Tipo de desvío</button>' +
      '<button class="btn primario" type="submit">Guardar</button></form></section>';
  }

  function leerTiposNcForm() {
    var nombres = document.querySelectorAll('[data-form="config-nc"] [name="tipo-nombre"]');
    var sevs = document.querySelectorAll('[data-form="config-nc"] [name="tipo-sev"]');
    return [].map.call(nombres, function (inp, i) { return { nombre: inp.value, sev: sevs[i].value }; });
  }

  // Formulario de cabecera: sirve para lote nuevo y para editar.
  // Al crear, se elige la plantilla; sus mediciones con tolerancia "por lote" piden acá su rango.
  pantallas.nuevo = function () {
    var l = ui.loteId ? Store.lote(ui.loteId) : null;
    var ps = plantillasEmpresa();
    var b = ui.borrador || {}; // lo tipeado antes de cambiar de plantilla
    var c = l ? l.datos.cab : Object.assign({ fecha: Reglas.hoy(), checker: perfil().nombre, rangos: {} }, b);
    var p = l ? l.datos.plantilla : (ps.filter(function (x) { return x.id === b.plantillaId; })[0] || ps[0]);
    var conRango = p.linea.concat(p.final).filter(function (it) { return it.tipo === 'medicion' && it.tolerancia === 'lote'; });
    var rangos = c.rangos || {};
    var lineas = config().lineas || [];
    return '<section class="tarjeta"><h2>' + (l ? 'Datos del lote' : 'Nuevo lote') + '</h2>' +
      '<form data-form="cabecera">' +
      (l ? '<p class="meta">Plantilla: ' + esc(p.nombre) + '</p>'
        : ps.length > 1 ? '<label>Plantilla de control<select name="plantilla" data-act-change="plantilla-lote">' +
            opciones(ps.map(function (x) { return { v: x.id, t: x.nombre }; }), p.id) + '</select></label>'
          : '<p class="meta">Plantilla: ' + esc(p.nombre) + '</p>') +
      '<label>Producto *<input name="prod" required value="' + esc(c.prod || '') + '"></label>' +
      '<label>N° de lote *<input name="lote" required value="' + esc(c.lote || '') + '"></label>' +
      '<label>Cliente<input name="cliente" value="' + esc(c.cliente || '') + '"></label>' +
      '<label>Línea<input name="linea" list="lineas" value="' + esc(c.linea || '') + '"></label>' +
      '<datalist id="lineas">' + lineas.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      '<label>Fecha<input name="fecha" type="date" value="' + esc(c.fecha || '') + '"></label>' +
      (conRango.length ? '<h3>Rangos de este lote</h3>' + conRango.map(function (it) {
        var r = rangos[it.id] || {}, u = it.unidad ? ' (' + esc(it.unidad) + ')' : '';
        return '<div class="fila2"><label>' + esc(it.nombre) + ': mín.' + u + '<input name="min-' + esc(it.id) + '" inputmode="decimal" value="' + esc(r.min || '') + '"></label>' +
          '<label>' + esc(it.nombre) + ': máx.' + u + '<input name="max-' + esc(it.id) + '" inputmode="decimal" value="' + esc(r.max || '') + '"></label></div>';
      }).join('') : '') +
      '<label>Inspector de Calidad<input name="checker" value="' + esc(c.checker || '') + '"></label>' +
      (l ? '' : '<label>Cantidad de ' + esc(nombreUnidad(p, 2)) + ' del control final<input name="cantFinal" type="number" min="0" max="200" value="' + esc(p.cantFinal === undefined ? 12 : p.cantFinal) + '"></label>') +
      '<div class="acciones"><button class="btn" type="button" data-act="' + (l ? 'abrir' : 'inicio') + '" data-id="' + esc(ui.loteId || '') + '">Cancelar</button>' +
      '<button class="btn primario" type="submit">' + (l ? 'Guardar' : 'Crear lote') + '</button></div>' +
      '</form></section>';
  };

  // "Envasado de líquidos (REG-01 v03)": nombre de la plantilla con su codificación.
  function nombreRegistro(p) {
    var doc = Reglas.docDe(p, config());
    return p.nombre + (doc.codigo ? ' (' + doc.codigo + ' v' + doc.version + ')' : '');
  }

  // Rangos cargados en el lote, para mostrar: "Peso por pico 10–11 kg".
  function textoRangos(d) {
    var r = d.cab.rangos || {};
    return d.plantilla.linea.concat(d.plantilla.final).filter(function (it) {
      return it.tipo === 'medicion' && it.tolerancia === 'lote' && r[it.id] && (r[it.id].min !== '' || r[it.id].max !== '');
    }).map(function (it) { return it.nombre + ' ' + (r[it.id].min || '…') + '–' + (r[it.id].max || '…') + (it.unidad ? ' ' + it.unidad : ''); });
  }

  // ── Pantalla del lote ──

  pantallas.lote = function () {
    var l = Store.lote(ui.loteId);
    if (!l) return '<p class="vacio">El lote ya no está en esta tablet.</p><button class="btn" data-act="inicio">Volver</button>';
    var d = l.datos, c = d.cab, ed = editable(l);
    var cab = '<section class="tarjeta cab-lote"><div class="cab-fila">' +
      '<button class="btn chico" data-act="inicio">← Lotes</button>' +
      '<span class="li-estado estado-' + esc(d.estado) + '">' + esc(ESTADOS[d.estado]) + '</span></div>' +
      '<h2>' + esc(c.lote) + ' · ' + esc(c.prod) + '</h2>' +
      '<p class="meta">' + [c.cliente, c.linea, Reglas.fechaLarga(c.fecha), nombreRegistro(d.plantilla)].concat(textoRangos(d))
        .filter(Boolean).map(esc).join(' · ') + '</p>' +
      (ed ? '<button class="btn chico" data-act="editar-cab">Editar datos</button>' : '') +
      (!ed ? '<p class="ayuda">Lote dictaminado: solo coordinación lo puede modificar.</p>' : '') + '</section>';
    return cab + '<fieldset class="planilla"' + (ed ? '' : ' disabled') + '>' +
      seccionUnidades('linea', d) + seccionUnidades('final', d) + seccionHallazgos(d) + '</fieldset>' + seccionDictamen(l);
  };

  function botonesCheck(sec, i, item, valor, conRepro, repro) {
    var b = function (v, txt, cls) {
      return '<button type="button" class="chk ' + cls + (valor === v ? ' sel' : '') + '" data-act="check" data-sec="' + sec +
        '" data-i="' + i + '" data-item="' + esc(item) + '" data-v="' + v + '">' + txt + '</button>';
    };
    return '<span class="chks">' + b(true, 'OK', 'ok') + b(false, 'NOK', 'nok') +
      (valor === false && conRepro ? botonRepro(sec, i, item, repro) : '') + '</span>';
  }

  function botonRepro(sec, i, item, repro) {
    return '<button type="button" class="chk repro' + (repro ? ' sel' : '') + '" data-act="repro" data-sec="' + sec + '" data-i="' + i +
      '" data-item="' + esc(item) + '">↻ Reprocesado</button>';
  }

  // Datos de la unidad que no son ítems de la plantilla (número, hora, cantidad, observación).
  function campoUnidad(sec, i, campo, valor, etiqueta, attrs) {
    return '<label>' + etiqueta + '<input data-sec="' + sec + '" data-i="' + i + '" data-campo="' + campo + '" value="' + esc(valor) + '" ' + (attrs || '') + '></label>';
  }

  function textoRango(it, cab) {
    var r = Reglas.rango(it, cab);
    if (!r) return '';
    var u = it.unidad ? ' ' + it.unidad : '';
    if (isNaN(r.min)) return 'máx. ' + r.max + u;
    if (isNaN(r.max)) return 'mín. ' + r.min + u;
    return r.min + '–' + r.max + u;
  }

  // Lo que se calcula de una medición: promedio, si está fuera de rango, semáforo y el
  // botón de reproceso. Se vuelve a calcular mientras se tipea.
  function derivadoMedicion(sec, i, it, u, cab) {
    var e = Reglas.evaluar(it, u.v[it.id], u.r[it.id], cab);
    var n = Reglas.lecturas(it, u.v[it.id]).length;
    return (e.sem ? '<span class="sem ' + e.sem + '"></span>' : '') +
      (e.promedio !== null && n > 1 ? 'Prom. ' + e.promedio + (it.unidad ? ' ' + esc(it.unidad) : '') + ' ' : '') +
      (e.estado === 'nok' ? '<b class="txt-nok">fuera de rango</b>' : e.estado === 'repro' ? '<b class="txt-warn">reprocesado</b>' :
        e.estado === 'ok' && Reglas.rango(it, cab) ? '<b class="txt-ok">✓</b>' : '') +
      ((e.estado === 'nok' || e.estado === 'repro') && it.reproceso ? ' ' + botonRepro(sec, i, it.id, u.r[it.id]) : '');
  }

  function htmlItem(sec, i, it, u, cab) {
    var v = u.v[it.id];
    var datos = 'data-sec="' + sec + '" data-i="' + i + '" data-item="' + esc(it.id) + '"';
    if (it.tipo === 'okNok') {
      return '<div class="it it-ok"><span class="g-tit">' + esc(it.nombre) + '</span>' + botonesCheck(sec, i, it.id, v, it.reproceso, u.r[it.id]) + '</div>';
    }
    if (it.tipo === 'medicion') {
      var ls = Reglas.lecturas(it, v);
      var rango = textoRango(it, cab);
      return '<div class="it it-med"><span class="g-tit">' + esc(it.nombre) + (it.unidad ? ' (' + esc(it.unidad) + ')' : '') +
        (rango ? ' · <span class="rango">' + esc(rango) + '</span>' : '') + '</span>' +
        '<div class="lecturas">' + ls.map(function (x, j) {
          return '<input ' + datos + ' data-l="' + j + '" inputmode="decimal" value="' + esc(x) + '" aria-label="' + esc(it.nombre) + ' ' + (j + 1) + '"' +
            (ls.length > 1 ? ' placeholder="' + (j + 1) + '"' : '') + '>';
        }).join('') + '</div>' +
        '<span class="der" id="der-' + sec + '-' + i + '-' + esc(it.id) + '">' + derivadoMedicion(sec, i, it, u, cab) + '</span></div>';
    }
    return '<label class="it">' + esc(it.nombre) + '<input ' + datos + (it.tipo === 'fecha' ? ' type="date"' : '') + ' value="' + esc(v || '') + '"></label>';
  }

  function estadoUnidad(sec, d, u) {
    return sec === 'linea' ? Reglas.estadoUnidadLinea(d.plantilla.linea, u, d.cab) : Reglas.estadoUnidadFinal(d.plantilla.final, u, d.cab);
  }

  function cardUnidad(sec, d, u, i) {
    var p = d.plantilla, items = p[sec];
    var cabeza = sec === 'linea'
      ? '<b>' + esc(p.unidad) + '</b>' +
        '<input class="corto" data-sec="linea" data-i="' + i + '" data-campo="n" value="' + esc(u.n) + '" aria-label="Número de ' + esc(nombreUnidad(p, 1)) + '">' +
        '<input class="corto" type="time" data-sec="linea" data-i="' + i + '" data-campo="hora" value="' + esc(u.hora) + '" aria-label="Hora">' +
        '<button type="button" class="btn chico" data-act="hora" data-i="' + i + '">Ahora</button>'
      : '<b>' + esc(p.unidad) + ' ' + (i + 1) + '</b>' +
        (items.some(function (it) { return it.tipo === 'okNok'; }) ? '<button type="button" class="btn chico" data-act="todo-ok" data-i="' + i + '">✓ Todo OK</button>' : '');
    return '<div class="pcard e-' + estadoUnidad(sec, d, u) + '" id="' + (sec === 'linea' ? 'cl-' : 'cf-') + i + '">' +
      '<div class="pcard-cab">' + cabeza +
      '<button type="button" class="btn chico peligro" data-act="quitar-unidad" data-sec="' + sec + '" data-i="' + i + '" aria-label="Quitar">✕</button></div>' +
      '<div class="items">' + items.map(function (it) { return htmlItem(sec, i, it, u, d.cab); }).join('') + '</div>' +
      '<div class="fila2">' +
      (sec === 'final' && p.cantidad ? campoUnidad(sec, i, 'cant', u.cant, 'Cantidad en ' + esc(p.cantidad) + ' (si difiere)', 'inputmode="decimal"') : '') +
      campoUnidad(sec, i, 'obs', u.obs, 'Observación') + '</div></div>';
  }

  function seccionUnidades(sec, d) {
    var p = d.plantilla;
    var lista = sec === 'linea' ? d.linea : d.final.unidades;
    if (!p[sec].length) return '';
    var titulo = sec === 'linea' ? 'Control en línea' : 'Control final';
    return '<section class="tarjeta"><h3>' + titulo + ' <small>' + lista.length + ' ' + esc(nombreUnidad(p, lista.length)) + '</small></h3>' +
      (sec === 'final' && p.cantidad ? '<label>Cantidad por ' + esc(nombreUnidad(p, 1)) + ' (' + esc(p.cantidad) + ')' +
        '<input class="corto" inputmode="decimal" data-sec="cf" data-i="0" data-campo="cantPorUnidad" value="' + esc(d.final.cantPorUnidad) + '"></label>' : '') +
      lista.map(function (u, i) { return cardUnidad(sec, d, u, i); }).join('') +
      '<button type="button" class="btn" data-act="agregar-unidad" data-sec="' + sec + '">+ ' + esc(p.unidad) + '</button></section>';
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

  function formatoCantidad(c, n, p) {
    return c !== null ? (Math.round(c * 100) / 100) + ' ' + p.cantidad : n + ' ' + nombreUnidad(p, n);
  }

  function seccionDictamen(l) {
    var d = l.datos, f = d.final, p = d.plantilla;
    var r = Reglas.resumenFinal(d);
    var sug = Reglas.sugerirDictamen(d);
    var falt = Reglas.unidadesFaltantes(d);
    var resumen = '<div class="resumen"><div class="r-ok"><b>' + esc(formatoCantidad(r.cantAprobada, r.aprobados, p)) + '</b><span>Aprobado</span></div>' +
      '<div class="r-nok"><b>' + esc(formatoCantidad(r.cantRetenida, r.retenidos, p)) + '</b><span>Retenido</span></div>' +
      '<div class="r-pend"><b>' + r.pendientes + '</b><span>Sin controlar</span></div></div>';
    var desv = Reglas.desvios(d);
    var desvios = desv.length
      ? '<details><summary>Desvíos detectados (' + desv.length + ')</summary><ul class="desvios">' + desv.map(function (x) {
          return '<li>' + esc(x.etapa) + ' · ' + esc(nombreUnidad(p, 1)) + ' ' + esc(x.unidad) + ' · ' + esc(x.control) + ' ' + esc(x.detalle) +
            (x.corregido ? ' · <i>reprocesado</i>' : ' · <b class="txt-nok">abierto</b>') + (x.obs ? ' · ' + esc(x.obs) : '') + '</li>';
        }).join('') + '</ul><button type="button" class="btn chico" data-act="copiar-desvios">Copiar para el registro de NC</button></details>'
      : '';
    var acciones;
    if (d.estado === 'activo') {
      var bloqueado = falt.length && !esSuperior();
      acciones = (falt.length ? '<p class="' + (bloqueado ? 'error' : 'ayuda') + '">Faltan completar ' + falt.length + ' ' +
          esc(nombreUnidad(p, falt.length)) + ' del control final' +
          (bloqueado ? '. Completalos o pedile a coordinación que dictamine.' : '. Coordinación puede dictaminar igual.') + '</p>' : '') +
        '<div class="dictamenes">' + DICTAMENES.map(function (x) {
          return '<button class="btn dict ' + x.cls + (sug === x.v ? ' sugerido' : '') + '" data-act="dictaminar" data-v="' + x.v + '"' +
            (bloqueado ? ' disabled' : '') + '>' + x.txt + (sug === x.v ? '<small>sugerido</small>' : '') + '</button>';
        }).join('') + '</div>';
    } else {
      acciones = '<p class="dict-final ' + esc(d.estado) + '">' + esc(ESTADOS[d.estado]) + '</p>' +
        '<p class="ayuda">Dictaminó ' + esc(f.dictaminadoPor || '—') + (f.dictaminadoRol ? ' (' + esc(f.dictaminadoRol) + ')' : '') +
        ' · ' + esc(f.fechaDictamen || '') + '</p>' +
        (d.cierreForzado ? '<p class="ayuda">⚠ Con ' + esc(d.cierreForzado.faltantes) + ' ' + esc(nombreUnidad(p, d.cierreForzado.faltantes)) +
          ' sin completar, autorizado por ' + esc(d.cierreForzado.por) + '</p>' : '') +
        (esSuperior() ? '<button class="btn" data-act="reabrir">Reabrir lote</button>' : '');
    }
    return '<section class="tarjeta"><h3>Dictamen</h3>' + resumen + desvios + seccionNcDelLote(l) + acciones +
      '<div class="acciones"><button class="btn" data-act="imprimir">Imprimir / PDF</button>' +
      (esSuperior() ? '<button class="btn peligro" data-act="borrar-lote">Borrar lote</button>' : '') + '</div></section>';
  }

  // ── Conflictos ──
  pantallas.conflictos = function () {
    var cs = Store.conflictos();
    return '<section class="tarjeta"><h2>Conflictos</h2>' +
      '<p class="ayuda">Otro equipo modificó estos lotes o NC mientras esta tablet tenía cambios sin subir. ' +
      'La tablet se quedó con la versión del servidor; acá está la tuya para que decidas.</p>' +
      (cs.length ? cs.map(function (c, i) {
        var esNc = c.tipo === 'nc';
        var titulo = esNc ? (c.numero || 'NC') + ' · ' + (c.datos.tipo || c.datos.desc) : c.datos.cab.lote + ' · ' + c.datos.cab.prod;
        return '<div class="pcard"><b>' + esc(titulo) + '</b>' +
          '<p class="meta">Tu versión del ' + esc(new Date(c.cuando).toLocaleString('es-AR')) + ' · estado ' +
          esc(esNc ? Reglas.NC_ESTADOS[c.datos.estado] : ESTADOS[c.datos.estado]) + '</p>' +
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
      '<div class="acciones"><button class="btn" data-act="bienvenida">Ver la guía de bienvenida</button>' +
      '<button class="btn" data-act="respaldo">Descargar respaldo (.json)</button>' +
      '<button class="btn" data-act="cambiar-empresa">Cambiar de empresa</button></div></section>';
    if (!esAdmin()) return html + '<button class="btn" data-act="inicio">Volver</button>';
    html += '<section class="tarjeta"><h2>Empresa</h2><form data-form="config">' +
      '<label>Nombre<input name="nombre" required value="' + esc(p.empresa) + '"></label>' +
      '<p class="ayuda">La codificación del registro (código, versión, vigencia, quién elaboró y aprobó) va en cada plantilla de control.</p>' +
      '<label>Líneas (separadas por coma)<input name="lineas" value="' + esc((cfg.lineas || []).join(', ')) + '"></label>' +
      '<button class="btn primario" type="submit">Guardar configuración</button></form></section>' +
      seccionPlantillas() + seccionConfigNc() +
      '<section class="tarjeta" id="miembros"><h2>Personas</h2><p class="ayuda">Cargando…</p></section>' +
      '<button class="btn" data-act="inicio">Volver</button>';
    setTimeout(cargarMiembros, 0);
    return html;
  };

  // Lista de plantillas en ⚙ y el botón para crear una a partir de un ejemplo por rubro.
  function seccionPlantillas() {
    var ps = plantillasEmpresa();
    var ejemplos = Object.keys(Reglas.EJEMPLOS).map(function (k) { return { v: k, t: Reglas.EJEMPLOS[k].rubro }; });
    return '<section class="tarjeta" id="plantillas"><h2>Plantillas de control</h2>' +
      '<p class="ayuda">Qué se controla en cada lote: mediciones con tolerancia, OK/NOK, datos y fechas. ' +
      'Armá una por tipo de producto o de línea; al crear un lote se elige cuál usar.</p>' +
      ps.map(function (p, i) {
        var n = p.linea.length + p.final.length, doc = Reglas.docDe(p, config());
        return '<div class="fila-plantilla"><span><b>' + esc(p.nombre) + '</b><small>' +
          (doc.codigo ? esc(doc.codigo) + ' · versión ' + esc(doc.version) + ' · ' : '') + n + ' ítem' + (n === 1 ? '' : 's') +
          ' · por ' + esc(nombreUnidad(p, 1)) + '</small></span>' +
          '<button class="btn chico" data-act="editar-plantilla" data-i="' + i + '">Editar</button>' +
          '<button class="btn chico" data-act="duplicar-plantilla" data-i="' + i + '">Duplicar</button>' +
          (ps.length > 1 ? '<button class="btn chico peligro" data-act="borrar-plantilla" data-i="' + i + '">Borrar</button>' : '') + '</div>';
      }).join('') +
      '<h3>Nueva plantilla</h3><div class="fila2"><label>Empezar desde el ejemplo<select id="ejemplo-plantilla">' +
      opciones(ejemplos, 'blanco') + '</select></label>' +
      '<button class="btn" data-act="nueva-plantilla">+ Nueva plantilla</button></div></section>';
  }

  pantallas.plantilla = function () { return Editor.html(ui.edit, ui.editIdx < 0, Reglas.docDe(ui.edit, config())); };

  // Guarda la lista de plantillas en la configuración de la empresa.
  async function guardarPlantillas(lista) {
    var cfg = Object.assign({}, config(), { plantillas: lista });
    delete cfg.inductoras; // del formato anterior: ya quedaron convertidas en plantilla
    await Nube.guardarEmpresa(perfil().empresaId, perfil().empresa, cfg);
    Store.setPerfil(Object.assign({}, perfil(), { config: cfg }));
  }

  // Antes de cualquier cambio en el editor se lee lo tipeado, para no perderlo al redibujar.
  function leerEditor() {
    var f = document.querySelector('[data-form="plantilla"]');
    if (f) ui.edit = Editor.leer(f, ui.edit);
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
    document.getElementById('franja-demo').hidden = !(p && p.demo) || ui.pantalla === 'login';
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

  function unidadDe(d, sec, i) { return sec === 'linea' ? d.linea[i] : d.final.unidades[i]; }
  function itemDe(d, sec, id) { return d.plantilla[sec].filter(function (it) { return it.id === id; })[0]; }

  // Al tipear no se redibuja la pantalla (se perdería el foco): solo se
  // actualizan los indicadores de esa tarjeta.
  function alEscribir(input) {
    var sec = input.dataset.sec, i = Number(input.dataset.i), campo = input.dataset.campo, id = input.dataset.item, v = input.value;
    cambiarLote(function (d) {
      if (sec === 'cf') { d.final[campo] = v; return; }
      var u = unidadDe(d, sec, i);
      if (campo) { u[campo] = v; return; }
      var it = itemDe(d, sec, id);
      if (it.tipo === 'medicion') {
        var ls = Reglas.lecturas(it, u.v[id]);
        ls[Number(input.dataset.l)] = v;
        u.v[id] = ls;
      } else u.v[id] = v;
    }, false);
    if (sec === 'cf' || campo) return;
    var d = Store.lote(ui.loteId).datos, u = unidadDe(d, sec, i), it = itemDe(d, sec, id);
    document.getElementById((sec === 'linea' ? 'cl-' : 'cf-') + i).className = 'pcard e-' + estadoUnidad(sec, d, u);
    var der = document.getElementById('der-' + sec + '-' + i + '-' + id);
    if (der && it.tipo === 'medicion') der.innerHTML = derivadoMedicion(sec, i, it, u, d.cab);
  }

  async function dictaminar(tipo) {
    var l = Store.lote(ui.loteId);
    var falt = Reglas.unidadesFaltantes(l.datos);
    var txt = DICTAMENES.filter(function (x) { return x.v === tipo; })[0].txt;
    if (falt.length && !esSuperior()) return;
    var msg = falt.length
      ? 'Faltan completar ' + falt.length + ' ' + nombreUnidad(l.datos.plantilla, falt.length) + ' del control final.\n¿Dictaminar "' + txt + '" igual? Queda registrado que lo autorizaste.'
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

  // Trae las NC del respaldo de la app individual (calidad-no-conformidades). No repite las que
  // ya se importaron (cada una recuerda de qué fila vino) y saltea las que no tienen lo mínimo.
  async function importarNcIndividual(input) {
    var archivo = input.files[0];
    input.value = '';
    if (!archivo) return;
    var filas;
    try {
      var j = JSON.parse(await archivo.text());
      filas = Array.isArray(j) ? j : j && j.filas;
      if (!Array.isArray(filas)) throw new Error();
    } catch (e) { return aviso('Ese archivo no es un respaldo del registro de NC.'); }
    var ya = Store.ncs().map(function (n) { return n.datos.importadoDe; }).filter(Boolean);
    var nuevas = [], salteadas = 0;
    filas.forEach(function (f) {
      var d = Reglas.desdeRegistroIndividual(f || {});
      if (d.importadoDe && ya.indexOf(d.importadoDe) >= 0) return;
      if (Reglas.validarNc(d)) { salteadas++; return; }
      nuevas.push(d);
    });
    if (!nuevas.length) return aviso('No hay NC nuevas para importar' + (salteadas ? ' (' + salteadas + ' sin fecha o sin datos)' : '') + '.');
    if (!confirm('Se van a importar ' + nuevas.length + ' NC' + (salteadas ? ' (' + salteadas + ' se saltean por no tener fecha o datos)' : '') +
        '.\nEl servidor les pone número a cada una al subirlas. ¿Seguir?')) return;
    nuevas.forEach(function (d) { d.creadaPor = quienSoy() + ' · importada'; Store.crearNc(d); });
    programarSync(0);
    aviso(nuevas.length + ' NC importadas');
    ir('inicio', { tab: 'nc', ncFiltro: 'abiertas' });
  }

  var acciones = {
    inicio: function () { ir('inicio'); },
    tab: function (b) { ir('inicio', { tab: b.dataset.tab, resultados: null }); },
    nuevo: function () { ir('nuevo', { loteId: null, borrador: null }); },
    abrir: function (b) {
      if (!b.dataset.id) return ir('inicio');
      if (b.dataset.remoto && !Store.lote(b.dataset.id)) {
        var f = (ui.resultados || []).filter(function (x) { return x.id === b.dataset.id; })[0];
        if (f) { Store.aplicarRemoto(f); Store.guardar(); migrarLotesViejos(); }
      }
      ir('lote', { loteId: b.dataset.id });
    },
    'editar-cab': function () { ir('nuevo', { loteId: ui.loteId }); },
    config: function () { ir('config', { tiposNcEdit: null }); },
    'nueva-nc': function () {
      ir('nc', { ncId: null, ncNueva: Reglas.nuevaNc({ creadaPor: quienSoy() }, plazoNc()) });
    },
    'abrir-nc': function (b) { ir('nc', { ncId: b.dataset.id }); },
    'volver-nc': function () { ir('inicio', { tab: 'nc' }); },
    'cerrar-nc': function () {
      if (!confirm('¿Cerrar la NC? Queda registrado que la cerraste vos, con fecha de hoy.')) return;
      if (guardarNc(document.querySelector('[data-form="nc"]'), { estado: 'cerrada', cierre: Reglas.hoy(), cerradaPor: quienSoy() })) {
        aviso('NC cerrada. Cuando puedas, verificá la eficacia.');
        dibujar();
      }
    },
    'reabrir-nc': function () {
      if (!confirm('¿Reabrir la NC? Se borra el cierre y la verificación de eficacia.')) return;
      if (guardarNc(document.querySelector('[data-form="nc"]'), { estado: 'abierta', cierre: '', cerradaPor: '', eficacia: 'pendiente' })) dibujar();
    },
    'anular-nc': function () {
      if (!confirm('¿Anular la NC? Queda en el registro como anulada (por ejemplo, si se cargó por error) y no cuenta en los indicadores.')) return;
      if (guardarNc(document.querySelector('[data-form="nc"]'), { estado: 'anulada' })) { aviso('NC anulada'); ir('inicio', { tab: 'nc' }); }
    },
    'crear-nc-lote': function () {
      var l = Store.lote(ui.loteId);
      var hechas = Store.ncs().filter(function (n) { return n.datos.loteId === l.id; }).map(function (n) { return n.datos.origen; });
      var nuevas = Reglas.ncsDesdeLote(l.datos, l.id, tiposNc(), plazoNc(), hechas);
      if (!nuevas.length) return;
      if (!confirm('Se van a crear ' + nuevas.length + ' NC: una por cada control con desvío (las corregidas en el momento entran cerradas).\n¿Seguir?')) return;
      nuevas.forEach(function (d) { d.creadaPor = quienSoy(); Store.crearNc(d); });
      programarSync(0);
      aviso(nuevas.length + ' NC creadas: completá la acción en la pestaña NC');
      dibujar();
    },
    'imprimir-nc': function () {
      var filtro = ui.ncFiltro || mesActual();
      var lista = ordenarNc(Store.ncs().filter(function (n) {
        return filtro === 'abiertas' ? Reglas.ncAbierta(n.datos) : Reglas.mesDeNc(n.datos) === filtro;
      }));
      Imprimir.registroNc(lista, filtro === 'abiertas' ? 'NC abiertas al ' + Reglas.fechaLarga(Reglas.hoy()) : Reglas.nombreMes(filtro), config(), perfil().empresa);
    },
    'tipo-nc-agregar': function () {
      ui.tiposNcEdit = leerTiposNcForm().concat([{ nombre: '', sev: '' }]);
      dibujar();
      var ins = document.querySelectorAll('[name="tipo-nombre"]');
      ins[ins.length - 1].focus();
    },
    'tipo-nc-quitar': function (b) {
      ui.tiposNcEdit = leerTiposNcForm();
      ui.tiposNcEdit.splice(Number(b.dataset.i), 1);
      dibujar();
    },
    bienvenida: function () { ir('bienvenida'); },
    conflictos: function () { ir('conflictos'); },
    conflicto: function (b) {
      Store.resolverConflicto(Number(b.dataset.i), b.dataset.v);
      programarSync(0);
      if (Store.conflictos().length) dibujar(); else ir('inicio');
    },
    'limpiar-busqueda': function () { ir('inicio', { resultados: null, busqueda: '' }); },

    check: function (b) {
      var sec = b.dataset.sec, i = Number(b.dataset.i), id = b.dataset.item, v = b.dataset.v === 'true';
      cambiarLote(function (d) {
        var u = unidadDe(d, sec, i);
        u.v[id] = u.v[id] === v ? null : v; // tocar el mismo otra vez lo deja sin marcar
        if (u.v[id] !== false) u.r[id] = false;
      });
    },
    repro: function (b) {
      var sec = b.dataset.sec, i = Number(b.dataset.i), id = b.dataset.item;
      cambiarLote(function (d) { var u = unidadDe(d, sec, i); u.r[id] = !u.r[id]; });
    },
    'todo-ok': function (b) {
      var i = Number(b.dataset.i);
      cambiarLote(function (d) {
        var u = d.final.unidades[i];
        d.plantilla.final.forEach(function (it) { if (it.tipo === 'okNok') { u.v[it.id] = true; u.r[it.id] = false; } });
      });
    },
    hora: function (b) {
      var i = Number(b.dataset.i), t = new Date();
      cambiarLote(function (d) { d.linea[i].hora = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); });
    },
    'agregar-unidad': function (b) {
      var sec = b.dataset.sec;
      cambiarLote(function (d) {
        var lista = sec === 'linea' ? d.linea : d.final.unidades;
        var nueva = Reglas.nuevaUnidad(lista.length + 1);
        // Los datos escritos (lote, código, fechas) suelen repetirse: se copian de la anterior.
        var ult = lista[lista.length - 1];
        if (ult && sec === 'linea') d.plantilla.linea.forEach(function (it) {
          if ((it.tipo === 'texto' || it.tipo === 'fecha') && ult.v[it.id]) nueva.v[it.id] = ult.v[it.id];
        });
        lista.push(nueva);
      });
    },
    'quitar-unidad': function (b) {
      var sec = b.dataset.sec, p = Store.lote(ui.loteId).datos.plantilla;
      if (!confirm('¿Quitar este ' + nombreUnidad(p, 1) + ' del control ' + (sec === 'linea' ? 'en línea' : 'final') + '?')) return;
      cambiarLote(function (d) { (sec === 'linea' ? d.linea : d.final.unidades).splice(Number(b.dataset.i), 1); });
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
        return [Reglas.fechaLarga(c.fecha), c.lote, c.cliente, c.prod, x.etapa, l.datos.plantilla.unidad + ' ' + x.unidad,
          x.control + ' ' + x.detalle, x.corregido ? 'Reprocesado' : 'Abierto', x.obs].join('\t');
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
    demo: async function (b) {
      esperando(b, 'Preparando la demo…');
      Store.reiniciarDemo(Demo.EMPRESA, 'visitante');
      try { await elegirEmpresa(await Nube.entrarDemo(), ''); }
      catch (e) { ir('login', { mensaje: e.message }); }
    },
    salir: async function () {
      if (perfil() && !perfil().demo && Store.pendientes().length &&
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
    'nueva-plantilla': function () {
      ir('plantilla', { edit: Reglas.plantillaEjemplo(document.getElementById('ejemplo-plantilla').value), editIdx: -1 });
    },
    'editar-plantilla': function (b) {
      ir('plantilla', { edit: Reglas.copia(plantillasEmpresa()[Number(b.dataset.i)]), editIdx: Number(b.dataset.i) });
    },
    'duplicar-plantilla': function (b) {
      var p = Reglas.copia(plantillasEmpresa()[Number(b.dataset.i)]);
      p.id = 'p' + Date.now().toString(36);
      p.nombre += ' (copia)';
      // Una copia es otro registro: necesita su propio código y arranca su propia historia.
      p.doc = Object.assign(Reglas.docDe(p, config()), { codigo: '', version: '00', vigencia: Reglas.hoy(), historial: [] });
      ir('plantilla', { edit: p, editIdx: -1 });
    },
    'borrar-plantilla': async function (b) {
      var ps = plantillasEmpresa().slice(), i = Number(b.dataset.i);
      if (!confirm('¿Borrar la plantilla "' + ps[i].nombre + '"? Los lotes ya creados con ella no cambian.')) return;
      ps.splice(i, 1);
      try { await guardarPlantillas(ps); aviso('Plantilla borrada'); dibujar(); }
      catch (e) { aviso(e.message); }
    },
    'item-agregar': function (b) {
      leerEditor();
      ui.edit[b.dataset.sec].push({ id: Reglas.nuevoId(), nombre: '', tipo: 'okNok', reproceso: true, obligatorio: true });
      dibujar();
      var items = document.querySelectorAll('.ed-item[data-sec="' + b.dataset.sec + '"]');
      items[items.length - 1].querySelector('[name="nombre"]').focus();
    },
    'item-quitar': function (b) {
      leerEditor();
      ui.edit[b.dataset.sec].splice(Number(b.dataset.i), 1);
      dibujar();
    },
    'item-mover': function (b) {
      leerEditor();
      var lista = ui.edit[b.dataset.sec], i = Number(b.dataset.i), j = i + Number(b.dataset.d);
      var x = lista[i]; lista[i] = lista[j]; lista[j] = x;
      dibujar();
    },
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
    bienvenida: async function (f) {
      var p = perfil();
      var nombre = f.nombre.value.trim();
      if (nombre !== p.nombre) {
        // Sin señal se guarda igual en la tablet; el servidor se actualiza la próxima vez que se guarde el nombre.
        try { await Nube.cambiarMiNombre(p.empresaId, nombre); }
        catch (e) { aviso('Tu nombre quedó guardado en este equipo. Para que lo vea el resto, guardalo de nuevo en ⚙ con señal.'); }
        Store.setPerfil(Object.assign({}, perfil(), { nombre: nombre }));
      }
      Store.marcarGuiaVista(p.userId);
      ir('inicio');
    },
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
      var l = ui.loteId ? Store.lote(ui.loteId) : null;
      var ps = plantillasEmpresa();
      var plantilla = l ? l.datos.plantilla : (ps.filter(function (x) { return f.plantilla && x.id === f.plantilla.value; })[0] || ps[0]);
      var rangos = {};
      [].forEach.call(f.querySelectorAll('[name^="min-"]'), function (inp) {
        var id = inp.name.slice(4);
        rangos[id] = { min: inp.value.trim(), max: f.querySelector('[name="max-' + id + '"]').value.trim() };
      });
      var cab = {
        prod: f.prod.value.trim(), lote: f.lote.value.trim(), cliente: Reglas.normalizarCliente(f.cliente.value),
        linea: f.linea.value.trim(), fecha: f.fecha.value, checker: f.checker.value.trim(), rangos: rangos
      };
      ui.borrador = null;
      if (l) {
        cambiarLote(function (d) { d.cab = cab; }, false);
      } else {
        var n = Math.max(0, Math.min(200, parseInt(f.cantFinal.value, 10) || 0));
        ui.loteId = Store.crear(Reglas.nuevoLote(cab, plantilla, n));
        programarSync();
      }
      ir('lote', { loteId: ui.loteId });
    },
    plantilla: async function (f) {
      ui.edit = Editor.leer(f, ui.edit);
      var problema = Reglas.validarPlantilla(ui.edit);
      if (problema) return aviso(problema);
      var ps = plantillasEmpresa().slice();
      var p = Reglas.copia(ui.edit), doc = p.doc, motivo = p.cambio;
      delete p.cambio;
      var repetido = ps.filter(function (x, i) { return i !== ui.editIdx && Reglas.docDe(x, config()).codigo === doc.codigo; })[0];
      if (repetido) return aviso('El código ' + doc.codigo + ' ya lo usa la plantilla "' + repetido.nombre + '".');
      // Control de cambios (ISO 9001, 7.5.3): si cambió qué se controla, corresponde una versión
      // nueva. Se ofrece; se puede rechazar para correcciones menores (un texto mal escrito).
      var anterior = ui.editIdx >= 0 ? ps[ui.editIdx] : null;
      var versionAnterior = anterior ? Reglas.docDe(anterior, config()).version : null;
      if (anterior && doc.version === versionAnterior && Reglas.cambioContenido(anterior, p)) {
        var nueva = Reglas.siguienteVersion(doc.version);
        if (confirm('Cambiaste qué se controla, pero la versión sigue siendo ' + doc.version + '.\n' +
            '¿Guardar como versión ' + nueva + '? La norma pide identificar cada cambio del registro.\n' +
            '(Cancelar = guardar sin cambiar la versión, por ejemplo si solo corregiste un texto.)')) {
          doc.version = nueva;
          doc.vigencia = Reglas.hoy();
        }
      }
      if (!anterior || doc.version !== versionAnterior) {
        doc.historial = doc.historial.concat([{ version: doc.version, fecha: Reglas.hoy(), por: perfil().nombre || perfil().email,
          cambio: motivo || (anterior ? '' : 'Creación del registro') }]);
      }
      ui.edit = p;
      if (ui.editIdx < 0) ps.push(p); else ps[ui.editIdx] = p;
      try { await guardarPlantillas(ps); aviso('Plantilla guardada'); ir('config'); }
      catch (e) { aviso(e.message); }
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
      var cfg = Object.assign({}, config(), {
        lineas: f.lineas.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        plantillas: plantillasEmpresa()
      });
      delete cfg.inductoras;
      try {
        await Nube.guardarEmpresa(perfil().empresaId, f.nombre.value.trim(), cfg);
        Store.setPerfil(Object.assign({}, perfil(), { empresa: f.nombre.value.trim(), config: cfg }));
        aviso('Configuración guardada');
        dibujar();
      } catch (e) { aviso(e.message); }
    },
    nc: function (f) {
      var nueva = !ui.ncId;
      if (!guardarNc(f)) return;
      aviso(nueva ? 'NC creada' : 'NC guardada');
      ir('inicio', { tab: 'nc', ncFiltro: ui.ncFiltro === 'abiertas' ? 'abiertas' : Reglas.mesDeNc(Store.nc(ui.ncId).datos) });
    },
    'config-nc': async function (f) {
      var cfg = Object.assign({}, config(), {
        ncCodigo: f.ncCodigo.value.trim(), ncVersion: f.ncVersion.value.trim(),
        ncPlazoDias: Math.max(1, Math.min(90, parseInt(f.ncPlazoDias.value, 10) || 5)),
        tiposNc: Reglas.normalizarTiposNc(leerTiposNcForm())
      });
      delete cfg.inductoras;
      try {
        await Nube.guardarEmpresa(perfil().empresaId, perfil().empresa, cfg);
        Store.setPerfil(Object.assign({}, perfil(), { config: cfg }));
        ui.tiposNcEdit = null;
        aviso('No conformidades: configuración guardada');
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
    if (s.dataset && s.dataset.actChange === 'nc-filtro') { ir('inicio', { tab: 'nc', ncFiltro: s.value }); return; }
    if (s.dataset && s.dataset.actChange === 'nc-tipo') {
      // El tipo sugiere la gravedad (se puede cambiar después).
      var sev = Reglas.sevSugerida(tiposNc(), s.value);
      if (sev) s.form.sev.value = sev;
      return;
    }
    if (s.dataset && s.dataset.actChange === 'importar-nc') { importarNcIndividual(s); return; }
    if (s.dataset && s.dataset.actChange === 'editor') { leerEditor(); dibujar(); return; }
    if (s.dataset && s.dataset.actChange === 'plantilla-lote') {
      // Se guarda lo ya escrito y se redibuja con los rangos de la plantilla elegida.
      var f = s.form;
      ui.borrador = { plantillaId: s.value, prod: f.prod.value, lote: f.lote.value, cliente: f.cliente.value,
        linea: f.linea.value, fecha: f.fecha.value, checker: f.checker.value, rangos: {} };
      dibujar();
      return;
    }
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
