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

## Pruebas

```powershell
npm test
```

Corre pruebas unitarias (divisor de sentencias, comparador de resultados, filtros de seguridad) y pruebas contra MySQL real: entre otras cosas, verifica que **cada solución de referencia apruebe su propio ejercicio**, que las respuestas incorrectas típicas se rechacen y que el aislamiento funcione. Requiere haber corrido `npm run db:setup`.

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
- Hay un tiempo máximo por consulta (`QUERY_TIMEOUT_MS`, 5 s): si se pasa, se cancela con `KILL QUERY`. También hay un máximo de filas (`MAX_ROWS`, 10.000).
- Para que "Comprobar" responda rápido, el servidor mantiene `SANDBOX_POOL` copias (2 por defecto) ya preparadas. Se borran al cerrar el servidor con `Ctrl + C`, y las que queden de un corte se borran al iniciar.
- Se bloquean `GRANT`, `CREATE USER`, `DROP DATABASE`, `INTO OUTFILE`, `LOAD DATA`, `SET GLOBAL`, `USE`, etc., con un mensaje claro. Los permisos de MySQL son la protección principal; este filtro es una segunda capa.
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
| `ER_ACCESS_DENIED_ERROR` al usar la app | Cambiaste contraseñas en `.env` después del setup: volvé a correr `npm run db:setup`. |
| Error 1419 al crear un trigger | Volvé a correr `npm run db:setup`. Si sigue fallando, en Workbench como root: `SET PERSIST log_bin_trust_function_creators = 1;` |
| Puerto 3001 o 5173 ocupado | Cambiá `PORT` en `server/.env` y el proxy en `client/vite.config.ts`. |

## Hoja de ruta

- [x] Etapa 1: inspección y plan
- [x] Etapa 2: estructura (frontend, backend, MySQL, setup)
- [x] Etapa 3: pantalla de ejercicio completa y 13 ejercicios de ejemplo
- [x] Etapa 4: 94 ejercicios (TP3, TP4, TP5), panel de repaso, filtros y ejercicios propios
- [ ] Etapa 5: revisión de seguridad y pruebas de carga
- [ ] Etapa 6: flujo de commits en GitHub
