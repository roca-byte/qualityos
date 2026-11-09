/* Reglas de negocio del control de un lote.
 *
 * Son funciones PURAS: reciben datos y devuelven un resultado, sin tocar la
 * pantalla ni la base. Así se pueden probar solas (tests/reglas.test.js) y la
 * pantalla, el PDF y el servidor usan exactamente la misma regla.
 *
 * QUÉ SE CONTROLA LO DEFINE UNA PLANTILLA (no está fijo en el código), para que la app
 * sirva en cualquier rubro. Una plantilla tiene ítems de 4 tipos:
 *   medicion  número con tolerancia (mín/máx), unidad y N lecturas (ej.: 4 pesos por pico)
 *   okNok     OK / NOK, opcionalmente con "reprocesado"
 *   texto     un dato escrito (ej.: lote del envase)
 *   fecha     una fecha (ej.: vencimiento)
 * Cada lote guarda una COPIA de su plantilla: si la plantilla cambia, los lotes viejos no.
 *
 * La plantilla también puede pedir DATOS DEL LOTE propios (p.cabecera): equipo, inductora,
 * turno… Cada uno es texto, lista de opciones, número o fecha, y se guarda en cab.extra[id].
 *
 * Valores guardados por unidad (pallet, caja, muestra…): u.v[itemId]
 *   okNok: true | false | null      medicion: ['10.4', '', …] (una por lectura)
 *   texto / fecha: 'texto' | 'AAAA-MM-DD'
 * u.r[itemId] = true si un NOK (o una medición fuera de rango) se reprocesó en el momento.
 */
