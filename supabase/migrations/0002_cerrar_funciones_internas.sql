-- Supabase da EXECUTE a "authenticated" por defecto en las funciones nuevas.
-- Estas dos son internas (el trigger de auditoría y un cálculo que usa guardar_lote):
-- nadie las tiene que poder llamar desde la app.
revoke execute on function public.registrar_historial() from authenticated;
revoke execute on function public.pallets_faltantes(jsonb) from authenticated;
