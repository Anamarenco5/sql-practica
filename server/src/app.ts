// API REST. El frontend solo habla con estas rutas: nunca recibe credenciales
// ni puede elegir contra qué base ejecutar (eso lo decide el ejercicio).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { getSampleRows, getSchema, listDatasets } from './db/datasets.js';
import { ExerciseSchema, TOPICS, publicExercise, type Exercise } from './exercises/model.js';
import { canEdit, countOwnCustomExercises, deleteCustomExercise, findExercise, getAllExercises, saveCustomExercise } from './exercises/repository.js';
import { AuthError, createSession, destroySession, loadUser, login, LoginInput, register, RegisterInput, requireUser } from './auth/auth.js';
import { rateLimiter } from './util/rateLimit.js';
import { clearExpectedCache, grade } from './grading/grader.js';
import { buildReview } from './progress/review.js';
import { getAttempts, getDraft, getProgress, recordAttempt, saveDraft } from './progress/store.js';
import { lastRows, type ScriptOutcome } from './sql/executor.js';
import { runScript } from './sql/runner.js';
import { semaphore } from './util/semaphore.js';

// Limita pedidos simultáneos de ejecución (las conexiones a MySQL se limitan además en runner.ts).
const limit = semaphore(4).run;

const SqlBody = z.object({
  sql: z.string().max(config.limits.maxSqlLength),
  hintsUsed: z.number().int().min(0).max(20).default(0),
});

function slug(s: string): string {
  const base = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'ejercicio';
}

const CustomInput = ExerciseSchema.omit({ id: true, custom: true, ownerId: true });

/**
 * Valida un ejercicio personalizado: estructura (zod), dataset existente y que la
 * solución de referencia se ejecute y apruebe su propio ejercicio (incluidas las pruebas).
 */
