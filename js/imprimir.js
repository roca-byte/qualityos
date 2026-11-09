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

  // Columnas de una tabla según los ítems de la plantilla. Una medición con varias lecturas
  // ocupa una columna por lectura (ej.: P1..P4) más la de resultado.
  function cabeceras(items, cab) {
    var arriba = '', abajo = '';
    items.forEach(function (it) {
      var titulo = esc(it.nombre) + (it.unidad ? ' (' + esc(it.unidad) + ')' : '');
      var r = Reglas.rango(it, cab);
      if (r) titulo += '<br><small>' + (isNaN(r.min) ? '' : esc(r.min)) + '–' + (isNaN(r.max) ? '' : esc(r.max)) + '</small>';
      var n = it.tipo === 'medicion' ? Reglas.lecturas(it, null).length : 1;
      if (it.tipo === 'medicion' && n > 1) {
        arriba += '<th colspan="' + (n + 1) + '">' + titulo + '</th>';
        for (var j = 0; j < n; j++) abajo += '<th>' + (j + 1) + '</th>';
        abajo += '<th>OK</th>';
      } else {
        arriba += '<th rowspan="2">' + titulo + '</th>';
      }
    });
    return { arriba: arriba, abajo: abajo };
  }

  function celdas(items, u, cab) {
    return items.map(function (it) {
      var v = u.v[it.id];
      var e = Reglas.evaluar(it, v, u.r[it.id], cab);
      if (it.tipo === 'okNok') return '<td>' + check(v, u.r[it.id]) + '</td>';
      if (it.tipo === 'medicion') {
        var ls = Reglas.lecturas(it, v);
        var res = e.estado === 'nok' ? '<b class="i-nok">NOK</b>' : e.estado === 'repro' ? '<b class="i-repro">↻ REPRO</b>' :
          e.estado === 'ok' ? 'OK' : '—';
        var sem = e.sem ? ' <span class="i-sem ' + e.sem + '"></span>' : '';
        if (ls.length > 1) return ls.map(function (x) { return '<td>' + esc(x) + '</td>'; }).join('') + '<td>' + res + '</td>';
        return '<td>' + (ls[0] ? esc(ls[0]) + sem + (e.estado === 'nok' || e.estado === 'repro' ? ' ' + res : '') : '—') + '</td>';
      }
      if (it.tipo === 'fecha') return '<td>' + esc(Reglas.fechaLarga(v)) + '</td>';
      return '<td>' + esc(v || '') + '</td>';
    }).join('');
  }

  function columnas(items) {
    return items.reduce(function (n, it) {
      var l = it.tipo === 'medicion' ? Reglas.lecturas(it, null).length : 1;
      return n + (l > 1 ? l + 1 : 1);
    }, 0);
  }

  function html(lote, config, empresa) {
    var l = lote.datos;
    var cab = l.cab, p = l.plantilla;
    var res = Reglas.resumenFinal(l);
    // Codificación de la plantilla que el lote guardó: un lote viejo sale con la versión
    // con la que se hizo, aunque la plantilla ya vaya por otra.
    var doc = Reglas.docDe(p, config);
    var rangos = p.linea.concat(p.final).filter(function (it) { return it.tipo === 'medicion' && it.tolerancia === 'lote' && Reglas.rango(it, cab); })
      .map(function (it) {
        var r = Reglas.rango(it, cab);
        return esc(it.nombre) + ': ' + (isNaN(r.min) ? '' : esc(r.min)) + '–' + (isNaN(r.max) ? '' : esc(r.max)) + (it.unidad ? ' ' + esc(it.unidad) : '');
      }).join(' · ');

    var encabezado =
      '<table class="i-cab"><tr>' +
      '<td class="i-empresa">' + esc(empresa) + '</td>' +
      '<td class="i-titulo">Control de Calidad de Lote<br><small>' + esc(p.nombre) + '</small></td>' +
      '<td class="i-doc">Código: ' + esc(doc.codigo || '—') + '<br>Versión: ' + esc(doc.version || '—') +
      (doc.vigencia ? '<br>Vigencia: ' + esc(Reglas.fechaLarga(doc.vigencia)) : '') + '</td>' +
      '</tr></table>';

    var datos =
      '<table class="i-tabla"><tr>' +
      '<th>Producto</th><td>' + esc(cab.prod) + '</td><th>N° de lote</th><td>' + esc(cab.lote) + '</td>' +
      '<th>Cliente</th><td>' + esc(cab.cliente || '—') + '</td></tr><tr>' +
      '<th>Línea</th><td>' + esc(cab.linea || '—') + '</td><th>Fecha</th><td>' + esc(Reglas.fechaLarga(cab.fecha)) + '</td>' +
      '<th>Inspector de Calidad</th><td>' + esc(cab.checker || '—') + '</td></tr><tr>' +
      (Reglas.textoDatos(p, cab).length ? '<th>Datos del lote</th><td colspan="5">' + Reglas.textoDatos(p, cab).map(esc).join(' · ') + '</td></tr><tr>' : '') +
      '<th>Rangos del lote</th><td colspan="3">' + (rangos || '—') + '</td>' +
      '<th>Estado</th><td><b>' + esc(String(l.estado).replace('_', ' ').toUpperCase()) + '</b></td>' +
      '</tr></table>';

    var linea = '';
    if (p.linea.length) {
      var hl = cabeceras(p.linea, cab);
      var filasLinea = l.linea.map(function (u, i) {
        var fila = '<tr class="i-' + Reglas.estadoUnidadLinea(p.linea, u, cab) + '"><td>' + (i + 1) + '</td><td>' + esc(u.n) + '</td><td>' + esc(u.hora) + '</td>' +
          celdas(p.linea, u, cab) + '</tr>';
        if (u.obs) fila += '<tr><td></td><td colspan="' + (columnas(p.linea) + 2) + '" class="i-obs">↳ ' + esc(u.obs) + '</td></tr>';
        return fila;
      }).join('');
      linea = '<h3>Control en línea · ' + l.linea.length + ' ' + esc(String(l.linea.length === 1 ? p.unidad : p.unidades).toLowerCase()) +
        (Reglas.textoFrecuencia(p) ? ' · ' + esc(Reglas.textoFrecuencia(p)) : '') + '</h3>' +
        '<table class="i-tabla i-chica"><thead><tr><th rowspan="2">#</th><th rowspan="2">' + esc(p.unidad) + '</th><th rowspan="2">Hora</th>' +
        hl.arriba + '</tr><tr>' + hl.abajo + '</tr></thead><tbody>' + filasLinea + '</tbody></table>';
    }

    var final = '';
    if (p.final.length) {
      var hf = cabeceras(p.final, cab);
      var conCant = !!p.cantidad;
      var filasFinal = l.final.unidades.map(function (u, i) {
        var fila = '<tr class="i-' + Reglas.estadoUnidadFinal(p.final, u, cab) + '"><td>' + (i + 1) + '</td>' + celdas(p.final, u, cab) +
          (conCant ? '<td>' + esc(u.cant || l.final.cantPorUnidad || '—') + '</td>' : '') + '</tr>';
        if (u.obs) fila += '<tr><td></td><td colspan="' + (columnas(p.final) + (conCant ? 1 : 0)) + '" class="i-obs">↳ ' + esc(u.obs) + '</td></tr>';
        return fila;
      }).join('');
      var cantidad = function (c, n) { return c !== null ? Math.round(c * 100) / 100 + ' ' + esc(p.cantidad) : n + ' ' + esc(String(n === 1 ? p.unidad : p.unidades).toLowerCase()); };
      final = '<h3>Control final · ' + l.final.unidades.length + ' ' + esc(String(l.final.unidades.length === 1 ? p.unidad : p.unidades).toLowerCase()) + '</h3>' +
        '<table class="i-tabla i-chica"><thead><tr><th rowspan="2">#</th>' + hf.arriba +
        (conCant ? '<th rowspan="2">Cantidad (' + esc(p.cantidad) + ')</th>' : '') + '</tr><tr>' + hf.abajo + '</tr></thead><tbody>' + filasFinal + '</tbody></table>' +
        '<p class="i-resumen">Aprobado: <b>' + cantidad(res.cantAprobada, res.aprobados) + '</b> · Retenido: <b>' +
        cantidad(res.cantRetenida, res.retenidos) + '</b>' + (res.pendientes ? ' · Sin controlar: <b>' + res.pendientes + '</b>' : '') + '</p>';
    }

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
      (l.cierreForzado ? '<tr><td colspan="6">⚠ Dictaminado con ' + esc(l.cierreForzado.faltantes) + ' ' + esc(p.unidades.toLowerCase()) +
        ' sin completar, autorizado por ' + esc(l.cierreForzado.por) + '</td></tr>' : '') +
      '<tr><th>Elaboró</th><td>' + esc(doc.elaboro || '') + '</td><th>Aprobó</th><td colspan="3">' + esc(doc.aprobo || '') + '</td></tr></table>';

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

  // ── Registro de No Conformidades (un mes, o las abiertas) ──
  // lista: [{ numero, datos }] ya filtrada y ordenada. titulo: "Noviembre 2026" o "NC abiertas al …".
  // Dos partes como el registro en papel: la planilla de NC y las acciones con su cierre y eficacia.
  function htmlRegistroNc(lista, titulo, config, empresa) {
    var k = Reglas.kpisNc(lista.map(function (n) { return n.datos; }));
    var est = function (d) { return Reglas.NC_ESTADOS[d.estado] || d.estado; };
    var cant = function (d) { return d.cantNC ? esc(d.cantNC) + (d.cantTot ? ' / ' + esc(d.cantTot) : '') + (d.unidadCant ? ' ' + esc(d.unidadCant) : '') : '—'; };
    var vacio = '<tr><td colspan="9" style="text-align:center">Sin NC en este período</td></tr>';
    var filas = lista.map(function (n) {
      var d = n.datos;
      return '<tr class="' + (d.estado === 'anulada' ? 'i-vacio' : d.sev === 'Crítico' ? 'i-nok' : '') + '">' +
        '<td>' + esc(n.numero || 'sin número') + '</td><td>' + esc(Reglas.fechaLarga(d.fecha)) + '</td>' +
        '<td>' + esc(d.lote || '—') + (d.prod ? '<br><small>' + esc(d.prod) + '</small>' : '') + '</td>' +
        '<td>' + esc(d.deteccion || '—') + '</td><td>' + esc(d.tipo || '—') + '</td><td>' + esc(d.sev || '—') + '</td>' +
        '<td>' + esc(d.desc) + '</td><td>' + cant(d) + '</td><td>' + esc(est(d)) + '</td></tr>';
    }).join('') || vacio;
    var acciones = lista.filter(function (n) { return n.datos.estado !== 'anulada'; }).map(function (n) {
      var d = n.datos;
      return '<tr><td>' + esc(n.numero || 'sin número') + '</td><td>' + esc(d.ac || '—') + '</td><td>' + esc(d.resp || '—') + '</td>' +
        '<td>' + esc(Reglas.fechaLarga(d.plazo) || '—') + '</td><td>' + esc(Reglas.fechaLarga(d.cierre) || '—') + '</td>' +
        '<td>' + esc(est(d)) + (d.cerradaPor ? '<br><small>' + esc(d.cerradaPor) + '</small>' : '') + '</td>' +
        '<td>' + esc(Reglas.EFICACIA[d.eficacia] || '—') + '</td></tr>';
    }).join('') || vacio;
    return '<div class="informe">' +
      '<table class="i-cab"><tr><td class="i-empresa">' + esc(empresa) + '</td>' +
      '<td class="i-titulo">Registro de No Conformidades<br><small>' + esc(titulo) + '</small></td>' +
      '<td class="i-doc">Código: ' + esc(config.ncCodigo || '—') + '<br>Versión: ' + esc(config.ncVersion || '—') + '</td></tr></table>' +
      '<p class="i-resumen">NC: <b>' + k.total + '</b> · Abiertas: <b>' + k.abiertas + '</b>' +
      (k.vencidas ? ' · Con plazo vencido: <b>' + k.vencidas + '</b>' : '') +
      ' · Leve ' + k.sev.Leve + ' · Moderado ' + k.sev.Moderado + ' · Crítico ' + k.sev['Crítico'] +
      (k.masFrecuente ? ' · Más frecuente: <b>' + esc(k.masFrecuente.tipo) + '</b> (' + k.masFrecuente.pct + ' %)' : '') +
      (k.enPlazo !== null ? ' · Cerradas en plazo: <b>' + k.enPlazo + ' %</b>' : '') +
      (k.tasa !== null ? ' · Cantidad no conforme: <b>' + k.tasa + ' %</b>' : '') + '</p>' +
      '<table class="i-tabla i-chica"><thead><tr><th>N°</th><th>Fecha</th><th>Lote / producto</th><th>Detección</th><th>Tipo de desvío</th>' +
      '<th>Gravedad</th><th>Descripción</th><th>Cantidad NC / total</th><th>Estado</th></tr></thead><tbody>' + filas + '</tbody></table>' +
      '<h3>Acciones, cierre y verificación de eficacia (ISO 9001, 10.2)</h3>' +
      '<table class="i-tabla i-chica"><thead><tr><th>N°</th><th>Acción correctiva / disposición</th><th>Responsable</th><th>Plazo</th>' +
      '<th>Cierre</th><th>Estado</th><th>Eficacia</th></tr></thead><tbody>' + acciones + '</tbody></table>' +
      '<table class="i-tabla i-firma"><tr><th>Inspector de Calidad</th><td></td><th>Coordinación de Calidad</th><td></td>' +
      '<th>Revisión SGC / Gerencia</th><td></td></tr></table>' +
      '<div class="i-pie">QualityOS · ' + esc(empresa) + '</div></div>';
  }

  function registroNc(lista, titulo, config, empresa) {
    document.getElementById('imprimir').innerHTML = htmlRegistroNc(lista, titulo, config, empresa);
    document.title = 'Registro de NC - ' + titulo;
    window.print();
    document.title = 'QualityOS';
  }

  return { esc: esc, html: html, lote: lote, htmlRegistroNc: htmlRegistroNc, registroNc: registroNc };
})();
