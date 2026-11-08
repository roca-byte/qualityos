/* Reglas de negocio del control de un lote.
 *
 * Son funciones PURAS: reciben datos y devuelven un resultado, sin tocar la
 * pantalla ni la base. Así se pueden probar solas (tests/reglas.test.js) y la
 * pantalla, el PDF y el servidor usan exactamente la misma regla. En la versión
 * vieja cada pantalla tenía su propia copia y ya daban resultados distintos.
 *
 * Valores de un check: true = OK, false = NOK, null = sin controlar.
 * "Repro" = estaba NOK y se reprocesó en el momento (cuenta como corregido).
 */
var Reglas = (function () {
  'use strict';

  var CHECKS_FINAL = [
    { campo: 'idOK', repro: 'idRepro', nombre: 'ID pallet' },
    { campo: 'qrOK', repro: 'qrRepro', nombre: 'Trazabilidad / QR' },
    { campo: 'paletOK', repro: 'paletRepro', nombre: 'Estado del pallet' },
    { campo: 'indCFOK', repro: 'indCFRepro', nombre: 'Inducción' }
  ];

  var CHECKS_LINEA = [
    { campo: 'indOK', repro: 'repro', nombre: 'Inducción' },
    { campo: 'qrLineaOK', repro: 'qrRepro', nombre: 'QR' },
    { campo: 'packOK', repro: 'packRepro', nombre: 'Packaging' },
    { campo: 'pltOK', repro: 'pltRepro', nombre: 'Paletizado' }
  ];

  var PICOS = ['p1', 'p2', 'p3', 'p4'];

  var ESTADO_POR_DICTAMEN = {
    APROBADO: 'aprobado',
    APROBADO_PARCIAL: 'aprobado_parcial',
    RETENIDO: 'retenido'
  };

  function numero(v) {
    if (v === '' || v === null || v === undefined) return NaN;
    return parseFloat(String(v).replace(',', '.'));
  }

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

  // Semáforo de la inducción: 'ok' dentro de tolerancia, 'warn' hasta un 30 %
  // del rango por fuera, 'nok' más lejos, '' si no hay dato o la inductora no
  // usa semáforo.
  function semaforo(valor, inductora) {
    if (!inductora || inductora.semaforo === false) return '';
    var v = numero(valor);
    var min = numero(inductora.tolMin);
    var max = numero(inductora.tolMax);
    if (isNaN(v) || isNaN(min) || isNaN(max)) return '';
    if (v >= min && v <= max) return 'ok';
    var margen = (max - min) * 0.3;
    if (v >= min - margen && v <= max + margen) return 'warn';
    return 'nok';
  }

  // Peso de un pallet: OK si todos los picos cargados están dentro del rango
  // del lote. null si no hay picos cargados o el lote no tiene rango.
  function pesoOK(pallet, cab) {
    var min = numero(cab && cab.pesoMin);
    var max = numero(cab && cab.pesoMax);
    if (isNaN(min) || isNaN(max)) return null;
    var cargados = PICOS.map(function (k) { return numero(pallet[k]); })
      .filter(function (v) { return !isNaN(v); });
    if (!cargados.length) return null;
    return cargados.every(function (v) { return v >= min && v <= max; });
  }

  function promedioPeso(pallet) {
    var cargados = PICOS.map(function (k) { return numero(pallet[k]); })
      .filter(function (v) { return !isNaN(v); });
    if (!cargados.length) return null;
    var suma = cargados.reduce(function (a, b) { return a + b; }, 0);
    return Math.round((suma / cargados.length) * 100) / 100;
  }

  // Un NOK "desnudo" es un NOK que NO se reprocesó: es el que importa.
  function nokSinRepro(pallet, checks) {
    return checks.filter(function (c) {
      return pallet[c.campo] === false && !pallet[c.repro];
    });
  }

  function tieneRepro(pallet, checks) {
    return checks.some(function (c) { return pallet[c.campo] === false && !!pallet[c.repro]; });
  }

  // Estado de un pallet de Control en Línea: 'nok' | 'repro' | 'ok' | 'pendiente'.
  function estadoPalletLinea(p, cab) {
    if (nokSinRepro(p, CHECKS_LINEA).length || pesoOK(p, cab) === false) return 'nok';
    if (tieneRepro(p, CHECKS_LINEA)) return 'repro';
    var algo = CHECKS_LINEA.some(function (c) { return p[c.campo] !== null && p[c.campo] !== undefined; });
    return algo ? 'ok' : 'pendiente';
  }

  // Estado de un pallet de Control Final: 'retenido' | 'aprobado' | 'pendiente'.
  // Un pallet con todo OK, o con NOKs todos reprocesados, queda aprobado.
  function estadoPalletFinal(p) {
    if (nokSinRepro(p, CHECKS_FINAL).length) return 'retenido';
    var completos = CHECKS_FINAL.every(function (c) {
      return p[c.campo] === true || (p[c.campo] === false && p[c.repro]);
    });
    return completos ? 'aprobado' : 'pendiente';
  }

  // Resumen del Control Final: pallets y litros aprobados / retenidos.
  // Litros: los del pallet si se cargaron, si no los "litros por pallet" del lote.
  // Si no hay ningún dato de litros devuelve null (se muestra en pallets).
  function resumenFinal(lote) {
    var f = lote.final || { pallets: [] };
    var lpp = numero(f.ltsPorPallet);
    var r = { aprobados: 0, retenidos: 0, pendientes: 0, ltsAprobados: 0, ltsRetenidos: 0, conLitros: false };
    (f.pallets || []).forEach(function (p) {
      var propio = numero(p.litrosParcial);
      var lts = !isNaN(propio) ? propio : (!isNaN(lpp) ? lpp : 0);
      if (!isNaN(propio) || !isNaN(lpp)) r.conLitros = true;
      var e = estadoPalletFinal(p);
      if (e === 'aprobado') { r.aprobados++; r.ltsAprobados += lts; }
      else if (e === 'retenido') { r.retenidos++; r.ltsRetenidos += lts; }
      else r.pendientes++;
    });
    if (!r.conLitros) { r.ltsAprobados = null; r.ltsRetenidos = null; }
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

  // Pallets del Control Final con checks sin completar. Para dictaminar tienen
  // que estar todos; si no, solo coordinación puede forzar (lo valida el servidor).
  function palletsFaltantes(lote) {
    var out = [];
    ((lote.final && lote.final.pallets) || []).forEach(function (p, i) {
      var faltan = CHECKS_FINAL.filter(function (c) {
        return p[c.campo] === null || p[c.campo] === undefined;
      }).map(function (c) { return c.nombre; });
      if (faltan.length) out.push({ numero: i + 1, campos: faltan });
    });
    return out;
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

  // Desvíos del lote para pasarlos al Registro de NC. Se separan los que
  // quedaron abiertos (NOK) de los corregidos en el momento (repro).
  function desvios(lote) {
    var out = [];
    (lote.linea || []).forEach(function (p, i) {
      var n = p.nPal || String(i + 1);
      CHECKS_LINEA.forEach(function (c) {
        if (p[c.campo] === false) {
          out.push({ etapa: 'Control en línea', pallet: n, control: c.nombre, corregido: !!p[c.repro], obs: p.obs || '' });
        }
      });
      if (pesoOK(p, lote.cab) === false) {
        out.push({ etapa: 'Control en línea', pallet: n, control: 'Peso', corregido: false, obs: p.obs || '' });
      }
    });
    ((lote.final && lote.final.pallets) || []).forEach(function (p, i) {
      CHECKS_FINAL.forEach(function (c) {
        if (p[c.campo] === false) {
          out.push({ etapa: 'Control final', pallet: String(i + 1), control: c.nombre, corregido: !!p[c.repro], obs: p.obs || '' });
        }
      });
    });
    return out;
  }

  function estadoPorDictamen(dictamen) {
    return ESTADO_POR_DICTAMEN[dictamen] || 'activo';
  }

  // Modelos vacíos. Los nombres de campo son los de la versión vieja para que
  // quien conoce aquella planilla se ubique.
  function nuevoPalletLinea(num) {
    return {
      nPal: String(num), hora: '', p1: '', p2: '', p3: '', p4: '',
      lote: '', codProd: '', fProd: '', fVenc: '',
      indOK: null, indVal: '', repro: false,
      qrLineaOK: null, qrRepro: false, packOK: null, packRepro: false, pltOK: null, pltRepro: false,
      obs: ''
    };
  }

  function nuevoPalletFinal() {
    return {
      idOK: null, idRepro: false, qrOK: null, qrRepro: false,
      paletOK: null, paletRepro: false, indCFOK: null, indCFRepro: false,
      litrosParcial: '', obs: ''
    };
  }

  function nuevoLote(cab, cantPallets) {
    var final = [];
    for (var i = 0; i < cantPallets; i++) final.push(nuevoPalletFinal());
    return {
      estado: 'activo',
      cab: cab,
      linea: [nuevoPalletLinea(1)],
      final: { ltsPorPallet: '', pallets: final, dictamen: null, fechaDictamen: null, dictaminadoPor: '', dictaminadoRol: '' },
      hallazgos: [],
      cierreForzado: null
    };
  }

  return {
    CHECKS_FINAL: CHECKS_FINAL, CHECKS_LINEA: CHECKS_LINEA, PICOS: PICOS,
    hoy: hoy, fechaLarga: fechaLarga, numero: numero,
    semaforo: semaforo, pesoOK: pesoOK, promedioPeso: promedioPeso,
    estadoPalletLinea: estadoPalletLinea, estadoPalletFinal: estadoPalletFinal,
    resumenFinal: resumenFinal, sugerirDictamen: sugerirDictamen,
    palletsFaltantes: palletsFaltantes, normalizarCliente: normalizarCliente,
    desvios: desvios, estadoPorDictamen: estadoPorDictamen,
    nuevoLote: nuevoLote, nuevoPalletLinea: nuevoPalletLinea, nuevoPalletFinal: nuevoPalletFinal
  };
})();

// Para las pruebas con Node. En el navegador no existe "module" y se ignora.
if (typeof module !== 'undefined') module.exports = Reglas;
