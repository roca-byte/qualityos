/* Supabase falso, en memoria, SOLO para las pruebas de la interfaz.
 * Reemplaza a vendor/supabase.js cuando corre tests/e2e/flujo.js.
 * Imita lo justo que usa js/nube.js. Las reglas de verdad del servidor se
 * prueban contra Postgres en tests/sql/.
 * window.__db queda expuesto para que la prueba mire o "toque" el servidor.
 */
(function () {
  var db = JSON.parse(localStorage.getItem('__db') || 'null') || {
    usuarios: { 'checker@uno.com': { id: 'u-1', email: 'checker@uno.com', clave: 'secreta1', confirmado: true } },
    plataforma: ['u-1'],          // dueños de la plataforma: pueden crear empresas
    confirmarEmail: false,        // true = como Supabase con "Confirm email" activado
    empresas: [], miembros: [], invitaciones: [], lotes: []
  };
  var guardar = function () { localStorage.setItem('__db', JSON.stringify(db)); };
  window.__db = db;
  window.__dbGuardar = guardar;
  var sesion = JSON.parse(localStorage.getItem('__sesion') || 'null');

  function ok(data) { return Promise.resolve({ data: data, error: null }); }
  function err(msg) { return Promise.resolve({ data: null, error: { message: msg } }); }
  function sinRed() { return navigator.onLine === false; }

  function consulta(tabla) {
    var filtros = [], orden = null, limite = null, op = 'select', valores = null;
    var q = {
      select: function () { return q; },
      eq: function (k, v) { filtros.push(function (f) { return f[k] === v; }); return q; },
      gt: function (k, v) { filtros.push(function (f) { return f[k] > v; }); return q; },
      or: function () { return q; },
      order: function (k, o) { orden = { k: k, asc: !o || o.ascending !== false }; return q; },
      limit: function (n) { limite = n; return q; },
      update: function (v) { op = 'update'; valores = v; return q; },
      upsert: function (v) { op = 'upsert'; valores = v; return q; },
      delete: function () { op = 'delete'; return q; },
      then: function (res, rej) { return ejecutar().then(res, rej); }
    };
    function ejecutar() {
      if (sinRed()) return err('Failed to fetch');
      var filas = db[tabla].filter(function (f) { return filtros.every(function (fn) { return fn(f); }); });
      if (op === 'update') { filas.forEach(function (f) { Object.assign(f, valores); }); guardar(); return ok(null); }
      if (op === 'delete') { db[tabla] = db[tabla].filter(function (f) { return filas.indexOf(f) < 0; }); guardar(); return ok(null); }
      if (op === 'upsert') { db[tabla].push(valores); guardar(); return ok(null); }
      if (tabla === 'miembros') filas = filas.map(function (m) {
        var e = db.empresas.filter(function (x) { return x.id === m.empresa_id; })[0];
        return Object.assign({}, m, { empresas: { nombre: e.nombre, config: e.config } });
      });
      if (orden) filas.sort(function (a, b) { return (a[orden.k] > b[orden.k] ? 1 : -1) * (orden.asc ? 1 : -1); });
      if (limite) filas = filas.slice(0, limite);
      return ok(JSON.parse(JSON.stringify(filas)));
    }
    return q;
  }

  var rpcs = {
    aceptar_invitaciones: function (a) {
      var email = sesion.user.email;
      var mias = db.invitaciones.filter(function (i) { return i.email === email; });
      mias.forEach(function (i) {
        db.miembros.push({ empresa_id: i.empresa_id, user_id: sesion.user.id, nombre: (a.p_mi_nombre || '').trim(), rol: i.rol, activo: true });
      });
      db.invitaciones = db.invitaciones.filter(function (i) { return i.email !== email; });
      return mias.length;
    },
    puedo_crear_empresas: function () { return db.plataforma.indexOf(sesion.user.id) >= 0; },
    crear_empresa: function (a) {
      if (db.plataforma.indexOf(sesion.user.id) < 0) throw new Error('Solo el administrador de QualityOS puede crear empresas. Pedí que te inviten.');
      var id = 'e-' + (db.empresas.length + 1);
      db.empresas.push({ id: id, nombre: a.p_nombre, config: {} });
      db.miembros.push({ empresa_id: id, user_id: sesion.user.id, nombre: a.p_mi_nombre, rol: 'admin', activo: true });
      return id;
    },
    cambiar_mi_nombre: function (a) {
      db.miembros.forEach(function (m) {
        if (m.empresa_id === a.p_empresa && m.user_id === sesion.user.id) m.nombre = a.p_nombre.trim();
      });
      return null;
    },
    guardar_lote: function (a) {
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
    }
  };

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () { return ok({ session: sesion }); },
          signInWithPassword: function (c) {
            if (sinRed()) return err('Failed to fetch');
            var u = db.usuarios[c.email];
            if (!u || u.clave !== c.password) return err('Invalid login credentials');
            if (!u.confirmado) return err('Email not confirmed');
            sesion = { user: { id: u.id, email: u.email } };
            localStorage.setItem('__sesion', JSON.stringify(sesion));
            return ok({ user: sesion.user, session: sesion });
          },
          signUp: function (c) {
            if (sinRed()) return err('Failed to fetch');
            if (db.usuarios[c.email]) return err('User already registered');
            if (String(c.password).length < 6) return err('Password should be at least 6 characters');
            var u = { id: 'u-' + (Object.keys(db.usuarios).length + 1), email: c.email, clave: c.password, confirmado: !db.confirmarEmail };
            db.usuarios[c.email] = u;
            guardar();
            if (!u.confirmado) return ok({ user: { id: u.id, email: u.email }, session: null });
            sesion = { user: { id: u.id, email: u.email } };
            localStorage.setItem('__sesion', JSON.stringify(sesion));
            return ok({ user: sesion.user, session: sesion });
          },
          signOut: function () { sesion = null; localStorage.removeItem('__sesion'); return ok(null); }
        },
        from: consulta,
        rpc: function (nombre, args) {
          if (sinRed()) return err('Failed to fetch');
          var r;
          try { r = rpcs[nombre](args || {}); } catch (e) { return err(e.message); }
          guardar();
          return ok(JSON.parse(JSON.stringify(r)));
        }
      };
    }
  };
})();