var Reglas = (function () {
  'use strict';

  var TIPOS = { medicion: 'Medición', okNok: 'OK / NOK', texto: 'Texto', fecha: 'Fecha' };

  var ESTADO_POR_DICTAMEN = {
    APROBADO: 'aprobado',
    APROBADO_PARCIAL: 'aprobado_parcial',
    RETENIDO: 'retenido'
  };

  function numero(v) {
    if (v === '' || v === null || v === undefined) return NaN;
    return parseFloat(String(v).replace(',', '.'));
  }

  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  function nuevoId() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Fecha de hoy en hora LOCAL (AAAA-MM-DD). Nunca toISOString(): eso es UTC
  // y a la noche en Argentina ya devuelve el día siguiente.
  function hoy(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  // AAAA-MM-DD → DD/MM/AAAA, para mostrar e imprimir.
  function fechaLarga(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }

  // ───────────────────────── Ítems ─────────────────────────

  // Tolerancia de una medición: fija en la plantilla, cargada en el lote, o ninguna.
  function rango(item, cab) {
    if (item.tipo !== 'medicion') return null;
    var r = item.tolerancia === 'lote' ? ((cab && cab.rangos) || {})[item.id] || {}
      : item.tolerancia === 'fija' ? item : null;
    if (!r) return null;
    var min = numero(r.min), max = numero(r.max);
    return isNaN(min) && isNaN(max) ? null : { min: min, max: max };
  }

  // Semáforo de un valor: 'ok' dentro de tolerancia, 'warn' hasta un 30 % del rango por
  // fuera, 'nok' más lejos. Con un solo límite (solo mínimo o solo máximo) no hay 'warn'.
  function semaforo(valor, r) {
    var v = numero(valor);
    if (isNaN(v) || !r) return '';
    var dentro = (isNaN(r.min) || v >= r.min) && (isNaN(r.max) || v <= r.max);
    if (dentro) return 'ok';
    if (isNaN(r.min) || isNaN(r.max)) return 'nok';
    var margen = (r.max - r.min) * 0.3;
    return v >= r.min - margen && v <= r.max + margen ? 'warn' : 'nok';
  }

  function lecturas(item, v) {
    var n = Math.max(1, parseInt(item.lecturas, 10) || 1);
    var arr = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
    var out = [];
    for (var i = 0; i < n; i++) out.push(arr[i] === undefined || arr[i] === null ? '' : String(arr[i]));
    return out;
  }

  // ¿Le falta el dato? (para saber si una unidad está completa)
  function vacio(item, v) {
    if (item.tipo === 'okNok') return v !== true && v !== false;
    if (item.tipo === 'medicion') return lecturas(item, v).some(function (x) { return x.trim() === '' || isNaN(numero(x)); });
    return v === undefined || v === null || String(v).trim() === '';
  }

  // Resultado de un ítem en una unidad.
  //   estado: 'ok' | 'nok' | 'repro' | 'pendiente'
  //   sem: color del semáforo ('' si no aplica) · promedio: de las lecturas cargadas
  function evaluar(item, v, repro, cab) {
    if (item.tipo === 'okNok') {
      if (v === true) return { estado: 'ok', sem: '' };
      if (v === false) return { estado: repro ? 'repro' : 'nok', sem: '' };
      return { estado: 'pendiente', sem: '' };
    }
    if (item.tipo === 'medicion') {
      var r = rango(item, cab);
      var cargadas = lecturas(item, v).map(numero).filter(function (x) { return !isNaN(x); });
      var res = { estado: 'pendiente', sem: '', promedio: null };
      if (!cargadas.length) return res;
      res.promedio = Math.round(cargadas.reduce(function (a, b) { return a + b; }, 0) / cargadas.length * 100) / 100;
      var colores = cargadas.map(function (x) { return semaforo(x, r); });
      var fuera = colores.some(function (c) { return c === 'warn' || c === 'nok'; });
      if (item.semaforo) res.sem = colores.indexOf('nok') >= 0 ? 'nok' : colores.indexOf('warn') >= 0 ? 'warn' : (r ? 'ok' : '');
      if (fuera) res.estado = repro ? 'repro' : 'nok';
      else res.estado = vacio(item, v) ? 'pendiente' : 'ok';
      return res;
    }
    return { estado: vacio(item, v) ? 'pendiente' : 'ok', sem: '' };
  }

  // Estado de una unidad del control en línea: 'nok' | 'repro' | 'ok' | 'pendiente'.
  function estadoUnidadLinea(items, u, cab) {
    var e = items.map(function (it) { return evaluar(it, u.v[it.id], u.r[it.id], cab).estado; });
    if (e.indexOf('nok') >= 0) return 'nok';
    if (e.indexOf('repro') >= 0) return 'repro';
    return e.indexOf('ok') >= 0 ? 'ok' : 'pendiente';
  }

  // Ítems obligatorios del control final que todavía no tienen dato.
  function faltantes(items, u) {
    return items.filter(function (it) { return it.obligatorio !== false && vacio(it, u.v[it.id]); });
  }

  // Estado de una unidad del control final: 'retenido' | 'aprobado' | 'pendiente'.
  // Retenida si tiene algún NOK sin reprocesar; aprobada si está completa sin NOK
  // (los NOK reprocesados cuentan como corregidos).
  function estadoUnidadFinal(items, u, cab) {
    var nok = items.some(function (it) { return evaluar(it, u.v[it.id], u.r[it.id], cab).estado === 'nok'; });
    if (nok) return 'retenido';
    return faltantes(items, u).length ? 'pendiente' : 'aprobado';
  }

  // Resumen del control final: unidades y cantidad (litros, kg…) aprobadas y retenidas.
  // Cantidad: la de la unidad si se cargó, si no la "cantidad por unidad" del lote.
  // Si la plantilla no lleva cantidad o no se cargó ninguna, va null (se informa en unidades).
  function resumenFinal(lote) {
    var p = lote.plantilla, f = lote.final;
    var porUnidad = numero(f.cantPorUnidad);
    var r = { aprobados: 0, retenidos: 0, pendientes: 0, cantAprobada: 0, cantRetenida: 0, conCantidad: false };
    f.unidades.forEach(function (u) {
      var propia = numero(u.cant);
      var cant = !isNaN(propia) ? propia : (!isNaN(porUnidad) ? porUnidad : 0);
      if (!isNaN(propia) || !isNaN(porUnidad)) r.conCantidad = true;
      var e = estadoUnidadFinal(p.final, u, lote.cab);
      if (e === 'aprobado') { r.aprobados++; r.cantAprobada += cant; }
      else if (e === 'retenido') { r.retenidos++; r.cantRetenida += cant; }
      else r.pendientes++;
    });
    if (!p.cantidad || !r.conCantidad) { r.cantAprobada = null; r.cantRetenida = null; }
    return r;
  }

  // Dictamen que la app sugiere (el inspector decide igual).
  function sugerirDictamen(lote) {
    var r = resumenFinal(lote);
    var total = r.aprobados + r.retenidos + r.pendientes;
    if (!total || r.pendientes === total) return null;
    if (r.retenidos === 0) return 'APROBADO';
    if (r.aprobados === 0) return 'RETENIDO';
    return 'APROBADO_PARCIAL';
  }

  // Unidades del control final con datos obligatorios sin completar. Para dictaminar tienen
  // que estar todas; si no, solo coordinación puede forzar (lo valida también el servidor).
  function unidadesFaltantes(lote) {
    var out = [];
    lote.final.unidades.forEach(function (u, i) {
      var f = faltantes(lote.plantilla.final, u).map(function (it) { return it.nombre; });
      if (f.length) out.push({ numero: i + 1, campos: f });
    });
    return out;
  }

  // Desvíos del lote para pasarlos al Registro de NC: cada NOK y cada medición fuera de
  // rango, separando los corregidos en el momento (reprocesados) de los que quedaron abiertos.
  function desvios(lote) {
    var out = [];
    var p = lote.plantilla;
    function revisar(etapa, items, u, numero) {
      items.forEach(function (it) {
        var e = evaluar(it, u.v[it.id], u.r[it.id], lote.cab);
        if (e.estado !== 'nok' && e.estado !== 'repro') return;
        var detalle = it.tipo === 'medicion'
          ? 'fuera de rango (' + lecturas(it, u.v[it.id]).filter(Boolean).join(' / ') + (it.unidad ? ' ' + it.unidad : '') + ')'
          : 'NOK';
        out.push({ etapa: etapa, unidad: numero, control: it.nombre, detalle: detalle, corregido: e.estado === 'repro', obs: u.obs || '' });
      });
    }
    lote.linea.forEach(function (u, i) { revisar('Control en línea', p.linea, u, u.n || String(i + 1)); });
    lote.final.unidades.forEach(function (u, i) { revisar('Control final', p.final, u, String(i + 1)); });
    return out;
  }

  function estadoPorDictamen(dictamen) {
    return ESTADO_POR_DICTAMEN[dictamen] || 'activo';
  }

  // "Coca cola  sa" → "Coca Cola SA": evita que el mismo cliente aparezca
  // dos veces en el historial por cómo se tipeó.
  function normalizarCliente(s) {
    if (!s) return '';
    return String(s).trim().replace(/\s+/g, ' ').split(' ').map(function (w) {
      if (w.length <= 4 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  // ───────────────────────── Modelos ─────────────────────────

  function nuevaUnidad(numeroUnidad) {
    return { n: String(numeroUnidad), hora: '', v: {}, r: {}, cant: '', obs: '' };
  }

  function nuevoLote(cab, plantilla, cantFinal) {
    var unidades = [];
    for (var i = 0; i < cantFinal; i++) unidades.push(nuevaUnidad(i + 1));
    return {
      formato: 2,
      estado: 'activo',
      cab: cab,
      plantilla: copia(plantilla),
      linea: [nuevaUnidad(1)],
      final: { cantPorUnidad: '', unidades: unidades, dictamen: null, fechaDictamen: null, dictaminadoPor: '', dictaminadoRol: '' },
      hallazgos: [],
      cierreForzado: null
    };
  }

  // Ítems de ejemplo. med(id, nombre, unidad, lecturas, tolerancia, [min, max], semáforo, reproceso)
  function med(id, nombre, unidad, n, tol, mm, sem, repro) {
    return { id: id, nombre: nombre, tipo: 'medicion', unidad: unidad, lecturas: n, tolerancia: tol,
      min: mm ? mm[0] : '', max: mm ? mm[1] : '', semaforo: !!sem, reproceso: !!repro, obligatorio: true };
  }
  function ok(id, nombre, repro) { return { id: id, nombre: nombre, tipo: 'okNok', reproceso: repro !== false, obligatorio: true }; }
  function txt(id, nombre) { return { id: id, nombre: nombre, tipo: 'texto', obligatorio: true }; }
  function fec(id, nombre) { return { id: id, nombre: nombre, tipo: 'fecha', obligatorio: true }; }
  // Dato de cabecera de ejemplo: dato(id, nombre, tipo, [opciones], obligatorio)
  function dato(id, nombre, tipo, opciones, oblig) { return { id: id, nombre: nombre, tipo: tipo, opciones: opciones || [], obligatorio: !!oblig }; }
  var TURNO = dato('turno', 'Turno', 'lista', ['Mañana', 'Tarde', 'Noche'], true);

  // Puntos de partida por rubro: el administrador elige uno y lo ajusta a su planta.
  // Las tolerancias que dependen del producto quedan "por lote" (se cargan al crear el lote).
  var EJEMPLOS = {
    agro: {
      rubro: 'Agroquímicos / químicos',
      nombre: 'Envasado de líquidos', unidad: 'Pallet', unidades: 'Pallets', cantidad: 'L',
      cabecera: [dato('inductora', 'Inductora', 'lista', ['Inductora 1', 'Inductora 2'], true), TURNO],
      linea: [med('peso', 'Peso por pico', 'kg', 4, 'lote'), txt('loteEnv', 'Lote en envase'), txt('codigo', 'Código'),
        fec('fprod', 'Fecha de producción'), fec('fvenc', 'Fecha de vencimiento'),
        med('ind', 'Inducción', '', 1, 'fija', [1.0, 1.4], true, true),
        ok('qr', 'QR'), ok('pack', 'Packaging'), ok('plt', 'Paletizado')],
      final: [ok('idPal', 'ID pallet'), ok('traz', 'Trazabilidad / QR'), ok('estPal', 'Estado del pallet'), ok('indF', 'Inducción')]
    },
    alimentos: {
      rubro: 'Alimentos',
      nombre: 'Envasado de alimentos', unidad: 'Muestra', unidades: 'Muestras', cantidad: 'kg',
      cabecera: [dato('equipo', 'Envasadora', 'texto'), TURNO],
      linea: [med('peso', 'Peso neto', 'g', 5, 'lote'), med('temp', 'Temperatura del producto', '°C', 1, 'lote', null, true),
        ok('metales', 'Detector de metales', false), ok('sellado', 'Sellado / cierre'),
        ok('rotulo', 'Rotulado: lote y vencimiento'), ok('alergenos', 'Declaración de alérgenos'),
        ok('visual', 'Visual: sin cuerpos extraños', false)],
      final: [ok('rotuloF', 'Rotulado'), med('tempF', 'Temperatura de carga', '°C', 1, 'lote', null, true),
        ok('envases', 'Integridad de envases'), ok('pallet', 'Paletizado')]
    },
    bebidas: {
      rubro: 'Bebidas',
      nombre: 'Envasado de bebidas', unidad: 'Muestra', unidades: 'Muestras', cantidad: 'L',
      cabecera: [TURNO],
      linea: [med('vol', 'Volumen / nivel de llenado', 'ml', 3, 'lote'), med('torque', 'Torque de tapa', 'N·m', 3, 'lote'),
        med('brix', '°Brix', '°Bx', 1, 'lote', null, true), ok('codif', 'Codificado de fecha'), ok('etiqueta', 'Etiqueta')],
      final: [ok('herm', 'Hermeticidad'), ok('etiquetaF', 'Etiqueta'), ok('pallet', 'Paletizado')]
    },
    cosmetica: {
      rubro: 'Cosmética / limpieza',
      nombre: 'Envasado cosmética', unidad: 'Muestra', unidades: 'Muestras', cantidad: 'unid.',
      cabecera: [TURNO],
      linea: [med('peso', 'Peso', 'g', 3, 'lote'), med('ph', 'pH', '', 1, 'lote', null, true),
        med('visc', 'Viscosidad', 'cP', 1, 'lote'), ok('aspecto', 'Aspecto, color y olor'),
        ok('cierre', 'Cierre / válvula'), ok('etiqueta', 'Etiqueta y lote')],
      final: [ok('etiquetaF', 'Etiqueta'), ok('cierreF', 'Cierre'), ok('pallet', 'Paletizado')]
    },
    blanco: {
      rubro: 'En blanco',
      nombre: 'Plantilla nueva', unidad: 'Unidad', unidades: 'Unidades', cantidad: '', cabecera: [],
      linea: [ok('conforme', 'Conforme')],
      final: [ok('conformeF', 'Conforme')]
    }
  };

  function plantillaEjemplo(clave) {
    var e = copia(EJEMPLOS[clave] || EJEMPLOS.blanco);
    delete e.rubro;
    e.id = 'p' + Date.now().toString(36);
    e.cantFinal = 12;
    e.doc = { codigo: '', version: '00', vigencia: hoy(), elaboro: '', aprobo: '', historial: [] };
    return e;
  }

  // ───────────────────── Datos del lote (cabecera) ─────────────────────
  var TIPOS_DATO = { texto: 'Texto', lista: 'Lista de opciones', numero: 'Número', fecha: 'Fecha' };

  // Los datos que pide la plantilla, con su valor en el lote ('' si falta).
  function datosLote(p, cab) {
    var extra = (cab && cab.extra) || {};
    return (p.cabecera || []).map(function (d) {
      return { id: d.id, nombre: d.nombre, tipo: d.tipo, valor: extra[d.id] === undefined || extra[d.id] === null ? '' : String(extra[d.id]).trim() };
    });
  }
  // Nombres de los datos obligatorios que faltan (no deja crear ni guardar la cabecera sin ellos).
  function datosFaltantes(p, cab) {
    var obligatorios = {};
    (p.cabecera || []).forEach(function (d) { if (d.obligatorio) obligatorios[d.id] = true; });
    return datosLote(p, cab).filter(function (x) { return obligatorios[x.id] && !x.valor; }).map(function (x) { return x.nombre; });
  }
  // "Inductora: Inductora 2 · Turno: Mañana", para la pantalla y el PDF (las fechas en dd/mm/aaaa).
  function textoDatos(p, cab) {
    return datosLote(p, cab).filter(function (x) { return x.valor; })
      .map(function (x) { return x.nombre + ': ' + (x.tipo === 'fecha' ? fechaLarga(x.valor) : x.valor); });
  }

  // ───────────────────── Codificación del registro ─────────────────────
  // Cada plantilla es un registro del sistema de gestión (ISO 9001, 7.5): tiene código,
  // versión, vigencia, quién elaboró y quién aprobó, y un historial de versiones.
  // Como cada lote guarda una copia de su plantilla, el PDF de un lote viejo conserva la
  // codificación con la que se hizo aunque la plantilla ya vaya por otra versión.

  // Codificación de una plantilla. Las de antes de esta función no tenían la suya: heredan
  // la que estaba en la configuración de la empresa (un solo código para todo).
  function docDe(p, config) {
    var c = config || {};
    var d = (p && p.doc) || {};
    return {
      codigo: d.codigo !== undefined ? d.codigo : (c.docCodigo || ''),
      version: d.version !== undefined ? d.version : (c.docVersion || '00'),
      vigencia: d.vigencia || '',
      elaboro: d.elaboro !== undefined ? d.elaboro : (c.docElab || ''),
      aprobo: d.aprobo !== undefined ? d.aprobo : (c.docAprob || ''),
      historial: d.historial || []
    };
  }

  // Versión siguiente: '03' → '04', '9' → '10', '1.2' → '1.3', 'B' → 'B.1'.
  function siguienteVersion(v) {
    var m = String(v || '').match(/^(.*?)(\d+)$/);
    if (!m) return (v ? v + '.' : '') + '1';
    var n = String(Number(m[2]) + 1);
    while (n.length < m[2].length) n = '0' + n;
    return m[1] + n;
  }

  // ¿Cambió QUÉ se controla? (no cuenta el nombre ni la codificación). Si cambió, la norma
  // pide una versión nueva del registro.
  function cambioContenido(a, b) {
    var clave = function (p) { return JSON.stringify([p.unidad, p.unidades, p.cantidad, p.linea, p.final, p.cabecera || []]); };
    return clave(a) !== clave(b);
  }

  // Revisa una plantilla antes de guardarla. Devuelve el problema o '' si está bien.
  function validarPlantilla(p) {
    if (!String(p.nombre || '').trim()) return 'La plantilla necesita un nombre.';
    if (p.doc && !String(p.doc.codigo || '').trim()) return 'Falta el código del registro (por ejemplo REG-01).';
    if (p.doc && !String(p.doc.version || '').trim()) return 'Falta la versión del registro.';
    if (!String(p.unidad || '').trim()) return 'Falta el nombre de la unidad que se controla (pallet, caja, muestra…).';
    if (!p.linea.length && !p.final.length) return 'Agregá al menos un ítem a controlar.';
    var datos = p.cabecera || [];
    for (var j = 0; j < datos.length; j++) {
      if (!String(datos[j].nombre || '').trim()) return 'Hay un dato del lote sin nombre.';
      if (datos[j].tipo === 'lista' && !(datos[j].opciones || []).length) return '"' + datos[j].nombre + '": escribí las opciones de la lista.';
    }
    var todos = p.linea.concat(p.final);
    for (var i = 0; i < todos.length; i++) {
      var it = todos[i];
      if (!String(it.nombre || '').trim()) return 'Hay un ítem sin nombre.';
      if (it.tipo === 'medicion' && it.tolerancia === 'fija') {
        var min = numero(it.min), max = numero(it.max);
        if (isNaN(min) && isNaN(max)) return '"' + it.nombre + '": poné el mínimo, el máximo o los dos.';
        if (!isNaN(min) && !isNaN(max) && min > max) return '"' + it.nombre + '": el mínimo es mayor que el máximo.';
      }
    }
    return '';
  }

  // ───────────────────── Datos del formato anterior ─────────────────────
  // Antes de las plantillas, la configuración tenía "inductoras" y los lotes campos fijos.

  // Configuración vieja → una plantilla equivalente (la de agroquímicos, con la tolerancia
  // de inducción de la primera inductora).
  function plantillaDesdeConfigVieja(config) {
    var p = plantillaEjemplo('agro');
    p.id = 'p-anterior';
    p.nombre = 'Envasado (formato anterior)';
    var ind = (config.inductoras || [])[0];
    if (ind) p.linea.forEach(function (it) { if (it.id === 'ind') { it.min = ind.tolMin; it.max = ind.tolMax; it.semaforo = ind.semaforo !== false; } });
    // La inductora se elegía en el lote: pasa a ser un dato de la cabecera con las de la empresa.
    // El turno no existía, así que no se pide.
    var nombres = (config.inductoras || []).map(function (i) { return i.nombre; }).filter(Boolean);
    p.cabecera = nombres.length ? [dato('inductora', 'Inductora', 'lista', nombres, false)] : [];
    return p;
  }

  // Lote viejo → formato 2. Lo que no tiene equivalente exacto: el OK/NOK de inducción del
  // control en línea pasa a deducirse del valor medido. La inductora elegida queda como dato
  // de la cabecera (cab.extra.inductora).
  function migrarLote(d, config) {
    if (d.formato === 2) return d;
    var p = plantillaDesdeConfigVieja(config || {});
    var ind = ((config && config.inductoras) || []).filter(function (i) { return i.id === d.cab.indId; })[0];
    if (ind) p.linea.forEach(function (it) { if (it.id === 'ind') { it.min = ind.tolMin; it.max = ind.tolMax; } });
    var cab = { prod: d.cab.prod, lote: d.cab.lote, cliente: d.cab.cliente || '', linea: d.cab.linea || '',
      fecha: d.cab.fecha || '', checker: d.cab.checker || '', rangos: { peso: { min: d.cab.pesoMin || '', max: d.cab.pesoMax || '' } },
      extra: ind ? { inductora: ind.nombre } : {} };
    var lineaV = (d.linea || []).map(function (x, i) {
      var u = nuevaUnidad(x.nPal || i + 1);
      u.hora = x.hora || ''; u.obs = x.obs || '';
      u.v = { peso: [x.p1 || '', x.p2 || '', x.p3 || '', x.p4 || ''], loteEnv: x.lote || '', codigo: x.codProd || '',
        fprod: x.fProd || '', fvenc: x.fVenc || '', ind: [x.indVal || ''],
        qr: x.qrLineaOK === undefined ? null : x.qrLineaOK, pack: x.packOK === undefined ? null : x.packOK, plt: x.pltOK === undefined ? null : x.pltOK };
      u.r = { ind: !!x.repro, qr: !!x.qrRepro, pack: !!x.packRepro, plt: !!x.pltRepro };
      return u;
    });
    var f = d.final || {};
    var unidades = (f.pallets || []).map(function (x, i) {
      var u = nuevaUnidad(i + 1);
      u.obs = x.obs || ''; u.cant = x.litrosParcial || '';
      u.v = { idPal: nul(x.idOK), traz: nul(x.qrOK), estPal: nul(x.paletOK), indF: nul(x.indCFOK) };
      u.r = { idPal: !!x.idRepro, traz: !!x.qrRepro, estPal: !!x.paletRepro, indF: !!x.indCFRepro };
      return u;
    });
    var hallazgos = (d.hallazgos || []).slice();
    return {
      formato: 2, estado: d.estado || 'activo', cab: cab, plantilla: p, linea: lineaV,
      final: { cantPorUnidad: f.ltsPorPallet || '', unidades: unidades, dictamen: f.dictamen || null, fechaDictamen: f.fechaDictamen || null,
        dictaminadoPor: f.dictaminadoPor || '', dictaminadoRol: f.dictaminadoRol || '' },
      hallazgos: hallazgos, cierreForzado: d.cierreForzado || null
    };
  }
  function nul(v) { return v === true || v === false ? v : null; }

  // Plantillas de la empresa (si es configuración vieja, la equivalente).
  function plantillas(config) {
    if (config && config.plantillas && config.plantillas.length) return config.plantillas;
    return [plantillaDesdeConfigVieja(config || {})];
  }

  // ───────────────────────── No conformidades ─────────────────────────
  // Una NC se carga el día que se detecta (sale de los desvíos de un lote o se carga a mano) y se
  // sigue hasta cerrarla y verificar su eficacia (ISO 9001, 10.2). El registro se entrega por mes.
  // Forma de datos de una NC (la fila de la base tiene además numero, version, etc.):
  //   fecha, deteccion, lote, loteId, prod, cliente, tipo, sev, desc, cantNC, cantTot, unidadCant,
  //   ac, resp, plazo, plazoAuto, estado, cierre, cerradaPor, eficacia, origen, importadoDe, creadaPor
  // El servidor valida lo mismo que validarNc (supabase/migrations/0005_no_conformidades.sql).

  var NC_ESTADOS = { abierta: 'Abierta', en_proceso: 'En proceso', cerrada: 'Cerrada', anulada: 'Anulada' };
  var SEVERIDADES = ['Leve', 'Moderado', 'Crítico'];
  var EFICACIA = { pendiente: 'Pendiente', eficaz: 'Eficaz', no_eficaz: 'No eficaz' };
  var DETECCIONES = ['Control en línea', 'Control final', 'Control de ingreso', 'Reclamo de cliente', 'Auditoría', 'Otro'];
  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var PLAZO_NC_DIAS = 5;   // días hábiles para el plazo de la acción, si la empresa no configura otro

  // Tipos de desvío para arrancar. Cada empresa arma los suyos en ⚙ (config.tiposNc).
  var TIPOS_NC_INICIALES = [
    ['Producto fuera de especificación', 'Crítico'], ['Peso / volumen fuera de rango', 'Leve'],
    ['Envase dañado', 'Moderado'], ['Cierre / tapa defectuosa', 'Crítico'], ['Rotulado / etiqueta incorrecta', 'Moderado'],
    ['Trazabilidad / codificación ilegible', 'Crítico'], ['Embalaje / paletizado incorrecto', 'Moderado'], ['Materia prima no conforme', 'Crítico']
  ].map(function (t) { return { nombre: t[0], sev: t[1] }; });

  // Sin vacíos ni repetidos (sin importar mayúsculas) y con gravedad válida.
  function normalizarTiposNc(lista) {
    var vistos = {};
    return (lista || []).map(function (t) {
      return { nombre: String((t && t.nombre) || '').trim(), sev: SEVERIDADES.indexOf(t && t.sev) >= 0 ? t.sev : '' };
    }).filter(function (t) {
      var k = t.nombre.toLowerCase();
      if (!t.nombre || vistos[k]) return false;
      vistos[k] = true;
      return true;
    });
  }
  function tiposNc(config) {
    return config && Array.isArray(config.tiposNc) ? normalizarTiposNc(config.tiposNc) : copia(TIPOS_NC_INICIALES);
  }
  function sevSugerida(tipos, tipo) {
    var t = tipos.filter(function (x) { return x.nombre === tipo; })[0];
    return t ? t.sev : '';
  }
  function plazoNcDias(config) {
    var n = parseInt(config && config.ncPlazoDias, 10);
    return n > 0 ? n : PLAZO_NC_DIAS;
  }

  // Suma días hábiles (sin sábados ni domingos), en hora local.
  function sumarHabiles(iso, n) {
    var p = String(iso).split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    for (var a = 0; a < n;) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) a++; }
    return hoy(d);
  }

  function nuevaNc(campos, plazoDias) {
    var d = Object.assign({
      fecha: hoy(), deteccion: '', lote: '', loteId: '', prod: '', cliente: '', tipo: '', sev: '', desc: '',
      cantNC: '', cantTot: '', unidadCant: '', ac: '', resp: '', plazo: '', plazoAuto: '',
      estado: 'abierta', cierre: '', cerradaPor: '', eficacia: 'pendiente', origen: '', creadaPor: ''
    }, campos || {});
    if (!d.plazo && d.fecha && d.estado !== 'cerrada') d.plazo = d.plazoAuto = sumarHabiles(d.fecha, plazoDias || PLAZO_NC_DIAS);
    return d;
  }

  // El plazo se recalcula al cambiar la fecha, salvo que se haya puesto a mano.
  function actualizarPlazo(d, plazoDias) {
    if (!d.fecha || (d.plazo && d.plazo !== d.plazoAuto)) return d;
    d.plazo = d.plazoAuto = sumarHabiles(d.fecha, plazoDias || PLAZO_NC_DIAS);
    return d;
  }

  function ncAbierta(d) { return d.estado === 'abierta' || d.estado === 'en_proceso'; }

  // Devuelve qué falta, o null si se puede guardar.
  function validarNc(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) return 'Falta la fecha de detección.';
    if (!NC_ESTADOS[d.estado]) return 'Estado inválido.';
    if (!String(d.tipo || '').trim() && !String(d.desc || '').trim()) return 'Elegí el tipo de desvío o escribí una descripción.';
    if (d.estado === 'cerrada' && !d.cierre) return 'Una NC cerrada necesita la fecha de cierre.';
    if (d.sev && SEVERIDADES.indexOf(d.sev) < 0) return 'Gravedad inválida.';
    return null;
  }

  // ── Meses: se carga todos los días y se entrega por mes ──
  function mesDeNc(d) { return String(d.fecha || '').slice(0, 7); }
  function nombreMes(mes) {
    var p = String(mes || '').split('-');
    return p.length === 2 ? MESES[Number(p[1]) - 1] + ' ' + p[0] : '';
  }
  // Meses con NC, del más nuevo al más viejo, siempre con el actual.
  function mesesNc(lista, mesActual) {
    var s = {};
    s[mesActual] = true;
    lista.forEach(function (d) { if (mesDeNc(d)) s[mesDeNc(d)] = true; });
    return Object.keys(s).sort().reverse();
  }
  // filtro: 'aaaa-mm' o 'abiertas' (abiertas y en proceso de todos los meses).
  function filtrarNc(lista, filtro) {
    return lista.filter(function (d) { return filtro === 'abiertas' ? ncAbierta(d) : mesDeNc(d) === filtro; });
  }

  // Indicadores del registro (las anuladas no cuentan).
  function kpisNc(lista) {
    var a = lista.filter(function (d) { return d.estado !== 'anulada'; });
    var sNC = 0, sT = 0, freq = {};
    a.forEach(function (d) {
      var x = numero(d.cantNC), y = numero(d.cantTot);
      if (!isNaN(x)) sNC += x;
      if (!isNaN(y)) sT += y;
      if (d.tipo) freq[d.tipo] = (freq[d.tipo] || 0) + 1;
    });
    var top = Object.keys(freq).sort(function (x, y) { return freq[y] - freq[x]; })[0];
    // En plazo: de las que tienen plazo y ya se cerraron, cuántas cerraron a tiempo.
    var cerradas = a.filter(function (d) { return d.estado === 'cerrada' && d.plazo && d.cierre; });
    var aTiempo = cerradas.filter(function (d) { return d.cierre <= d.plazo; });
    var sev = { Leve: 0, Moderado: 0, 'Crítico': 0 };
    a.forEach(function (d) { if (sev[d.sev] !== undefined) sev[d.sev]++; });
    return {
      total: a.length,
      abiertas: a.filter(ncAbierta).length,
      tasa: sT > 0 ? Math.round(sNC / sT * 1000) / 10 : null,
      masFrecuente: top ? { tipo: top, veces: freq[top], pct: Math.round(freq[top] / a.length * 100) } : null,
      enPlazo: cerradas.length ? Math.round(aTiempo.length / cerradas.length * 100) : null,
      vencidas: a.filter(function (d) { return ncAbierta(d) && d.plazo && d.plazo < hoy(); }).length,
      sev: sev
    };
  }

  // NC a partir de los desvíos de un lote. El mismo control que falla en varias unidades del lote
  // es UNA no conformidad (una NC por lote · evento · tipo de desvío): se agrupan y se listan las
  // unidades. Lo reprocesado en el momento entra cerrado. "existentes" son los "origen" de las NC
  // ya creadas desde este lote, para no crearlas dos veces.
  function ncsDesdeLote(lote, loteId, tipos, plazoDias, existentes) {
    var grupos = {}, orden = [], p = lote.plantilla, c = lote.cab;
    desvios(lote).forEach(function (x) {
      var clave = [loteId, x.etapa, x.control, x.corregido ? 'r' : 'a'].join('|');
      if (!grupos[clave]) { grupos[clave] = { x: x, unidades: [] }; orden.push(clave); }
      // La observación es de la unidad (no del control): va pegada a esa unidad.
      grupos[clave].unidades.push(p.unidad + ' ' + x.unidad + ': ' + x.detalle + (x.obs ? ' — ' + x.obs : ''));
    });
    return orden.filter(function (k) { return (existentes || []).indexOf(k) < 0; }).map(function (k) {
      var g = grupos[k], x = g.x;
      var tipo = (tipos.filter(function (t) { return t.nombre.toLowerCase() === x.control.toLowerCase(); })[0] || {}).nombre || '';
      var fecha = c.fecha || hoy();
      return nuevaNc({
        fecha: fecha, deteccion: x.etapa, lote: c.lote, loteId: loteId, prod: c.prod, cliente: c.cliente || '',
        tipo: tipo, sev: sevSugerida(tipos, tipo), unidadCant: p.cantidad || '',
        desc: x.control + ' · ' + g.unidades.join('; '),
        estado: x.corregido ? 'cerrada' : 'abierta', cierre: x.corregido ? fecha : '',
        ac: x.corregido ? 'Corregido en el momento (reproceso)' : '', origen: k
      }, plazoDias);
    });
  }

  // Una fila del respaldo de la app individual (calidad-no-conformidades) → NC de QualityOS.
  // Así se puede pasar de una app a la otra sin volver a cargar nada.
  var ESTADO_INDIVIDUAL = { Pendiente: 'abierta', 'En proceso': 'en_proceso', Finalizado: 'cerrada', Anulado: 'anulada' };
  var DETEC_INDIVIDUAL = { 'CONTROL LÍNEA': 'Control en línea', 'CONTROL FINAL': 'Control final', 'CONTROL INGRESO': 'Control de ingreso' };
  function desdeRegistroIndividual(f) {
    var estado = ESTADO_INDIVIDUAL[f.est] || 'abierta';
    var fecha = /^\d{4}-\d{2}-\d{2}$/.test(f.fecha || '') ? f.fecha : '';
    return nuevaNc({
      fecha: fecha, deteccion: DETEC_INDIVIDUAL[f.detec] || '', lote: f.lote || '', prod: f.prod || '', cliente: f.cliente || '',
      tipo: f.tipo || '', sev: SEVERIDADES.indexOf(f.sev) >= 0 ? f.sev : '', desc: f.desc || '',
      cantNC: f.litNC || '', cantTot: f.litTot || '', unidadCant: (f.litNC || f.litTot) ? 'L' : '',
      ac: f.ac || '', resp: f.resp || '', plazo: f.plazo || '', plazoAuto: f.plazo || '',
      estado: estado, cierre: f.cierre || (estado === 'cerrada' ? fecha : ''),
      eficacia: { Eficaz: 'eficaz', 'No eficaz': 'no_eficaz' }[f.eficacia] || 'pendiente',
      importadoDe: String(f.id || '')
    });
  }

  return {
    TIPOS: TIPOS, EJEMPLOS: EJEMPLOS, TIPOS_DATO: TIPOS_DATO,
    datosLote: datosLote, datosFaltantes: datosFaltantes, textoDatos: textoDatos,
    hoy: hoy, fechaLarga: fechaLarga, numero: numero, copia: copia, nuevoId: nuevoId,
    rango: rango, semaforo: semaforo, lecturas: lecturas, vacio: vacio, evaluar: evaluar,
    estadoUnidadLinea: estadoUnidadLinea, estadoUnidadFinal: estadoUnidadFinal, faltantes: faltantes,
    resumenFinal: resumenFinal, sugerirDictamen: sugerirDictamen, unidadesFaltantes: unidadesFaltantes,
    desvios: desvios, estadoPorDictamen: estadoPorDictamen, normalizarCliente: normalizarCliente,
    nuevaUnidad: nuevaUnidad, nuevoLote: nuevoLote, plantillaEjemplo: plantillaEjemplo,
    validarPlantilla: validarPlantilla, plantillas: plantillas, migrarLote: migrarLote,
    docDe: docDe, siguienteVersion: siguienteVersion, cambioContenido: cambioContenido,
    NC_ESTADOS: NC_ESTADOS, SEVERIDADES: SEVERIDADES, EFICACIA: EFICACIA, DETECCIONES: DETECCIONES,
    TIPOS_NC_INICIALES: TIPOS_NC_INICIALES, normalizarTiposNc: normalizarTiposNc, tiposNc: tiposNc,
    sevSugerida: sevSugerida, plazoNcDias: plazoNcDias, sumarHabiles: sumarHabiles,
    nuevaNc: nuevaNc, actualizarPlazo: actualizarPlazo, ncAbierta: ncAbierta, validarNc: validarNc,
    mesDeNc: mesDeNc, nombreMes: nombreMes, mesesNc: mesesNc, filtrarNc: filtrarNc, kpisNc: kpisNc,
    ncsDesdeLote: ncsDesdeLote, desdeRegistroIndividual: desdeRegistroIndividual
  };
})();

// Para las pruebas con Node. En el navegador no existe "module" y se ignora.
if (typeof module !== 'undefined') module.exports = Reglas;
