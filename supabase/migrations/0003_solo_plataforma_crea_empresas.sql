-- Antes cualquiera con el link podía crear una cuenta y una empresa nueva (y usar
-- el proyecto de Supabase sin permiso). Ahora solo los dueños de la plataforma
-- crean empresas; el resto entra únicamente por invitación de un admin de empresa.

-- Quiénes administran la plataforma (no una empresa: toda la instalación).
-- Se carga a mano desde el SQL Editor, nunca desde la app:
--   insert into public.plataforma_admins (user_id)
--   select id from auth.users where email = 'tu@email.com';
create table public.plataforma_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado  timestamptz not null default now()
);
-- RLS activado y sin políticas: nadie la lee ni la escribe desde la app.
alter table public.plataforma_admins enable row level security;
revoke all on public.plataforma_admins from anon, authenticated;

create function public.puedo_crear_empresas() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.plataforma_admins where user_id = auth.uid())
$$;

create or replace function public.crear_empresa(p_nombre text, p_mi_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if not public.puedo_crear_empresas() then
    raise exception 'Solo el administrador de QualityOS puede crear empresas. Pedí que te inviten.';
  end if;
  insert into public.empresas (nombre) values (trim(p_nombre)) returning id into v_id;
  insert into public.miembros (empresa_id, user_id, nombre, rol)
  values (v_id, auth.uid(), trim(coalesce(p_mi_nombre, '')), 'admin');
  return v_id;
end $$;

revoke execute on function public.puedo_crear_empresas() from public, anon;
grant execute on function public.puedo_crear_empresas() to authenticated;
