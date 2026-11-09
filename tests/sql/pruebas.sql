-- Pruebas de la migración: permisos, multiempresa, conflictos y auditoría.
-- Cada bloque simula a un usuario distinto. Si una afirmación falla, psql corta
-- con error y correr.sh termina en rojo.

-- ── Ayudas (solo existen en la base de prueba) ──
create schema prueba;
grant usage on schema prueba to authenticated, anon;

-- Ejecuta un SQL y exige que falle con un mensaje que contenga "esperado".
create function prueba.debe_fallar(p_sql text, p_esperado text) returns void
language plpgsql as $$
declare v_error text;
begin
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;
  -- El chequeo va fuera del bloque de arriba: si no, su propio error se atraparía.
  if v_error is null then
    raise exception 'Se esperaba un error (%) y no lo hubo: %', p_esperado, p_sql;
  elsif position(p_esperado in v_error) = 0 then
    raise exception 'Error distinto al esperado. Esperado: %, recibido: %', p_esperado, v_error;
  end if;
end $$;
grant execute on function prueba.debe_fallar(text, text) to authenticated, anon;

-- Lote de ejemplo: 2 pallets en Control Final, completos o no.
create function prueba.lote(p_completo boolean, p_estado text default 'activo', p_dictamen text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'estado', p_estado,
    'cab', jsonb_build_object('prod', 'Aceite 1L', 'lote', 'L-100', 'cliente', 'Cliente Uno', 'linea', 'Env-04', 'fecha', '2026-11-07'),
    'linea', '[]'::jsonb,
    'final', jsonb_build_object(
      'dictamen', p_dictamen,
      'pallets', jsonb_build_array(
        jsonb_build_object('idOK', true, 'qrOK', true, 'paletOK', true, 'indCFOK', true),
        jsonb_build_object('idOK', true, 'qrOK', true, 'paletOK', true,
                           'indCFOK', case when p_completo then to_jsonb(true) else 'null'::jsonb end))))
$$;
grant execute on function prueba.lote(boolean, text, text) to authenticated;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'ana@uno.com'),
  ('00000000-0000-0000-0000-00000000000b', 'beto@uno.com'),
  ('00000000-0000-0000-0000-00000000000c', 'caro@dos.com'),
  ('00000000-0000-0000-0000-00000000000d', 'dani@nadie.com');

-- ── Solo los dueños de la plataforma crean empresas ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"dani@nadie.com"}', false);
set role authenticated;
do $$ begin assert not public.puedo_crear_empresas(), 'Dani no puede crear empresas'; end $$;
select prueba.debe_fallar($$select public.crear_empresa('Empresa Pirata', 'Dani')$$, 'Solo el administrador');
select prueba.debe_fallar($$select count(*) from public.plataforma_admins$$, 'permission denied');
select prueba.debe_fallar($$insert into public.plataforma_admins values (auth.uid())$$, 'permission denied');
reset role;
insert into public.plataforma_admins (user_id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000c');

-- ── Ana crea la empresa Uno e invita a Beto como checker ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"ana@uno.com"}', false);
set role authenticated;
select public.crear_empresa('Empresa Uno', 'Ana') as e1 \gset
insert into public.invitaciones (empresa_id, email, rol) values (:'e1', 'beto@uno.com', 'checker');
do $$ begin
  assert (select count(*) from public.empresas) = 1, 'Ana ve su empresa';
  assert public.mi_rol((select id from public.empresas)) = 'admin', 'Ana es admin';
end $$;
reset role;

-- ── Caro crea otra empresa ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"caro@dos.com"}', false);
set role authenticated;
select public.crear_empresa('Empresa Dos', 'Caro') as e2 \gset
reset role;

-- ── Beto acepta la invitación y trabaja un lote ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"beto@uno.com"}', false);
set role authenticated;
do $$ begin
  assert public.aceptar_invitaciones('Beto') = 1, 'Beto entra por invitación';
end $$;
select :'e1'::uuid as e1u \gset
-- Un invitado trabaja en su empresa pero no crea otras.
select prueba.debe_fallar($$select public.crear_empresa('Otra', 'Beto')$$, 'Solo el administrador');
do $$
declare e uuid := (select id from public.empresas);
        r jsonb;
