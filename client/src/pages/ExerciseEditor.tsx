// Formulario para crear o editar ejercicios propios.
// Antes de guardar, el backend ejecuta la solución y verifica que apruebe su propio ejercicio.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type ExerciseDefinition, type Probe, type Requirement, type TableInfo, type Topic, type ValidationResult } from '../api';
import { Markdown } from '../components/Markdown';
import { ErrorBox, GradePanel, ResultsPanel } from '../components/Results';
import { SqlEditor } from '../components/SqlEditor';

const NEW: ExerciseDefinition = {
  title: '',
  topic: 'consultas-basicas',
  difficulty: 'basico',
  dataset: 'universidad',
  mode: 'readonly',
  statement: '',
  tables: [],
  starterSql: '',
  solution: '',
  explanation: '',
  hints: [],
  concepts: [],
  requirements: [],
  check: { type: 'result', orderMatters: false, checkColumnNames: false },
};

const noop = () => {};

function SqlField({ label, value, onChange, schema, help, height = 160 }: { label: string; value: string; onChange: (v: string) => void; schema: TableInfo[]; help?: string; height?: number }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {help && <span className="field-help">{help}</span>}
      <div className="field-editor" style={{ height }}>
        <SqlEditor value={value} onChange={onChange} onRun={noop} onCheck={noop} schema={schema} />
      </div>
    </div>
  );
}

