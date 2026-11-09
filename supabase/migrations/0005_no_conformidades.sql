-- Registro de No Conformidades (NC).
-- Estaba en la versión vieja de QualityOS y quedó afuera de la reconstrucción. Se usa todos los
-- meses y se carga todos los días: una NC nace de los desvíos de un lote (o se carga a mano, por
-- ejemplo un reclamo o un control de ingreso) y se sigue hasta cerrarla y verificar su eficacia.
--
-- Mismo esquema que los lotes: la tablet genera el id (para crear NC sin señal), cada cambio
-- sube con la versión sobre la que se editó (si otro equipo la cambió antes, hay conflicto y
-- nada se pisa), borrar deja una lápida y cada versión queda en la auditoría.
-- Quién puede qué: cualquiera de Calidad (todos los roles de la empresa) crea, edita, cierra
-- y verifica la eficacia. Borrar del todo es solo de coordinación o admin; lo normal es anular.

create table public.no_conformidades (
  id             uuid primary key,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  -- Número correlativo por empresa y año (NC-2026-001). Lo pone el servidor al recibirla por
  -- primera vez: dos tablets sin señal no pueden saber cuál número sigue.
  numero         text not null,
  -- Columnas sacadas de "datos" para buscar y filtrar con SQL (y Power BI).
  fecha          date not null,
  estado         text not null check (estado in ('abierta', 'en_proceso', 'cerrada', 'anulada')),
  tipo           text not null default '',
  severidad      text not null default '' check (severidad in ('', 'Leve', 'Moderado', 'Crítico')),
  lote           text not null default '',
  -- Lote de QualityOS del que salió (si salió de uno). Sin clave foránea: la NC puede subir
  -- antes que el lote, o el lote borrarse, y la NC tiene que seguir existiendo.
  lote_id        uuid,
  datos          jsonb not null,
  version        integer not null default 1,
  borrado        boolean not null default false,
  creado_por     uuid,
  creado         timestamptz not null default now(),
  modificado_por uuid,
  modificado     timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index nc_empresa_mod_idx on public.no_conformidades(empresa_id, modificado);
create index nc_empresa_fecha_idx on public.no_conformidades(empresa_id, fecha);

create table public.no_conformidades_historial (
  id         bigint generated always as identity primary key,
  nc_id      uuid not null,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  version    integer not null,
  estado     text not null,
  borrado    boolean not null,
  datos      jsonb not null,
  usuario    uuid,
  cuando     timestamptz not null default now()
);
create index nc_historial_nc_idx on public.no_conformidades_historial(nc_id, version);

alter table public.no_conformidades enable row level security;
alter table public.no_conformidades_historial enable row level security;

-- Todos los miembros leen (incluidas las lápidas, para sincronizar). Se escribe solo con guardar_nc().
create policy nc_ver on public.no_conformidades
  for select to authenticated using (public.es_miembro(empresa_id));
create policy nc_historial_ver on public.no_conformidades_historial
  for select to authenticated using (public.mi_rol(empresa_id) in ('coordinacion', 'admin'));

revoke all on public.no_conformidades, public.no_conformidades_historial from anon;
revoke insert, update, delete on public.no_conformidades, public.no_conformidades_historial from authenticated;
grant select on public.no_conformidades, public.no_conformidades_historial to authenticated;

create function public.registrar_historial_nc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.no_conformidades_historial (nc_id, empresa_id, version, estado, borrado, datos, usuario)
  values (new.id, new.empresa_id, new.version, new.estado, new.borrado, new.datos, auth.uid());
  return new;
end $$;

create trigger nc_historial_trg
  after insert or update on public.no_conformidades
  for each row execute function public.registrar_historial_nc();

-- Guarda una NC (crear, editar o borrar). Igual que guardar_lote: devuelve {ok:true, nc} o, si
-- alguien la cambió mientras tanto, {ok:false, conflicto:true, nc:<la del servidor>}.
-- Reglas que se validan acá (mismas que Reglas.validarNc en js/reglas.js):
--   * Fecha de detección y estado válidos; tipo de desvío o descripción.
--   * Una NC cerrada tiene que tener fecha de cierre.
--   * Borrar exige coordinación o admin.
create function public.guardar_nc(p_id uuid, p_empresa uuid, p_version_base integer,
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
      version = v_actual.version + 1,
      modificado_por = auth.uid(), modificado = now()
    where id = p_id returning * into v_fila;
  else
    if p_version_base <> 0 then
      -- La tablet cree que la NC existe pero el servidor no la tiene.
      return jsonb_build_object('ok', false, 'conflicto', true, 'nc', null);
    end if;
    -- Numeración: se bloquea la empresa para que dos NC que llegan juntas no tomen el mismo número.
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

revoke execute on function public.registrar_historial_nc() from public, anon, authenticated;
revoke execute on function public.guardar_nc(uuid, uuid, integer, jsonb, boolean) from public, anon;
grant execute on function public.guardar_nc(uuid, uuid, integer, jsonb, boolean) to authenticated;