begin
  assert public.mi_rol(e) = 'checker', 'Beto es checker';
  assert (select count(*) from public.empresas) = 1, 'Beto solo ve la empresa Uno';
  assert (select count(*) from public.invitaciones) = 0, 'Un checker no ve invitaciones';

  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 0, prueba.lote(false));
  assert (r->>'ok')::boolean and (r->'lote'->>'version')::int = 1, 'Crear lote: versión 1';

  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 1, prueba.lote(false));
  assert (r->'lote'->>'version')::int = 2, 'Editar lote: versión 2';

  -- Una tablet con la versión 1 (vieja) no pisa la 2: recibe conflicto.
  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 1, prueba.lote(false));
  assert not (r->>'ok')::boolean and (r->>'conflicto')::boolean, 'Versión vieja → conflicto';
  assert (r->'lote'->>'version')::int = 2, 'El conflicto devuelve la versión del servidor';
  assert (select version from public.lotes) = 2, 'El servidor no cambió';

  assert (select numero || '|' || producto || '|' || cliente from public.lotes) = 'L-100|Aceite 1L|Cliente Uno',
    'Columnas de búsqueda sacadas de datos';
end $$;
select prueba.debe_fallar($$insert into public.lotes (id, empresa_id, numero, producto, datos)
  values (gen_random_uuid(), (select id from public.empresas), 'x', 'y', '{}')$$, 'permission denied');
select prueba.debe_fallar($$update public.lotes set estado = 'aprobado'$$, 'permission denied');
-- Dictaminar con pallets incompletos: un checker no puede.
select prueba.debe_fallar(format($$select public.guardar_lote('11111111-1111-1111-1111-111111111111', %L, 2,
  prueba.lote(false, 'aprobado', 'APROBADO'))$$, :'e1'), 'Faltan pallets');
-- Estado cerrado sin dictamen: inválido.
select prueba.debe_fallar(format($$select public.guardar_lote('11111111-1111-1111-1111-111111111111', %L, 2,
  prueba.lote(true, 'aprobado', null))$$, :'e1'), 'tiene que tener dictamen');
-- Borrar: un checker no puede.
select prueba.debe_fallar(format($$select public.guardar_lote('11111111-1111-1111-1111-111111111111', %L, 2,
  prueba.lote(false), true)$$, :'e1'), 'Solo coordinación');
-- Con todo completo sí dictamina; después ya no puede editar.
do $$
declare e uuid := (select id from public.empresas); r jsonb;
begin
  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 2, prueba.lote(true, 'aprobado_parcial', 'APROBADO_PARCIAL'));
  assert (r->>'ok')::boolean, 'El inspector (rol checker) dictamina con CF completo';
  assert (select estado || '|' || dictamen from public.lotes) = 'aprobado_parcial|APROBADO_PARCIAL',
    'El parcial se conserva (en la versión vieja quedaba "cerrado")';
  perform public.cambiar_mi_nombre(e, 'Beto Gómez');
  assert (select nombre from public.miembros where user_id = auth.uid()) = 'Beto Gómez', 'Cambia su nombre';
  update public.empresas set config = '{"x":1}';
  assert (select config from public.empresas) = '{}'::jsonb, 'Un checker no edita la configuración';
  assert (select count(*) from public.lotes_historial) = 0, 'Un checker no ve la auditoría';
end $$;
select prueba.debe_fallar(format($$select public.guardar_lote('11111111-1111-1111-1111-111111111111', %L, 3,
  prueba.lote(true))$$, :'e1'), 'ya está dictaminado');
reset role;

-- ── Caro (otra empresa) no ve ni toca el lote de Uno ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"caro@dos.com"}', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.lotes) = 0, 'Caro no ve lotes de otra empresa';
  assert (select count(*) from public.miembros) = 1, 'Caro solo ve los miembros de su empresa';
end $$;
select prueba.debe_fallar(format($$select public.guardar_lote('11111111-1111-1111-1111-111111111111', %L, 3,
  prueba.lote(true))$$, :'e1'), 'No sos miembro');
select prueba.debe_fallar(format($$select public.guardar_lote('11111111-1111-1111-1111-111111111111', %L, 3,
  prueba.lote(true))$$, :'e2'), 'otra empresa');
reset role;

-- ── Dani no pertenece a ninguna empresa ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","email":"dani@nadie.com"}', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.empresas) = 0, 'Sin empresa no ve nada';
  assert public.aceptar_invitaciones('Dani') = 0, 'Sin invitación no entra a ninguna';
