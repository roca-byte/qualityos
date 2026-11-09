-- Firma electrónica del dictamen del lote y del cierre de una NC.
--
-- Qué es (Ley 25.506: firma ELECTRÓNICA, no digital; criterios de 21 CFR Part 11):
--   * Se firma con dos componentes: la sesión del usuario y su clave, que se vuelve a pedir en
--     CADA firma. La clave la verifica el servidor contra el hash que guarda Supabase
--     (auth.users.encrypted_password, bcrypt), así que no depende de la app.
--   * La firma muestra quién (nombre y rol), cuándo (hora del SERVIDOR) y qué significa
--     ("Dictamen: APROBADO", "Cierre de la NC NC-2026-003").
--   * Queda ligada al contenido: se guarda la huella SHA-256 de lo firmado. Si el lote o la NC
--     cambian después, la firma deja de estar vigente (se borra del registro y hay que volver a
--     firmar); el historial de firmas no se borra nunca.
--   * Sin señal no se firma (la clave se verifica en el servidor): el dictamen queda
--     "pendiente de firma" hasta que vuelva la conexión.
--
-- Dónde queda:
--   * public.firmas: historial de todas las firmas. Nadie la modifica ni la borra (ni la app ni
--     un admin): solo se agrega con firmar().
--   * lotes.firma / no_conformidades.firma: la firma VIGENTE, para que viaje con la fila al
--     sincronizar. guardar_lote / guardar_nc la ponen en null cuando cambia lo firmado.

alter table public.lotes add column firma jsonb;
alter table public.no_conformidades add column firma jsonb;

create table public.firmas (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  tipo        text not null check (tipo in ('lote', 'nc')),
  objeto_id   uuid not null,
  version     integer not null,          -- versión del lote / NC que quedó con esta firma
  significado text not null,
  hash        text not null,             -- SHA-256 (hex) de lo firmado
  user_id     uuid not null,
  nombre      text not null,
  rol         text not null,
  cuando      timestamptz not null default now()
);
create index firmas_objeto_idx on public.firmas(objeto_id, cuando);

-- Intentos de firma con la clave equivocada: más de 5 en 15 minutos bloquean la firma un rato
-- (sin esto, firmar() serviría para adivinar claves).
create table public.firmas_intentos (
  user_id uuid not null,
  cuando  timestamptz not null default now()
);
create index firmas_intentos_idx on public.firmas_intentos(user_id, cuando);

alter table public.firmas enable row level security;
alter table public.firmas_intentos enable row level security;
create policy firmas_ver on public.firmas
  for select to authenticated using (public.es_miembro(empresa_id));
-- firmas_intentos: sin políticas, nadie la lee desde la app.
revoke all on public.firmas, public.firmas_intentos from anon, authenticated;
grant select on public.firmas to authenticated;

-- Huella de lo que se firma. De una NC no entra la verificación de eficacia: se hace DESPUÉS del
-- cierre y no tiene que invalidar la firma del cierre.
create function public.huella_firma(p_tipo text, p_datos jsonb) returns text
language sql immutable set search_path = public as $$
  select encode(extensions.digest(
    (case when p_tipo = 'nc' then p_datos - 'eficacia' else p_datos end)::text, 'sha256'), 'hex')
$$;

