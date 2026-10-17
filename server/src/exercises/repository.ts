// Catálogo de ejercicios: los de fábrica (JSON) + los personalizados (base de la app).
import fs from 'node:fs';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { config } from '../config.js';
import { getAppPool } from '../db/connections.js';
import { getDataset } from '../db/datasets.js';
import { ExerciseSchema, TOPICS, type Exercise } from './model.js';

let builtIn: Exercise[] | null = null;

export function loadBuiltInExercises(): Exercise[] {
  if (builtIn) return builtIn;
  const dir = config.paths.exercises;
  const all: Exercise[] = [];
  const seen = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const list = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as unknown[];
    list.forEach((raw, i) => {
      const parsed = ExerciseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Ejercicio inválido en ${file} (posición ${i}): ${parsed.error.message}`);
      }
      const ex = parsed.data;
      if (seen.has(ex.id)) throw new Error(`Id de ejercicio repetido: ${ex.id}`);
      if (!getDataset(ex.dataset)) throw new Error(`El ejercicio ${ex.id} usa el dataset inexistente "${ex.dataset}"`);
      seen.add(ex.id);
      all.push(ex);
    });
  }
  builtIn = sortExercises(all);
  return builtIn;
}

// Orden del catálogo: por tema (orden de TOPICS), después los ejercicios sin fuente
// (introductorios) y luego por TP y número de ejercicio ("TP3 Ej. 17" → [3, 17]).
const topicOrder = Object.keys(TOPICS);
function sourceKey(e: Exercise): [number, number] {
  const m = /TP\s*(\d+)\s*Ej\.?\s*(\d+)/i.exec(e.source ?? '');
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}
export function sortExercises(list: Exercise[]): Exercise[] {
  return list
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const t = topicOrder.indexOf(a.e.topic) - topicOrder.indexOf(b.e.topic);
      if (t !== 0) return t;
      const [ta, na] = sourceKey(a.e);
      const [tb, nb] = sourceKey(b.e);
      return ta - tb || na - nb || a.i - b.i;
    })
    .map((x) => x.e);
}

// ---- Ejercicios personalizados (tabla ejercicios_personalizados) ----

let customCache: Exercise[] | null = null;

export async function getCustomExercises(): Promise<Exercise[]> {
  if (customCache) return customCache;
  const [rows] = await getAppPool().query<RowDataPacket[]>('SELECT id_ejercicio, definicion FROM ejercicios_personalizados ORDER BY creado');
  const list: Exercise[] = [];
  for (const r of rows) {
    const raw = typeof r.definicion === 'string' ? JSON.parse(r.definicion) : r.definicion;
    const parsed = ExerciseSchema.safeParse({ ...raw, id: r.id_ejercicio, custom: true });
    if (parsed.success) list.push(parsed.data);
    else console.warn(`Ejercicio personalizado inválido (${r.id_ejercicio}) ignorado: ${parsed.error.message}`);
  }
  customCache = list;
  return list;
}

export async function getAllExercises(): Promise<Exercise[]> {
  return sortExercises([...loadBuiltInExercises(), ...(await getCustomExercises())]);
}

export async function findExercise(id: string): Promise<Exercise | undefined> {
  return (await getAllExercises()).find((e) => e.id === id);
}

export async function saveCustomExercise(ex: Exercise): Promise<void> {
  if (loadBuiltInExercises().some((e) => e.id === ex.id)) throw new Error('No se puede sobrescribir un ejercicio de fábrica.');
  await getAppPool().query(
    'INSERT INTO ejercicios_personalizados (id_ejercicio, definicion) VALUES (?, ?) ON DUPLICATE KEY UPDATE definicion = VALUES(definicion)',
    [ex.id, JSON.stringify({ ...ex, custom: true })],
  );
  customCache = null;
}

export async function deleteCustomExercise(id: string): Promise<boolean> {
  const [r] = await getAppPool().query('DELETE FROM ejercicios_personalizados WHERE id_ejercicio = ?', [id]);
  customCache = null;
  return (r as { affectedRows: number }).affectedRows > 0;
}
