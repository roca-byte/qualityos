# Desarrollo — QualityOS

Información técnica para quien quiera estudiar, modificar o instalar una copia de la app.
Para usarla, ver el [README](README.md) y la [guía de uso](docs/GUIA.md). El contexto para
agentes de IA está en [CLAUDE.md](CLAUDE.md).

## Historia

Es la primera app de la suite. La versión original usaba Firebase y funcionaba para una sola
planta; esta es una **reconstrucción desde cero sobre Supabase**, pensada para que varias
empresas la usen con la misma instalación, cada una viendo solo sus datos.

## Cómo funciona por dentro

- **Sin señal primero.** La app trabaja siempre contra la copia de la tablet. Cada cambio queda
  en una "bandeja de salida" que se sube sola cuando hay conexión.
- **Nada se pisa.** Cada lote tiene un número de versión. Si dos equipos cambian el mismo lote,
  el servidor no acepta la versión vieja: la app avisa y deja elegir cuál queda.
- **Seguridad en la base.** Postgres con *Row Level Security*: cada fila pertenece a una
  empresa y la base impide ver o tocar datos de otra. Los lotes solo se guardan a través de una
  función que valida el rol.
- **Auditoría.** Cada versión de cada lote queda guardada con quién la hizo y cuándo.
- **Borrar no es borrar.** Un lote borrado queda marcado; así no "revive" si una tablet que
  estuvo sin señal sube una copia vieja.

Las decisiones y los problemas de la versión anterior que esto resuelve están en
[`docs/DISENO.md`](docs/DISENO.md).

## Tecnología

HTML, CSS y JavaScript puros, sin frameworks ni build. Base de datos y usuarios en
[Supabase](https://supabase.com) (Postgres). Única librería:
[supabase-js](https://github.com/supabase/supabase-js), incluida en el repo para que la app abra
sin internet. Comparte la identidad visual de la suite QualityOS: teal profundo, modo claro u
oscuro según el sistema y botones de 48 px para usar con guantes.

```
index.html               Estructura: barra superior + <main id="vista">
css/styles.css           Estilos (mobile first) + impresión A4
js/config.js             URL y clave pública de Supabase
js/reglas.js             Reglas de negocio puras: semáforo, peso, litros, dictamen
js/store.js              Datos en la tablet + bandeja de salida
js/nube.js               Todo lo que habla con Supabase
js/demo.js               Servidor de mentira del modo demo (y de las pruebas)
js/imprimir.js           Registro del lote para imprimir / PDF
js/editor.js             Editor de plantillas de control (⚙)
js/app.js                Pantallas y eventos
sw.js                    Service worker: la app abre sin señal
supabase/migrations/     Tablas, seguridad (RLS) y funciones, en orden
tests/                   Pruebas de reglas, base de datos e interfaz
tools/demo.js            Genera las capturas y el GIF de la guía
tools/video.js           Graba el video de demostración (MP4)
docs/                    Guía de uso, guía de Supabase y decisiones de diseño
```

## Pruebas

```bash
node --test 'tests/*.test.js'   # reglas de negocio (solo Node, sin instalar nada)
tests/sql/correr.sh             # tablas y permisos contra un Postgres local
node tests/e2e/flujo.js         # recorrido completo de la interfaz (Playwright)
node tests/e2e/primer-uso.js    # cuenta nueva: registro, invitación y bienvenida
node tests/e2e/demo.js          # modo demo: funciona y no hace ningún pedido a Supabase
node tests/e2e/plantillas.js    # armar una plantilla propia y usarla en un lote
```

Las capturas de la guía y el GIF se regeneran con `node tools/demo.js`, y el video con
`node tools/video.js` (Playwright y ffmpeg, con datos de ejemplo ficticios). Conviene correrlos
cada vez que cambia algo visible.

## Instalar una copia propia

Para uso **no comercial** (ver la licencia):

1. Crear un proyecto en Supabase y cargar las migraciones: [`docs/SUPABASE.md`](docs/SUPABASE.md).
2. Poner la URL y la clave *publishable* del proyecto en `js/config.js`.
3. Publicar la carpeta en un hosting estático (GitHub Pages, Cloudflare Pages…). Las rutas
   son relativas, así que funciona en un subdirectorio.

Para probarla en la compu: `python3 -m http.server 8000` y abrir `http://localhost:8000`
(con `file://` el service worker no anda).

## Licencias de terceros

`vendor/supabase.js` mantiene su propia licencia MIT (`vendor/supabase-LICENSE`).
