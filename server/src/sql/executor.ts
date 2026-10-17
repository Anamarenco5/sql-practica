// Ejecuta un script (varias sentencias) sobre una conexión dedicada y
// devuelve un resultado por sentencia, como el panel "Output" de Workbench.
import type { Connection as CoreConnection } from 'mysql2';
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

interface RawSet {
  fields?: FieldPacket[];
  rows: unknown[][];
  header?: ResultSetHeader;
  truncated: boolean;
}

/**
 * Ejecuta una sentencia leyendo las filas de a una (streaming), con dos límites:
 *  - Memoria: se guardan como máximo MAX_ROWS filas por resultado; el resto se descarta
 *    a medida que llega. (sql_select_limit no alcanza: no se aplica a los SELECT que
 *    se ejecutan dentro de un procedimiento.)
 *  - Tiempo: si se pasa QUERY_TIMEOUT_MS, una conexión auxiliar del mismo usuario
 *    cancela la consulta con KILL QUERY (un usuario siempre puede cancelar las suyas).
 */
function queryBounded(conn: Connection, role: Role, sql: string): Promise<RawSet[]> {
  const core = (conn as unknown as { connection: CoreConnection }).connection;
  const sets: RawSet[] = [];
  const at = (i: number) => (sets[i] ??= { rows: [], truncated: false });
  let killed = false;
  let anyTruncated = false;
  let discarded = 0;
  let killing: Promise<void> = Promise.resolve();

  const kill = () => {
    if (killed) return;
    killed = true;
    killing = (async () => {
      try {
        const killer = await openConnection(role);
        await killer.query(`KILL QUERY ${Number(conn.threadId)}`);
        await killer.end();
      } catch {
        /* si falla, el error de la consulta original igual llega */
      }
    })();
  };
  const timer = setTimeout(kill, config.limits.timeoutMs + 500);

  return new Promise<RawSet[]>((resolve, reject) => {
    const q = core.query({ sql, rowsAsArray: true });
    q.on('fields', (fields: FieldPacket[], index = 0) => {
      at(index).fields = fields;
    });
    q.on('result', (row: unknown, index = 0) => {
      const set = at(index);
      if (isHeader(row)) {
        set.header = row;
        return;
      }
      if (set.rows.length < config.limits.maxRows) {
        set.rows.push(row as unknown[]);
        return;
      }
      set.truncated = true;
      anyTruncated = true;
      // Un SELECT común ya viene cortado por sql_select_limit (MAX_ROWS + 1 filas), así que
      // solo se cancela si siguen llegando filas: el caso de un SELECT dentro de un CALL.
      discarded++;
      if (discarded > 1) kill();
    });
    // Antes de devolver el control esperamos a que termine un KILL en curso, para que
    // nunca alcance a la sentencia siguiente de la misma conexión.
    q.on('error', async (err: unknown) => {
      clearTimeout(timer);
      await killing;
      const e = err as { errno?: number };
      // Si la cortamos nosotros por exceso de filas, el resultado parcial es válido.
      if (anyTruncated && (e.errno === 1317 || e.errno === undefined)) return resolve(sets.filter(Boolean));
      if (killed && (e.errno === undefined || e.errno === 1317)) {
        Object.assign(err as object, { errno: 1317, code: 'ER_QUERY_INTERRUPTED' });
      }
      reject(err);
    });
    q.on('end', async () => {
      clearTimeout(timer);
      await killing;
      resolve(sets.filter(Boolean));
    });
  });
}

function isHeader(x: unknown): x is ResultSetHeader {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && 'affectedRows' in x;
}

/** Convierte los conjuntos recibidos (SELECT, DML o CALL con varios resultados) en resultados uniformes. */
function normalize(index: number, statement: string, sets: RawSet[], durationMs: number): StatementResult[] {
  const out: StatementResult[] = [];
  sets.forEach((set, k) => {
    if (set.fields) {
      out.push({
        kind: 'rows',
        index,
        statement,
        columns: set.fields.map((c) => ({ name: c.name, type: TYPE_NAMES[c.columnType ?? -1] ?? 'OTRO' })),
        rows: set.rows,
        rowCount: set.rows.length,
        truncated: set.truncated,
        durationMs,
      });
    } else if (set.header) {
      // el OK final de un CALL solo aporta si no hubo otros resultados
      if (k === sets.length - 1 && out.length > 0 && sets.length > 1) return;
      const h = set.header;
      out.push({
        kind: 'ok',
        index,
        statement,
        affectedRows: h.affectedRows,
        insertId: h.insertId,
        warningCount: h.warningStatus ?? 0,
        info: h.info ?? '',
        durationMs,
      });
    }
  });
  return out;
}

export async function runStatements(conn: Connection, role: Role, stmts: Statement[]): Promise<ScriptOutcome> {
  const results: StatementResult[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const t0 = performance.now();
    try {
      const sets = await queryBounded(conn, role, s.sql);
      const ms = Math.round(performance.now() - t0);
      results.push(...normalize(i, s.sql, sets, ms));
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
