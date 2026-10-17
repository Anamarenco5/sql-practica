import { useState } from 'react';
import type { GradeResult, OkResult, RowsResult, ScriptOutcome, SqlError } from '../api';

export function DataGrid({ columns, rows, types }: { columns: string[]; rows: unknown[][]; types?: string[] }) {
  if (columns.length === 0) return <p className="muted">La consulta no devolvió columnas.</p>;
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="rownum" aria-label="Fila"></th>
            {columns.map((c, i) => (
              <th key={i}>
                <span className="col-name">{c}</span>
                {types?.[i] && <span className="col-type">{types[i].toLowerCase()}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={columns.length + 1}>
                0 filas
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                <td className="rownum">{i + 1}</td>
                {r.map((v, j) => (
                  <td key={j} className={v === null ? 'null' : typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? 'num' : ''}>
                    {v === null ? 'NULL' : String(v)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorBox({ error }: { error: SqlError }) {
  const where = error.statementLine ? `Línea ${error.statementLine}` : null;
  return (
    <div className="error-box" role="alert">
      <div className="error-head">
        <strong>{error.code === 'BLOQUEADO' ? 'Sentencia no permitida' : error.errno ? `Error ${error.errno}` : 'Error'}</strong>
        {where && <span className="muted">{where}</span>}
      </div>
      <p className="error-msg">{error.message}</p>
      {error.hint && <p className="error-hint">{error.hint}</p>}
    </div>
  );
}

function okLine(r: OkResult): string {
  const s = r.statement.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  if (['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(s)) {
    return `${r.affectedRows} fila(s) afectada(s)${r.info ? ` — ${r.info}` : ''}`;
  }
  return 'OK';
}

export function ResultsPanel({ outcome, running }: { outcome: ScriptOutcome | null; running: boolean }) {
  const [tab, setTab] = useState<'result' | 'log'>('result');
  if (running) return <div className="results placeholder">Ejecutando en MySQL…</div>;
  if (!outcome) {
    return (
      <div className="results placeholder">
        Ejecutá tu consulta para ver el resultado. <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
      </div>
    );
  }
  const sets = outcome.results.filter((r): r is RowsResult => r.kind === 'rows');
  const last = sets[sets.length - 1];

  return (
    <div className="results">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'result'} onClick={() => setTab('result')}>
          Resultado
        </button>
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>
          Mensajes ({outcome.results.length + (outcome.error ? 1 : 0)})
        </button>
        {last && tab === 'result' && (
          <span className="tab-meta">
            {last.rowCount} {last.rowCount === 1 ? 'fila' : 'filas'} en {last.durationMs} ms
            {last.displayTruncated && ', se muestran las primeras 500'}
            {last.truncated && ' (resultado truncado)'}
          </span>
        )}
      </div>
      {tab === 'result' ? (
        <div className="tab-body">
          {outcome.error && <ErrorBox error={outcome.error} />}
          {last ? (
            <DataGrid columns={last.columns.map((c) => c.name)} types={last.columns.map((c) => c.type)} rows={last.rows} />
          ) : (
            !outcome.error && <p className="muted pad">El script se ejecutó sin devolver filas. Mirá la pestaña Mensajes.</p>
          )}
        </div>
      ) : (
        <ol className="log tab-body">
          {outcome.results.map((r, i) => (
            <li key={i} className="ok">
              <code>{r.statement.length > 90 ? r.statement.slice(0, 90) + '…' : r.statement}</code>
              <span>{r.kind === 'rows' ? `${r.rowCount} fila(s) devuelta(s)` : okLine(r)}</span>
              <span className="muted">{r.durationMs} ms</span>
            </li>
          ))}
          {outcome.error && (
            <li className="bad">
              <code>Sentencia {(outcome.error.statementIndex ?? 0) + 1}</code>
              <span>{outcome.error.message}</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

export function GradePanel({ grade, onClose }: { grade: GradeResult; onClose: () => void }) {
  return (
    <section className={`grade ${grade.correct ? 'is-ok' : 'is-bad'}`} aria-live="polite">
      <div className="grade-head">
        <span className="grade-mark" aria-hidden="true">
          {grade.correct ? '✓' : '✕'}
        </span>
        <strong>{grade.summary}</strong>
        <button className="link" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {grade.feedback.length > 0 && (
        <ul className="grade-list">
          {grade.feedback.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {grade.warnings.length > 0 && (
        <ul className="grade-list warn">
          {grade.warnings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {grade.probes && grade.probes.length > 0 && (
        <table className="probes">
          <tbody>
            {grade.probes.map((p, i) => (
              <tr key={i} className={p.passed ? 'ok' : 'bad'}>
                <td>{p.passed ? '✓' : '✕'}</td>
                <td>{p.description}</td>
                <td className="muted">{p.expected === 'error' ? 'debe rechazarse' : 'debe aceptarse'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
