/* Demo: un "servidor" de mentira que vive en el navegador.
 *
 * Imita lo justo de Supabase que usa js/nube.js (sesión, tablas, funciones), pero
 * guarda todo en localStorage. Sirve para dos cosas:
 *   1. El modo demo ("Probar sin cuenta"): cualquiera puede recorrer la app con datos
 *      de ejemplo sin crear cuenta y SIN tocar la base real.
 *   2. Las pruebas automáticas de la interfaz (tests/e2e/), que lo usan como servidor.
 * Las reglas de seguridad de verdad están en la base (supabase/migrations/): acá no se
 * controlan permisos.
 */
var Demo = (function () {
  'use strict';

  var CLAVE_DEMO = 'qualityos.demo';
  var EMAIL = 'visitante@demo.qualityos';
  var CLAVE = 'demo-qualityos';
  var EMPRESA = 'demo';

  function sinRed() { return navigator.onLine === false; }
  function ok(data) { return Promise.resolve({ data: JSON.parse(JSON.stringify(data === undefined ? null : data)), error: null }); }
  function err(msg) { return Promise.resolve({ data: null, error: { message: msg } }); }

  // Crea un cliente con la misma forma que el de supabase-js.
  // "clave" es dónde se guardan sus datos en localStorage. Cada operación lee y guarda
  // de nuevo, así lo que cambie otra pestaña (o una prueba) se ve enseguida.
  function cliente(clave) {
    var claveSesion = clave + '.sesion';
    function leer() { return JSON.parse(localStorage.getItem(clave) || 'null') || vacio(); }
    function guardar(db) { localStorage.setItem(clave, JSON.stringify(db)); }
    function sesion() { return JSON.parse(localStorage.getItem(claveSesion) || 'null'); }
    function setSesion(s) {
      if (s) localStorage.setItem(claveSesion, JSON.stringify(s)); else localStorage.removeItem(claveSesion);
    }
    function entrar(u) {
      var s = { user: { id: u.id, email: u.email } };
      setSesion(s);
      return s;
    }

    function consulta(tabla) {
      var filtros = [], orden = null, limite = null, op = 'select', valores = null;
      var q = {
        select: function () { return q; },
        eq: function (k, v) { filtros.push(function (f) { return f[k] === v; }); return q; },
        gt: function (k, v) { filtros.push(function (f) { return f[k] > v; }); return q; },
        // Solo el caso que usa la app: "col.ilike.%texto%,col2.ilike.%texto%".
        or: function (expr) {
          var partes = String(expr).split(',').map(function (p) { return p.split('.ilike.'); });
          filtros.push(function (f) {
            return partes.some(function (p) {
              var t = (p[1] || '').replace(/%/g, '').toLowerCase();
              var v = f[p[0]] !== undefined ? f[p[0]] : (f.datos && f.datos.cab && f.datos.cab[{ numero: 'lote', producto: 'prod' }[p[0]] || p[0]]);
              return String(v || '').toLowerCase().indexOf(t) >= 0;
            });
          });
          return q;
        },
        order: function (k, o) { orden = { k: k, asc: !o || o.ascending !== false }; return q; },
        limit: function (n) { limite = n; return q; },
        update: function (v) { op = 'update'; valores = v; return q; },
        upsert: function (v) { op = 'upsert'; valores = v; return q; },
        delete: function () { op = 'delete'; return q; },
        then: function (res, rej) { return ejecutar().then(res, rej); }
      };
      function ejecutar() {
        if (sinRed()) return err('Failed to fetch');
        var db = leer();
        // Una base guardada antes de que existieran las NC no tiene esa tabla.
        if (!db[tabla]) db[tabla] = [];
        var filas = db[tabla].filter(function (f) { return filtros.every(function (fn) { return fn(f); }); });
        if (op === 'update') { filas.forEach(function (f) { Object.assign(f, valores); }); guardar(db); return ok(null); }
        if (op === 'delete') { db[tabla] = db[tabla].filter(function (f) { return filas.indexOf(f) < 0; }); guardar(db); return ok(null); }
        if (op === 'upsert') { db[tabla].push(valores); guardar(db); return ok(null); }
        if (tabla === 'miembros') filas = filas.map(function (m) {
          var e = db.empresas.filter(function (x) { return x.id === m.empresa_id; })[0];
          return Object.assign({}, m, { empresas: { nombre: e.nombre, config: e.config } });
        });
        if (orden) filas.sort(function (a, b) { return (a[orden.k] > b[orden.k] ? 1 : -1) * (orden.asc ? 1 : -1); });
        if (limite) filas = filas.slice(0, limite);
        return ok(filas);
      }
      return q;
    }

    // Las mismas funciones que la base real (supabase/migrations/), sin controles de permisos.
    var rpcs = {
      aceptar_invitaciones: function (db, s, a) {
        var mias = db.invitaciones.filter(function (i) { return i.email === s.user.email; });
        mias.forEach(function (i) {
          db.miembros.push({ empresa_id: i.empresa_id, user_id: s.user.id, nombre: (a.p_mi_nombre || '').trim(), rol: i.rol, activo: true });
        });
        db.invitaciones = db.invitaciones.filter(function (i) { return i.email !== s.user.email; });
        return mias.length;
      },
      puedo_crear_empresas: function (db, s) { return db.plataforma.indexOf(s.user.id) >= 0; },
      crear_empresa: function (db, s, a) {
        if (db.plataforma.indexOf(s.user.id) < 0) throw new Error('Solo el administrador de QualityOS puede crear empresas. Pedí que te inviten.');
        var id = 'e-' + (db.empresas.length + 1);
        db.empresas.push({ id: id, nombre: a.p_nombre, config: {} });
        db.miembros.push({ empresa_id: id, user_id: s.user.id, nombre: a.p_mi_nombre, rol: 'admin', activo: true });
        return id;
      },
      cambiar_mi_nombre: function (db, s, a) {
        db.miembros.forEach(function (m) {
          if (m.empresa_id === a.p_empresa && m.user_id === s.user.id) m.nombre = a.p_nombre.trim();
        });
        return null;
      },
      guardar_lote: function (db, s, a) {
        var actual = db.lotes.filter(function (l) { return l.id === a.p_id; })[0];
        var ahora = new Date(Date.now() + db.lotes.length).toISOString();
        if (actual) {
          if (actual.version !== a.p_version_base) return { ok: false, conflicto: true, lote: actual };
          Object.assign(actual, { datos: a.p_datos, version: actual.version + 1, modificado: ahora, borrado: a.p_borrar || actual.borrado });
          return { ok: true, lote: actual };
        }
        var nuevo = { id: a.p_id, empresa_id: a.p_empresa, datos: a.p_datos, version: 1, borrado: !!a.p_borrar, modificado: ahora };
        db.lotes.push(nuevo);
        return { ok: true, lote: nuevo };
      },
      // Igual que guardar_nc de la base: valida lo mismo (Reglas.validarNc) y numera por empresa y año.
      guardar_nc: function (db, s, a) {
        db.no_conformidades = db.no_conformidades || [];
        var problema = R.validarNc(a.p_datos);
        if (problema) throw new Error(problema);
        var actual = db.no_conformidades.filter(function (n) { return n.id === a.p_id; })[0];
        var ahora = new Date(Date.now() + db.no_conformidades.length).toISOString();
        var columnas = { fecha: a.p_datos.fecha, estado: a.p_datos.estado, tipo: a.p_datos.tipo || '', lote: a.p_datos.lote || '' };
        if (actual) {
          if (actual.version !== a.p_version_base) return { ok: false, conflicto: true, nc: actual };
          Object.assign(actual, columnas, { datos: a.p_datos, version: actual.version + 1, modificado: ahora, borrado: a.p_borrar || actual.borrado });
          return { ok: true, nc: actual };
        }
        if (a.p_version_base !== 0) return { ok: false, conflicto: true, nc: null };
        var nueva = Object.assign({ id: a.p_id, empresa_id: a.p_empresa, numero: siguienteNumero(db.no_conformidades, a.p_empresa, a.p_datos.fecha),
          datos: a.p_datos, version: 1, borrado: !!a.p_borrar, modificado: ahora }, columnas);
        db.no_conformidades.push(nueva);
        return { ok: true, nc: nueva };
      }
    };

    return {
      auth: {
        getSession: function () { return ok({ session: sesion() }); },
        signInWithPassword: function (c) {
          if (sinRed()) return err('Failed to fetch');
          var u = leer().usuarios[c.email];
          if (!u || u.clave !== c.password) return err('Invalid login credentials');
          if (!u.confirmado) return err('Email not confirmed');
          var s = entrar(u);
          return ok({ user: s.user, session: s });
        },
        signUp: function (c) {
          if (sinRed()) return err('Failed to fetch');
          var db = leer();
          if (db.usuarios[c.email]) return err('User already registered');
          if (String(c.password).length < 6) return err('Password should be at least 6 characters');
          var u = { id: 'u-' + (Object.keys(db.usuarios).length + 1), email: c.email, clave: c.password, confirmado: !db.confirmarEmail };
          db.usuarios[c.email] = u;
          guardar(db);
          if (!u.confirmado) return ok({ user: { id: u.id, email: u.email }, session: null });
          var s = entrar(u);
          return ok({ user: s.user, session: s });
        },
        signOut: function () { setSesion(null); return ok(null); }
      },
      from: consulta,
      rpc: function (nombre, args) {
        if (sinRed()) return err('Failed to fetch');
        var db = leer(), r;
        try { r = rpcs[nombre](db, sesion(), args || {}); } catch (e) { return err(e.message); }
        guardar(db);
        return ok(r);
      }
    };
  }

  function vacio() {
    return { usuarios: {}, plataforma: [], confirmarEmail: false, empresas: [], miembros: [], invitaciones: [], lotes: [], no_conformidades: [] };
  }

  // NC-AAAA-NNN: el siguiente número de esa empresa en el año de la fecha (como guardar_nc).
  function siguienteNumero(ncs, empresaId, fecha) {
    var anio = String(fecha).slice(0, 4);
    var max = ncs.filter(function (n) { return n.empresa_id === empresaId && n.numero.indexOf('NC-' + anio + '-') === 0; })
      .reduce(function (m, n) { return Math.max(m, Number(n.numero.split('-')[2])); }, 0);
    return 'NC-' + anio + '-' + String(max + 1).padStart(3, '0');
  }

  // ── Datos de ejemplo (ficticios) ──

  // En el navegador Reglas ya está cargado; desde Node (tools/) se pide.
  var R = typeof Reglas !== 'undefined' ? Reglas : require('./reglas.js');

  function plantilla(clave, id, doc) { var p = R.plantillaEjemplo(clave); p.id = id; p.doc = doc; return p; }

  var CONFIG_EJEMPLO = {
    plantillas: [
      plantilla('agro', 'agro', { codigo: 'REG-01', version: '03', vigencia: '2026-09-01', elaboro: 'Laura Gómez', aprobo: 'Pablo Díaz',
        historial: [
          { version: '01', fecha: '2026-03-10', por: 'Laura Gómez', cambio: 'Creación del registro' },
          { version: '02', fecha: '2026-06-15', por: 'Laura Gómez', cambio: 'Se agrega el control de QR en línea' },
          { version: '03', fecha: '2026-09-01', por: 'Pablo Díaz', cambio: 'Inducción con tolerancia 1,0–1,4 y semáforo' }] }),
      plantilla('alimentos', 'alimentos', { codigo: 'REG-02', version: '01', vigencia: '2026-10-01', elaboro: 'Laura Gómez', aprobo: 'Pablo Díaz',
        historial: [{ version: '01', fecha: '2026-10-01', por: 'Laura Gómez', cambio: 'Creación del registro' }] })
    ],
    lineas: ['Env-01', 'Env-02', 'Env-04'],
    tiposNc: [
      { nombre: 'Inducción débil', sev: 'Crítico' }, { nombre: 'Peso / volumen fuera de rango', sev: 'Leve' },
      { nombre: 'Sellado deficiente', sev: 'Crítico' }, { nombre: 'Trazabilidad / QR', sev: 'Crítico' },
      { nombre: 'Rotulado incorrecto', sev: 'Moderado' }, { nombre: 'Envase dañado', sev: 'Moderado' },
      { nombre: 'Materia prima no conforme', sev: 'Crítico' }
    ],
    ncCodigo: 'REG-NC', ncVersion: '02',
    docCodigo: 'REG-01', docVersion: '03', docElab: 'Laura Gómez', docAprob: 'Coordinación de Calidad'
  };

  // Cinco lotes en distintos estados, armados con las mismas reglas de la app: cuatro de
  // envasado de líquidos y uno de alimentos (otra plantilla, otros controles).
  function lotesEjemplo(empresaId) {
    var hoy = new Date();
    var dia = function (n) { return R.hoy(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n)); };
    var agro = CONFIG_EJEMPLO.plantillas[0], alim = CONFIG_EJEMPLO.plantillas[1];
    var mas = function (a, b) { return Object.assign({}, a, b); };
    var unidad = function (n, v, r, extra) { return Object.assign(R.nuevaUnidad(n), { v: v, r: r || {} }, extra || {}); };
    // Control en línea de líquidos: todo OK salvo lo que se pise con "cambios".
    var pl = function (n, cambios, repro) {
      return unidad(n, mas({
        peso: ['10.4', '10.6', '10.5', '10.5'], loteEnv: 'L-' + n, codigo: '7790123', fprod: dia(0), fvenc: dia(-365),
        ind: ['1.2'], qr: true, pack: true, plt: true
      }, cambios), repro, { hora: '0' + (6 + n) + ':1' + n });
    };
    var cfOk = { idPal: true, traz: true, estPal: true, indF: true };
    var lote = function (p, cab, estado, dictamen, linea, finales, por) {
      // Datos del lote que piden las plantillas de ejemplo (inductora y turno, o envasadora y turno).
      var extra = p === agro ? { inductora: 'Inductora 2', turno: 'Mañana' } : { equipo: 'Envasadora 3', turno: 'Mañana' };
      var l = R.nuevoLote(mas({ checker: 'Laura Gómez', extra: extra }, cab), p, 0);
      l.linea = linea;
      l.final.unidades = finales.map(function (f, i) { return unidad(i + 1, f[0] || {}, f[1]); });
      l.final.cantPorUnidad = p === agro ? '1000' : '480';
      if (dictamen) {
        l.estado = estado; l.final.dictamen = dictamen;
        l.final.fechaDictamen = R.fechaLarga(cab.fecha) + ', 15:40';
        l.final.dictaminadoPor = por;
        l.final.dictaminadoRol = por === 'Pablo Díaz' ? 'Coordinación' : 'Inspector de Calidad';
      }
      return l;
    };
    var rangoPeso = { peso: { min: '10', max: '11' } };
    var datos = [
      lote(agro, { prod: 'Aceite girasol 1,5 L', lote: 'L-2611-014', cliente: 'Distribuidora Norte SA', linea: 'Env-04', fecha: dia(0), rangos: rangoPeso },
        'activo', null, [pl(1), pl(2, { peso: ['10.4', '10.6', '11.3', '10.5'] }), pl(3, { pack: false }, { pack: true })],
        [[cfOk], [cfOk], [cfOk], [], [], []]),
      lote(alim, { prod: 'Yogur frutilla 190 g', lote: 'Y-2611-031', cliente: 'Almacén Central', linea: 'Env-01', fecha: dia(1),
        rangos: { peso: { min: '188', max: '196' }, temp: { min: '2', max: '6' }, tempF: { min: '2', max: '6' } } },
        'aprobado', 'APROBADO',
        [unidad(1, { peso: ['190', '191', '189', '192', '190'], temp: ['4.1'], metales: true, sellado: true, rotulo: true, alergenos: true, visual: true }, {}, { hora: '08:05' }),
         unidad(2, { peso: ['191', '190', '193', '190', '191'], temp: ['4.3'], metales: true, sellado: false, rotulo: true, alergenos: true, visual: true }, { sellado: true }, { hora: '09:05' })],
        [[{ rotuloF: true, tempF: ['3.8'], envases: true, pallet: true }], [{ rotuloF: true, tempF: ['4.0'], envases: true, pallet: true }]], 'Laura Gómez'),
      lote(agro, { prod: 'Aceite oliva 500 ml', lote: 'L-2611-012', cliente: 'Almacén Central', linea: 'Env-01', fecha: dia(1), rangos: rangoPeso },
        'aprobado', 'APROBADO', [pl(1), pl(2)], [[cfOk], [cfOk], [cfOk], [cfOk]], 'Laura Gómez'),
      lote(agro, { prod: 'Vinagre de alcohol 1 L', lote: 'L-2611-009', cliente: 'Supermercados del Sur', linea: 'Env-02', fecha: dia(2), rangos: rangoPeso },
        'aprobado_parcial', 'APROBADO_PARCIAL', [pl(1)], [[cfOk], [cfOk], [mas(cfOk, { traz: false })], [cfOk]], 'Laura Gómez'),
      lote(agro, { prod: 'Aceite girasol 900 ml', lote: 'L-2611-007', cliente: 'Distribuidora Norte SA', linea: 'Env-04', fecha: dia(3), rangos: rangoPeso },
        'retenido', 'RETENIDO', [pl(1, { ind: ['0.7'] })], [[mas(cfOk, { indF: false })], [mas(cfOk, { indF: false })]], 'Pablo Díaz')
    ];
    return datos.map(function (d, i) {
      return { id: '00000000-0000-4000-8000-00000000000' + i, empresa_id: empresaId, datos: d, version: 1,
        borrado: false, modificado: new Date(Date.now() - i * 60000).toISOString() };
    });
  }

  // NC de ejemplo: tres que salieron de los lotes de ejemplo (una en proceso, una abierta y una
  // corregida en el momento) y dos del mes pasado (una cerrada y verificada, otra todavía abierta
  // y con el plazo vencido), para que se vean la vista por mes, las abiertas y los indicadores.
  function ncsEjemplo(empresaId, lotes) {
    var hoy = new Date();
    var dia = function (n) { return R.hoy(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n)); };
    var mesPasado = function (d) { return R.hoy(new Date(hoy.getFullYear(), hoy.getMonth() - 1, d)); };
    var deLote = function (i) { var c = lotes[i].datos.cab; return { loteId: lotes[i].id, lote: c.lote, prod: c.prod, cliente: c.cliente, fecha: c.fecha }; };
    var datos = [
      R.nuevaNc(Object.assign(deLote(4), { deteccion: 'Control final', tipo: 'Inducción débil', sev: 'Crítico',
        desc: 'Inducción 0,7 en línea y sello flojo en los 2 pallets del control final', cantNC: '2000', cantTot: '2000', unidadCant: 'L',
        ac: 'Lote retenido. Reinducción del 100 % y ajuste de la potencia de la inductora', resp: 'Pablo Díaz', estado: 'en_proceso', creadaPor: 'Pablo Díaz' })),
      R.nuevaNc(Object.assign(deLote(3), { deteccion: 'Control final', tipo: 'Trazabilidad / QR', sev: 'Crítico',
        desc: 'QR ilegible en el pallet 3', cantNC: '1000', cantTot: '4000', unidadCant: 'L', resp: 'Laura Gómez', creadaPor: 'Laura Gómez' })),
      R.nuevaNc(Object.assign(deLote(1), { deteccion: 'Control en línea', tipo: 'Sellado deficiente', sev: 'Crítico',
        desc: 'Sellado · Pallet 2: NOK', estado: 'cerrada', cierre: deLote(1).fecha, ac: 'Corregido en el momento (reproceso)', creadaPor: 'Laura Gómez' })),
      R.nuevaNc({ fecha: mesPasado(12), deteccion: 'Reclamo de cliente', lote: 'L-2610-022', prod: 'Aceite girasol 1,5 L', cliente: 'Almacén Central',
        tipo: 'Envase dañado', sev: 'Moderado', desc: 'El cliente recibió 30 botellas abolladas', cantNC: '45', cantTot: '6000', unidadCant: 'L',
        ac: 'Se reforzó el film y se cambió el esquinero del pallet', resp: 'Pablo Díaz', estado: 'cerrada', cierre: mesPasado(15),
        eficacia: 'eficaz', cerradaPor: 'Pablo Díaz', creadaPor: 'Pablo Díaz' }),
      R.nuevaNc({ fecha: mesPasado(20), deteccion: 'Control de ingreso', tipo: 'Materia prima no conforme', sev: 'Crítico',
        desc: 'Tapas del proveedor con rosca deformada (lote de tapas T-118)', ac: 'Devolución al proveedor y pedido de acción correctiva',
        resp: 'Laura Gómez', creadaPor: 'Laura Gómez' })
    ];
    var filas = [];
    // Se numeran en el orden en que se habrían cargado (por fecha), como en la base.
    datos.sort(function (x, y) { return x.fecha < y.fecha ? -1 : 1; }).forEach(function (d, i) {
      d.plazo = d.plazo || ''; d.plazoAuto = d.plazoAuto || '';
      filas.push({ id: '00000000-0000-4000-9000-00000000000' + i, empresa_id: empresaId, numero: siguienteNumero(filas, empresaId, d.fecha),
        fecha: d.fecha, estado: d.estado, tipo: d.tipo, lote: d.lote, datos: d, version: 1, borrado: false,
        modificado: new Date(Date.now() - i * 60000).toISOString() });
    });
    return filas;
  }

  // Deja la demo como nueva: cada visitante arranca con los mismos datos.
  function reiniciar() {
    var db = vacio();
    db.usuarios[EMAIL] = { id: 'visitante', email: EMAIL, clave: CLAVE, confirmado: true };
    db.empresas.push({ id: EMPRESA, nombre: 'Planta Demo', config: CONFIG_EJEMPLO });
    db.miembros.push(
      { empresa_id: EMPRESA, user_id: 'visitante', nombre: 'Visitante', rol: 'admin', activo: true },
      { empresa_id: EMPRESA, user_id: 'laura', nombre: 'Laura Gómez', rol: 'checker', activo: true },
      { empresa_id: EMPRESA, user_id: 'pablo', nombre: 'Pablo Díaz', rol: 'coordinacion', activo: true }
    );
    db.invitaciones.push({ empresa_id: EMPRESA, email: 'turno.noche@plantademo.com', rol: 'checker' });
    db.lotes = lotesEjemplo(EMPRESA);
    db.no_conformidades = ncsEjemplo(EMPRESA, db.lotes);
    localStorage.setItem(CLAVE_DEMO, JSON.stringify(db));
    localStorage.removeItem(CLAVE_DEMO + '.sesion');
  }

  return {
    CLAVE_DEMO: CLAVE_DEMO, EMAIL: EMAIL, CLAVE: CLAVE, EMPRESA: EMPRESA,
    cliente: cliente, reiniciar: reiniciar, lotesEjemplo: lotesEjemplo, ncsEjemplo: ncsEjemplo, CONFIG_EJEMPLO: CONFIG_EJEMPLO
  };
})();

// Para los scripts de Node (tools/). En el navegador no existe "module" y se ignora.
if (typeof module !== 'undefined') module.exports = Demo;
