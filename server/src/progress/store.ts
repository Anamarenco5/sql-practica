// Registro de intentos y progreso (base sqlpractica_app, usuario sqlp_app).
// Todas las consultas usan parámetros (?) — nunca concatenamos texto del usuario.
import type { RowDataPacket } from 'mysql2/promise';
import { getAppPool } from '../db/connections.js';

export interface AttemptInput {
  exerciseId: string;
  sql: string;
  correct: boolean;
  errorCode?: string;
  hintsUsed: number;
}

export async function recordAttempt(a: AttemptInput): Promise<void> {
  await getAppPool().query(
    'INSERT INTO intentos (id_ejercicio, sql_texto, correcto, codigo_error, pistas_vistas) VALUES (?, ?, ?, ?, ?)',
    [a.exerciseId, a.sql, a.correct, a.errorCode ?? null, a.hintsUsed],
  );
}

export interface ExerciseProgress {
  exerciseId: string;
  attempts: number;
  solved: boolean;
  firstSolvedAt: string | null;
  lastAttemptAt: string | null;
  failedAttempts: number;
  maxHints: number;
}

export async function getProgress(): Promise<Map<string, ExerciseProgress>> {
  const [rows] = await getAppPool().query<RowDataPacket[]>(
    `SELECT id_ejercicio,
            COUNT(*)                         AS intentos,
            SUM(correcto)                    AS correctos,
            SUM(NOT correcto)                AS fallidos,
            MIN(CASE WHEN correcto THEN fecha END) AS primera_ok,
            MAX(fecha)                       AS ultimo,
            MAX(pistas_vistas)               AS pistas
       FROM intentos
      GROUP BY id_ejercicio`,
  );
  const map = new Map<string, ExerciseProgress>();
  for (const r of rows) {
    map.set(r.id_ejercicio, {
      exerciseId: r.id_ejercicio,
      attempts: Number(r.intentos),
      solved: Number(r.correctos) > 0,
      failedAttempts: Number(r.fallidos),
      firstSolvedAt: r.primera_ok,
      lastAttemptAt: r.ultimo,
      maxHints: Number(r.pistas),
    });
  }
  return map;
}

export async function getAttempts(exerciseId: string, limit = 20) {
  const [rows] = await getAppPool().query<RowDataPacket[]>(
    'SELECT id_intento AS id, sql_texto AS `sql`, correcto AS correct, codigo_error AS errorCode, fecha AS createdAt FROM intentos WHERE id_ejercicio = ? ORDER BY fecha DESC, id_intento DESC LIMIT ?',
    [exerciseId, limit],
  );
  return rows.map((r) => ({ ...r, correct: Boolean(r.correct) }));
}

export async function saveDraft(exerciseId: string, sql: string): Promise<void> {
  await getAppPool().query(
    'INSERT INTO borradores (id_ejercicio, sql_texto) VALUES (?, ?) ON DUPLICATE KEY UPDATE sql_texto = VALUES(sql_texto)',
    [exerciseId, sql],
  );
}

export async function getDraft(exerciseId: string): Promise<string | null> {
  const [rows] = await getAppPool().query<RowDataPacket[]>('SELECT sql_texto FROM borradores WHERE id_ejercicio = ?', [exerciseId]);
  return rows.length ? (rows[0].sql_texto as string) : null;
}
