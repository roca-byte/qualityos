-- Plantillas de control: qué se controla ya no está fijo, lo define la plantilla que cada
-- lote guarda en datos->'plantilla'. La regla "para dictaminar con unidades incompletas
-- hace falta coordinación" (guardar_lote) usa pallets_faltantes(), que ahora mira los
-- ítems obligatorios del control final de esa plantilla.
-- Misma regla que Reglas.unidadesFaltantes en js/reglas.js.

-- ¿Al valor le falta el dato? okNok: true/false; medición: lista de lecturas (todas
-- cargadas); texto y fecha: no vacíos.
create function public.valor_vacio(p_tipo text, p_valor jsonb) returns boolean
language sql immutable set search_path = public as $$
  select case
    when p_valor is null or jsonb_typeof(p_valor) = 'null' then true
    when p_tipo = 'okNok' then jsonb_typeof(p_valor) <> 'boolean'
    when jsonb_typeof(p_valor) = 'array' then
      jsonb_array_length(p_valor) = 0 or exists (
        select 1 from jsonb_array_elements(p_valor) as x
        where jsonb_typeof(x) = 'null' or trim(x #>> '{}') = '')
    else trim(p_valor #>> '{}') = ''
  end
$$;

create or replace function public.pallets_faltantes(p_datos jsonb) returns integer
language sql immutable set search_path = public as $$
  select case
    -- Formato con plantilla (formato 2)
    when p_datos ? 'plantilla' then (
      select count(*)::integer
      from jsonb_array_elements(coalesce(p_datos->'final'->'unidades', '[]'::jsonb)) as u
      where exists (
        select 1 from jsonb_array_elements(coalesce(p_datos->'plantilla'->'final', '[]'::jsonb)) as i
        where coalesce((i->>'obligatorio')::boolean, true)
          and public.valor_vacio(i->>'tipo', u->'v'->(i->>'id'))))
    -- Formato anterior: cuatro checks fijos por pallet
    else (
      select count(*)::integer
      from jsonb_array_elements(coalesce(p_datos->'final'->'pallets', '[]'::jsonb)) as p
      where coalesce(p->>'idOK', 'null') = 'null'
         or coalesce(p->>'qrOK', 'null') = 'null'
         or coalesce(p->>'paletOK', 'null') = 'null'
         or coalesce(p->>'indCFOK', 'null') = 'null')
  end
$$;

-- Funciones internas: nadie las llama desde la app.
revoke execute on function public.valor_vacio(text, jsonb) from public, anon, authenticated;
revoke execute on function public.pallets_faltantes(jsonb) from public, anon, authenticated;