async function validateCustom(body: unknown, id: string) {
  const parsed = CustomInput.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'definición'}: ${i.message}`) };
  }
  if (!listDatasets().some((d) => d.id === parsed.data.dataset)) {
    return { ok: false, errors: [`La base "${parsed.data.dataset}" no existe.`] };
  }
  for (const r of parsed.data.requirements) {
    try {
      new RegExp(r.pattern, 'i');
    } catch {
      return { ok: false, errors: [`El patrón "${r.pattern}" no es una expresión regular válida.`] };
    }
  }
  const exercise: Exercise = { ...parsed.data, id, custom: true };
  clearExpectedCache(id);
  try {
    const g = await grade(exercise, exercise.solution);
    if (!g.correct) {
      const errors = [
        'La solución de referencia no aprueba su propio ejercicio.',
        ...(g.error ? [`Error de MySQL: ${g.error.message}`] : []),
        ...g.feedback,
      ];
      return { ok: false, errors, grade: { ...g, output: forDisplay(g.output) } };
    }
    const warnings: string[] = [];
    const rows = g.output ? lastRows(g.output) : undefined;
    if (exercise.check.type === 'result' && rows && rows.rowCount === 0) {
      warnings.push('La solución devuelve 0 filas: cualquier consulta con las mismas columnas que no devuelva nada también aprobaría. Conviene agregar requisitos o cambiar el enunciado.');
    }
    if (exercise.check.type === 'state' && exercise.check.probes.length === 0 && exercise.check.verifyQueries.length === 0) {
      warnings.push('No hay pruebas ni consultas de verificación: cualquier script sin errores aprobaría.');
    }
    return { ok: true, warnings, exercise, grade: { ...g, output: forDisplay(g.output) } };
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  } finally {
    clearExpectedCache(id);
  }
}

/** Recorta las filas que viajan al navegador (la corrección usa el resultado completo). */
function forDisplay(out: ScriptOutcome | undefined) {
  if (!out) return undefined;
  return {
    ...out,
    results: out.results.map((r) =>
      r.kind === 'rows' && r.rows.length > config.limits.displayRows
        ? { ...r, rows: r.rows.slice(0, config.limits.displayRows), displayTruncated: true }
        : r,
    ),
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1); // Render: la IP real viene en X-Forwarded-For

  // Chequeo de salud de Render: va antes del filtro de Host porque Render lo pide con
  // su dirección interna. No devuelve datos ni usa cookies.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });

  // Hosts permitidos: la propia computadora y, si está configurada, la dirección pública.
  // - Host: frena ataques de "DNS rebinding".
  // - Origin: frena que otra web abierta en el navegador le haga pedidos a la API (CSRF).
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const publicHost = config.publicOrigin ? new URL(config.publicOrigin).host.toLowerCase() : '';
  const allowedHost = (h: string) => LOCAL.test(h) || (publicHost !== '' && h.toLowerCase() === publicHost);
  app.use((req, res, next) => {
    if (!allowedHost(req.headers.host ?? '')) return res.status(403).json({ error: 'Host no permitido.' });
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        ok = allowedHost(new URL(origin).host);
      } catch {
        ok = false;
      }
      if (!ok) return res.status(403).json({ error: 'Origen no permitido.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Solo JSON: un formulario de otra web no puede mandar este tipo sin permiso del navegador.
  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => {
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && hasBody && !req.is('application/json')) {
      return res.status(415).json({ error: 'El cuerpo tiene que ser JSON.' });
    }
    next();
  });
  app.use('/api', loadUser);

  const authLimit = rateLimiter(config.limits.authPerMinute);
  const runLimit = rateLimiter(config.limits.runsPerMinute);
  const tooMany = (res: Response, wait: number) => {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: `Demasiados pedidos seguidos. Esperá ${wait} segundos y volvé a intentar.` });
  };
  const viewer = (req: Request) => ({ id: req.user!.id, isAdmin: req.user!.isAdmin });

  // ---- Públicas ----
  app.get('/api/topics', (_req, res) => {
    res.json(Object.entries(TOPICS).map(([id, name]) => ({ id, name })));
  });

  // ---- Cuentas ----
  app.post('/api/auth/register', async (req, res) => {
    const wait = authLimit(`ip:${req.ip}`);
    if (wait) return tooMany(res, wait);
    const input = RegisterInput.parse(req.body);
    const user = await register(input);
    await createSession(res, user.id);
    res.status(201).json(user);
  });

  app.post('/api/auth/login', async (req, res) => {
    const wait = authLimit(`ip:${req.ip}`);
    if (wait) return tooMany(res, wait);
    const user = await login(LoginInput.parse(req.body));
    await createSession(res, user.id);
    res.json(user);
  });

  app.post('/api/auth/logout', async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'No iniciaste sesión.' });
    res.json(req.user);
  });

  // ---- Todo lo demás requiere sesión ----
  app.use('/api', requireUser);

  app.get('/api/datasets', (_req, res) => {
    res.json(listDatasets().map(({ id, name, description }) => ({ id, name, description })));
  });

  app.get('/api/datasets/:id/schema', async (req, res) => {
    if (!listDatasets().some((d) => d.id === req.params.id)) return res.status(404).json({ error: 'Dataset inexistente' });
    res.json(await getSchema(req.params.id));
  });

  app.get('/api/datasets/:id/tables/:table/sample', async (req, res) => {
    if (!listDatasets().some((d) => d.id === req.params.id)) return res.status(404).json({ error: 'Dataset inexistente' });
    const sample = await getSampleRows(req.params.id, req.params.table, Number(req.query.limit ?? 10));
    if (!sample) return res.status(404).json({ error: 'Tabla inexistente' });
    res.json(sample);
  });

  app.get('/api/exercises', async (req, res) => {
    const progress = await getProgress(req.user!.id);
    res.json(
      (await getAllExercises(viewer(req))).map((e) => ({
        id: e.id,
        title: e.title,
        topic: e.topic,
        difficulty: e.difficulty,
        mode: e.mode,
        dataset: e.dataset,
        source: e.source,
        custom: e.custom,
        public: e.public,
        mine: e.custom && e.ownerId === req.user!.id,
        progress: progress.get(e.id) ?? null,
      })),
    );
  });

  app.get('/api/exercises/:id', async (req, res) => {
    const ex = await findExercise(req.params.id, viewer(req));
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const progress = (await getProgress(req.user!.id)).get(ex.id) ?? null;
    res.json({ ...publicExercise(ex, req.user!.id), canEdit: canEdit(ex, viewer(req)), progress, draft: await getDraft(req.user!.id, ex.id) });
  });

  // Ejecutar (sin corregir): como apretar el rayo en Workbench.
  app.post('/api/exercises/:id/run', async (req, res) => {
    const wait = runLimit(`u:${req.user!.id}`) || runLimit(`ip:${req.ip}`);
    if (wait) return tooMany(res, wait);
    const ex = await findExercise(req.params.id, viewer(req));
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const body = SqlBody.parse(req.body);
    const out = await limit(() => runScript(ex.dataset, ex.mode, body.sql));
    res.json(forDisplay(out));
  });

  // Comprobar: ejecuta, corrige y registra el intento.
  app.post('/api/exercises/:id/check', async (req, res) => {
    const wait = runLimit(`u:${req.user!.id}`) || runLimit(`ip:${req.ip}`);
    if (wait) return tooMany(res, wait);
    const ex = await findExercise(req.params.id, viewer(req));
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const body = SqlBody.parse(req.body);
    const result = await limit(() => grade(ex, body.sql));
    await recordAttempt({ userId: req.user!.id, exerciseId: ex.id, sql: body.sql, correct: result.correct, errorCode: result.error?.code, hintsUsed: body.hintsUsed });
    res.json({ ...result, output: forDisplay(result.output) });
  });

  // La solución se habilita recién después de al menos un intento (o si el ejercicio es tuyo).
  app.get('/api/exercises/:id/solution', async (req, res) => {
    const ex = await findExercise(req.params.id, viewer(req));
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const p = (await getProgress(req.user!.id)).get(ex.id);
    if ((!p || p.attempts === 0) && !canEdit(ex, viewer(req))) {
      return res.status(403).json({ error: 'Intentá resolverlo al menos una vez (botón Comprobar) antes de ver la solución.' });
    }
    res.json({ solution: ex.solution, explanation: ex.explanation });
  });

  app.get('/api/exercises/:id/attempts', async (req, res) => {
    if (!(await findExercise(req.params.id, viewer(req)))) return res.status(404).json({ error: 'Ejercicio inexistente' });
    res.json(await getAttempts(req.user!.id, req.params.id));
  });

  app.put('/api/exercises/:id/draft', async (req, res) => {
    if (!(await findExercise(req.params.id, viewer(req)))) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const body = z.object({ sql: z.string().max(config.limits.maxSqlLength) }).parse(req.body);
    await saveDraft(req.user!.id, req.params.id, body.sql);
    res.json({ ok: true });
  });

  // ---- Panel de repaso ----
  app.get('/api/review', async (req, res) => {
    res.json(await buildReview(req.user!.id, await getAllExercises(viewer(req)), await getProgress(req.user!.id)));
  });

  // ---- Ejercicios personalizados ----
  const MAX_OWN = 100;

  app.get('/api/custom-exercises/:id', async (req, res) => {
    const ex = await findExercise(req.params.id, viewer(req));
    if (!ex || !ex.custom || !canEdit(ex, viewer(req))) return res.status(404).json({ error: 'Ejercicio personalizado inexistente' });
    const { ownerId: _o, ...rest } = ex;
    res.json(rest); // incluye la solución: lo podés editar
  });

  // Prueba la definición sin guardarla: la solución tiene que ejecutarse y aprobar su propio ejercicio.
  app.post('/api/custom-exercises/validate', async (req, res) => {
    const wait = runLimit(`u:${req.user!.id}`);
    if (wait) return tooMany(res, wait);
    const result = await limit(() => validateCustom(req.body, `c-borrador-${crypto.randomBytes(6).toString('hex')}`));
    res.status(result.ok ? 200 : 422).json(result);
  });

  app.post('/api/custom-exercises', async (req, res) => {
    const wait = runLimit(`u:${req.user!.id}`);
    if (wait) return tooMany(res, wait);
    if ((await countOwnCustomExercises(req.user!.id)) >= MAX_OWN) {
      return res.status(422).json({ ok: false, errors: [`Llegaste al máximo de ${MAX_OWN} ejercicios propios. Borrá alguno para crear otro.`] });
    }
    const id = `c-${slug(String(req.body?.title ?? 'ejercicio'))}-${crypto.randomBytes(3).toString('hex')}`;
    const result = await limit(() => validateCustom(req.body, id));
    if (!result.ok || !result.exercise) return res.status(422).json(result);
    // Solo una administradora puede publicar un ejercicio para todos.
    const isPublic = req.user!.isAdmin && Boolean(req.body?.public);
    await saveCustomExercise(result.exercise, req.user!.id, isPublic);
    res.status(201).json({ ok: true, id });
  });

  app.put('/api/custom-exercises/:id', async (req, res) => {
    const wait = runLimit(`u:${req.user!.id}`);
    if (wait) return tooMany(res, wait);
    const current = await findExercise(req.params.id, viewer(req));
    if (!current || !current.custom || !canEdit(current, viewer(req))) return res.status(404).json({ error: 'Ejercicio personalizado inexistente' });
    const result = await limit(() => validateCustom(req.body, current.id));
    if (!result.ok || !result.exercise) return res.status(422).json(result);
    const isPublic = req.user!.isAdmin ? Boolean(req.body?.public) : current.public;
    await saveCustomExercise(result.exercise, current.ownerId ?? req.user!.id, isPublic);
    clearExpectedCache(current.id);
    res.json({ ok: true, id: current.id });
  });

  app.delete('/api/custom-exercises/:id', async (req, res) => {
    const ex = await findExercise(req.params.id, viewer(req));
    if (!ex || !ex.custom || !canEdit(ex, viewer(req))) return res.status(404).json({ error: 'Ejercicio personalizado inexistente' });
    await deleteCustomExercise(ex.id);
    clearExpectedCache(ex.id);
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta inexistente' });
  });

  // En producción, el mismo servidor entrega la página (client/dist): una sola dirección.
  if (fs.existsSync(path.join(config.paths.client, 'index.html'))) {
    app.use(express.static(config.paths.client, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.paths.client, 'index.html'));
    });
  }

  // Errores: nunca devolvemos stack traces ni detalles internos al navegador.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message ?? 'Datos inválidos', details: err.issues.map((i) => i.message) });
    }
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    const e = err as { code?: string; message?: string; type?: string };
    if (e.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo no es un JSON válido.' });
    console.error('[error]', e.message ?? err);
    if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') return res.status(503).json({ error: 'No se pudo conectar a MySQL. Probá de nuevo en unos segundos.' });
    if (e.code === 'ER_ACCESS_DENIED_ERROR') return res.status(503).json({ error: 'MySQL rechazó las credenciales del servidor. ¿Corriste el setup con la misma configuración?' });
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}
