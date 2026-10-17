// Compara dos conjuntos de resultados para decidir si una consulta es correcta.
// La idea: no importa CÓMO escribiste la consulta, sino QUÉ devuelve.
//   - Los alias de columna no importan (salvo que el ejercicio lo pida).
//   - El orden de las filas solo importa si el enunciado pide ORDER BY.
//   - Si las columnas vienen en otro orden, se intenta emparejarlas.
//   - Los números se comparan con tolerancia (5 = 5.00 = '5.0000').

export interface ResultSet {
  columns: string[];
  rows: unknown[][];
}

export interface CompareOptions {
  orderMatters: boolean;
  // columnas (índices 0-based del resultado esperado) que definen el orden; si hay
  // empates en esas columnas, cualquier orden entre las filas empatadas es válido
  orderKeys?: number[];
  checkColumnNames: boolean;
  numericTolerance: number;
}

export interface CompareResult {
  equal: boolean;
  feedback: string[]; // explicación de las diferencias (en español)
  warnings: string[]; // cosas a mejorar aunque el resultado sea correcto
}

const NUMERIC = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

export function canon(v: unknown, tol: number): string {
  if (v === null || v === undefined) return '∅NULL';
  if (typeof v === 'number' || typeof v === 'bigint' || (typeof v === 'string' && NUMERIC.test(v.trim()))) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      const decimals = Math.max(0, Math.round(-Math.log10(tol)));
      const r = Number(n.toFixed(decimals));
      return 'n:' + (Object.is(r, -0) ? 0 : r);
    }
  }
  if (Buffer.isBuffer(v)) return 'b:' + v.toString('hex');
  if (typeof v === 'object') return 'j:' + JSON.stringify(v);
  return 's:' + String(v);
}

function show(v: unknown): string {
  return v === null || v === undefined ? 'NULL' : String(v);
}

function rowKey(row: unknown[], tol: number): string {
  return row.map((v) => canon(v, tol)).join('\u0001');
}

/** Firma de una columna: sus valores canónicos ordenados (para emparejar columnas permutadas). */
function columnSignature(rows: unknown[][], col: number, tol: number): string {
  return rows
    .map((r) => canon(r[col], tol))
    .sort()
    .join('\u0001');
}

function findPermutation(user: ResultSet, exp: ResultSet, tol: number): number[] | null {
  const n = exp.columns.length;
  const expSigs = Array.from({ length: n }, (_, i) => columnSignature(exp.rows, i, tol));
  const userSigs = Array.from({ length: n }, (_, i) => columnSignature(user.rows, i, tol));
  const used = new Set<number>();
  const perm: number[] = []; // perm[i] = columna del usuario que corresponde a la columna esperada i
  for (let i = 0; i < n; i++) {
    // preferimos la misma posición o el mismo nombre si hay empate
    const candidates = userSigs.map((s, j) => (s === expSigs[i] && !used.has(j) ? j : -1)).filter((j) => j >= 0);
    if (candidates.length === 0) return null;
    const pick =
      candidates.find((j) => j === i) ??
      candidates.find((j) => user.columns[j].toLowerCase() === exp.columns[i].toLowerCase()) ??
      candidates[0];
    used.add(pick);
    perm.push(pick);
  }
  return perm;
}

export function compareResults(user: ResultSet, exp: ResultSet, opts: CompareOptions): CompareResult {
  const tol = opts.numericTolerance;
  const feedback: string[] = [];
  const warnings: string[] = [];

  if (user.columns.length !== exp.columns.length) {
    feedback.push(
      `Tu consulta devuelve ${user.columns.length} columna(s) y se esperaban ${exp.columns.length}: ${exp.columns.join(', ')}.`,
    );
    if (user.rows.length !== exp.rows.length) {
      feedback.push(`Además devuelve ${user.rows.length} fila(s) y se esperaban ${exp.rows.length}.`);
    }
    return { equal: false, feedback, warnings };
  }

  let rows = user.rows;
  let columns = user.columns;
  // ¿Columnas en otro orden? Las reordenamos si se pueden emparejar por contenido.
  const direct = exp.columns.every((_, i) => columnSignature(user.rows, i, tol) === columnSignature(exp.rows, i, tol));
  if (!direct && user.rows.length === exp.rows.length) {
    const perm = findPermutation(user, exp, tol);
    if (perm && perm.some((j, i) => j !== i)) {
      rows = user.rows.map((r) => perm.map((j) => r[j]));
      columns = perm.map((j) => user.columns[j]);
      warnings.push('Las columnas están en otro orden que el pedido en el enunciado. Se aceptó, pero en un examen conviene respetar el orden.');
    }
  }

  if (opts.checkColumnNames) {
    exp.columns.forEach((c, i) => {
      if (columns[i] !== c) feedback.push(`La columna ${i + 1} debería llamarse "${c}" (la tuya se llama "${columns[i]}"). Usá un alias con AS.`);
    });
  }

  if (rows.length !== exp.rows.length) {
    feedback.push(`Tu consulta devuelve ${rows.length} fila(s) y se esperaban ${exp.rows.length}.`);
    if (rows.length > exp.rows.length) {
      feedback.push('Sobran filas: ¿falta alguna condición en el WHERE/HAVING, un DISTINCT, o un JOIN está duplicando filas?');
    } else {
      feedback.push('Faltan filas: ¿alguna condición es demasiado restrictiva, o debería ser un LEFT JOIN en lugar de INNER JOIN?');
    }
  }

  const uKeys = rows.map((r) => rowKey(r, tol));
  const eKeys = exp.rows.map((r) => rowKey(r, tol));

  // Comparación como multiconjunto (sin orden)
  const counts = new Map<string, number>();
  for (const k of eKeys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const extra: number[] = [];
  uKeys.forEach((k, idx) => {
    const c = counts.get(k) ?? 0;
    if (c > 0) counts.set(k, c - 1);
    else extra.push(idx);
  });
  const missing: number[] = [];
  const remaining = new Map(counts);
  eKeys.forEach((k, idx) => {
    const c = remaining.get(k) ?? 0;
    if (c > 0) {
      missing.push(idx);
      remaining.set(k, c - 1);
    }
  });

  const fmt = (r: unknown[]) => '(' + r.map(show).join(', ') + ')';
  if (extra.length > 0 || missing.length > 0) {
    if (extra.length > 0) {
      feedback.push(`Filas de tu resultado que no deberían estar (${extra.length}). Ejemplo: ${extra.slice(0, 2).map((i) => fmt(rows[i])).join(' ')}`);
    }
    if (missing.length > 0) {
      feedback.push(`Filas esperadas que no aparecen (${missing.length}). Ejemplo: ${missing.slice(0, 2).map((i) => fmt(exp.rows[i])).join(' ')}`);
    }
    return { equal: false, feedback, warnings };
  }

  if (feedback.length > 0) return { equal: false, feedback, warnings };

  if (opts.orderMatters) {
    const keyCols = opts.orderKeys && opts.orderKeys.length > 0 ? opts.orderKeys : exp.columns.map((_, i) => i);
    const proj = (r: unknown[]) => keyCols.map((c) => canon(r[c], tol)).join('\u0001');
    const firstDiff = rows.findIndex((r, i) => proj(r) !== proj(exp.rows[i]));
    if (firstDiff !== -1) {
      feedback.push(`Las filas son correctas pero el orden no: revisá el ORDER BY (la primera diferencia está en la fila ${firstDiff + 1}).`);
      return { equal: false, feedback, warnings };
    }
  }

  return { equal: true, feedback, warnings };
}
