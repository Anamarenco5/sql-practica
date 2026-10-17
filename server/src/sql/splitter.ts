// Divide un script SQL en sentencias individuales, igual que lo hace el cliente
// de MySQL o Workbench. Entiende:
//   - comillas simples, dobles y backticks (con escapes \ y comillas duplicadas)
//   - comentarios  -- ...,  # ...  y  /* ... */
//   - la directiva DELIMITER (necesaria para escribir triggers y procedimientos)
// Ejecutar sentencia por sentencia (en vez de multipleStatements) nos permite
// informar exactamente qué sentencia falló y validar cada una por separado.

export interface Statement {
  sql: string; // texto de la sentencia, sin el delimitador final
  line: number; // línea (1-based) donde empieza
}

export function splitSql(script: string): Statement[] {
  const out: Statement[] = [];
  const n = script.length;
  const delimRe = /[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)/iy;
  let delimiter = ';';
  let stmtStart = 0; // inicio de la sentencia actual (índice en script)
  let stmtStartLine = 1;
  let line = 1;
  let i = 0;
  let atLineStart = true;

  // Se trabaja con índices (slice) y no concatenando caracteres: un dump de
  // varios MB se divide en milisegundos.
  const flush = (endIdx: number) => {
    const raw = script.slice(stmtStart, endIdx);
    const sql = raw.trim();
    if (sql !== '' && !isOnlyComments(sql)) {
      const lead = raw.slice(0, raw.length - raw.trimStart().length);
      out.push({ sql, line: stmtStartLine + (lead.match(/\n/g) ?? []).length });
    }
  };

  while (i < n) {
    // DELIMITER solo es válido al comienzo de una línea (fuera de strings).
    if (atLineStart) {
      delimRe.lastIndex = i;
      const m = delimRe.exec(script);
      if (m) {
        flush(i);
        delimiter = m[1];
        i += m[0].length;
        if (m[2]) line++;
        stmtStart = i;
        stmtStartLine = line;
        continue;
      }
    }
    const ch = script[i];

    // Strings y nombres entre comillas
    if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < n) {
        const c = script[i];
        if (c === '\n') line++;
        if (c === '\\' && ch !== '`') {
          if (script[i + 1] === '\n') line++;
          i += 2;
          continue;
        }
        if (c === ch) {
          if (script[i + 1] === ch) {
            i += 2; // comilla duplicada = escape
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      atLineStart = false;
      continue;
    }

    // Comentario de línea: "-- " (MySQL exige espacio o fin de línea) o "#"
    if ((ch === '-' && script[i + 1] === '-' && (i + 2 >= n || /\s/.test(script[i + 2]))) || ch === '#') {
      const end = script.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }

    // Comentario de bloque
    if (ch === '/' && script[i + 1] === '*') {
      const end = script.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (script[k] === '\n') line++;
      i = stop;
      atLineStart = false;
      continue;
    }

    // Delimitador actual
    if (ch === delimiter[0] && script.startsWith(delimiter, i)) {
      flush(i);
      i += delimiter.length;
      stmtStart = i;
      stmtStartLine = line;
      atLineStart = false;
      continue;
    }

    if (ch === '\n') {
      line++;
      atLineStart = true;
    } else if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
      atLineStart = false;
    }
    i++;
  }
  flush(n);
  return out;
}

function isOnlyComments(sql: string): boolean {
  return stripCommentsAndStrings(sql).trim() === '';
}

// Devuelve el SQL sin comentarios y con los literales de texto vaciados,
// para poder buscar palabras clave sin falsos positivos (ej: 'GRANT' dentro de un string).
// Los comentarios versionados /*! ... */ se conservan porque MySQL SÍ los ejecuta.
export function stripCommentsAndStrings(sql: string, keepStrings = false): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += keepStrings ? sql.slice(start, i) : "''";
      continue;
    }
    if (ch === '`') {
      const end = sql.indexOf('`', i + 1);
      const stop = end === -1 ? n : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if ((ch === '-' && sql[i + 1] === '-' && /\s/.test(sql[i + 2] ?? ' ')) || ch === '#') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end;
      out += ' ';
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      if (sql[i + 2] === '!') {
        // /*!80000 código */ -> se ejecuta: lo dejamos visible
        out += ' ' + sql.slice(i + 3, end === -1 ? n : end).replace(/^\d+/, '') + ' ';
      } else {
        out += ' ';
      }
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
