// Segunda capa de defensa: revisa las sentencias ANTES de enviarlas a MySQL.
// La primera (y principal) capa son los permisos de los usuarios MySQL creados
// en el setup; esto solo agrega mensajes claros y bloquea lo que nunca tiene
// sentido en un ejercicio.
import { stripCommentsAndStrings, type Statement } from './splitter.js';

export type ExecMode = 'readonly' | 'sandbox';

interface Rule {
  re: RegExp;
  msg: string;
}

const ALWAYS_BLOCKED: Rule[] = [
  { re: /\b(GRANT|REVOKE)\b/, msg: 'No se permite administrar permisos (GRANT/REVOKE).' },
  { re: /\b(CREATE|DROP|ALTER|RENAME)\s+USER\b|\bSET\s+PASSWORD\b/, msg: 'No se permite administrar usuarios.' },
  { re: /\b(CREATE|DROP|ALTER)\s+(DATABASE|SCHEMA)\b/, msg: 'No se permite crear ni borrar bases de datos: trabajás dentro de la base del ejercicio.' },
  { re: /^\s*USE\b/, msg: 'No hace falta USE: la consulta ya se ejecuta en la base del ejercicio.' },
  { re: /\bINTO\s+(OUTFILE|DUMPFILE)\b|\bLOAD\s+(DATA|XML)\b|\bLOAD_FILE\s*\(/, msg: 'No se permite leer ni escribir archivos del servidor.' },
  { re: /\bSET\s+(GLOBAL|PERSIST|PERSIST_ONLY)\b|@@(GLOBAL|PERSIST)\./, msg: 'No se permite modificar variables globales del servidor.' },
  { re: /\b(SHUTDOWN|RESTART|KILL|FLUSH|PURGE|RESET|INSTALL|UNINSTALL)\b/, msg: 'Sentencia de administración del servidor no permitida.' },
  { re: /\b(LOCK\s+TABLES?|UNLOCK\s+TABLES?|LOCK\s+INSTANCE)\b/, msg: 'No se permite bloquear tablas manualmente.' },
  { re: /\b(HANDLER)\s+\w+\s+(OPEN|READ|CLOSE)\b/, msg: 'Sentencia HANDLER no permitida.' },
  { re: /\bCHANGE\s+(MASTER|REPLICATION)\b|\bSTART\s+(SLAVE|REPLICA)\b/, msg: 'Sentencias de replicación no permitidas.' },
];

// En modo solo lectura rechazamos todo lo que modifica algo. (No usamos una lista
// de permitidos para que un typo como "SELEC" llegue a MySQL y muestre el error de
// sintaxis real. De todos modos el usuario lector solo tiene permiso de SELECT y la
// sesión está en modo READ ONLY.)
const READONLY_DENIED = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|RENAME|CALL|DO|IMPORT|START|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SET|PREPARE|EXECUTE|DEALLOCATE)\b/;

export class GuardError extends Error {
  constructor(
    message: string,
    public statementIndex: number,
    public statementLine?: number,
  ) {
    super(message);
  }
}

export function checkStatements(stmts: Statement[], mode: ExecMode): void {
  stmts.forEach((s, idx) => {
    const clean = stripCommentsAndStrings(s.sql).toUpperCase();
    for (const rule of ALWAYS_BLOCKED) {
      if (rule.re.test(clean)) throw new GuardError(rule.msg, idx, s.line);
    }
    if (mode === 'readonly' && READONLY_DENIED.test(clean)) {
      throw new GuardError(
        'Este ejercicio es de solo lectura: escribí una consulta (SELECT). Las sentencias que modifican datos se practican en los ejercicios de tipo "modificación".',
        idx,
        s.line,
      );
    }
  });
}
