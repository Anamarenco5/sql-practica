import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, DIFFICULTY_LABEL, MODE_LABEL, type Exercise, type ExerciseSummary, type GradeResult, type ScriptOutcome, type TableInfo } from '../api';
import { Markdown } from '../components/Markdown';
import { ErrorBox, GradePanel, ResultsPanel } from '../components/Results';
import { SchemaPanel } from '../components/SchemaPanel';
import { SqlEditor } from '../components/SqlEditor';

type LeftTab = 'enunciado' | 'esquema';

export function ExercisePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [all, setAll] = useState<ExerciseSummary[]>([]);
  const [schema, setSchema] = useState<TableInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sql, setSql] = useState('');
  const [outcome, setOutcome] = useState<ScriptOutcome | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState<'run' | 'check' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [solution, setSolution] = useState<{ solution: string; explanation: string } | null>(null);
  const [solutionMsg, setSolutionMsg] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('enunciado');
  const [attempted, setAttempted] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setEx(null);
    setOutcome(null);
    setGrade(null);
    setSolution(null);
    setSolutionMsg(null);
    setHintsShown(0);
    setActionError(null);
    setLeftTab('enunciado');
    (async () => {
      try {
        const [e, list] = await Promise.all([api.exercise(id), api.exercises()]);
        if (!alive) return;
        setEx(e);
        setAll(list);
        setSql(e.draft ?? e.starterSql ?? '');
        setAttempted((e.progress?.attempts ?? 0) > 0);
        setSchema(await api.schema(e.dataset));
      } catch (err) {
        if (alive) setLoadError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Guarda el borrador automáticamente (1 s después de dejar de escribir).
  const onChange = (v: string) => {
    setSql(v);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.saveDraft(id, v).catch(() => {});
    }, 1000);
  };

  const run = useCallback(async () => {
    if (busy || !sql.trim()) return;
    setBusy('run');
    setActionError(null);
    setGrade(null);
    try {
      setOutcome(await api.run(id, sql));
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [busy, id, sql]);

  const check = useCallback(async () => {
    if (busy || !sql.trim()) return;
    setBusy('check');
    setActionError(null);
    try {
      const g = await api.check(id, sql, hintsShown);
      setGrade(g);
      if (g.output) setOutcome(g.output);
      setAttempted(true);
      if (g.correct && ex) setEx({ ...ex, progress: { ...(ex.progress ?? { exerciseId: id, attempts: 0, failedAttempts: 0, firstSolvedAt: null, lastAttemptAt: null, maxHints: 0 }), solved: true } });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [busy, id, sql, hintsShown, ex]);

  const showSolution = async () => {
    try {
      setSolution(await api.solution(id));
      setSolutionMsg(null);
    } catch (e) {
      setSolutionMsg((e as Error).message);
    }
  };

  const reset = () => {
    if (sql !== ex?.starterSql && !window.confirm('¿Reemplazar tu código por el inicial del ejercicio?')) return;
    onChange(ex?.starterSql ?? '');
    setOutcome(null);
    setGrade(null);
  };

  if (loadError) {
    return (
      <main className="page narrow">
        <ErrorBox error={{ code: 'ERROR', message: loadError }} />
        <Link to="/">Volver al inicio</Link>
      </main>
    );
  }
  if (!ex) return <main className="page narrow muted">Cargando ejercicio…</main>;

  const idx = all.findIndex((e) => e.id === ex.id);
  const next = idx >= 0 ? all[idx + 1] : undefined;
  const prev = idx > 0 ? all[idx - 1] : undefined;

  return (
    <main className="workspace">
      <section className="left" aria-label="Enunciado">
        <nav className="crumbs">
          <Link to="/">Ejercicios</Link>
          <span aria-hidden="true">/</span>
          <span>{ex.title}</span>
        </nav>
        <header className="ex-head">
          <h1>{ex.title}</h1>
          <div className="tags">
            <span className={`tag diff-${ex.difficulty}`}>{DIFFICULTY_LABEL[ex.difficulty]}</span>
            <span className={`tag mode-${ex.mode}`}>{MODE_LABEL[ex.mode]}</span>
            {ex.source && <span className="tag plain">{ex.source}</span>}
            {ex.progress?.solved && <span className="tag solved">Resuelto</span>}
          </div>
        </header>

        <div className="tabs left-tabs" role="tablist">
          <button role="tab" aria-selected={leftTab === 'enunciado'} onClick={() => setLeftTab('enunciado')}>
            Enunciado
          </button>
          <button role="tab" aria-selected={leftTab === 'esquema'} onClick={() => setLeftTab('esquema')}>
            Tablas y datos
          </button>
        </div>

        {leftTab === 'enunciado' ? (
          <div className="left-body">
            <Markdown text={ex.statement} className="statement" />
            {ex.mode === 'sandbox' && (
              <p className="note">Cada ejecución usa una copia nueva de la base. Lo que modifiques se descarta al terminar.</p>
            )}
            {ex.check.type === 'state' && ex.check.probes.length > 0 && (
              <div className="block">
                <h2>Cómo se va a comprobar</h2>
                <ul className="plain-list">
                  {ex.check.probes.map((p, i) => (
                    <li key={i}>
                      {p.description}: {p.expect === 'error' ? 'debe rechazarse' : 'debe aceptarse'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="block">
              <h2>Tablas que vas a usar</h2>
              <p className="table-chips">
                {ex.tables.map((t) => (
                  <button key={t} className="chip" onClick={() => setLeftTab('esquema')}>
                    {t}
                  </button>
                ))}
              </p>
            </div>

            {ex.hints.length > 0 && (
              <div className="block">
                <h2>Pistas</h2>
                <ol className="hints">
                  {ex.hints.slice(0, hintsShown).map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ol>
                {hintsShown < ex.hints.length && (
                  <button className="btn ghost small" onClick={() => setHintsShown((n) => n + 1)}>
                    {hintsShown === 0 ? 'Ver una pista' : `Ver pista ${hintsShown + 1} de ${ex.hints.length}`}
                  </button>
                )}
              </div>
            )}

            <div className="block">
              <h2>Solución</h2>
              {solution ? (
                <div className="solution">
                  <pre>
                    <code>{solution.solution}</code>
                  </pre>
                  <Markdown text={solution.explanation} />
                </div>
              ) : (
                <>
                  <button className="btn ghost small" onClick={showSolution} disabled={!attempted} title={attempted ? '' : 'Disponible después de comprobar al menos una vez'}>
                    Ver solución comentada
                  </button>
                  <p className="muted small">{attempted ? 'Intentaste resolverlo: ya podés verla.' : 'Se habilita después de comprobar tu respuesta al menos una vez.'}</p>
                  {solutionMsg && <p className="error-msg">{solutionMsg}</p>}
                </>
              )}
            </div>

            {ex.concepts.length > 0 && (
              <div className="block">
                <h2>Conceptos</h2>
                <p className="concepts">{ex.concepts.join(', ')}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="left-body">
            <SchemaPanel dataset={ex.dataset} schema={schema} relevant={ex.tables} onInsert={(t) => onChange(sql + (sql && !/\s$/.test(sql) ? ' ' : '') + t)} />
          </div>
        )}
      </section>

      <section className="right" aria-label="Editor y resultados">
        <div className="editor-shell">
          <SqlEditor value={sql} onChange={onChange} onRun={run} onCheck={check} schema={schema} />
        </div>
        <div className="toolbar">
          <button className="btn primary" onClick={run} disabled={busy !== null} title="Ctrl + Enter">
            {busy === 'run' ? 'Ejecutando…' : 'Ejecutar'}
          </button>
          <button className="btn accent" onClick={check} disabled={busy !== null} title="Ctrl + Shift + Enter">
            {busy === 'check' ? 'Comprobando…' : 'Comprobar'}
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => onChange('')} disabled={busy !== null}>
            Limpiar
          </button>
          <button className="btn ghost" onClick={reset} disabled={busy !== null}>
            Reiniciar
          </button>
        </div>
        {actionError && <ErrorBox error={{ code: 'ERROR', message: actionError }} />}
        {grade && <GradePanel grade={grade} onClose={() => setGrade(null)} />}
        {grade?.correct && next && (
          <div className="next">
            <button className="btn primary" onClick={() => navigate(`/ejercicio/${next.id}`)}>
              Siguiente: {next.title}
            </button>
          </div>
        )}
        <ResultsPanel outcome={outcome} running={busy !== null} />
        <nav className="pager">
          {prev ? <Link to={`/ejercicio/${prev.id}`}>Anterior: {prev.title}</Link> : <span />}
          {next ? <Link to={`/ejercicio/${next.id}`}>Siguiente: {next.title}</Link> : <span />}
        </nav>
      </section>
    </main>
  );
}
