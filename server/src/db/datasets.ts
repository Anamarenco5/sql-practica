// Bases de datos de práctica ("datasets").
// Cada carpeta de db/datasets/<id>/ tiene un dataset.json y un script .sql.
// El setup las carga una vez como sqlp_ds_<id>. A partir de ahí:
//   - los ejercicios de consulta leen directo de sqlp_ds_<id> (usuario solo lectura)
//   - los ejercicios de modificación trabajan sobre una COPIA temporal (sandbox)
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config, DATASET_PREFIX } from '../config.js';
import { openConnection } from './connections.js';

const DatasetSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  description: z.string().default(''),
  script: z.string(), // archivo .sql dentro de la carpeta
  sandbox: z
    .object({
      // tablas que se copian vacías en el sandbox (por tamaño), conservando su estructura
      skipData: z.array(z.string()).default([]),
    })
    .default({ skipData: [] }),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export function datasetDbName(id: string): string {
  return DATASET_PREFIX + id;
}

let cache: Dataset[] | null = null;
export function listDatasets(): Dataset[] {
  if (cache) return cache;
  const dir = config.paths.datasets;
  const out: Dataset[] = [];
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name, 'dataset.json');
      if (fs.existsSync(file)) out.push(DatasetSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))));
    }
  }
  cache = out;
  return out;
}

export function getDataset(id: string): Dataset | undefined {
  return listDatasets().find((d) => d.id === id);
}

export function datasetScriptPath(d: Dataset): string {
  return path.join(config.paths.datasets, d.id, d.script);
}

// ---- Esquema (para el panel lateral y el autocompletado) ----

export interface TableInfo {
  name: string;
  rowCount: number;
  columns: { name: string; type: string; nullable: boolean; key: string; extra: string; default: string | null }[];
  foreignKeys: { column: string; refTable: string; refColumn: string }[];
}

const schemaCache = new Map<string, TableInfo[]>();

export async function getSchema(id: string): Promise<TableInfo[]> {
  const hit = schemaCache.get(id);
  if (hit) return hit;
  const db = datasetDbName(id);
  const conn = await openConnection('reader');
  try {
    const [cols] = await conn.query(
      `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_KEY k, EXTRA e, COLUMN_DEFAULT d
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [db],
    );
    const [fks] = await conn.query(
      `SELECT TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc
         FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [db],
    );
    const tables = new Map<string, TableInfo>();
    for (const r of cols as Record<string, string>[]) {
      if (!tables.has(r.t)) tables.set(r.t, { name: r.t, rowCount: 0, columns: [], foreignKeys: [] });
      tables.get(r.t)!.columns.push({ name: r.c, type: r.ty, nullable: r.n === 'YES', key: r.k, extra: r.e, default: r.d });
    }
    for (const r of fks as Record<string, string>[]) {
      tables.get(r.t)?.foreignKeys.push({ column: r.c, refTable: r.rt, refColumn: r.rc });
    }
    // Conteo exacto de filas (las estadísticas de information_schema son aproximadas)
    for (const t of tables.values()) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${db}\`.\`${t.name}\``);
      t.rowCount = Number((rows as { n: number }[])[0].n);
    }
    const list = [...tables.values()];
    schemaCache.set(id, list);
    return list;
  } finally {
    await conn.end();
  }
}

/** Primeras filas de una tabla, para mostrar los datos disponibles. */
export async function getSampleRows(id: string, table: string, limit = 10) {
  const schema = await getSchema(id);
  const t = schema.find((x) => x.name === table);
  if (!t) return null; // solo tablas conocidas: nunca interpolamos texto arbitrario
  const conn = await openConnection('reader');
  try {
    const [rows] = await conn.query({ sql: `SELECT * FROM \`${datasetDbName(id)}\`.\`${t.name}\` LIMIT ${Math.min(50, Math.max(1, limit))}`, rowsAsArray: true });
    return { columns: t.columns.map((c) => c.name), rows: rows as unknown[][], total: t.rowCount };
  } finally {
    await conn.end();
  }
}
