/* Editor: formulario para armar una plantilla de control (⚙ → Plantillas).
 *
 * html(p)  dibuja el formulario de la plantilla p.
 * leer(f)  arma de nuevo la plantilla con lo que hay escrito en el formulario.
 * Cada vez que se agrega, quita o mueve un ítem, app.js primero LEE el formulario (para no
 * perder lo tipeado) y después vuelve a dibujarlo con el cambio.
 */
var Editor = (function () {
  'use strict';

  var esc = function (s) { return Imprimir.esc(s); };

  function opciones(lista, elegido) {
    return lista.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(elegido) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }

  var TIPOS = [['okNok', 'OK / NOK'], ['medicion', 'Medición (número)'], ['texto', 'Texto'], ['fecha', 'Fecha']];
  var TOLERANCIAS = [['lote', 'Se carga en cada lote'], ['fija', 'Fija (mín. y máx. acá)'], ['ninguna', 'Sin tolerancia (solo registrar)']];

  function htmlItem(sec, it, i, total) {
    var base = 'data-sec="' + sec + '" data-i="' + i + '"';
    var med = it.tipo === 'medicion';
    var h = '<div class="ed-item" ' + base + ' data-id="' + esc(it.id) + '">' +
      '<div class="ed-cab"><b>' + (i + 1) + '</b>' +
      '<button type="button" class="btn chico" data-act="item-mover" ' + base + ' data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir">↑</button>' +
      '<button type="button" class="btn chico" data-act="item-mover" ' + base + ' data-d="1"' + (i === total - 1 ? ' disabled' : '') + ' aria-label="Bajar">↓</button>' +
      '<button type="button" class="btn chico peligro" data-act="item-quitar" ' + base + ' aria-label="Quitar ítem">✕</button></div>' +
      '<div class="fila2"><label>Qué se controla<input name="nombre" required value="' + esc(it.nombre) + '" placeholder="Ej.: Peso neto"></label>' +
      '<label>Tipo<select name="tipo" data-act-change="editor">' + opciones(TIPOS, it.tipo) + '</select></label></div>';
    if (med) {
      h += '<div class="fila2"><label>Unidad de medida<input name="unidad" value="' + esc(it.unidad || '') + '" placeholder="kg, °C, ml…"></label>' +
        '<label>Lecturas por unidad<input name="lecturas" type="number" min="1" max="8" value="' + esc(it.lecturas || 1) + '"></label></div>' +
        '<label>Tolerancia<select name="tolerancia" data-act-change="editor">' + opciones(TOLERANCIAS, it.tolerancia || 'lote') + '</select></label>';
      if (it.tolerancia === 'fija') {
        h += '<div class="fila2"><label>Mínimo<input name="min" inputmode="decimal" value="' + esc(it.min) + '"></label>' +
          '<label>Máximo<input name="max" inputmode="decimal" value="' + esc(it.max) + '"></label></div>';
      }
      if (it.tolerancia !== 'ninguna') {
        h += '<label class="inline"><input type="checkbox" name="semaforo"' + (it.semaforo ? ' checked' : '') + '> Mostrar semáforo (verde / amarillo / rojo)</label>';
      }
    }
    if (it.tipo === 'okNok' || med) {
      h += '<label class="inline"><input type="checkbox" name="reproceso"' + (it.reproceso ? ' checked' : '') + '> Permite marcar "reprocesado"</label>';
    }
    if (sec === 'final') {
      h += '<label class="inline"><input type="checkbox" name="obligatorio"' + (it.obligatorio !== false ? ' checked' : '') + '> Obligatorio para dictaminar</label>';
    }
    return h + '</div>';
  }

  // Un dato del lote (cabecera): nombre, tipo y, si es lista, sus opciones separadas por coma.
  var TIPOS_DATO = [['texto', 'Texto'], ['lista', 'Lista de opciones'], ['numero', 'Número'], ['fecha', 'Fecha']];
  function htmlDato(it, i, total) {
    var base = 'data-sec="cabecera" data-i="' + i + '"';
    return '<div class="ed-item" ' + base + ' data-id="' + esc(it.id) + '">' +
      '<div class="ed-cab"><b>' + (i + 1) + '</b>' +
      '<button type="button" class="btn chico" data-act="item-mover" ' + base + ' data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir">↑</button>' +
      '<button type="button" class="btn chico" data-act="item-mover" ' + base + ' data-d="1"' + (i === total - 1 ? ' disabled' : '') + ' aria-label="Bajar">↓</button>' +
      '<button type="button" class="btn chico peligro" data-act="item-quitar" ' + base + ' aria-label="Quitar dato">✕</button></div>' +
      '<div class="fila2"><label>Dato<input name="nombre" required value="' + esc(it.nombre) + '" placeholder="Ej.: Inductora, Equipo, Turno"></label>' +
      '<label>Tipo<select name="tipo" data-act-change="editor">' + opciones(TIPOS_DATO, it.tipo) + '</select></label></div>' +
      (it.tipo === 'lista' ? '<label>Opciones (separadas por coma)<input name="opciones" value="' + esc((it.opciones || []).join(', ')) +
        '" placeholder="Ej.: Inductora 1, Inductora 2"></label>' : '') +
      '<label class="inline"><input type="checkbox" name="obligatorio"' + (it.obligatorio ? ' checked' : '') + '> Obligatorio para crear el lote</label></div>';
  }

  // Codificación del registro (ISO 9001, 7.5): código, versión, vigencia, quién elaboró y
  // aprobó, y el historial de versiones (solo lectura: lo completa la app al guardar).
  function htmlDoc(doc, cambio) {
    var hist = (doc.historial || []).slice().reverse();
    return '<h3>Codificación del registro</h3>' +
      '<p class="ayuda">Sale en el encabezado y el pie del PDF de cada lote. Cada lote conserva la versión con la que se hizo.</p>' +
      '<div class="fila2"><label>Código *<input name="d-codigo" required value="' + esc(doc.codigo) + '" placeholder="REG-01"></label>' +
      '<label>Versión *<input name="d-version" required value="' + esc(doc.version) + '"></label></div>' +
      '<label>Vigente desde<input name="d-vigencia" type="date" value="' + esc(doc.vigencia) + '"></label>' +
      '<div class="fila2"><label>Elaboró<input name="d-elaboro" value="' + esc(doc.elaboro) + '"></label>' +
      '<label>Aprobó<input name="d-aprobo" value="' + esc(doc.aprobo) + '"></label></div>' +
      '<label>Qué cambió en esta versión (queda en el historial)<input name="d-cambio" value="' + esc(cambio || '') + '" placeholder="Ej.: se agrega control de torque"></label>' +
      (hist.length ? '<details class="historial"><summary>Historial de versiones (' + hist.length + ')</summary><ul>' + hist.map(function (h) {
        return '<li><b>Versión ' + esc(h.version) + '</b> · ' + esc(h.fecha.split('-').reverse().join('/')) + (h.por ? ' · ' + esc(h.por) : '') +
          (h.cambio ? '<br>' + esc(h.cambio) : '') + '</li>';
      }).join('') + '</ul></details>' : '');
  }

  function html(p, esNueva, doc) {
    var seccion = function (sec, titulo, ayuda) {
      return '<h3>' + titulo + '</h3><p class="ayuda">' + ayuda + '</p>' +
        p[sec].map(function (it, i) { return htmlItem(sec, it, i, p[sec].length); }).join('') +
        '<button type="button" class="btn" data-act="item-agregar" data-sec="' + sec + '">+ Ítem</button>';
    };
    return '<section class="tarjeta"><h2>' + (esNueva ? 'Nueva plantilla' : 'Editar plantilla') + '</h2>' +
      '<form data-form="plantilla" class="editor">' +
      '<label>Nombre de la plantilla<input name="p-nombre" required value="' + esc(p.nombre) + '" placeholder="Ej.: Envasado de jugos"></label>' +
      '<div class="fila2"><label>Qué se controla (singular)<input name="p-unidad" required value="' + esc(p.unidad) + '" placeholder="Pallet, Caja, Muestra"></label>' +
      '<label>Plural<input name="p-unidades" required value="' + esc(p.unidades) + '" placeholder="Pallets, Cajas, Muestras"></label></div>' +
      '<div class="fila2"><label>Cantidad por unidad, en<input name="p-cantidad" value="' + esc(p.cantidad || '') + '" placeholder="L, kg, unid. (vacío = no se usa)"></label>' +
      '<label>Unidades del control final (por defecto)<input name="p-cantFinal" type="number" min="0" max="200" value="' + esc(p.cantFinal || 12) + '"></label></div>' +
      htmlDoc(doc, p.cambio) +
      '<h3>Datos del lote</h3><p class="ayuda">Lo que se completa al crear el lote además de producto, lote, cliente y línea ' +
      '(equipo, inductora, turno…). Sale en la cabecera del lote y en el PDF.</p>' +
      (p.cabecera || []).map(function (it, i) { return htmlDato(it, i, p.cabecera.length); }).join('') +
      '<button type="button" class="btn" data-act="item-agregar" data-sec="cabecera">+ Dato del lote</button>' +
      seccion('linea', 'Control en línea', 'Lo que se revisa mientras la línea produce, unidad por unidad.') +
      seccion('final', 'Control final', 'Lo que se revisa antes del despacho. Los obligatorios tienen que estar completos para dictaminar.') +
      '<p class="ayuda">Los lotes ya creados no cambian: cada uno guarda la plantilla con la que se hizo.</p>' +
      '<div class="acciones"><button type="button" class="btn" data-act="config">Cancelar</button>' +
      '<button class="btn primario" type="submit">Guardar plantilla</button></div>' +
      '</form></section>';
  }

  // Lee el formulario y devuelve la plantilla (conserva id y lo que no está en pantalla).
  function leer(f, anterior) {
    var p = JSON.parse(JSON.stringify(anterior));
    var val = function (n) { var e = f.querySelector('[name="' + n + '"]'); return e ? e.value.trim() : ''; };
    p.nombre = val('p-nombre');
    p.unidad = val('p-unidad');
    p.unidades = val('p-unidades');
    p.cantidad = val('p-cantidad');
    p.cantFinal = Math.max(0, Math.min(200, parseInt(val('p-cantFinal'), 10) || 0));
    p.doc = { codigo: val('d-codigo'), version: val('d-version'), vigencia: val('d-vigencia'),
      elaboro: val('d-elaboro'), aprobo: val('d-aprobo'), historial: (anterior.doc && anterior.doc.historial) || [] };
    // El motivo del cambio no es parte de la plantilla: app.js lo pasa al historial al guardar.
    p.cambio = val('d-cambio');
    p.cabecera = [].map.call(f.querySelectorAll('.ed-item[data-sec="cabecera"]'), function (div) {
      var v = function (n) { var e = div.querySelector('[name="' + n + '"]'); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : undefined; };
      var previo = (anterior.cabecera || []).filter(function (x) { return x.id === div.dataset.id; })[0] || {};
      var tipo = v('tipo');
      // Si se pasa a lista y todavía no se escribieron opciones, se conservan las que tenía.
      var ops = v('opciones') !== undefined ? v('opciones').split(',') : (previo.opciones || []);
      return { id: div.dataset.id, nombre: v('nombre'), tipo: tipo,
        opciones: tipo === 'lista' ? ops.map(function (o) { return String(o).trim(); }).filter(Boolean) : [],
        obligatorio: !!v('obligatorio') };
    });
    ['linea', 'final'].forEach(function (sec) {
      p[sec] = [].map.call(f.querySelectorAll('.ed-item[data-sec="' + sec + '"]'), function (div) {
        var v = function (n) { var e = div.querySelector('[name="' + n + '"]'); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : undefined; };
        var previo = anterior[sec].filter(function (x) { return x.id === div.dataset.id; })[0] || {};
        var it = { id: div.dataset.id, nombre: v('nombre'), tipo: v('tipo') };
        if (it.tipo === 'medicion') {
          it.unidad = v('unidad') !== undefined ? v('unidad') : (previo.unidad || '');
          it.lecturas = Math.max(1, Math.min(8, parseInt(v('lecturas'), 10) || 1));
          it.tolerancia = v('tolerancia') || 'lote';
          it.min = v('min') !== undefined ? v('min') : (previo.min || '');
          it.max = v('max') !== undefined ? v('max') : (previo.max || '');
          it.semaforo = v('semaforo') !== undefined ? v('semaforo') : !!previo.semaforo;
        }
        if (it.tipo === 'okNok' || it.tipo === 'medicion') it.reproceso = v('reproceso') !== undefined ? v('reproceso') : previo.reproceso !== false;
        it.obligatorio = sec === 'final' ? v('obligatorio') !== false : true;
        return it;
      });
    });
    return p;
  }

  return { html: html, leer: leer };
})();
