// Corrección automática de ejercicios.
//
// Tipo "result" (consultas): se ejecutan tu script y la solución de referencia y se
// compara el ÚLTIMO resultado de cada uno. Así se aceptan consultas distintas que
// devuelven lo mismo (JOIN vs subconsulta, alias distintos, etc.).
//
// Tipo "state" (modificaciones): tu script corre en un sandbox nuevo y la solución
// en otro. Después, en ambos, se corren las "pruebas" (sentencias que deben fallar o
// funcionar) y las consultas de verificación, y se comparan los resultados.
import type { Exercise } from '../exercises/model.js';
import { lastRows, runStatements, type ScriptOutcome } from '../sql/executor.js';
import type { SqlErrorInfo } from '../sql/errors.js';
import { guardToError, openEnv, parseScript, type Env } from '../sql/runner.js';
import { splitSql, stripCommentsAndStrings } from '../sql/splitter.js';
import { compareResults, type ResultSet } from './compare.js';

export interface ProbeOutcome {
  description: string;
  expected: 'ok' | 'error';
  got: 'ok' | 'error';
  passed: boolean;
  message?: string;
}

export interface GradeResult {
  correct: boolean;
  summary: string;
  feedback: string[];
  warnings: string[];
  error?: SqlErrorInfo; // error de MySQL en tu script
  output?: ScriptOutcome; // lo que devolvió tu script (para mostrarlo)
  probes?: ProbeOutcome[];
}

function toSet(r: { columns: { name: string }[]; rows: unknown[][] }): ResultSet {
  return { columns: r.columns.map((c) => c.name), rows: r.rows };
}

function checkRequirements(ex: Exercise, sql: string): string[] {
  const clean = stripCommentsAndStrings(sql, true); // sin comentarios, pero con los textos ('Salud')
  const msgs: string[] = [];
  for (const req of ex.requirements) {
    const found = new RegExp(req.pattern, 'i').test(clean);
    if (req.forbid ? found : !found) msgs.push(req.message);
  }
  return msgs;
}

// La salida de la solución de referencia no cambia: la guardamos en memoria.
const expectedCache = new Map<string, Promise<ResultSet | ExpectedState>>();

interface ExpectedState {
  verify: ResultSet[];
}

export function clearExpectedCache(id?: string) {
  if (id) expectedCache.delete(id);
  else expectedCache.clear();
}

async function runSolutionForResult(ex: Exercise): Promise<ResultSet> {
  const env = await openEnv(ex.dataset, ex.mode);
  try {
    const out = await runStatements(env.conn, env.role, splitSql(ex.solution));
    if (out.error) throw new Error(`La solución de referencia de "${ex.id}" falla: ${out.error.message}`);
    const rows = lastRows(out);
    if (!rows) throw new Error(`La solución de referencia de "${ex.id}" no devuelve filas.`);
    return toSet(rows);
  } finally {
    await env.dispose();
  }
}

async function runVerifyQueries(env: Env, queries: string[]): Promise<ResultSet[] | SqlErrorInfo> {
  const sets: ResultSet[] = [];
  for (const q of queries) {
    const out = await runStatements(env.conn, env.role, splitSql(q));
    if (out.error) return out.error;
    const rows = lastRows(out);
    sets.push(rows ? toSet(rows) : { columns: [], rows: [] });
  }
  return sets;
}

async function runProbes(env: Env, ex: Exercise): Promise<ProbeOutcome[]> {
  if (ex.check.type !== 'state') return [];
  const outcomes: ProbeOutcome[] = [];
  for (const p of ex.check.probes) {
    // cada prueba dentro de una transacción que se deshace, para que no afecte a las siguientes
    await env.conn.query('START TRANSACTION');
    const out = await runStatements(env.conn, env.role, splitSql(p.sql));
    await env.conn.query('ROLLBACK');
    const got = out.error ? 'error' : 'ok';
    outcomes.push({
      description: p.description,
      expected: p.expect,
      got,
      passed: got === p.expect,
      message: out.error ? out.error.message : undefined,
    });
  }
  return outcomes;
}

async function runSolutionForState(ex: Exercise): Promise<ExpectedState> {
  if (ex.check.type !== 'state') throw new Error('tipo de corrección inválido');
  const env = await openEnv(ex.dataset, 'sandbox');
  try {
    const out = await runStatements(env.conn, env.role, splitSql(ex.solution));
    if (out.error) throw new Error(`La solución de referencia de "${ex.id}" falla: ${out.error.message}`);
    const probes = await runProbes(env, ex);
    const bad = probes.find((p) => !p.passed);
    if (bad) throw new Error(`La solución de referencia de "${ex.id}" no pasa la prueba "${bad.description}".`);
    const verify = await runVerifyQueries(env, ex.check.verifyQueries);
    if (!Array.isArray(verify)) throw new Error(`Consulta de verificación inválida en "${ex.id}": ${verify.message}`);
    return { verify };
  } finally {
    await env.dispose();
  }
}

