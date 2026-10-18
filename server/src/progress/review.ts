// Panel "Para repasar": a partir de tus intentos detecta qué temas y ejercicios
// te están costando. Las reglas son simples y explicables:
//   - intentado y todavía sin resolver
//   - resuelto, pero después de 3 o más intentos fallidos
//   - resuelto usando pistas
// y los errores de MySQL que más se repiten.
import type { RowDataPacket } from 'mysql2/promise';
import { getAppPool } from '../db/connections.js';
import { TOPICS, type Exercise } from '../exercises/model.js';
import type { ExerciseProgress } from './store.js';

const ERROR_LABELS: Record<string, string> = {
  ER_PARSE_ERROR: 'Errores de sintaxis',
  ER_BAD_FIELD_ERROR: 'Columnas inexistentes o alias usados en el WHERE',
  ER_NON_UNIQ_ERROR: 'Columnas ambiguas en los JOIN',
  ER_WRONG_FIELD_WITH_GROUP: 'Columnas fuera del GROUP BY',
  ER_INVALID_GROUP_FUNC_USE: 'Funciones de agregación en el WHERE (van en HAVING)',
  ER_NO_SUCH_TABLE: 'Nombres de tabla incorrectos',
  ER_SUBQUERY_NO_1_ROW: 'Subconsultas que devuelven más de una fila',
  ER_OPERAND_COLUMNS: 'Subconsultas con más de una columna',
  ER_DERIVED_MUST_HAVE_ALIAS: 'Tablas derivadas sin alias',
  ER_SP_DOES_NOT_EXIST: 'Procedimientos o funciones inexistentes',
  ER_SP_UNDECLARED_VAR: 'Variables sin declarar en procedimientos',
  ER_SP_VARCOND_AFTER_CURSHNDLR: 'Orden de los DECLARE',
  ER_NO_REFERENCED_ROW_2: 'Claves foráneas inexistentes al insertar',
  ER_ROW_IS_REFERENCED_2: 'Borrados bloqueados por claves foráneas',
  ER_DUP_ENTRY: 'Valores duplicados en claves únicas',
  ER_QUERY_TIMEOUT: 'Consultas demasiado lentas (¿producto cartesiano?)',
  BLOQUEADO: 'Sentencias no permitidas en el ejercicio',
};

export interface ReviewItem {
  id: string;
  title: string;
  topic: string;
  reason: string;
  concepts: string[];
}

export async function buildReview(userId: number, exercises: Exercise[], progress: Map<string, ExerciseProgress>) {
  const byId = new Map(exercises.map((e) => [e.id, e]));

  const items: (ReviewItem & { weight: number })[] = [];
  for (const p of progress.values()) {
    const ex = byId.get(p.exerciseId);
    if (!ex) continue;
    let reason: string | null = null;
    let weight = 0;
    if (!p.solved) {
      reason = `${p.attempts} intento${p.attempts === 1 ? '' : 's'} sin resolver`;
      weight = 100 + p.attempts;
    } else if (p.failedAttempts >= 3) {
      reason = `Resuelto después de ${p.failedAttempts} intentos fallidos`;
      weight = 50 + p.failedAttempts;
    } else if (p.maxHints > 0) {
      reason = `Resuelto con ${p.maxHints} pista${p.maxHints === 1 ? '' : 's'}`;
      weight = 20 + p.maxHints;
    }
    if (reason) items.push({ id: ex.id, title: ex.title, topic: ex.topic, reason, concepts: ex.concepts, weight });
  }
  items.sort((a, b) => b.weight - a.weight);

  // Resumen por tema
  const topics = Object.entries(TOPICS)
    .map(([id, name]) => {
      const list = exercises.filter((e) => e.topic === id);
      const solved = list.filter((e) => progress.get(e.id)?.solved).length;
      const struggling = items.filter((i) => i.topic === id).length;
      const failed = list.reduce((acc, e) => acc + (progress.get(e.id)?.failedAttempts ?? 0), 0);
      return { id, name, total: list.length, solved, struggling, failedAttempts: failed };
    })
    .filter((t) => t.total > 0);

  // Conceptos que más aparecen en los ejercicios para repasar
  const conceptCount = new Map<string, number>();
  for (const it of items) for (const c of it.concepts) conceptCount.set(c, (conceptCount.get(c) ?? 0) + 1);
  const concepts = [...conceptCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Errores de MySQL más frecuentes
  const [rows] = await getAppPool().query<RowDataPacket[]>(
    `SELECT codigo_error AS code, COUNT(*) AS n
       FROM intentos
      WHERE id_usuario = ? AND codigo_error IS NOT NULL
      GROUP BY codigo_error
      ORDER BY n DESC
      LIMIT 5`,
    [userId],
  );
  const errors = rows.map((r) => ({ code: r.code as string, label: ERROR_LABELS[r.code as string] ?? r.code, count: Number(r.n) }));

  return {
    items: items.slice(0, 12).map(({ weight: _w, ...rest }) => rest),
    topics,
    concepts,
    errors,
  };
}