end $$;
reset role;

-- ── Sin sesión (anon) no se lee nada ──
set role anon;
select prueba.debe_fallar('select * from public.lotes', 'permission denied');
select prueba.debe_fallar('select public.crear_empresa(''x'', ''y'')', 'permission denied');
reset role;

-- ── Ana (admin) reabre y borra; la auditoría guarda todo ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"ana@uno.com"}', false);
set role authenticated;
do $$
declare e uuid := (select id from public.empresas); r jsonb;
begin
  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 3, prueba.lote(false));
  assert (r->>'ok')::boolean and (select estado from public.lotes) = 'activo', 'Admin reabre el lote';
  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 4, prueba.lote(false, 'retenido', 'RETENIDO'));
  assert (r->>'ok')::boolean, 'Coordinación/admin puede dictaminar con pallets incompletos';
  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 5, prueba.lote(false, 'retenido', 'RETENIDO'), true);
  assert (select borrado from public.lotes), 'Borrar deja una lápida';
  -- Una versión vieja que llega tarde no lo "revive".
  r := public.guardar_lote('11111111-1111-1111-1111-111111111111', e, 2, prueba.lote(false));
  assert (r->>'conflicto')::boolean and (select borrado from public.lotes), 'El borrado no revive';
  assert (select count(*) from public.lotes_historial) = 6, 'Auditoría: una fila por versión';
  assert (select count(distinct usuario) from public.lotes_historial) = 2, 'La auditoría guarda quién';
end $$;
-- Borrarse a sí mismo no da error: simplemente no afecta filas.
do $$ begin
  delete from public.miembros where user_id = auth.uid();
  assert (select count(*) from public.miembros where user_id = auth.uid()) = 1, 'El admin no se puede quitar a sí mismo';
end $$;
reset role;

-- ── Las funciones internas no se pueden llamar desde la app ──
set role authenticated;
select prueba.debe_fallar($$select public.pallets_faltantes('{}'::jsonb)$$, 'permission denied');
reset role;

-- ── Plantillas: las unidades faltantes salen de los ítems obligatorios de la plantilla ──
do $$
declare
  plantilla jsonb := '{"final":[
    {"id":"qr","tipo":"okNok","obligatorio":true},
    {"id":"temp","tipo":"medicion","obligatorio":true},
    {"id":"obs","tipo":"texto","obligatorio":false}]}';
  completa jsonb := '{"v":{"qr":false,"temp":["4.1","3.9"]}}';
  sin_ok jsonb := '{"v":{"temp":["4.1","3.9"]}}';
  lectura_vacia jsonb := '{"v":{"qr":true,"temp":["4.1",""]}}';
begin
  assert public.pallets_faltantes(jsonb_build_object('plantilla', plantilla,
    'final', jsonb_build_object('unidades', jsonb_build_array(completa)))) = 0,
    'un NOK es un dato cargado y lo no obligatorio no cuenta';
  assert public.pallets_faltantes(jsonb_build_object('plantilla', plantilla,
    'final', jsonb_build_object('unidades', jsonb_build_array(completa, sin_ok, lectura_vacia)))) = 2,
    'falta el OK/NOK en una y una lectura en otra';
  assert public.pallets_faltantes(prueba.lote(false)) = 1, 'el formato anterior se sigue entendiendo';
end $$;

