/* Nube: todo lo que habla con Supabase está en este archivo.
 *
 * En la versión vieja las llamadas a Firebase estaban en 7 archivos distintos.
 * Juntarlas acá hace que cambiar de servicio (o probar la app sin él) sea
 * reescribir un solo archivo.
 */
var Nube = (function () {
  'use strict';

  var cliente = null;
  var sincronizando = false;
  // Al bajar cambios se pide un poco hacia atrás: una transacción que empezó
  // antes puede confirmarse después y quedaría afuera.
  var SOLAPAMIENTO_MS = 2 * 60 * 1000;
  var DIAS_PRIMERA_BAJADA = 60;

  function configurada() {
    var c = window.QOS_CONFIG || {};
    return !!(c.supabaseUrl && c.supabaseKey && window.supabase);
  }

  function sb() {
    if (!cliente) {
      var c = window.QOS_CONFIG;
      cliente = window.supabase.createClient(c.supabaseUrl, c.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'qualityos.sesion' }
      });
    }
    return cliente;
  }

  function hayRed() { return navigator.onLine !== false; }

  // Supabase devuelve { data, error }. Esto lo convierte en "devuelve data o lanza".
  function dato(res) {
    if (res.error) throw new Error(traducir(res.error.message));
    return res.data;
  }

  function traducir(msg) {
    var m = String(msg || '');
    if (/Invalid login credentials/i.test(m)) return 'Email o clave incorrectos.';
    if (/Email not confirmed/i.test(m)) return 'Todavía no confirmaste el email: revisá tu correo.';
    if (/already registered/i.test(m)) return 'Ese email ya tiene cuenta: ingresá con tu clave.';
    if (/Password should be/i.test(m)) return 'La clave tiene que tener al menos 6 caracteres.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor.';
    return m;
  }

  // ── Sesión ──
  async function usuario() {
    var s = dato(await sb().auth.getSession());
    return s.session ? s.session.user : null;
  }

  async function entrar(email, clave) {
    return dato(await sb().auth.signInWithPassword({ email: email, password: clave })).user;
  }

  async function registrarse(email, clave) {
    // emailRedirectTo: adónde lleva el link del mail de confirmación. Sin esto Supabase
    // usa la página de origen que manda el navegador, que es solo el dominio
    // (https://roca-byte.github.io/) y no la carpeta de la app: el link daba 404.
    // Se usa la dirección actual sin #/?, así sirve en cualquier hosting o subcarpeta.
    var aca = location.origin + location.pathname;
    var d = dato(await sb().auth.signUp({ email: email, password: clave, options: { emailRedirectTo: aca } }));
    // Si el proyecto pide confirmar el email, no hay sesión hasta confirmarlo.
    return { usuario: d.user, necesitaConfirmar: !d.session };
  }

  async function salir() {
    try { await sb().auth.signOut(); } catch (e) { /* sin red: igual se sale localmente */ }
  }

  // ── Empresas y miembros ──
  async function misEmpresas(nombre) {
    // Primero se suma a las empresas que lo hayan invitado.
    dato(await sb().rpc('aceptar_invitaciones', { p_mi_nombre: nombre || '' }));
    var u = await usuario();
    return dato(await sb().from('miembros')
      .select('empresa_id, rol, nombre, activo, empresas(nombre, config)')
      .eq('user_id', u.id).eq('activo', true));
  }

  // Solo los dueños de la plataforma crean empresas (lo decide la base).
  async function puedoCrearEmpresas() {
    return dato(await sb().rpc('puedo_crear_empresas')) === true;
  }

  async function crearEmpresa(nombre, miNombre) {
    return dato(await sb().rpc('crear_empresa', { p_nombre: nombre, p_mi_nombre: miNombre }));
  }

  async function guardarEmpresa(empresaId, nombre, config) {
    dato(await sb().from('empresas').update({ nombre: nombre, config: config }).eq('id', empresaId));
  }

  async function cambiarMiNombre(empresaId, nombre) {
    dato(await sb().rpc('cambiar_mi_nombre', { p_empresa: empresaId, p_nombre: nombre }));
  }

  async function miembros(empresaId) {
    var m = dato(await sb().from('miembros').select('user_id, nombre, rol, activo').eq('empresa_id', empresaId).order('nombre'));
    var inv = dato(await sb().from('invitaciones').select('email, rol').eq('empresa_id', empresaId).order('email'));
    return { miembros: m, invitaciones: inv };
  }

  async function invitar(empresaId, email, rol) {
    dato(await sb().from('invitaciones').upsert({ empresa_id: empresaId, email: email.trim().toLowerCase(), rol: rol }));
  }

  async function quitarInvitacion(empresaId, email) {
    dato(await sb().from('invitaciones').delete().eq('empresa_id', empresaId).eq('email', email));
  }

  async function cambiarMiembro(empresaId, userId, cambios) {
    dato(await sb().from('miembros').update(cambios).eq('empresa_id', empresaId).eq('user_id', userId));
  }

  // ── Lotes ──

  // Sube la bandeja de salida y baja lo que cambiaron otros equipos.
  // Devuelve { subidos, conflictos, bajados } o lanza si no hay conexión.
  async function sincronizar() {
    if (sincronizando) return null;
    if (!hayRed()) throw new Error('Sin conexión');
    sincronizando = true;
    var res = { subidos: 0, conflictos: 0, bajados: 0 };
    try {
      var empresaId = Store.perfil().empresaId;
      var pend = Store.pendientes();
      for (var i = 0; i < pend.length; i++) {
        var p = pend[i];
        var r = dato(await sb().rpc('guardar_lote', {
          p_id: p.id, p_empresa: empresaId, p_version_base: p.version, p_datos: p.datos, p_borrar: p.borrar
        }));
        if (r.ok) { Store.confirmar(p.id, p.cambios, r.lote); res.subidos++; }
        else { Store.conflicto(p.id, r.lote); res.conflictos++; }
      }

      var desde = Store.ultimaBajada();
      var corte = desde ? new Date(new Date(desde).getTime() - SOLAPAMIENTO_MS)
                        : new Date(Date.now() - DIAS_PRIMERA_BAJADA * 864e5);
      var filas = dato(await sb().from('lotes')
        .select('id, version, borrado, datos, modificado')
        .eq('empresa_id', empresaId)
        .gt('modificado', corte.toISOString())
        .order('modificado', { ascending: true })
        .limit(1000));
      filas.forEach(function (f) { Store.aplicarRemoto(f); });
      if (filas.length) Store.setUltimaBajada(filas[filas.length - 1].modificado);
      else Store.guardar();
      res.bajados = filas.length;
      return res;
    } finally {
      sincronizando = false;
    }
  }

  // Busca en todo el historial del servidor (no solo lo que está en la tablet).
  async function buscarLotes(texto) {
    var q = sb().from('lotes')
      .select('id, version, datos, modificado, estado, numero, producto, cliente, fecha')
      .eq('empresa_id', Store.perfil().empresaId)
      .eq('borrado', false)
      .order('modificado', { ascending: false })
      .limit(100);
    var t = String(texto || '').replace(/[%,()]/g, ' ').trim();
    if (t) q = q.or('numero.ilike.%' + t + '%,cliente.ilike.%' + t + '%,producto.ilike.%' + t + '%');
    return dato(await q);
  }

  return {
    configurada: configurada, hayRed: hayRed,
    usuario: usuario, entrar: entrar, registrarse: registrarse, salir: salir,
    misEmpresas: misEmpresas, puedoCrearEmpresas: puedoCrearEmpresas, crearEmpresa: crearEmpresa, guardarEmpresa: guardarEmpresa,
    cambiarMiNombre: cambiarMiNombre, miembros: miembros, invitar: invitar,
    quitarInvitacion: quitarInvitacion, cambiarMiembro: cambiarMiembro,
    sincronizar: sincronizar, buscarLotes: buscarLotes
  };
})();
