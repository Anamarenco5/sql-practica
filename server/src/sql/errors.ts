// Traduce los errores más comunes de MySQL a explicaciones en español pensadas
// para estudiar. Siempre se conserva el mensaje original del motor.

export interface SqlErrorInfo {
  code: string; // ej: ER_PARSE_ERROR
  errno?: number; // ej: 1064
  sqlState?: string;
  message: string; // mensaje original de MySQL
  hint?: string; // explicación en español
  statementIndex?: number; // índice de la sentencia que falló
  statementLine?: number;
}

const HINTS: Record<number, string> = {
  1064: 'Error de sintaxis. Revisá el fragmento que MySQL muestra después de "near": suele faltar una coma, sobrar una coma antes de FROM, o haber una palabra clave mal escrita o en el orden incorrecto (SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT).',
  1146: 'La tabla no existe. Revisá el nombre en el panel de esquema (los nombres de tabla distinguen mayúsculas en Linux).',
  1054: 'La columna no existe o no se puede usar en ese lugar. Revisá el nombre, el alias de la tabla, y recordá que un alias del SELECT no se puede usar en el WHERE (sí en HAVING y ORDER BY).',
  1052: 'Columna ambigua: existe en más de una de las tablas del JOIN. Calificala con el nombre o alias de la tabla (ej: a.id_departamento).',
  1055: 'Con ONLY_FULL_GROUP_BY, toda columna del SELECT que no esté dentro de una función de agregación (COUNT, SUM, AVG…) debe aparecer en el GROUP BY.',
  1111: 'Uso inválido de una función de agregación. Las condiciones sobre COUNT/SUM/AVG van en HAVING, no en WHERE.',
  1140: 'Mezclaste columnas agregadas y no agregadas sin GROUP BY.',
  1241: 'El operando debe tener 1 columna: la subconsulta devuelve más columnas de las que se pueden comparar.',
  1242: 'La subconsulta devuelve más de una fila y se usó con =, <, >… Usá IN, ANY/ALL, EXISTS o hacé que la subconsulta devuelva un único valor.',
  1248: 'Toda tabla derivada (subconsulta en el FROM) necesita un alias.',
  1222: 'Las consultas combinadas con UNION deben tener la misma cantidad de columnas.',
  1060: 'Nombre de columna duplicado en la tabla o vista.',
  1062: 'Valor duplicado para una clave PRIMARY KEY o UNIQUE.',
  1048: 'Se intentó guardar NULL en una columna NOT NULL.',
  1364: 'La columna no tiene valor por defecto y no se indicó en el INSERT.',
  1366: 'Valor incorrecto para el tipo de dato de la columna.',
  1265: 'Dato truncado: el valor no entra en la columna o no es válido para el ENUM.',
  1406: 'El texto es más largo de lo que permite la columna.',
  1451: 'No se puede borrar/actualizar la fila padre: otras filas la referencian mediante una FOREIGN KEY (salvo que la FK tenga ON DELETE CASCADE/SET NULL).',
  1452: 'No se puede insertar/actualizar la fila hija: el valor de la FOREIGN KEY no existe en la tabla referenciada.',
  3819: 'Se violó una restricción CHECK.',
  1644: 'Error lanzado por SIGNAL dentro de un trigger o procedimiento.',
  1305: 'La función o procedimiento no existe en esta base.',
  1318: 'Cantidad incorrecta de argumentos al llamar al procedimiento o función.',
  1304: 'Ya existe un procedimiento/función con ese nombre. Usá DROP PROCEDURE IF EXISTS antes de crearlo.',
  1359: 'Ya existe un trigger con ese nombre.',
  1235: 'Esta versión de MySQL no soporta esa combinación (por ejemplo LIMIT dentro de una subconsulta con IN).',
  1093: 'No se puede modificar una tabla y leerla en una subconsulta de la misma sentencia. Envolvé la subconsulta en una tabla derivada.',
  1442: 'Un trigger no puede modificar la misma tabla que lo disparó.',
  1419: 'MySQL tiene el log binario activo y no confía en funciones/triggers sin privilegio SUPER. Corré de nuevo "npm run db:setup", que activa log_bin_trust_function_creators.',
  1142: 'Permiso denegado: el usuario de práctica no puede acceder a esa tabla o base. Trabajá solo con las tablas del ejercicio.',
  1044: 'Permiso denegado sobre esa base de datos.',
  1227: 'Permiso denegado: esa operación requiere privilegios de administrador.',
  1792: 'El ejercicio es de solo lectura: no se pueden modificar datos.',
  3024: 'La consulta superó el tiempo máximo de ejecución. ¿Hay un JOIN sin condición (producto cartesiano) o una subconsulta muy costosa?',
  1317: 'La consulta fue cancelada por superar el tiempo máximo.',
  1327: 'Variable no declarada. Dentro de un procedimiento, declarala con DECLARE al inicio del bloque BEGIN.',
  1337: 'Orden incorrecto de DECLARE: primero variables y condiciones, luego cursores y al final handlers.',
  1415: 'Una función no puede devolver un conjunto de resultados (SELECT sin INTO).',
  1584: 'Parámetros incorrectos en la llamada a la función nativa.',
  1630: 'La función no existe. ¿Dejaste un espacio entre el nombre de la función y el paréntesis?',
  1582: 'Cantidad incorrecta de parámetros para la función.',
};

export function toErrorInfo(err: unknown, statementIndex?: number, statementLine?: number): SqlErrorInfo {
  const e = err as { code?: string; errno?: number; sqlState?: string; sqlMessage?: string; message?: string };
  const errno = e.errno;
  return {
    code: e.code ?? 'ERROR',
    errno,
    sqlState: e.sqlState,
    message: e.sqlMessage ?? e.message ?? String(err),
    hint: errno !== undefined ? HINTS[errno] : undefined,
    statementIndex,
    statementLine,
  };
}