-- Con plantilla, un inspector no puede dictaminar con unidades incompletas; coordinación sí.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"beto@uno.com"}', false);
set role authenticated;
select prueba.debe_fallar(format($$select public.guardar_lote('22222222-2222-2222-2222-222222222222', %L, 0,
  '{"formato":2,"estado":"aprobado","cab":{"prod":"Jugo","lote":"J-1"},
    "plantilla":{"final":[{"id":"herm","tipo":"okNok","obligatorio":true}]},
    "final":{"dictamen":"APROBADO","unidades":[{"v":{}}]}}'::jsonb)$$, :'e1'), 'Faltan pallets');
do $$ begin
  assert (public.guardar_lote('22222222-2222-2222-2222-222222222222', (select id from public.empresas), 0,
    '{"formato":2,"estado":"aprobado","cab":{"prod":"Jugo","lote":"J-1"},
      "plantilla":{"final":[{"id":"herm","tipo":"okNok","obligatorio":true}]},
      "final":{"dictamen":"APROBADO","unidades":[{"v":{"herm":true}}]}}'::jsonb)->>'ok')::boolean,
    'con la plantilla completa el inspector dictamina';
end $$;
select prueba.debe_fallar($$select public.valor_vacio('texto', '""')$$, 'permission denied');
reset role;

-- ── No conformidades (migración 0005) ──
-- Cualquiera de Calidad crea, edita y cierra; borrar es de coordinación; numeración por año.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"beto@uno.com"}', false);
set role authenticated;
do $$
declare e uuid := (select id from public.empresas); r jsonb;
begin
  r := public.guardar_nc('33333333-3333-3333-3333-333333333331', e, 0,
    '{"fecha":"2026-11-05","estado":"abierta","tipo":"Peso fuera de rango","sev":"Leve","lote":"J-1","loteId":"22222222-2222-2222-2222-222222222222"}');
  assert (r->>'ok')::boolean and r->'nc'->>'numero' = 'NC-2026-001', 'El inspector crea una NC y el servidor le pone número';
  assert r->'nc'->>'lote_id' = '22222222-2222-2222-2222-222222222222', 'Guarda de qué lote salió';
  r := public.guardar_nc('33333333-3333-3333-3333-333333333332', e, 0, '{"fecha":"2026-11-06","estado":"abierta","desc":"Reclamo"}');
  assert r->'nc'->>'numero' = 'NC-2026-002', 'Numeración correlativa';
  r := public.guardar_nc('33333333-3333-3333-3333-333333333333', e, 0, '{"fecha":"2027-01-02","estado":"abierta","desc":"Otro año"}');
  assert r->'nc'->>'numero' = 'NC-2027-001', 'Cada año arranca en 001';
  -- Cerrar (un inspector también puede: "cualquiera de Calidad")
  r := public.guardar_nc('33333333-3333-3333-3333-333333333331', e, 1,
    '{"fecha":"2026-11-05","estado":"cerrada","cierre":"2026-11-08","tipo":"Peso fuera de rango","sev":"Leve","eficacia":"eficaz"}');
  assert (r->>'ok')::boolean and (select estado from public.no_conformidades where numero = 'NC-2026-001') = 'cerrada',
    'El inspector cierra la NC';
  assert (select numero from public.no_conformidades where id = '33333333-3333-3333-3333-333333333331') = 'NC-2026-001',
    'Editar no cambia el número';
  -- Versión vieja: conflicto, nada se pisa
  r := public.guardar_nc('33333333-3333-3333-3333-333333333331', e, 1, '{"fecha":"2026-11-05","estado":"abierta","desc":"x"}');
  assert (r->>'conflicto')::boolean and r->'nc'->>'estado' = 'cerrada', 'Versión vieja de una NC → conflicto';
  assert (select count(*) from public.no_conformidades_historial) = 0, 'Un inspector no ve la auditoría de NC';
end $$;
select prueba.debe_fallar(format($$select public.guardar_nc(gen_random_uuid(), %L, 0, '{"estado":"abierta","desc":"x"}')$$, :'e1'), 'fecha de detección');
select prueba.debe_fallar(format($$select public.guardar_nc(gen_random_uuid(), %L, 0, '{"fecha":"2026-11-05","estado":"abierta"}')$$, :'e1'), 'tipo de desvío o una descripción');
select prueba.debe_fallar(format($$select public.guardar_nc(gen_random_uuid(), %L, 0, '{"fecha":"2026-11-05","estado":"cerrada","desc":"x"}')$$, :'e1'), 'fecha de cierre');
select prueba.debe_fallar(format($$select public.guardar_nc(gen_random_uuid(), %L, 0, '{"fecha":"2026-11-05","estado":"rara","desc":"x"}')$$, :'e1'), 'Estado de NC inválido');
select prueba.debe_fallar(format($$select public.guardar_nc('33333333-3333-3333-3333-333333333332', %L, 1, '{"fecha":"2026-11-06","estado":"abierta","desc":"Reclamo"}', true)$$, :'e1'), 'Solo coordinación');
select prueba.debe_fallar($$update public.no_conformidades set estado = 'cerrada'$$, 'permission denied');
select prueba.debe_fallar($$select public.registrar_historial_nc()$$, 'permission denied');
reset role;

-- Otra empresa no ve ni toca las NC de Uno
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"caro@dos.com"}', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.no_conformidades) = 0, 'Caro no ve NC de otra empresa';
end $$;
select prueba.debe_fallar(format($$select public.guardar_nc('33333333-3333-3333-3333-333333333332', %L, 1, '{"fecha":"2026-11-06","estado":"abierta","desc":"x"}')$$, :'e1'), 'No sos miembro');
select prueba.debe_fallar(format($$select public.guardar_nc('33333333-3333-3333-3333-333333333332', %L, 1, '{"fecha":"2026-11-06","estado":"abierta","desc":"x"}')$$, :'e2'), 'otra empresa');
do $$ begin
  assert (public.guardar_nc('44444444-4444-4444-4444-444444444444', (select id from public.empresas), 0,
    '{"fecha":"2026-11-07","estado":"abierta","desc":"Primera de Dos"}')->'nc'->>'numero') = 'NC-2026-001',
    'La numeración es por empresa';
end $$;
reset role;

-- Admin borra (lápida) y ve la auditoría
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"ana@uno.com"}', false);
set role authenticated;
do $$
declare e uuid := (select id from public.empresas); r jsonb;
begin
  r := public.guardar_nc('33333333-3333-3333-3333-333333333332', e, 1, '{"fecha":"2026-11-06","estado":"anulada","desc":"Reclamo"}', true);
  assert (r->>'ok')::boolean and (r->'nc'->>'borrado')::boolean, 'Coordinación/admin borra una NC (queda lápida)';
  assert (select count(*) from public.no_conformidades_historial) = 5, 'Auditoría de NC: una fila por versión';
