# SQL Práctica

Plataforma personal para practicar SQL sobre **MySQL real**, pensada para preparar el final de **Diseño de Bases de Datos**. Está inspirada en [Aprende SQL](https://www.aprendesql.dev/): escribís la consulta, la ejecutás y comprobás si es correcta.

Trae **94 ejercicios** sobre la base **Universidad** de los trabajos prácticos:

| Tema | Ejercicios |
|---|---|
| Consultas, JOIN, agregación, LEFT JOIN, subconsultas e integradores | TP3, secciones 1 a 6 |
| Detección y corrección de errores (la consulta propuesta viene cargada en el editor) | TP3, ejercicios 41 a 60 |
| Restricciones (CHECK, UNIQUE, FK con RESTRICT / CASCADE / SET NULL), triggers, procedimientos y funciones | TP4 |
| Procedimientos con transacciones, handler, ROLLBACK y RESIGNAL | TP5 completo |

## Qué hace

- Muestra el enunciado, las tablas (columnas, tipos, PK/FK) y una muestra de los datos.
- Tiene un editor SQL con resaltado de sintaxis y autocompletado de tablas y columnas.
- **Ejecuta en MySQL** y muestra el resultado en una tabla, o el error del motor con una explicación en español.
- **Corrige automáticamente**: compara *qué devuelve* tu consulta con la solución de referencia, así que se aceptan formas distintas de llegar al mismo resultado (JOIN o subconsulta, `YEAR()` o `BETWEEN`, alias distintos…).
- En los ejercicios de modificación (UPDATE, CHECK, triggers…) trabajás sobre una **copia temporal** de la base. Después se verifica el estado final y se corren pruebas que deben fallar o funcionar.
- Muestra pistas de a una y la solución comentada, que se habilita después del primer intento.
- Guarda tus intentos, lo que ya resolviste y un borrador automático de cada ejercicio.
- **Panel "Para repasar"**: ejercicios intentados sin resolver, resueltos con muchos intentos fallidos o con pistas, los conceptos que más se repiten en ellos y tus errores de MySQL más frecuentes.
- **Filtros** por texto (título o TP), dificultad, estado, tipo y origen.
- **Ejercicios propios**: un formulario para cargar enunciado, solución, pistas y criterios de corrección. Antes de guardar, la solución se ejecuta y tiene que aprobar su propio ejercicio.

## Cuentas de usuario

Para usar la app hay que crear una cuenta con email y contraseña. Cada persona tiene su propio progreso, intentos, borradores y ejercicios propios.

- Las contraseñas se guardan con un hash `scrypt` con sal: nunca en texto plano.
- La sesión es una cookie `HttpOnly` (JavaScript no la puede leer) que dura 30 días.
- Los emails de `ADMIN_EMAILS` (en `server/.env`) tienen permisos de administradora: pueden **publicar** ejercicios propios para que los vea todo el mundo (aparecen como "Extra"). El resto de los ejercicios propios son privados.
- Hay límites por persona y por IP: 40 ejecuciones por minuto y 10 intentos de login por minuto.

## Requisitos

| Programa | Versión | Cómo comprobarlo |
|---|---|---|
| Node.js | 22.12 o superior | `node -v` |
| MySQL Server | 8.0 o superior (el mismo que usás con Workbench) | `mysql --version` o Workbench → *Server Status* |
| Git | cualquiera reciente | `git --version` |

> El servicio de MySQL tiene que estar iniciado. En Windows se llama **MySQL80** (Servicios de Windows), o podés iniciarlo desde Workbench.

## Instalación (una sola vez)

En una terminal de VS Code (PowerShell), dentro de la carpeta del proyecto:

```powershell
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de configuración
copy server\.env.example server\.env
```

Abrí `server/.env` y completá:

- `MYSQL_ADMIN_PASSWORD`: la contraseña de **root** de tu MySQL (la de Workbench). Solo se usa en el paso 3.
- `APP_DB_PASSWORD`, `READER_DB_PASSWORD`, `SANDBOX_DB_PASSWORD`: inventá tres contraseñas nuevas. Son de los usuarios que va a crear el setup, **no** las de root.

```powershell
# 3. Crear usuarios, permisos y cargar la base Universidad (~10 segundos)
npm run db:setup
```

Al terminar tiene que decir `Listo`. Si después borrás `MYSQL_ADMIN_PASSWORD` del `.env`, la app sigue funcionando: root solo se usa durante el setup.

## Uso diario

```powershell
npm run dev
```

Abrí <http://localhost:5173>.

| Atajo | Acción |
|---|---|
| `Ctrl + Enter` | Ejecutar |
| `Ctrl + Shift + Enter` | Comprobar |

Para detener el servidor: `Ctrl + C` en la terminal.

## Publicar en internet (Render + Aiven, gratis)

La página corre en **Render** y la base de datos en **Aiven for MySQL** (plan Free). Ninguno de los dos pide tarjeta.

**1. Aiven (MySQL)**
1. Creá un servicio **MySQL** con el plan **Free** (ojo: el que aparece por defecto es "Developer", que es pago).
2. En *Connection information* anotá **Host** y **Port**, y descargá el **CA certificate** (`ca.pem`).
3. Opcional: desde la PC, con esos datos en `server/.env` (más `MYSQL_SSL=required` o `MYSQL_SSL_CA`), `npm run db:check` verifica que todo funcione.

**2. Render (la página)**
1. En Render: **New → Blueprint**, conectá este repositorio de GitHub. Render lee `render.yaml`.
2. Completá las variables secretas que pide:

| Variable | Valor |
|---|---|
| `PUBLIC_ORIGIN` | opcional: en Render se toma sola de `RENDER_EXTERNAL_URL`. Cargala solo si usás un dominio propio |
| `MYSQL_HOST` / `MYSQL_PORT` | los de Aiven |
| `MYSQL_ADMIN_USER` | `avnadmin` |
| `MYSQL_ADMIN_PASSWORD` | la contraseña de `avnadmin` |
| `MYSQL_SSL_CA` | el contenido completo de `ca.pem` (desde `-----BEGIN CERTIFICATE-----` hasta `-----END CERTIFICATE-----`) |
| `ADMIN_EMAILS` | tu email (con el que te vas a registrar) |

Las contraseñas de los tres usuarios internos (`APP_DB_PASSWORD`, etc.) las genera Render solo.

3. Al arrancar, con `AUTO_SETUP=1`, el servidor crea las tablas y los usuarios, y carga la base Universidad en Aiven (la primera vez tarda un minuto más).

**Límites del plan gratis:** Render apaga la página después de 15 minutos sin uso y tarda alrededor de un minuto en volver. Aiven puede apagar servicios gratis sin actividad: se vuelven a encender desde su panel.

## Pruebas

```powershell
npm test
```

Corre unas 220 pruebas (tarda unos 3 minutos):

- **Unitarias**: divisor de sentencias, comparador de resultados y filtros de seguridad.
- **Contra MySQL real**: cada solución de referencia aprueba su propio ejercicio, un script vacío no aprueba ninguno de modificación, y las respuestas incorrectas típicas se rechazan.
- **Seguridad** (`test/security.test.ts`): intentos de escalar privilegios, leer otras bases o archivos, bucles infinitos, resultados gigantes, pedidos desde otras webs, 20 comprobaciones simultáneas y persistencia del progreso.

Requiere haber corrido `npm run db:setup`.

## Arquitectura

```
sql-practica/
├─ client/                 React + TypeScript (Vite)
│  └─ src/
│     ├─ pages/            Dashboard (inicio) y ExercisePage (pantalla de ejercicio)
│     ├─ components/       Editor SQL (CodeMirror), resultados, esquema, markdown
│     └─ api.ts            Cliente de la API (solo rutas /api, sin credenciales)
├─ server/                 Node + Express + TypeScript (mysql2)
│  ├─ exercises/           Ejercicios de fábrica en JSON
│  ├─ src/
│  │  ├─ sql/              splitter (divide scripts, entiende DELIMITER), guard (filtros),
│  │  │                    executor (ejecución con límites), runner, errores en español
│  │  ├─ db/               conexiones, datasets y sandboxes
│  │  ├─ grading/          comparación de resultados y corrección
│  │  ├─ progress/         intentos y borradores
│  │  └─ setup/            npm run db:setup
│  └─ test/                pruebas (vitest)
└─ db/datasets/universidad/  dump de la base Universidad + dataset.json
```

En desarrollo, Vite (puerto 5173) redirige `/api` al backend (puerto 3001). El backend solo escucha en `127.0.0.1`.

### Seguridad y aislamiento

El setup crea tres usuarios de MySQL con permisos mínimos. La app **nunca** usa root.

| Usuario | Puede | Para qué |
|---|---|---|
| `sqlp_app` | todo, solo en `sqlpractica_app` | guardar intentos y borradores |
| `sqlp_reader` | solo `SELECT` en `sqlp_ds_*` | ejercicios de consulta |
| `sqlp_sandbox` | todo, solo en `sqlp_sbx_*`, y `SELECT` en `sqlp_ds_*` | ejercicios de modificación |

Además:

- Los ejercicios de consulta corren en una sesión `READ ONLY`.
- Los de modificación corren sobre una copia `sqlp_sbx_<id>` que se crea y se borra en cada ejecución. La base original `sqlp_ds_universidad` nunca cambia. Para que la copia sea rápida, la tabla `asistencias` (180.000 filas) se copia vacía.
- Si el servidor tiene `partial_revokes` activado (Aiven lo usa), MySQL toma `%` y `_` de los `GRANT` como caracteres literales y el permiso `sqlp_sbx_*` con comodín no funciona. El setup lo detecta solo: en ese caso `sqlp_sandbox` no recibe ningún permiso para crear bases, y el servidor, con el usuario administrador, crea cada copia, le da permiso a `sqlp_sandbox` solo sobre esa base y al terminar la borra y le quita el permiso. Por eso en Render `MYSQL_ADMIN_PASSWORD` tiene que quedar cargada.
- Hay un tiempo máximo por consulta (`QUERY_TIMEOUT_MS`, 5 s): si se pasa, se cancela con `KILL QUERY`. También hay un máximo de filas (`MAX_ROWS`, 10.000).
- Para que "Comprobar" responda rápido, el servidor mantiene `SANDBOX_POOL` copias (2 por defecto) ya preparadas. Se borran al cerrar el servidor con `Ctrl + C`, y las que queden de un corte se borran al iniciar.
- Se bloquean `GRANT`, `CREATE USER`, `DROP DATABASE`, `INTO OUTFILE`, `LOAD DATA`, `SET GLOBAL`, `USE`, SQL dinámico (`PREPARE`), eventos (`CREATE EVENT`), etc., con un mensaje claro. Los permisos de MySQL son la protección principal; este filtro es una segunda capa.
- Las filas se leen de a una (streaming) y se guardan como máximo `MAX_ROWS` por resultado. Así, un procedimiento que devuelve millones de filas no agota la memoria (antes llegaba a 1,4 GB; ahora, unos MB).
- Cada usuario de MySQL tiene como máximo 20 conexiones, y el servidor abre como mucho 8 entornos a la vez por usuario: el resto espera en fila.
- La API solo acepta pedidos con `Host` y `Origin` locales (`localhost` / `127.0.0.1`) y con cuerpo JSON. Así, una página web abierta en el navegador no puede usarla (CSRF ni DNS rebinding).
- En los enunciados (markdown) se escapa el HTML y solo se permiten enlaces `http(s)` o `mailto`.
- Cada 10 minutos se borran las copias de la base que hayan quedado sueltas.
- Las credenciales viven solo en `server/.env`, que está en `.gitignore`. El frontend no las ve nunca.
- El setup activa `log_bin_trust_function_creators` para que un usuario sin privilegios pueda crear triggers y funciones dentro de los sandbox.

### Cómo se corrige

- **Ejercicios de consulta** (`check.type = "result"`): se compara el último resultado de tu script con el de la solución. No importan los alias (salvo que el ejercicio lo exija), ni el orden de las filas (salvo que el enunciado pida `ORDER BY`), ni el formato numérico (`5` = `5.00`). Si las columnas vienen en otro orden, se aceptan con una advertencia.
- **Ejercicios de modificación** (`check.type = "state"`): tu script y la solución corren en sandboxes separados. Después se ejecutan en ambos las *consultas de verificación* y se comparan los resultados, y se corren *pruebas*: sentencias que deben ser rechazadas o aceptadas, por ejemplo insertar una nota de 11 cuando hay un CHECK.
- `requirements`: patrones que tu SQL debe contener (o no), por ejemplo "usá una subconsulta".

### Agregar ejercicios

- **Desde la app:** botón *Crear ejercicio propio* en el inicio. Se guardan en la base `sqlpractica_app` (tabla `ejercicios_personalizados`), así que no se pierden al actualizar el código. Los propios se editan o borran desde el enlace *Propio: editar* del ejercicio.
- **En el código:** agregando objetos a un JSON de `server/exercises/`. La validación está en `server/src/exercises/model.ts`. Después corré `npm test`: comprueba que cada solución de referencia apruebe su propio ejercicio y que un script vacío no apruebe ninguno de modificación.

Cómo armar la corrección de uno de modificación:

- **Pruebas** (`probes`): sentencias que la base debe rechazar (`"error"`) o aceptar (`"ok"`) después del script. Cada una se deshace al terminar, salvo que llame a un procedimiento que haga su propio `COMMIT`.
- **Consultas de verificación** (`verifyQueries`): se corren al final y su último resultado se compara con el de la solución. Para la estructura podés consultar `information_schema` (por ejemplo `REFERENTIAL_CONSTRAINTS` para ver el `DELETE_RULE` de una FK).

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| `ECONNREFUSED` | MySQL no está iniciado. Inicialo desde Servicios (MySQL80) o Workbench. |
| `ER_ACCESS_DENIED_ERROR` en el setup | La contraseña de root en `MYSQL_ADMIN_PASSWORD` no es correcta. |
| `Access denied for AuthId ... to database 'mysql'` | Versión vieja del setup con un servidor con `partial_revokes` (Aiven): actualizá el código. |
| `ER_ACCESS_DENIED_ERROR` al usar la app | Cambiaste contraseñas en `.env` después del setup: volvé a correr `npm run db:setup`. |
| Error 1419 al crear un trigger | Volvé a correr `npm run db:setup`. Si sigue fallando, en Workbench como root: `SET PERSIST log_bin_trust_function_creators = 1;` |
| Puerto 3001 o 5173 ocupado | Cambiá `PORT` en `server/.env` y el proxy en `client/vite.config.ts`. |

## Hoja de ruta

- [x] Etapa 1: inspección y plan
- [x] Etapa 2: estructura (frontend, backend, MySQL, setup)
- [x] Etapa 3: pantalla de ejercicio completa y 13 ejercicios de ejemplo
- [x] Etapa 4: 94 ejercicios (TP3, TP4, TP5), panel de repaso, filtros y ejercicios propios
- [x] Etapa 5: auditoría de seguridad con ataques reales, pruebas de carga y de persistencia
- [ ] Etapa 6: flujo de commits en GitHub
