// Ejecuta un script (varias sentencias) sobre una conexión dedicada y
// devuelve un resultado por sentencia, como el panel "Output" de Workbench.
import type { Connection, FieldPacket, ResultSetHeader } from 'mysql2/promise';
import { config } from '../config.js';
import { openConnection, type Role } from '../db/connections.js';
import { toErrorInfo, type SqlErrorInfo } from './errors.js';
import type { Statement } from './splitter.js';

export interface Column {
  name: string;
  type: string;
}

export interface RowsResult {
  kind: 'rows';
  index: number; // número de sentencia
  statement: string;
  columns: Column[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean; // se alcanzó MAX_ROWS
  durationMs: number;
}

export interface OkResult {
  kind: 'ok';
  index: number;
  statement: string;
  affectedRows: number;
  insertId: number;
  warningCount: number;
  info: string;
  durationMs: number;
}

export type StatementResult = RowsResult | OkResult;

export interface ScriptOutcome {
  results: StatementResult[];
  error?: SqlErrorInfo; // si una sentencia falla, se detiene ahí (como Workbench)
}

// Nombres legibles para los tipos de columna de MySQL (códigos del protocolo).
const TYPE_NAMES: Record<number, string> = {
  0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE', 6: 'NULL',
  7: 'TIMESTAMP', 8: 'BIGINT', 9: 'MEDIUMINT', 10: 'DATE', 11: 'TIME', 12: 'DATETIME',
  13: 'YEAR', 15: 'VARCHAR', 16: 'BIT', 245: 'JSON', 246: 'DECIMAL', 247: 'ENUM', 248: 'SET',
  252: 'TEXT', 253: 'VARCHAR', 254: 'CHAR',
};

/** Prepara la sesión con límites de seguridad. */
export async function prepareSession(conn: Connection, opts: { readOnly: boolean }): Promise<void> {
  await conn.query(`SET SESSION max_execution_time = ${Math.floor(config.limits.timeoutMs)}`); // aplica a SELECT
  await conn.query(`SET SESSION sql_select_limit = ${config.limits.maxRows + 1}`); // corta resultados gigantes
  await conn.query(`SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'`);
  if (opts.readOnly) await conn.query('SET SESSION TRANSACTION READ ONLY');
}

/**
 * Ejecuta una sentencia con un tiempo máximo. Si se pasa, abre una conexión
 * auxiliar del mismo usuario y cancela la consulta con KILL QUERY
 * (un usuario siempre puede cancelar sus propias consultas).
 */
async function queryWithTimeout(conn: Connection, role: Role, sql: string) {
  let timer: NodeJS.Timeout | undefined;
  let killed = false;
  const threadId = conn.threadId;
  timer = setTimeout(async () => {
    killed = true;
    try {
      const killer = await openConnection(role);
      await killer.query(`KILL QUERY ${Number(threadId)}`);
      await killer.end();
    } catch {
      /* si falla, el error de la consulta original igual llega */
    }
  }, config.limits.timeoutMs + 500);
  try {
    return await conn.query({ sql, rowsAsArray: true });
  } catch (err) {
    if (killed) {
      const e = err as { errno?: number };
      if (e.errno === undefined || e.errno === 1317) {
        Object.assign(err as object, { errno: 1317, code: 'ER_QUERY_INTERRUPTED' });
      }
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isHeader(x: unknown): x is ResultSetHeader {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && 'affectedRows' in x;
}

/** Convierte la respuesta de mysql2 (que varía si es SELECT, DML o CALL) en resultados uniformes. */
function normalize(index: number, statement: string, raw: unknown, fields: unknown, durationMs: number): StatementResult[] {
  const out: StatementResult[] = [];
  const mkRows = (rows: unknown[][], f: FieldPacket[]): RowsResult => {
    const truncated = rows.length > config.limits.maxRows;
    const kept = truncated ? rows.slice(0, config.limits.maxRows) : rows;
    return {
      kind: 'rows',
      index,
      statement,
      columns: (f ?? []).map((c) => ({ name: c.name, type: TYPE_NAMES[c.columnType ?? -1] ?? 'OTRO' })),
      rows: kept,
      rowCount: kept.length,
      truncated,
      durationMs,
    };
  };
  const mkOk = (h: ResultSetHeader): OkResult => ({
    kind: 'ok',
    index,
    statement,
    affectedRows: h.affectedRows,
    insertId: h.insertId,
    warningCount: h.warningStatus ?? 0,
    info: h.info ?? '',
    durationMs,
  });

  if (isHeader(raw)) {
    out.push(mkOk(raw));
  } else if (Array.isArray(raw)) {
    // CALL devuelve [rs1, rs2, ..., header] y fields = [f1, f2, ..., undefined]
    const multi = Array.isArray(fields) && fields.length > 0 && (Array.isArray(fields[0]) || fields[0] === undefined) && raw.some((r) => isHeader(r));
    if (multi) {
      raw.forEach((part, k) => {
        if (isHeader(part)) {
          // el header final de un CALL solo aporta si no hubo resultados
          if (k === raw.length - 1 && out.length > 0) return;
          out.push(mkOk(part));
        } else out.push(mkRows(part as unknown[][], (fields as FieldPacket[][])[k]));
      });
    } else {
      out.push(mkRows(raw as unknown[][], fields as FieldPacket[]));
    }
  }
  return out;
}

export async function runStatements(conn: Connection, role: Role, stmts: Statement[]): Promise<ScriptOutcome> {
  const results: StatementResult[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const t0 = performance.now();
    try {
      const [raw, fields] = await queryWithTimeout(conn, role, s.sql);
      const ms = Math.round(performance.now() - t0);
      results.push(...normalize(i, s.sql, raw, fields, ms));
    } catch (err) {
      return { results, error: toErrorInfo(err, i, s.line) };
    }
  }
  return { results };
}

/** Último conjunto de filas devuelto por el script (lo que se corrige en ejercicios de consulta). */
export function lastRows(outcome: ScriptOutcome): RowsResult | undefined {
  for (let i = outcome.results.length - 1; i >= 0; i--) {
    const r = outcome.results[i];
    if (r.kind === 'rows') return r;
  }
  return undefined;
}