end $$;
reset role;

-- ── Firma electrónica (migración 0006) ──
-- Claves de prueba (en Supabase las guarda Auth con bcrypt, igual que acá).
update auth.users set encrypted_password = extensions.crypt('clave-beto', extensions.gen_salt('bf'))
 where id = '00000000-0000-0000-0000-00000000000b';
update auth.users set encrypted_password = extensions.crypt('clave-ana', extensions.gen_salt('bf'))
 where id = '00000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","email":"beto@uno.com"}', false);
set role authenticated;
do $$
declare e uuid := (select id from public.empresas); r jsonb; v int;
begin
  -- Un lote dictaminado (el J-1 de las pruebas de plantillas)
  v := (select version from public.lotes where id = '22222222-2222-2222-2222-222222222222');
  r := public.firmar('lote', '22222222-2222-2222-2222-222222222222', e, v, 'equivocada');
  assert not (r->>'ok')::boolean and r->>'error' = 'Clave incorrecta.', 'Con la clave equivocada no firma';
  r := public.firmar('lote', '22222222-2222-2222-2222-222222222222', e, v, 'clave-beto');
  assert (r->>'ok')::boolean, 'Con su clave firma: ' || coalesce(r->>'error', '');
  assert r->'fila'->'firma'->>'nombre' = 'Beto Gómez' and r->'fila'->'firma'->>'rol' = 'checker', 'La firma dice quién y con qué rol';
  assert r->'fila'->'firma'->>'significado' = 'Dictamen: APROBADO', 'y qué significa';
  assert (r->'fila'->>'version')::int = v + 1, 'Firmar sube la versión (para que llegue a los otros equipos)';
  assert r->'fila'->'firma'->>'hash' = encode(extensions.digest((select datos from public.lotes where id = '22222222-2222-2222-2222-222222222222')::text, 'sha256'), 'hex'),
    'La huella es la de los datos firmados';
  assert (select count(*) from public.firmas) = 1, 'Queda en el historial de firmas';
  -- Firmar una versión que ya no es la del servidor: no
  begin
    r := public.firmar('lote', '22222222-2222-2222-2222-222222222222', e, v, 'clave-beto');
    assert false, 'no debería firmar una versión vieja';
  exception when others then
    assert sqlerrm like 'Cambió mientras lo mirabas%', sqlerrm;
  end;
  -- Un lote en control (sin dictamen) no se firma
  perform public.guardar_lote('55555555-5555-5555-5555-555555555555', e, 0, prueba.lote(false));
  begin
    r := public.firmar('lote', '55555555-5555-5555-5555-555555555555', e, 1, 'clave-beto');
    assert false, 'no debería firmar un lote en control';
  exception when others then
    assert sqlerrm = 'Solo se firma un lote dictaminado', sqlerrm;
  end;
  -- NC: se firma el cierre; la eficacia posterior no lo invalida, otro cambio sí
  r := public.guardar_nc('66666666-6666-6666-6666-666666666666', e, 0, '{"fecha":"2026-11-08","estado":"abierta","desc":"Prueba firma"}');
  begin
    r := public.firmar('nc', '66666666-6666-6666-6666-666666666666', e, 1, 'clave-beto');
    assert false, 'no debería firmar una NC abierta';
  exception when others then
    assert sqlerrm = 'Solo se firma una NC cerrada', sqlerrm;
  end;
  r := public.guardar_nc('66666666-6666-6666-6666-666666666666', e, 1, '{"fecha":"2026-11-08","estado":"cerrada","cierre":"2026-11-09","desc":"Prueba firma","eficacia":"pendiente"}');
  r := public.firmar('nc', '66666666-6666-6666-6666-666666666666', e, 2, 'clave-beto');
  assert (r->>'ok')::boolean and r->'fila'->'firma'->>'significado' like 'Cierre de la NC NC-2026-%', 'Firma el cierre de la NC';
  r := public.guardar_nc('66666666-6666-6666-6666-666666666666', e, 3, '{"fecha":"2026-11-08","estado":"cerrada","cierre":"2026-11-09","desc":"Prueba firma","eficacia":"eficaz"}');
  assert r->'nc'->'firma' is not null and r->'nc'->'firma' <> 'null'::jsonb, 'Verificar la eficacia no invalida la firma del cierre';
  r := public.guardar_nc('66666666-6666-6666-6666-666666666666', e, 4, '{"fecha":"2026-11-08","estado":"cerrada","cierre":"2026-11-09","desc":"Prueba firma (corregida)","eficacia":"eficaz"}');
  assert r->'nc'->'firma' = 'null'::jsonb or r->'nc'->'firma' is null, 'Cambiar lo firmado deja la firma sin vigencia';
  assert (select count(*) from public.firmas) = 2, 'pero el historial la conserva';
