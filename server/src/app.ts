// API REST. El frontend solo habla con estas rutas: nunca recibe credenciales
// ni puede elegir contra qué base ejecutar (eso lo decide el ejercicio).
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { getSampleRows, getSchema, listDatasets } from './db/datasets.js';
import { TOPICS, publicExercise, type Exercise } from './exercises/model.js';
import { loadBuiltInExercises } from './exercises/repository.js';
import { grade } from './grading/grader.js';
import { getAttempts, getDraft, getProgress, recordAttempt, saveDraft } from './progress/store.js';
import type { ScriptOutcome } from './sql/executor.js';
import { runScript } from './sql/runner.js';

// Limita ejecuciones simultáneas (cada sandbox copia una base entera).
function semaphore(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
const limit = semaphore(4);

const SqlBody = z.object({
  sql: z.string().max(config.limits.maxSqlLength),
  hintsUsed: z.number().int().min(0).max(20).default(0),
});

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
  app.use(express.json({ limit: '100kb' }));

  const exercises = () => loadBuiltInExercises();
  const findExercise = (id: string): Exercise | undefined => exercises().find((e) => e.id === id);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/topics', (_req, res) => {
    res.json(Object.entries(TOPICS).map(([id, name]) => ({ id, name })));
  });

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

  app.get('/api/exercises', async (_req, res) => {
    const progress = await getProgress();
    res.json(
      exercises().map((e) => ({
        id: e.id,
        title: e.title,
        topic: e.topic,
        difficulty: e.difficulty,
        mode: e.mode,
        dataset: e.dataset,
        source: e.source,
        custom: e.custom,
        progress: progress.get(e.id) ?? null,
      })),
    );
  });

  app.get('/api/exercises/:id', async (req, res) => {
    const ex = findExercise(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const progress = (await getProgress()).get(ex.id) ?? null;
    res.json({ ...publicExercise(ex), progress, draft: await getDraft(ex.id) });
  });

  // Ejecutar (sin corregir): como apretar el rayo en Workbench.
  app.post('/api/exercises/:id/run', async (req, res) => {
    const ex = findExercise(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const body = SqlBody.parse(req.body);
    const out = await limit(() => runScript(ex.dataset, ex.mode, body.sql));
    res.json(forDisplay(out));
  });

  // Comprobar: ejecuta, corrige y registra el intento.
  app.post('/api/exercises/:id/check', async (req, res) => {
    const ex = findExercise(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const body = SqlBody.parse(req.body);
    const result = await limit(() => grade(ex, body.sql));
    await recordAttempt({ exerciseId: ex.id, sql: body.sql, correct: result.correct, errorCode: result.error?.code, hintsUsed: body.hintsUsed });
    res.json({ ...result, output: forDisplay(result.output) });
  });

  // La solución se habilita recién después de al menos un intento.
  app.get('/api/exercises/:id/solution', async (req, res) => {
    const ex = findExercise(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const p = (await getProgress()).get(ex.id);
    if (!p || p.attempts === 0) {
      return res.status(403).json({ error: 'Intentá resolverlo al menos una vez (botón Comprobar) antes de ver la solución.' });
    }
    res.json({ solution: ex.solution, explanation: ex.explanation });
  });

  app.get('/api/exercises/:id/attempts', async (req, res) => {
    if (!findExercise(req.params.id)) return res.status(404).json({ error: 'Ejercicio inexistente' });
    res.json(await getAttempts(req.params.id));
  });

  app.put('/api/exercises/:id/draft', async (req, res) => {
    if (!findExercise(req.params.id)) return res.status(404).json({ error: 'Ejercicio inexistente' });
    const body = z.object({ sql: z.string().max(config.limits.maxSqlLength) }).parse(req.body);
    await saveDraft(req.params.id, body.sql);
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta inexistente' });
  });

  // Errores: nunca devolvemos stack traces ni detalles internos al navegador.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Datos inválidos', details: err.issues.map((i) => i.message) });
    const e = err as { code?: string; message?: string };
    console.error('[error]', e.message ?? err);
    if (e.code === 'ECONNREFUSED') return res.status(503).json({ error: 'No se pudo conectar a MySQL. ¿Está iniciado el servicio?' });
    if (e.code === 'ER_ACCESS_DENIED_ERROR') return res.status(503).json({ error: 'MySQL rechazó las credenciales del servidor. ¿Corriste npm run db:setup con el mismo server/.env?' });
    res.status(500).json({ error: 'Error interno del servidor. Mirá la consola del backend para más detalles.' });
  });

  return app;
}