function cached<T extends ResultSet | ExpectedState>(ex: Exercise, fn: () => Promise<T>): Promise<T> {
  let p = expectedCache.get(ex.id);
  if (!p) {
    p = fn();
    p.catch(() => expectedCache.delete(ex.id)); // si falló, reintentar la próxima
    expectedCache.set(ex.id, p);
  }
  return p as Promise<T>;
}

export async function grade(ex: Exercise, sql: string): Promise<GradeResult> {
  let stmts;
  try {
    stmts = parseScript(sql, ex.mode);
  } catch (err) {
    const error = guardToError(err);
    return { correct: false, summary: 'La consulta no se pudo ejecutar.', feedback: [], warnings: [], error };
  }
  const reqMsgs = checkRequirements(ex, sql);

  if (ex.check.type === 'result') {
    const check = ex.check;
    const env = await openEnv(ex.dataset, ex.mode);
    let output: ScriptOutcome;
    try {
      output = await runStatements(env.conn, env.role, stmts);
    } finally {
      await env.dispose();
    }
    if (output.error) {
      return { correct: false, summary: 'Tu consulta tiene un error.', feedback: [], warnings: [], error: output.error, output };
    }
    const mine = lastRows(output);
    if (!mine) {
      return { correct: false, summary: 'Tu script no devuelve ninguna tabla de resultados.', feedback: ['El ejercicio se corrige comparando el resultado de tu último SELECT.'], warnings: [], output };
    }
    if (mine.truncated) {
      return { correct: false, summary: 'Tu consulta devuelve demasiadas filas.', feedback: ['El resultado superó el máximo de filas permitido. ¿Te falta una condición de JOIN (producto cartesiano)?'], warnings: [], output };
    }
    const expected = await cached(ex, () => runSolutionForResult(ex));
    const cmp = compareResults(toSet(mine), expected as ResultSet, check);
    const correct = cmp.equal && reqMsgs.length === 0;
    return {
      correct,
      summary: correct ? '¡Correcto! Tu resultado coincide con el esperado.' : cmp.equal ? 'El resultado es correcto, pero no cumple lo que pide el ejercicio.' : 'El resultado no coincide con el esperado.',
      feedback: [...reqMsgs, ...cmp.feedback],
      warnings: cmp.warnings,
      output,
    };
  }

  // ---- tipo "state" ----
  const check = ex.check;
  const env = await openEnv(ex.dataset, 'sandbox');
  let output: ScriptOutcome;
  let probes: ProbeOutcome[] = [];
  let verify: ResultSet[] | SqlErrorInfo = [];
  try {
    output = await runStatements(env.conn, env.role, stmts);
    if (!output.error) {
      probes = await runProbes(env, ex);
      verify = await runVerifyQueries(env, check.verifyQueries);
    }
  } finally {
    await env.dispose();
  }
  if (output.error) {
    return { correct: false, summary: 'Tu script tiene un error.', feedback: [], warnings: [], error: output.error, output };
  }
  const feedback: string[] = [...reqMsgs];
  for (const p of probes) {
    if (!p.passed) {
      feedback.push(
        p.expected === 'error'
          ? `Prueba no superada: "${p.description}" debería ser rechazada por la base, pero se aceptó.`
          : `Prueba no superada: "${p.description}" debería funcionar, pero falló: ${p.message ?? ''}`,
      );
    }
  }
  if (!Array.isArray(verify)) {
    feedback.push(`Después de tu script, la verificación falló: ${verify.message}`);
  } else {
    const expected = (await cached(ex, () => runSolutionForState(ex))) as ExpectedState;
    verify.forEach((set, i) => {
      const cmp = compareResults(set, expected.verify[i], { orderMatters: false, checkColumnNames: false, numericTolerance: check.numericTolerance });
      if (!cmp.equal) {
        feedback.push(`El estado final de la base no es el esperado (verificación ${i + 1}).`, ...cmp.feedback);
      }
    });
  }
  const correct = feedback.length === 0;
  return {
    correct,
    summary: correct ? '¡Correcto! La base quedó como se esperaba y pasó todas las pruebas.' : 'Todavía no: revisá las observaciones.',
    feedback,
    warnings: [],
    output,
    probes,
  };
}
