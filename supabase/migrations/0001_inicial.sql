-- QualityOS · esquema inicial en Supabase (Postgres)
--
-- Ideas principales (ver docs/DISENO.md):
--  * Multiempresa: cada fila cuelga de una empresa y la base misma (RLS)
--    impide ver datos de otra. No depende de lo que muestre la pantalla.
--  * Los lotes NO se escriben directo: se guardan con la función guardar_lote(),
--    que valida permisos, detecta conflictos (dos tablets editando el mismo lote)
--    y nunca pisa en silencio una versión más nueva.
--  * Borrar = marcar borrado (lápida). Así un lote borrado no "revive" cuando una
--    tablet que estuvo sin señal sube su copia vieja.
--  * Cada cambio de un lote queda en lotes_historial (quién, cuándo, qué).

-- ─────────────────────────── Tablas ───────────────────────────

create table public.empresas (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null check (length(trim(nombre)) > 0),
  -- Configuración editable desde la app: inductoras, líneas, datos del documento.
  config  jsonb not null default '{}'::jsonb,
  creada  timestamptz not null default now()
);

create table public.miembros (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  nombre     text not null default '',
  rol        text not null check (rol in ('checker', 'coordinacion', 'admin')),
  activo     boolean not null default true,
  creado     timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index miembros_user_idx on public.miembros(user_id);

-- Invitaciones por email: la persona crea su cuenta y al entrar se suma sola.
-- Así no hace falta crear usuarios desde el navegador del admin.
create table public.invitaciones (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  email      text not null check (email = lower(trim(email))),
  rol        text not null check (rol in ('checker', 'coordinacion', 'admin')),
  creada     timestamptz not null default now(),
  primary key (empresa_id, email)
);

create table public.lotes (
  -- El id lo genera la tablet (crypto.randomUUID) para poder crear lotes sin señal.
  id             uuid primary key,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  -- Columnas sacadas de "datos" para poder buscar y filtrar con SQL (y Power BI).
  numero         text not null,
  producto       text not null,
  cliente        text not null default '',
  linea          text not null default '',
  fecha          date,
  estado         text not null default 'activo'
                 check (estado in ('activo', 'aprobado', 'aprobado_parcial', 'retenido')),
  dictamen       text check (dictamen in ('APROBADO', 'APROBADO_PARCIAL', 'RETENIDO')),
  -- El lote completo: cabecera, control en línea, control final y observaciones.
  datos          jsonb not null,
  version        integer not null default 1,
  borrado        boolean not null default false,
  creado_por     uuid,
  creado         timestamptz not null default now(),
  modificado_por uuid,
  -- Hora del SERVIDOR. Antes mandaba el reloj de cada tablet y una con la hora
  -- adelantada siempre ganaba.
  modificado     timestamptz not null default now()
);
create index lotes_empresa_mod_idx on public.lotes(empresa_id, modificado);
create index lotes_empresa_cliente_idx on public.lotes(empresa_id, cliente);

create table public.lotes_historial (
  id         bigint generated always as identity primary key,
  lote_id    uuid not null,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  version    integer not null,
  estado     text not null,
  dictamen   text,
  borrado    boolean not null,
  datos      jsonb not null,
  usuario    uuid,
  cuando     timestamptz not null default now()
);
create index lotes_historial_lote_idx on public.lotes_historial(lote_id, version);

-- ─────────────────────── Funciones de apoyo ───────────────────────
-- security definer: corren con permisos del dueño para poder leer "miembros"
-- desde las políticas sin caer en recursión de RLS.

create function public.mi_rol(p_empresa uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from public.miembros
  where empresa_id = p_empresa and user_id = auth.uid() and activo
$$;

create function public.es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_rol(p_empresa) is not null
$$;

create function public.es_admin(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_rol(p_empresa) = 'admin'
$$;

-- Pallets del Control Final con algún check sin completar (misma regla que
-- Reglas.palletsFaltantes en js/reglas.js).
create function public.pallets_faltantes(p_datos jsonb) returns integer
language sql immutable set search_path = public as $$
  select count(*)::integer
  from jsonb_array_elements(coalesce(p_datos->'final'->'pallets', '[]'::jsonb)) as p
  where coalesce(p->>'idOK', 'null') = 'null'
     or coalesce(p->>'qrOK', 'null') = 'null'
     or coalesce(p->>'paletOK', 'null') = 'null'
     or coalesce(p->>'indCFOK', 'null') = 'null'
$$;

-- ─────────────────────── Seguridad por fila ───────────────────────

alter table public.empresas        enable row level security;
alter table public.miembros        enable row level security;
alter table public.invitaciones    enable row level security;
alter table public.lotes           enable row level security;
alter table public.lotes_historial enable row level security;

create policy empresas_ver on public.empresas
  for select to authenticated using (public.es_miembro(id));
create policy empresas_editar on public.empresas
  for update to authenticated using (public.es_admin(id)) with check (public.es_admin(id));

create policy miembros_ver on public.miembros
  for select to authenticated using (public.es_miembro(empresa_id));
create policy miembros_admin_editar on public.miembros
  for update to authenticated using (public.es_admin(empresa_id)) with check (public.es_admin(empresa_id));
create policy miembros_admin_quitar on public.miembros
  for delete to authenticated using (public.es_admin(empresa_id) and user_id <> auth.uid());

create policy invitaciones_admin on public.invitaciones
  for all to authenticated using (public.es_admin(empresa_id)) with check (public.es_admin(empresa_id));

-- Lotes: todos los miembros leen (incluidas las lápidas, para sincronizar).
-- No hay política de insert/update/delete: solo se escribe con guardar_lote().
create policy lotes_ver on public.lotes
  for select to authenticated using (public.es_miembro(empresa_id));

create policy lotes_historial_ver on public.lotes_historial
  for select to authenticated
  using (public.mi_rol(empresa_id) in ('coordinacion', 'admin'));

revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.lotes, public.lotes_historial from authenticated;
grant select on public.empresas, public.miembros, public.lotes, public.lotes_historial to authenticated;
grant update (nombre, config) on public.empresas to authenticated;
grant update (rol, activo) on public.miembros to authenticated;
grant delete on public.miembros to authenticated;
grant select, insert, update, delete on public.invitaciones to authenticated;

-- ─────────────────────── Auditoría ───────────────────────

create function public.registrar_historial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.lotes_historial (lote_id, empresa_id, version, estado, dictamen, borrado, datos, usuario)
  values (new.id, new.empresa_id, new.version, new.estado, new.dictamen, new.borrado, new.datos, auth.uid());
  return new;
end $$;

create trigger lotes_historial_trg
  after insert or update on public.lotes
  for each row execute function public.registrar_historial();

-- ─────────────────────── Funciones que usa la app ───────────────────────

-- Crea una empresa y deja a quien la crea como admin.
create function public.crear_empresa(p_nombre text, p_mi_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  insert into public.empresas (nombre) values (trim(p_nombre)) returning id into v_id;
  insert into public.miembros (empresa_id, user_id, nombre, rol)
  values (v_id, auth.uid(), trim(coalesce(p_mi_nombre, '')), 'admin');
  return v_id;
end $$;

-- Suma al usuario a las empresas que lo invitaron (por su email de login).
create function public.aceptar_invitaciones(p_mi_nombre text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email', '')); v_n integer;
begin
  if auth.uid() is null or v_email = '' then return 0; end if;
  insert into public.miembros (empresa_id, user_id, nombre, rol)
  select i.empresa_id, auth.uid(), trim(coalesce(p_mi_nombre, '')), i.rol
  from public.invitaciones i where i.email = v_email
  on conflict (empresa_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  delete from public.invitaciones where email = v_email;
  return v_n;
end $$;

-- Cada uno puede cambiar su propio nombre (sale en la firma del dictamen).
create function public.cambiar_mi_nombre(p_empresa uuid, p_nombre text) returns void
language sql security definer set search_path = public as $$
  update public.miembros set nombre = trim(p_nombre)
  where empresa_id = p_empresa and user_id = auth.uid()
$$;

-- Guarda un lote (crear, editar o borrar).
--   p_version_base: la versión que la tablet tenía al empezar a editar (0 = lote nuevo).
-- Devuelve {ok:true, lote} o, si alguien lo cambió mientras tanto,
-- {ok:false, conflicto:true, lote:<la versión del servidor>}: la tablet decide
-- qué hacer, pero el servidor nunca pisa en silencio un cambio ajeno.
-- Reglas que se validan acá (no alcanza con esconder botones):
--   * Un lote ya dictaminado solo lo modifica coordinación o admin.
--   * Dictaminar con pallets incompletos en Control Final exige coordinación o admin.
--   * Borrar exige coordinación o admin.
create function public.guardar_lote(p_id uuid, p_empresa uuid, p_version_base integer,
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
      version = v_actual.version + 1,
      modificado_por = auth.uid(), modificado = now()
    where id = p_id returning * into v_fila;
  else
    if p_version_base <> 0 then
      -- La tablet cree que el lote existe pero el servidor no lo tiene.
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

revoke execute on all functions in schema public from public, anon;
grant execute on function public.crear_empresa(text, text),
                          public.aceptar_invitaciones(text),
                          public.cambiar_mi_nombre(uuid, text),
                          public.guardar_lote(uuid, uuid, integer, jsonb, boolean),
                          public.mi_rol(uuid), public.es_miembro(uuid), public.es_admin(uuid)
  to authenticated;
