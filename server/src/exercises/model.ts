// Modelo de un ejercicio. Los ejercicios "de fábrica" viven en archivos JSON
// (server/src/exercises/*.json) y los personalizados en la base sqlpractica_app;
// ambos se validan con este mismo esquema.
import { z } from 'zod';

export const TOPICS = {
  'consultas-basicas': 'Consultas básicas',
  'joins': 'JOIN',
  'agregacion': 'Agregación y GROUP BY',
  'left-join': 'LEFT JOIN',
  'subconsultas': 'Subconsultas',
  'integradores': 'Integradores',
  'correccion': 'Detección y corrección de errores',
  'dml': 'INSERT, UPDATE y DELETE',
  'restricciones': 'Restricciones de integridad',
  'triggers': 'Triggers',
  'procedimientos': 'Procedimientos y funciones',
  'transacciones': 'Transacciones',
  'vistas': 'Vistas',
} as const;
export type Topic = keyof typeof TOPICS;

const Requirement = z.object({
  pattern: z.string(), // regex (sin distinguir mayúsculas) que debe aparecer en tu SQL
  message: z.string(), // qué se le dice al alumno si no aparece
  forbid: z.boolean().default(false), // true = el patrón NO debe aparecer
});

const Probe = z.object({
  description: z.string(),
  sql: z.string(),
  expect: z.enum(['ok', 'error']),
});

const ResultCheck = z.object({
  type: z.literal('result'),
  orderMatters: z.boolean().default(false), // true si el enunciado pide ORDER BY
  orderKeys: z.array(z.number().int().min(0)).optional(), // columnas por las que se ordena (para tolerar empates)
  checkColumnNames: z.boolean().default(false), // true si se exige un alias concreto
  numericTolerance: z.number().default(0.01),
});

const StateCheck = z.object({
  type: z.literal('state'),
  // Consultas que se ejecutan DESPUÉS de tu script; su resultado se compara con el de la solución.
  verifyQueries: z.array(z.string()).default([]),
  // Sentencias de prueba: deben fallar o funcionar (ideal para CHECK, FK, triggers, procedimientos).
  probes: z.array(Probe).default([]),
  numericTolerance: z.number().default(0.01),
});

export const ExerciseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  topic: z.enum(Object.keys(TOPICS) as [Topic, ...Topic[]]),
  difficulty: z.enum(['basico', 'intermedio', 'avanzado']),
  dataset: z.string(),
  mode: z.enum(['readonly', 'sandbox']),
  source: z.string().optional(), // ej: "TP3 · Ejercicio 1"
  statement: z.string(),
  tables: z.array(z.string()).default([]), // tablas relevantes (se muestran primero)
  starterSql: z.string().default(''),
  solution: z.string(),
  explanation: z.string().default(''),
  hints: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
  requirements: z.array(Requirement).default([]),
  check: z.discriminatedUnion('type', [ResultCheck, StateCheck]),
  custom: z.boolean().default(false),
  // Solo para ejercicios propios: quién lo creó y si lo ven todos (los publica una administradora).
  ownerId: z.number().int().optional(),
  public: z.boolean().default(false),
});

export type Exercise = z.infer<typeof ExerciseSchema>;

/** Lo que ve el navegador: sin la solución (se pide aparte, después de intentarlo). */
export function publicExercise(e: Exercise, viewerId?: number) {
  const { solution: _s, explanation: _e, ownerId, ...rest } = e;
  // las pistas sí viajan: la interfaz las revela de a una
  return { ...rest, mine: e.custom && ownerId !== undefined && ownerId === viewerId };
}
