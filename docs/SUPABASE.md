# Conectar QualityOS con Supabase

Paso a paso para dejar la base lista. Se hace una sola vez.

## 1. Crear el proyecto

1. Entrá a [supabase.com](https://supabase.com) → **New project**.
2. Nombre: `qualityos`. Región: **South America (São Paulo)** (la más cercana).
3. Guardá la contraseña de la base en un lugar seguro (la app no la usa).

> El plan gratis permite 2 proyectos activos. Los que no se usan se pausan solos a la
> semana sin actividad; se reactivan desde el panel.

## 2. Cargar el esquema

1. En el proyecto: **SQL Editor** → **New query**.
2. Pegá todo el contenido de `supabase/migrations/0001_inicial.sql` y tocá **Run**.
3. En **Table Editor** tienen que aparecer: `empresas`, `miembros`, `invitaciones`, `lotes`
   y `lotes_historial`, todas con el candado de **RLS** activado.

## 3. Usuarios

En **Authentication → Sign In / Providers → Email**:

- Dejá activado **Email**.
- **Confirm email**: si queda activado, cada persona recibe un mail para confirmar su cuenta
  antes de poder entrar (más seguro). Si lo desactivás, entran apenas crean la cuenta.

En **Authentication → URL Configuration** poné en **Site URL** la dirección donde publiques
la app (por ejemplo `https://roca-byte.github.io/qualityos/`), para que el link del mail
de confirmación lleve ahí.

## 4. Conectar la app

En **Project Settings → API Keys** copiá:

- **Project URL** (algo como `https://abcdxyz.supabase.co`)
- La clave **publishable** (`sb_publishable_...`). Si tu proyecto muestra la vieja **anon**,
  sirve igual.

Y pegalas en `js/config.js`:

```js
window.QOS_CONFIG = {
  supabaseUrl: 'https://abcdxyz.supabase.co',
  supabaseKey: 'sb_publishable_...'
};
```

Esta clave es pública a propósito: va dentro de la app. Lo que protege los datos son las
reglas de seguridad de la base (RLS). **Nunca** pongas la clave `secret` / `service_role`.

Después de cambiar `config.js`, subí `VERSION` en `sw.js` para que los celulares bajen el
archivo nuevo.

## 5. Primer uso

1. Abrí la app → **Crear cuenta nueva** → confirmá el mail si hace falta → **Ingresar**.
2. Escribí tu nombre y el de la empresa → **Crear empresa**. Quedás como Administración.
3. ⚙ → configurá inductoras, líneas y datos del registro.
4. ⚙ → **Personas → Invitar**: email y rol de cada persona. Cada una crea su cuenta con ese
   mismo email y al entrar queda sumada.

## Roles

| Rol | Puede |
|---|---|
| Checker | Crear y controlar lotes, dictaminar si el control final está completo |
| Coordinación | Lo anterior, más dictaminar con pallets incompletos, modificar o reabrir lotes dictaminados, borrar lotes y ver la auditoría |
| Administración | Todo lo anterior, más configurar la empresa e invitar personas |

Estas reglas las hace cumplir la base de datos (función `guardar_lote` y políticas RLS),
no solo la pantalla.

## Consultas útiles (SQL Editor)

```sql
-- Lotes del mes con su dictamen
select fecha, numero, producto, cliente, dictamen
from lotes where not borrado and fecha >= date_trunc('month', current_date)
order by fecha;

-- Quién cambió un lote y cuándo
select version, estado, dictamen, usuario, cuando
from lotes_historial where lote_id = '<id del lote>' order by version;
```