end $$;
-- El historial de firmas no se modifica ni se borra desde la app
select prueba.debe_fallar($$update public.firmas set nombre = 'Otro'$$, 'permission denied');
select prueba.debe_fallar($$delete from public.firmas$$, 'permission denied');
select prueba.debe_fallar($$insert into public.firmas (empresa_id, tipo, objeto_id, version, significado, hash, user_id, nombre, rol)
  values ((select id from public.empresas), 'lote', gen_random_uuid(), 1, 'x', 'x', auth.uid(), 'x', 'x')$$, 'permission denied');
select prueba.debe_fallar($$select count(*) from public.firmas_intentos$$, 'permission denied');
select prueba.debe_fallar($$select public.huella_firma('lote', '{}')$$, 'permission denied');
-- Demasiados intentos con la clave equivocada: se bloquea aunque después ponga la correcta
do $$
declare e uuid := (select id from public.empresas); r jsonb; i int;
begin
  for i in 1..5 loop
    r := public.firmar('nc', '66666666-6666-6666-6666-666666666666', e, 5, 'mal');
  end loop;
  r := public.firmar('nc', '66666666-6666-6666-6666-666666666666', e, 5, 'clave-beto');
  assert not (r->>'ok')::boolean and r->>'error' like 'Demasiados intentos%', 'Bloqueo por intentos fallidos';
end $$;
reset role;

-- Coordinación reabre el lote firmado: la firma deja de estar vigente
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","email":"ana@uno.com"}', false);
set role authenticated;
do $$
declare e uuid := (select id from public.empresas); r jsonb; v int;
begin
  assert (select count(*) from public.firmas) = 2, 'Otro miembro de la empresa ve el historial de firmas';
  v := (select version from public.lotes where id = '22222222-2222-2222-2222-222222222222');
  r := public.guardar_lote('22222222-2222-2222-2222-222222222222', e, v, '{"formato":2,"estado":"activo","cab":{"prod":"Jugo","lote":"J-1"},
      "plantilla":{"final":[]},"final":{"dictamen":null,"unidades":[]}}');
  assert r->'lote'->'firma' = 'null'::jsonb or r->'lote'->'firma' is null, 'Reabrir borra la firma vigente';
end $$;
reset role;
-- Otra empresa no ve las firmas de Uno
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","email":"caro@dos.com"}', false);
set role authenticated;
do $$ begin assert (select count(*) from public.firmas) = 0, 'Caro no ve firmas de otra empresa'; end $$;
reset role;