-- Firma el lote (su dictamen) o la NC (su cierre).
--   p_version: la versión que el usuario está viendo. Si en el servidor hay otra, no se firma
--   (se firmaría algo distinto de lo que vio).
-- Devuelve {ok:true, fila:<la fila actualizada, con su firma>} o {ok:false, error}.
create function public.firmar(p_tipo text, p_id uuid, p_empresa uuid, p_version integer, p_clave text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rol      text := public.mi_rol(p_empresa);
  v_clave    text;
  v_nombre   text;
  v_lote     public.lotes;
  v_nc       public.no_conformidades;
  v_datos    jsonb;
  v_version  integer;
  v_signif   text;
  v_hash     text;
  v_firma    jsonb;
  v_fila     jsonb;
begin
  if v_rol is null then raise exception 'No sos miembro de esta empresa'; end if;
  if p_tipo not in ('lote', 'nc') then raise exception 'Tipo de firma inválido'; end if;

  if (select count(*) from public.firmas_intentos
      where user_id = auth.uid() and cuando > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Demasiados intentos con la clave equivocada. Esperá 15 minutos.');
  end if;
  select encrypted_password into v_clave from auth.users where id = auth.uid();
  if v_clave is null or v_clave = '' or extensions.crypt(coalesce(p_clave, ''), v_clave) <> v_clave then
    -- Se devuelve (no se lanza) para que el intento fallido quede guardado.
    insert into public.firmas_intentos (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'Clave incorrecta.');
  end if;

  if p_tipo = 'lote' then
    select * into v_lote from public.lotes where id = p_id for update;
    if not found or v_lote.borrado then raise exception 'El lote no existe'; end if;
    if v_lote.empresa_id <> p_empresa then raise exception 'Lote de otra empresa'; end if;
    if v_lote.estado = 'activo' or v_lote.dictamen is null then raise exception 'Solo se firma un lote dictaminado'; end if;
    v_datos := v_lote.datos; v_version := v_lote.version;
    v_signif := 'Dictamen: ' || replace(v_lote.dictamen, '_', ' ');
  else
    select * into v_nc from public.no_conformidades where id = p_id for update;
    if not found or v_nc.borrado then raise exception 'La NC no existe'; end if;
    if v_nc.empresa_id <> p_empresa then raise exception 'NC de otra empresa'; end if;
    if v_nc.estado <> 'cerrada' then raise exception 'Solo se firma una NC cerrada'; end if;
    v_datos := v_nc.datos; v_version := v_nc.version;
    v_signif := 'Cierre de la NC ' || v_nc.numero;
  end if;
  if v_version <> p_version then
    raise exception 'Cambió mientras lo mirabas: sincronizá y volvé a firmar';
  end if;

  select coalesce(nullif(trim(nombre), ''), (select email from auth.users where id = auth.uid())) into v_nombre
    from public.miembros where empresa_id = p_empresa and user_id = auth.uid();
  v_hash := public.huella_firma(p_tipo, v_datos);
  insert into public.firmas (empresa_id, tipo, objeto_id, version, significado, hash, user_id, nombre, rol)
  values (p_empresa, p_tipo, p_id, v_version + 1, v_signif, v_hash, auth.uid(), v_nombre, v_rol);
  v_firma := jsonb_build_object('nombre', v_nombre, 'rol', v_rol, 'significado', v_signif, 'hash', v_hash,
    'codigo', upper(substr(v_hash, 1, 4) || '-' || substr(v_hash, 5, 4)), 'cuando', now());

  -- La firma sube la versión (así llega a los otros equipos al sincronizar) sin cambiar los datos.
  if p_tipo = 'lote' then
    update public.lotes set firma = v_firma, version = version + 1, modificado = now(), modificado_por = auth.uid()
     where id = p_id returning to_jsonb(lotes.*) into v_fila;
  else
    update public.no_conformidades set firma = v_firma, version = version + 1, modificado = now(), modificado_por = auth.uid()
     where id = p_id returning to_jsonb(no_conformidades.*) into v_fila;
  end if;
  return jsonb_build_object('ok', true, 'fila', v_fila);
end $$;

-- guardar_lote y guardar_nc: igual que antes, más una regla: si cambia lo firmado, la firma
-- vigente se borra (queda en public.firmas como historial).
create or replace function public.guardar_lote(p_id uuid, p_empresa uuid, p_version_base integer,
                                               p_datos jsonb, p_borrar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rol      text := public.mi_rol(p_empresa);
  v_actual   public.lotes;
  v_estado   text := coalesce(p_datos->>'estado', 'activo');
  v_dictamen text := nullif(p_datos->'final'->>'dictamen', '');
  v_superior boolean := v_rol in ('coordinacion', 'admin');
  v_fila     public.lotes;
begin
  if v_rol is null then raise exception 'No sos miembro de esta empresa'; end if;
  if coalesce(trim(p_datos->'cab'->>'lote'), '') = '' or coalesce(trim(p_datos->'cab'->>'prod'), '') = '' then
    raise exception 'Producto y número de lote son obligatorios';
  end if;
  if v_estado <> 'activo' and v_dictamen is null then
    raise exception 'Un lote cerrado tiene que tener dictamen';
  end if;
  if p_borrar and not v_superior then
    raise exception 'Solo coordinación puede borrar lotes';
  end if;
  if v_estado <> 'activo' and public.pallets_faltantes(p_datos) > 0 and not v_superior then
    raise exception 'Faltan pallets por controlar: solo coordinación puede dictaminar así';
  end if;

  select * into v_actual from public.lotes where id = p_id for update;

  if found then
    if v_actual.empresa_id <> p_empresa then raise exception 'Lote de otra empresa'; end if;
    if v_actual.version <> p_version_base then
      return jsonb_build_object('ok', false, 'conflicto', true, 'lote', to_jsonb(v_actual));
    end if;
    if v_actual.estado <> 'activo' and not v_superior then
      raise exception 'El lote ya está dictaminado: solo coordinación puede modificarlo';
    end if;
    update public.lotes set
      numero = trim(p_datos->'cab'->>'lote'),
      producto = trim(p_datos->'cab'->>'prod'),
      cliente = coalesce(p_datos->'cab'->>'cliente', ''),
      linea = coalesce(p_datos->'cab'->>'linea', ''),
      fecha = nullif(p_datos->'cab'->>'fecha', '')::date,
      estado = v_estado, dictamen = v_dictamen, datos = p_datos,
      borrado = p_borrar or v_actual.borrado,
      firma = case when p_datos = v_actual.datos then v_actual.firma else null end,
      version = v_actual.version + 1,
      modificado_por = auth.uid(), modificado = now()
    where id = p_id returning * into v_fila;
  else
    if p_version_base <> 0 then
      return jsonb_build_object('ok', false, 'conflicto', true, 'lote', null);
    end if;
    insert into public.lotes (id, empresa_id, numero, producto, cliente, linea, fecha,
                              estado, dictamen, datos, borrado, creado_por, modificado_por)
    values (p_id, p_empresa, trim(p_datos->'cab'->>'lote'), trim(p_datos->'cab'->>'prod'),
            coalesce(p_datos->'cab'->>'cliente', ''), coalesce(p_datos->'cab'->>'linea', ''),
            nullif(p_datos->'cab'->>'fecha', '')::date, v_estado, v_dictamen, p_datos,
            p_borrar, auth.uid(), auth.uid())
    returning * into v_fila;
  end if;

  return jsonb_build_object('ok', true, 'lote', to_jsonb(v_fila));
end $$;

create or replace function public.guardar_nc(p_id uuid, p_empresa uuid, p_version_base integer,
                                             p_datos jsonb, p_borrar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rol    text := public.mi_rol(p_empresa);
  v_actual public.no_conformidades;
  v_estado text := coalesce(p_datos->>'estado', '');
  v_fecha  date;
  v_numero text;
  v_fila   public.no_conformidades;
begin
  if v_rol is null then raise exception 'No sos miembro de esta empresa'; end if;
  begin
    v_fecha := (p_datos->>'fecha')::date;
  exception when others then v_fecha := null;
  end;
  if v_fecha is null then raise exception 'La NC necesita la fecha de detección'; end if;
  if v_estado not in ('abierta', 'en_proceso', 'cerrada', 'anulada') then
    raise exception 'Estado de NC inválido: %', v_estado;
  end if;
  if coalesce(trim(p_datos->>'tipo'), '') = '' and coalesce(trim(p_datos->>'desc'), '') = '' then
    raise exception 'La NC necesita el tipo de desvío o una descripción';
  end if;
  if v_estado = 'cerrada' and coalesce(p_datos->>'cierre', '') = '' then
    raise exception 'Una NC cerrada tiene que tener fecha de cierre';
  end if;
  if coalesce(p_datos->>'sev', '') not in ('', 'Leve', 'Moderado', 'Crítico') then
    raise exception 'Gravedad inválida';
  end if;
  if p_borrar and v_rol not in ('coordinacion', 'admin') then
    raise exception 'Solo coordinación puede borrar una NC (cualquiera de Calidad puede anularla)';
  end if;

  select * into v_actual from public.no_conformidades where id = p_id for update;

  if found then
    if v_actual.empresa_id <> p_empresa then raise exception 'NC de otra empresa'; end if;
    if v_actual.version <> p_version_base then
      return jsonb_build_object('ok', false, 'conflicto', true, 'nc', to_jsonb(v_actual));
    end if;
    update public.no_conformidades set
      fecha = v_fecha, estado = v_estado,
      tipo = coalesce(p_datos->>'tipo', ''), severidad = coalesce(p_datos->>'sev', ''),
      lote = coalesce(p_datos->>'lote', ''), lote_id = nullif(p_datos->>'loteId', '')::uuid,
      datos = p_datos, borrado = p_borrar or v_actual.borrado,
      -- La verificación de eficacia es posterior al cierre: no invalida su firma.
      firma = case when (p_datos - 'eficacia') = (v_actual.datos - 'eficacia') then v_actual.firma else null end,
      version = v_actual.version + 1,
      modificado_por = auth.uid(), modificado = now()
    where id = p_id returning * into v_fila;
  else
    if p_version_base <> 0 then
      return jsonb_build_object('ok', false, 'conflicto', true, 'nc', null);
    end if;
    perform 1 from public.empresas where id = p_empresa for update;
    select 'NC-' || extract(year from v_fecha)::int || '-' || lpad((coalesce(max(split_part(numero, '-', 3)::int), 0) + 1)::text, 3, '0')
      into v_numero
      from public.no_conformidades
     where empresa_id = p_empresa and numero like 'NC-' || extract(year from v_fecha)::int || '-%';
    insert into public.no_conformidades (id, empresa_id, numero, fecha, estado, tipo, severidad, lote, lote_id,
                                         datos, borrado, creado_por, modificado_por)
    values (p_id, p_empresa, v_numero, v_fecha, v_estado, coalesce(p_datos->>'tipo', ''), coalesce(p_datos->>'sev', ''),
            coalesce(p_datos->>'lote', ''), nullif(p_datos->>'loteId', '')::uuid,
            p_datos, p_borrar, auth.uid(), auth.uid())
    returning * into v_fila;
  end if;

  return jsonb_build_object('ok', true, 'nc', to_jsonb(v_fila));
end $$;

revoke execute on function public.huella_firma(text, jsonb) from public, anon, authenticated;
revoke execute on function public.firmar(text, uuid, uuid, integer, text) from public, anon;
grant execute on function public.firmar(text, uuid, uuid, integer, text) to authenticated;
