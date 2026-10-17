// Catálogo de ejercicios: los de fábrica (JSON) + los personalizados (base de la app).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDataset } from '../db/datasets.js';
import { ExerciseSchema, type Exercise } from './model.js';

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
  builtIn = all;
  return all;
}
