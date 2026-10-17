// Punto de entrada para ejecutar SQL del alumno en el entorno correcto.
import type { Connection } from 'mysql2/promise';
import { config } from '../config.js';
import { openConnection } from '../db/connections.js';
import { datasetDbName } from '../db/datasets.js';
import { createSandbox } from '../db/sandbox.js';
import { toErrorInfo, type SqlErrorInfo } from './errors.js';
import { prepareSession, runStatements, type ScriptOutcome } from './executor.js';
import { checkStatements, GuardError, type ExecMode } from './guard.js';
import { splitSql, type Statement } from './splitter.js';
import { semaphore } from '../util/semaphore.js';

export class UserInputError extends Error {}

/** Divide y valida el script. Lanza GuardError/UserInputError con mensajes para el alumno. */
export function parseScript(sql: string, mode: ExecMode): Statement[] {
  if (sql.length > config.limits.maxSqlLength) {
    throw new UserInputError(`El script es demasiado largo (máximo ${config.limits.maxSqlLength} caracteres).`);
  }
  const stmts = splitSql(sql);
  if (stmts.length === 0) throw new UserInputError('No hay ninguna sentencia para ejecutar.');
  if (stmts.length > config.limits.maxStatements) {
    throw new UserInputError(`Demasiadas sentencias (máximo ${config.limits.maxStatements}).`);
  }
  checkStatements(stmts, mode);
  return stmts;
}

export function guardToError(err: unknown): SqlErrorInfo {
  if (err instanceof GuardError) {
    return { code: 'BLOQUEADO', message: err.message, statementIndex: err.statementIndex, statementLine: err.statementLine };
  }
  if (err instanceof UserInputError) return { code: 'ENTRADA_INVALIDA', message: err.message };
  return toErrorInfo(err);
}

export interface Env {
  conn: Connection;
  role: 'reader' | 'sandbox';
  dispose: () => Promise<void>;
}

// Cada usuario de MySQL tiene un máximo de 20 conexiones (MAX_USER_CONNECTIONS del setup).
// Cada entorno usa 1 conexión, más 1 extra si hay que cancelar por tiempo; el pool de
// sandboxes usa SANDBOX_POOL más. Con 8 entornos por usuario queda margen de sobra.
const envSlots = { reader: semaphore(8), sandbox: semaphore(8) };

/** Abre el entorno de ejecución: la base de práctica (solo lectura) o un sandbox nuevo. */
export async function openEnv(dataset: string, mode: ExecMode): Promise<Env> {
  const role = mode === 'readonly' ? 'reader' : 'sandbox';
  const slot = envSlots[role];
  await slot.acquire();
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      slot.release();
    }
  };
  try {
    if (mode === 'readonly') {
      const conn = await openConnection('reader', datasetDbName(dataset));
      await prepareSession(conn, { readOnly: true });
      return { conn, role, dispose: () => conn.end().catch(() => {}).finally(release) };
    }
    const sbx = await createSandbox(dataset);
    await prepareSession(sbx.conn, { readOnly: false });
    return { conn: sbx.conn, role, dispose: () => sbx.dispose().finally(release) };
  } catch (err) {
    release();
    throw err;
  }
}

/** Ejecuta un script completo en un entorno nuevo y lo descarta. */
export async function runScript(dataset: string, mode: ExecMode, sql: string): Promise<ScriptOutcome> {
  let stmts: Statement[];
  try {
    stmts = parseScript(sql, mode);
  } catch (err) {
    return { results: [], error: guardToError(err) };
  }
  const env = await openEnv(dataset, mode);
  try {
    return await runStatements(env.conn, env.role, stmts);
  } finally {
    await env.dispose();
  }
}
