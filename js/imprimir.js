/* Imprimir: arma el registro del lote para imprimir o guardar como PDF.
 * Solo lee datos; no cambia nada. Todo texto cargado por el usuario pasa por
 * esc() antes de ir al HTML (en la versión vieja no, y se podía inyectar código).
 */
var Imprimir = (function () {
  'use strict';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function check(ok, repro) {
    if (ok === false && repro) return '<b class="i-repro">↻ REPRO</b>';
    if (ok === false) return '<b class="i-nok">✗ NOK</b>';
    if (ok === true) return '<b class="i-ok">✓ OK</b>';
    return '<span class="i-vacio">—</span>';
  }

  var DICTAMEN_TXT = { APROBADO: 'APROBADO', APROBADO_PARCIAL: 'APROBADO PARCIAL', RETENIDO: 'RETENIDO' };

  function html(lote, config, empresa) {
    var l = lote.datos;
    var cab = l.cab;
    var ind = (config.inductoras || []).filter(function (i) { return i.id === cab.indId; })[0] || { nombre: '—' };
    var res = Reglas.resumenFinal(l);

    var encabezado =
      '<table class="i-cab"><tr>' +
      '<td class="i-empresa">' + esc(empresa) + '</td>' +
      '<td class="i-titulo">Control de Calidad de Lote<br><small>Control en línea y producto final</small></td>' +
      '<td class="i-doc">Código: ' + esc(config.docCodigo || 'REG-01') + '<br>Versión: ' + esc(config.docVersion || '00') + '</td>' +
      '</tr></table>';

    var datos =
      '<table class="i-tabla"><tr>' +
      '<th>Producto</th><td>' + esc(cab.prod) + '</td><th>N° de lote</th><td>' + esc(cab.lote) + '</td>' +
      '<th>Cliente</th><td>' + esc(cab.cliente || '—') + '</td></tr><tr>' +
      '<th>Línea</th><td>' + esc(cab.linea || '—') + '</td><th>Fecha</th><td>' + esc(Reglas.fechaLarga(cab.fecha)) + '</td>' +
      '<th>Inductora</th><td>' + esc(ind.nombre) + (ind.tolMin !== undefined ? ' (' + esc(ind.tolMin) + '–' + esc(ind.tolMax) + ')' : '') + '</td></tr><tr>' +
      '<th>Peso por pico</th><td>' + (cab.pesoMin ? esc(cab.pesoMin) + '–' + esc(cab.pesoMax) + ' kg' : '—') + '</td>' +
      '<th>Inspector de Calidad</th><td>' + esc(cab.checker || '—') + '</td><th>Estado</th><td><b>' + esc(String(l.estado).replace('_', ' ').toUpperCase()) + '</b></td>' +
      '</tr></table>';

    var filasLinea = (l.linea || []).map(function (p, i) {
      var peso = Reglas.pesoOK(p, cab);
      var sem = Reglas.semaforo(p.indVal, ind);
      var fila = '<tr class="i-' + Reglas.estadoPalletLinea(p, cab) + '">' +
        '<td>' + (i + 1) + '</td><td>' + esc(p.nPal) + '</td><td>' + esc(p.hora) + '</td>' +
        Reglas.PICOS.map(function (k) { return '<td>' + esc(p[k]) + '</td>'; }).join('') +
        '<td>' + (peso === false ? '<b class="i-nok">NOK</b>' : peso ? 'OK' : '—') + '</td>' +
        '<td>' + esc(p.lote) + '</td><td>' + esc(p.codProd) + '</td><td>' + esc(Reglas.fechaLarga(p.fProd)) + '</td><td>' + esc(Reglas.fechaLarga(p.fVenc)) + '</td>' +
        '<td>' + check(p.indOK, p.repro) + '</td><td>' + esc(p.indVal || '—') + (sem ? ' <span class="i-sem ' + sem + '"></span>' : '') + '</td>' +
        '<td>' + check(p.qrLineaOK, p.qrRepro) + '</td><td>' + check(p.packOK, p.packRepro) + '</td><td>' + check(p.pltOK, p.pltRepro) + '</td></tr>';
      if (p.obs) fila += '<tr><td></td><td colspan="18" class="i-obs">↳ ' + esc(p.obs) + '</td></tr>';
      return fila;
    }).join('');

    var linea =
      '<h3>Control en línea · ' + (l.linea || []).length + ' pallets</h3>' +
      '<table class="i-tabla i-chica"><thead><tr>' +
      '<th rowspan="2">#</th><th rowspan="2">Pallet</th><th rowspan="2">Hora</th>' +
      '<th colspan="5">Peso por pico (kg)</th><th colspan="4">Identificación</th><th colspan="2">Inducción</th><th colspan="3">Control en línea</th></tr><tr>' +
      '<th>P1</th><th>P2</th><th>P3</th><th>P4</th><th>OK</th><th>Lote</th><th>Cód.</th><th>F. prod.</th><th>F. venc.</th>' +
      '<th>OK/NOK</th><th>Valor</th><th>QR</th><th>Pack</th><th>Plt</th></tr></thead><tbody>' + filasLinea + '</tbody></table>';

    var filasFinal = ((l.final && l.final.pallets) || []).map(function (p, i) {
      var fila = '<tr class="i-' + Reglas.estadoPalletFinal(p) + '"><td>' + (i + 1) + '</td>' +
        Reglas.CHECKS_FINAL.map(function (c) { return '<td>' + check(p[c.campo], p[c.repro]) + '</td>'; }).join('') +
        '<td>' + esc(p.litrosParcial || l.final.ltsPorPallet || '—') + '</td></tr>';
      if (p.obs) fila += '<tr><td></td><td colspan="5" class="i-obs">↳ ' + esc(p.obs) + '</td></tr>';
      return fila;
    }).join('');

    var cantidad = function (lts, pal) { return lts !== null ? Math.round(lts) + ' L' : pal + ' pallets'; };
    var final =
      '<h3>Control final · ' + ((l.final && l.final.pallets) || []).length + ' pallets</h3>' +
      '<table class="i-tabla i-chica"><thead><tr><th>#</th>' +
      Reglas.CHECKS_FINAL.map(function (c) { return '<th>' + esc(c.nombre) + '</th>'; }).join('') +
      '<th>Litros</th></tr></thead><tbody>' + filasFinal + '</tbody></table>' +
      '<p class="i-resumen">Aprobado: <b>' + cantidad(res.ltsAprobados, res.aprobados) + '</b> · Retenido: <b>' +
      cantidad(res.ltsRetenidos, res.retenidos) + '</b>' + (res.pendientes ? ' · Sin controlar: <b>' + res.pendientes + '</b>' : '') + '</p>';

    var obs = (l.hallazgos || []).length
      ? '<h3>Observaciones</h3><ul class="i-hallazgos">' + l.hallazgos.map(function (h) {
          return '<li><small>' + esc(h.ts) + ' · ' + esc(h.autor || '') + '</small><br>' + esc(h.txt) + '</li>';
        }).join('') + '</ul>'
      : '';

    var f = l.final || {};
    var dictamen =
      '<table class="i-tabla i-firma"><tr>' +
      '<th>Dictamen</th><td><b>' + esc(DICTAMEN_TXT[f.dictamen] || 'SIN DICTAMEN') + '</b></td>' +
      '<th>Dictaminó</th><td>' + esc(f.dictaminadoPor || '—') + (f.dictaminadoRol ? ' (' + esc(f.dictaminadoRol) + ')' : '') + '</td>' +
      '<th>Fecha</th><td>' + esc(f.fechaDictamen || '—') + '</td></tr>' +
      (l.cierreForzado ? '<tr><td colspan="6">⚠ Dictaminado con ' + esc(l.cierreForzado.faltantes) +
        ' pallet(s) sin completar, autorizado por ' + esc(l.cierreForzado.por) + '</td></tr>' : '') +
      '<tr><th>Elaboró</th><td>' + esc(config.docElab || '') + '</td><th>Aprobó</th><td colspan="3">' + esc(config.docAprob || '') + '</td></tr></table>';

    return '<div class="informe">' + encabezado + datos + linea + final + obs + dictamen +
      '<div class="i-pie">QualityOS · ' + esc(empresa) + '</div></div>';
  }

  // Dibuja el informe en #imprimir y abre el diálogo del navegador
  // (ahí se elige "Guardar como PDF").
  function lote(l, config, empresa) {
    var cont = document.getElementById('imprimir');
    cont.innerHTML = html(l, config, empresa);
    document.title = 'Lote ' + l.datos.cab.lote + ' - ' + l.datos.cab.prod;
    window.print();
    document.title = 'QualityOS';
  }

  return { esc: esc, html: html, lote: lote };
})();
