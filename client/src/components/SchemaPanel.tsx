// Estructura de las tablas: columnas, tipos, PK/FK y muestra de datos.
import { useState } from 'react';
import { api, type Sample, type TableInfo } from '../api';
import { DataGrid } from './Results';

function TableItem({ dataset, table, defaultOpen, onInsert }: { dataset: string; table: TableInfo; defaultOpen: boolean; onInsert: (t: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const [sample, setSample] = useState<Sample | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fk = new Map(table.foreignKeys.map((f) => [f.column, f]));

  const toggleSample = async () => {
    if (!showSample && !sample) {
      try {
        setSample(await api.sample(dataset, table.name));
      } catch (e) {
        setErr((e as Error).message);
      }
    }
    setShowSample((v) => !v);
  };

  return (
    <li className={`table-item ${open ? 'open' : ''}`}>
      <button className="table-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="caret" aria-hidden="true" />
        <span className="table-name">{table.name}</span>
        <span className="muted small">{table.rowCount.toLocaleString('es-AR')} filas</span>
      </button>
      {open && (
        <div className="table-body">
          <table className="cols">
            <tbody>
              {table.columns.map((c) => {
                const ref = fk.get(c.name);
                return (
                  <tr key={c.name}>
                    <td className="col-key">
                      {c.key === 'PRI' && <abbr title="Clave primaria">PK</abbr>}
                      {ref && <abbr title={`Clave foránea a ${ref.refTable}.${ref.refColumn}`}>FK</abbr>}
                      {c.key === 'UNI' && !ref && <abbr title="Valor único">UQ</abbr>}
                    </td>
                    <td className="col-n">
                      {c.name}
                      {ref && <span className="ref"> → {ref.refTable}</span>}
                    </td>
                    <td className="col-t">
                      {c.type}
                      {!c.nullable && c.key !== 'PRI' && <span className="nn" title="NOT NULL"> no nulo</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="table-actions">
            <button className="link" onClick={toggleSample}>
              {showSample ? 'Ocultar datos' : 'Ver datos de ejemplo'}
            </button>
            <button className="link" onClick={() => onInsert(table.name)}>
              Insertar nombre en el editor
            </button>
          </div>
          {err && <p className="error-msg">{err}</p>}
          {showSample && sample && (
            <div className="sample">
              <DataGrid columns={sample.columns} rows={sample.rows} />
              <p className="muted small">Primeras {sample.rows.length} de {sample.total.toLocaleString('es-AR')} filas.</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function SchemaPanel({ dataset, schema, relevant, onInsert }: { dataset: string; schema: TableInfo[]; relevant: string[]; onInsert: (t: string) => void }) {
  const [showAll, setShowAll] = useState(relevant.length === 0);
  const main = relevant.map((r) => schema.find((t) => t.name === r)).filter((t): t is TableInfo => Boolean(t));
  const others = schema.filter((t) => !relevant.includes(t.name));
  return (
    <div className="schema">
      <ul className="table-list">
        {main.map((t, i) => (
          <TableItem key={t.name} dataset={dataset} table={t} defaultOpen={i === 0 || main.length <= 2} onInsert={onInsert} />
        ))}
      </ul>
      {others.length > 0 && (
        <>
          <button className="link" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ocultar el resto de las tablas' : `Ver las otras ${others.length} tablas de la base`}
          </button>
          {showAll && (
            <ul className="table-list">
              {others.map((t) => (
                <TableItem key={t.name} dataset={dataset} table={t} defaultOpen={false} onInsert={onInsert} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
