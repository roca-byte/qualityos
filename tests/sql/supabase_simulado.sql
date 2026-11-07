-- Imita lo mínimo de Supabase para probar la migración en un Postgres común:
-- los roles anon/authenticated, la tabla auth.users y auth.uid()/auth.jwt(),
-- que en Supabase leen el token del usuario que hace el pedido.
-- Los roles son de todo el servidor: se crean solo si no existen.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