export function ExerciseEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [def, setDef] = useState<ExerciseDefinition>(NEW);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [schema, setSchema] = useState<TableInfo[]>([]);
  const [hintsText, setHintsText] = useState('');
  const [conceptsText, setConceptsText] = useState('');
  const [orderKeysText, setOrderKeysText] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<'validate' | 'save' | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.topics().then(setTopics).catch(() => {});
    if (id) {
      api
        .customExercise(id)
        .then((e) => {
          const { id: _id, ...rest } = e as ExerciseDefinition & { id: string; custom?: boolean; hintCount?: number };
          setDef({ ...NEW, ...rest });
          setHintsText(e.hints.join('\n'));
          setConceptsText(e.concepts.join(', '));
          if (e.check.type === 'result' && e.check.orderKeys) setOrderKeysText(e.check.orderKeys.map((k) => k + 1).join(', '));
        })
        .catch((e) => setLoadError(e.message));
    }
  }, [id]);

  useEffect(() => {
    api.schema(def.dataset).then(setSchema).catch(() => setSchema([]));
  }, [def.dataset]);

  const set = <K extends keyof ExerciseDefinition>(k: K, v: ExerciseDefinition[K]) => setDef((d) => ({ ...d, [k]: v }));

  const setMode = (mode: ExerciseDefinition['mode']) => {
    setDef((d) => ({
      ...d,
      mode,
      // por defecto: consultas se corrigen por resultado; modificaciones por estado final
      check:
        mode === 'readonly'
          ? { type: 'result', orderMatters: false, checkColumnNames: false }
          : d.check.type === 'state'
            ? d.check
            : { type: 'state', verifyQueries: [''], probes: [] },
    }));
  };

  /** Arma la definición final a partir de los campos de texto auxiliares. */
  const build = (): ExerciseDefinition => {
    const check = def.check.type === 'result'
      ? {
          ...def.check,
          orderKeys: def.check.orderMatters
            ? orderKeysText.split(',').map((s) => Number(s.trim()) - 1).filter((n) => Number.isInteger(n) && n >= 0)
            : undefined,
        }
      : { ...def.check, verifyQueries: def.check.verifyQueries.filter((q) => q.trim() !== '') };
    return {
      ...def,
      title: def.title.trim(),
      hints: hintsText.split('\n').map((s) => s.trim()).filter(Boolean),
      concepts: conceptsText.split(',').map((s) => s.trim()).filter(Boolean),
      check,
    };
  };

  const validate = async () => {
    setBusy('validate');
    setResult(null);
    try {
      setResult(await api.validateCustom(build()));
    } catch (e) {
      setResult({ ok: false, errors: [(e as Error).message] });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setResult(null);
    try {
      const r = id ? await api.updateCustom(id, build()) : await api.createCustom(build());
      if (r.ok && r.id) navigate(`/ejercicio/${r.id}`);
      else setResult(r);
    } catch (e) {
      setResult({ ok: false, errors: [(e as Error).message] });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!id || !window.confirm('¿Borrar este ejercicio? Tus intentos quedan guardados, pero el ejercicio desaparece.')) return;
    await api.deleteCustom(id);
    navigate('/');
  };

  if (loadError) {
    return (
      <main className="page narrow">
        <ErrorBox error={{ code: 'ERROR', message: loadError }} />
        <Link to="/">Volver al inicio</Link>
      </main>
    );
  }

  const check = def.check;
  const updateState = (patch: Partial<Extract<ExerciseDefinition['check'], { type: 'state' }>>) =>
    setDef((d) => (d.check.type === 'state' ? { ...d, check: { ...d.check, ...patch } } : d));
  const updateResult = (patch: Partial<Extract<ExerciseDefinition['check'], { type: 'result' }>>) =>
    setDef((d) => (d.check.type === 'result' ? { ...d, check: { ...d.check, ...patch } } : d));

  return (
    <main className="page editor-page">
      <nav className="crumbs">
        <Link to="/">Ejercicios</Link>
        <span aria-hidden="true">/</span>
        <span>{editing ? 'Editar ejercicio' : 'Nuevo ejercicio'}</span>
      </nav>
      <h1>{editing ? 'Editar ejercicio propio' : 'Crear ejercicio propio'}</h1>
      <p className="muted lead">
        Cargá un enunciado y su solución. Al guardar, la solución se ejecuta en MySQL y tiene que aprobar su propio ejercicio: así sabés que la corrección automática va a funcionar.
      </p>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset>
          <legend>Datos generales</legend>
          <label className="field">
            <span className="field-label">Título</span>
            <input required value={def.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej: Docentes con más de 5 comisiones" />
          </label>
          <div className="row">
            <label className="field">
              <span className="field-label">Tema</span>
              <select value={def.topic} onChange={(e) => set('topic', e.target.value)}>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Dificultad</span>
              <select value={def.difficulty} onChange={(e) => set('difficulty', e.target.value as ExerciseDefinition['difficulty'])}>
                <option value="basico">Básico</option>
                <option value="intermedio">Intermedio</option>
                <option value="avanzado">Avanzado</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Tipo</span>
              <select value={def.mode} onChange={(e) => setMode(e.target.value as ExerciseDefinition['mode'])}>
                <option value="readonly">Consulta (SELECT)</option>
                <option value="sandbox">Modificación (DML, DDL, triggers…)</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Origen (opcional)</span>
              <input value={def.source ?? ''} onChange={(e) => set('source', e.target.value || undefined)} placeholder="Ej: Parcial 2025 Ej. 3" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Enunciado</legend>
          <div className="field">
            <span className="field-label">
              Consigna{' '}
              <button type="button" className="link" onClick={() => setPreview((v) => !v)}>
                {preview ? 'Editar' : 'Vista previa'}
              </button>
            </span>
            <span className="field-help">Admite markdown: **negrita**, `código`, listas con guiones.</span>
            {preview ? (
              <div className="preview">
                <Markdown text={def.statement || '_Sin enunciado todavía._'} />
              </div>
            ) : (
              <textarea required rows={6} value={def.statement} onChange={(e) => set('statement', e.target.value)} />
            )}
          </div>
          <div className="field">
            <span className="field-label">Tablas que se usan</span>
            <span className="field-help">Se muestran primero en el panel de tablas del ejercicio.</span>
            <div className="checks">
              {schema.map((t) => (
                <label key={t.name} className="check">
                  <input
                    type="checkbox"
                    checked={def.tables.includes(t.name)}
                    onChange={(e) => set('tables', e.target.checked ? [...def.tables, t.name] : def.tables.filter((x) => x !== t.name))}
                  />
                  <code>{t.name}</code>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Solución</legend>
          <SqlField label="Solución de referencia" value={def.solution} onChange={(v) => set('solution', v)} schema={schema} help="Se usa para corregir. Podés usar DELIMITER." height={200} />
          <SqlField label="Código inicial (opcional)" value={def.starterSql} onChange={(v) => set('starterSql', v)} schema={schema} help="Lo que aparece en el editor al abrir el ejercicio." height={110} />
          <label className="field">
            <span className="field-label">Explicación (opcional)</span>
            <span className="field-help">Se muestra junto con la solución, después del primer intento. Admite markdown.</span>
            <textarea rows={4} value={def.explanation} onChange={(e) => set('explanation', e.target.value)} />
          </label>
          <div className="row">
            <label className="field">
              <span className="field-label">Pistas</span>
              <span className="field-help">Una por línea, de la más general a la más específica.</span>
              <textarea rows={4} value={hintsText} onChange={(e) => setHintsText(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Conceptos</span>
              <span className="field-help">Separados por comas. Alimentan el panel de repaso.</span>
              <textarea rows={4} value={conceptsText} onChange={(e) => setConceptsText(e.target.value)} placeholder="LEFT JOIN, HAVING" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Corrección</legend>
          {check.type === 'result' ? (
            <>
              <p className="field-help">Se compara el último resultado de la consulta del alumno con el de tu solución. Se aceptan consultas distintas que devuelvan lo mismo.</p>
              <label className="check">
                <input type="checkbox" checked={check.orderMatters} onChange={(e) => updateResult({ orderMatters: e.target.checked })} />
                El orden de las filas importa (el enunciado pide ORDER BY)
              </label>
              {check.orderMatters && (
                <label className="field narrow-field">
                  <span className="field-label">Columnas del ORDER BY (opcional)</span>
                  <span className="field-help">Posiciones separadas por coma, ej: 3 o 1, 2. Así se toleran empates.</span>
                  <input value={orderKeysText} onChange={(e) => setOrderKeysText(e.target.value)} />
                </label>
              )}
              <label className="check">
                <input type="checkbox" checked={check.checkColumnNames} onChange={(e) => updateResult({ checkColumnNames: e.target.checked })} />
                Exigir los mismos nombres de columna (alias)
              </label>
            </>
          ) : (
            <>
              <p className="field-help">El script del alumno y tu solución corren cada uno en una copia de la base. Después se ejecutan las pruebas y las consultas de verificación, y se comparan.</p>
              <div className="field">
                <span className="field-label">Pruebas</span>
                <span className="field-help">Sentencias que la base debe rechazar o aceptar después del script (ideal para CHECK, FK, triggers y procedimientos). Cada una se deshace al terminar.</span>
                {check.probes.map((p, i) => (
                  <div key={i} className="probe-row">
                    <input
                      placeholder="Descripción, ej: Insertar una nota de 11"
                      value={p.description}
                      onChange={(e) => updateState({ probes: check.probes.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })}
                    />
                    <select value={p.expect} onChange={(e) => updateState({ probes: check.probes.map((x, j) => (j === i ? { ...x, expect: e.target.value as Probe['expect'] } : x)) })}>
                      <option value="error">debe rechazarse</option>
                      <option value="ok">debe aceptarse</option>
                    </select>
                    <textarea
                      className="mono"
                      rows={2}
                      placeholder="INSERT INTO notas (...) VALUES (...)"
                      value={p.sql}
                      onChange={(e) => updateState({ probes: check.probes.map((x, j) => (j === i ? { ...x, sql: e.target.value } : x)) })}
                    />
                    <button type="button" className="link" onClick={() => updateState({ probes: check.probes.filter((_, j) => j !== i) })}>
                      Quitar
                    </button>
                  </div>
                ))}
                <button type="button" className="btn ghost small" onClick={() => updateState({ probes: [...check.probes, { description: '', sql: '', expect: 'error' }] })}>
                  Agregar prueba
                </button>
              </div>
              <div className="field">
                <span className="field-label">Consultas de verificación</span>
                <span className="field-help">Se ejecutan al final; se compara su resultado con el de tu solución. Pueden ser varias sentencias: se compara el último SELECT.</span>
                {check.verifyQueries.map((q, i) => (
                  <div key={i} className="probe-row single">
                    <textarea
                      className="mono"
                      rows={3}
                      placeholder="SELECT id_docente, salario_base FROM docentes"
                      value={q}
                      onChange={(e) => updateState({ verifyQueries: check.verifyQueries.map((x, j) => (j === i ? e.target.value : x)) })}
                    />
                    <button type="button" className="link" onClick={() => updateState({ verifyQueries: check.verifyQueries.filter((_, j) => j !== i) })}>
                      Quitar
                    </button>
                  </div>
                ))}
                <button type="button" className="btn ghost small" onClick={() => updateState({ verifyQueries: [...check.verifyQueries, ''] })}>
                  Agregar consulta
                </button>
              </div>
            </>
          )}

          <div className="field">
            <span className="field-label">Requisitos (opcional)</span>
            <span className="field-help">Expresiones regulares que el SQL del alumno debe contener (o no), ej: LEFT\s+JOIN.</span>
            {def.requirements.map((r, i) => (
              <div key={i} className="probe-row">
                <input
                  className="mono"
                  placeholder="Patrón, ej: \(\s*SELECT"
                  value={r.pattern}
                  onChange={(e) => set('requirements', def.requirements.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)))}
                />
                <select value={r.forbid ? 'forbid' : 'require'} onChange={(e) => set('requirements', def.requirements.map((x, j) => (j === i ? { ...x, forbid: e.target.value === 'forbid' } : x)))}>
                  <option value="require">debe aparecer</option>
                  <option value="forbid">no debe aparecer</option>
                </select>
                <input
                  placeholder="Mensaje si no se cumple"
                  value={r.message}
                  onChange={(e) => set('requirements', def.requirements.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)))}
                />
                <button type="button" className="link" onClick={() => set('requirements', def.requirements.filter((_, j) => j !== i))}>
                  Quitar
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost small" onClick={() => set('requirements', [...def.requirements, { pattern: '', message: '', forbid: false } as Requirement])}>
              Agregar requisito
            </button>
          </div>
        </fieldset>

        {result && !result.ok && (
          <div className="error-box" role="alert">
            <strong>Todavía no se puede guardar</strong>
            <ul className="grade-list">
              {(result.errors ?? []).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {result?.ok && <p className="ok-note">La solución funciona y aprueba su propio ejercicio. Ya podés guardarlo.</p>}
        {result?.warnings && result.warnings.length > 0 && (
          <ul className="warn-note">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {result?.grade?.probes && result.grade.probes.length > 0 && <GradePanel grade={result.grade} onClose={() => setResult(null)} />}
        {result?.grade?.output && (
          <div className="editor-results">
            <ResultsPanel outcome={result.grade.output} running={false} />
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={validate} disabled={busy !== null}>
            {busy === 'validate' ? 'Probando…' : 'Probar solución'}
          </button>
          <button type="submit" className="btn primary" disabled={busy !== null}>
            {busy === 'save' ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar ejercicio'}
          </button>
          <span className="spacer" />
          {editing && (
            <button type="button" className="btn danger" onClick={remove} disabled={busy !== null}>
              Borrar ejercicio
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
