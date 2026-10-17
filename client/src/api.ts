// Cliente de la API. El frontend solo conoce rutas /api/…: nada de credenciales.

export type Difficulty = 'basico' | 'intermedio' | 'avanzado';
export type Mode = 'readonly' | 'sandbox';

export interface Progress {
  exerciseId: string;
  attempts: number;
  solved: boolean;
  failedAttempts: number;
  firstSolvedAt: string | null;
  lastAttemptAt: string | null;
  maxHints: number;
}

export interface ExerciseSummary {
  id: string;
  title: string;
  topic: string;
  difficulty: Difficulty;
  mode: Mode;
  dataset: string;
  source?: string;
  custom: boolean;
  progress: Progress | null;
}

export interface Exercise extends ExerciseSummary {
  statement: string;
  tables: string[];
  starterSql: string;
  hints: string[];
  concepts: string[];
  check: { type: 'result'; orderMatters: boolean; checkColumnNames: boolean } | { type: 'state'; probes: { description: string; expect: 'ok' | 'error' }[] };
  draft: string | null;
}

export interface Topic {
  id: string;
  name: string;
}

export interface Column {
  name: string;
  type: string;
}

export interface RowsResult {
  kind: 'rows';
  index: number;
  statement: string;
  columns: Column[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  displayTruncated?: boolean;
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

export interface SqlError {
  code: string;
  errno?: number;
  sqlState?: string;
  message: string;
  hint?: string;
  statementIndex?: number;
  statementLine?: number;
}

export interface ScriptOutcome {
  results: StatementResult[];
  error?: SqlError;
}

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
  error?: SqlError;
  output?: ScriptOutcome;
  probes?: ProbeOutcome[];
}

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: { name: string; type: string; nullable: boolean; key: string; extra: string; default: string | null }[];
  foreignKeys: { column: string; refTable: string; refColumn: string }[];
}

export interface Sample {
  columns: string[];
  rows: unknown[][];
  total: number;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. ¿Está corriendo "npm run dev"?', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Error ${res.status}`, res.status);
  return body as T;
}

export const api = {
  topics: () => req<Topic[]>('/api/topics'),
  exercises: () => req<ExerciseSummary[]>('/api/exercises'),
  exercise: (id: string) => req<Exercise>(`/api/exercises/${encodeURIComponent(id)}`),
  run: (id: string, sql: string) => req<ScriptOutcome>(`/api/exercises/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify({ sql }) }),
  check: (id: string, sql: string, hintsUsed: number) =>
    req<GradeResult>(`/api/exercises/${encodeURIComponent(id)}/check`, { method: 'POST', body: JSON.stringify({ sql, hintsUsed }) }),
  solution: (id: string) => req<{ solution: string; explanation: string }>(`/api/exercises/${encodeURIComponent(id)}/solution`),
  saveDraft: (id: string, sql: string) => req<{ ok: true }>(`/api/exercises/${encodeURIComponent(id)}/draft`, { method: 'PUT', body: JSON.stringify({ sql }) }),
  schema: (dataset: string) => req<TableInfo[]>(`/api/datasets/${encodeURIComponent(dataset)}/schema`),
  sample: (dataset: string, table: string) => req<Sample>(`/api/datasets/${encodeURIComponent(dataset)}/tables/${encodeURIComponent(table)}/sample?limit=10`),
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  basico: 'Básico',
  intermedio: 'Intermedio',
  avanzado: 'Avanzado',
};

export const MODE_LABEL: Record<Mode, string> = {
  readonly: 'Consulta',
  sandbox: 'Modificación',
};
