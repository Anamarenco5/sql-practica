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
  public?: boolean;
  mine?: boolean;
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
  canEdit?: boolean;
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

export interface ReviewData {
  items: { id: string; title: string; topic: string; reason: string; concepts: string[] }[];
  topics: { id: string; name: string; total: number; solved: number; struggling: number; failedAttempts: number }[];
  concepts: { name: string; count: number }[];
  errors: { code: string; label: string; count: number }[];
}

export interface Probe {
  description: string;
  sql: string;
  expect: 'ok' | 'error';
}

export interface Requirement {
  pattern: string;
  message: string;
  forbid: boolean;
}

/** Definición completa de un ejercicio (lo que se edita en el formulario). */
export interface ExerciseDefinition {
  title: string;
  topic: string;
  difficulty: Difficulty;
  dataset: string;
  mode: Mode;
  source?: string;
  statement: string;
  tables: string[];
  starterSql: string;
  solution: string;
  explanation: string;
  hints: string[];
  concepts: string[];
  requirements: Requirement[];
  public?: boolean;
  check:
    | { type: 'result'; orderMatters: boolean; orderKeys?: number[]; checkColumnNames: boolean; numericTolerance?: number }
    | { type: 'state'; verifyQueries: string[]; probes: Probe[]; numericTolerance?: number };
}

export interface User {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  grade?: GradeResult;
  id?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit, acceptStatus: number[] = []): Promise<T> {
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
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('sesion-vencida'));
  if (!res.ok && !acceptStatus.includes(res.status)) throw new ApiError(body.error ?? `Error ${res.status}`, res.status);
  return body as T;
}

export const api = {
  me: () => req<User>('/api/auth/me'),
  login: (email: string, password: string) => req<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string) =>
    req<User>('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  logout: () => req<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  topics: () => req<Topic[]>('/api/topics'),
  exercises: () => req<ExerciseSummary[]>('/api/exercises'),
  exercise: (id: string) => req<Exercise>(`/api/exercises/${encodeURIComponent(id)}`),
  run: (id: string, sql: string) => req<ScriptOutcome>(`/api/exercises/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify({ sql }) }),
  check: (id: string, sql: string, hintsUsed: number) =>
    req<GradeResult>(`/api/exercises/${encodeURIComponent(id)}/check`, { method: 'POST', body: JSON.stringify({ sql, hintsUsed }) }),
  solution: (id: string) => req<{ solution: string; explanation: string }>(`/api/exercises/${encodeURIComponent(id)}/solution`),
  saveDraft: (id: string, sql: string) => req<{ ok: true }>(`/api/exercises/${encodeURIComponent(id)}/draft`, { method: 'PUT', body: JSON.stringify({ sql }) }),
  schema: (dataset: string) => req<TableInfo[]>(`/api/datasets/${encodeURIComponent(dataset)}/schema`),
  review: () => req<ReviewData>('/api/review'),
  datasets: () => req<{ id: string; name: string; description: string }[]>('/api/datasets'),
  customExercise: (id: string) => req<ExerciseDefinition & { id: string }>(`/api/custom-exercises/${encodeURIComponent(id)}`),
  validateCustom: (def: ExerciseDefinition) =>
    req<ValidationResult>('/api/custom-exercises/validate', { method: 'POST', body: JSON.stringify(def) }, [422]),
  createCustom: (def: ExerciseDefinition) => req<ValidationResult>('/api/custom-exercises', { method: 'POST', body: JSON.stringify(def) }, [422]),
  updateCustom: (id: string, def: ExerciseDefinition) =>
    req<ValidationResult>(`/api/custom-exercises/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(def) }, [422]),
  deleteCustom: (id: string) => req<{ ok: true }>(`/api/custom-exercises/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
