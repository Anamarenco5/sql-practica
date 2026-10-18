import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, DIFFICULTY_LABEL, MODE_LABEL, type Difficulty, type ExerciseSummary, type Mode, type ReviewData, type Topic } from '../api';
import { ErrorBox } from '../components/Results';

type Status = 'solved' | 'tried' | 'new';

function status(e: ExerciseSummary): Status {
  if (e.progress?.solved) return 'solved';
  if ((e.progress?.attempts ?? 0) > 0) return 'tried';
  return 'new';
}

const STATUS_LABEL: Record<Status, string> = { solved: 'Resuelto', tried: 'Intentado', new: 'Sin empezar' };

interface Filters {
  q: string;
  difficulty: Difficulty | '';
  status: Status | '';
  mode: Mode | '';
  source: 'tp' | 'extra' | 'propios' | '';
}

const EMPTY: Filters = { q: '', difficulty: '', status: '', mode: '', source: '' };

function loadFilters(): Filters {
  try {
    return { ...EMPTY, ...JSON.parse(sessionStorage.getItem('filtros') ?? '{}') };
  } catch {
    return EMPTY;
  }
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function ReviewPanel({ review }: { review: ReviewData }) {
  if (review.items.length === 0 && review.errors.length === 0) return null;
  return (
    <section className="review" aria-labelledby="repaso">
      <h2 id="repaso">Para repasar</h2>
      <div className="review-grid">
        {review.items.length > 0 && (
          <ol className="review-list">
            {review.items.map((i) => (
              <li key={i.id}>
                <Link to={`/ejercicio/${i.id}`}>{i.title}</Link>
                <span className="muted small">{i.reason}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="review-side">
          {review.concepts.length > 0 && (
            <div>
              <h3>Conceptos que más te cuestan</h3>
              <p className="concept-chips">
                {review.concepts.map((c) => (
                  <span key={c.name} className="chip static">
                    {c.name}
                    {c.count > 1 && <span className="muted"> ×{c.count}</span>}
                  </span>
                ))}
              </p>
            </div>
          )}
          {review.errors.length > 0 && (
            <div>
              <h3>Tus errores más frecuentes</h3>
              <ul className="plain-list small">
                {review.errors.map((e) => (
                  <li key={e.code}>
                    {e.label} <span className="muted">({e.count})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function Dashboard() {
  const [list, setList] = useState<ExerciseSummary[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters>(loadFilters);

  useEffect(() => {
    Promise.all([api.exercises(), api.topics(), api.review()])
      .then(([l, t, r]) => {
        setList(l);
        setTopics(t);
        setReview(r);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem('filtros', JSON.stringify(f));
    } catch {
      /* sin almacenamiento: los filtros no se recuerdan */
    }
  }, [f]);

  const filtered = useMemo(() => {
    if (!list) return [];
    const q = normalize(f.q.trim());
    return list.filter(
      (e) =>
        (!q || normalize(`${e.title} ${e.source ?? ''}`).includes(q)) &&
        (!f.difficulty || e.difficulty === f.difficulty) &&
        (!f.status || status(e) === f.status) &&
        (!f.mode || e.mode === f.mode) &&
        (!f.source || (f.source === 'propios' ? e.mine : f.source === 'extra' ? e.custom && !e.mine : !e.custom)),
    );
  }, [list, f]);

  if (error) {
    return (
      <main className="page narrow">
        <ErrorBox error={{ code: 'ERROR', message: error }} />
      </main>
    );
  }
  if (!list) return <main className="page narrow muted">Cargando…</main>;

  const solved = list.filter((e) => status(e) === 'solved').length;
  const pending = list.find((e) => status(e) === 'tried') ?? list.find((e) => status(e) === 'new');
  const groups = topics.map((t) => ({ topic: t, items: filtered.filter((e) => e.topic === t.id), all: list.filter((e) => e.topic === t.id) })).filter((g) => g.items.length > 0);
  const filtering = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((prev) => ({ ...prev, [k]: v }));

  return (
    <main className="page">
      <section className="hero">
        <div>
          <h1>
            {solved} de {list.length} ejercicios resueltos
          </h1>
          <div className="meter" role="progressbar" aria-label="Progreso general" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={solved}>
            <span style={{ width: `${list.length ? (solved / list.length) * 100 : 0}%` }} />
          </div>
          <p className="muted">Base Universidad de los TPs, ejecutada en tu MySQL.</p>
        </div>
        <div className="hero-actions">
          {pending && (
            <Link className="btn primary big" to={`/ejercicio/${pending.id}`}>
              {solved === 0 && status(pending) === 'new' ? 'Empezar' : 'Seguir'} con “{pending.title}”
            </Link>
          )}
          <Link className="btn ghost" to="/ejercicios/nuevo">
            Crear ejercicio propio
          </Link>
        </div>
      </section>

      {review && <ReviewPanel review={review} />}

      <section className="filters" aria-label="Filtros">
        <input type="search" placeholder="Buscar por título o TP (ej: TP3 Ej. 17)" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Buscar" />
        <select value={f.difficulty} onChange={(e) => set('difficulty', e.target.value as Filters['difficulty'])} aria-label="Dificultad">
          <option value="">Toda dificultad</option>
          <option value="basico">Básico</option>
          <option value="intermedio">Intermedio</option>
          <option value="avanzado">Avanzado</option>
        </select>
        <select value={f.status} onChange={(e) => set('status', e.target.value as Filters['status'])} aria-label="Estado">
          <option value="">Todo estado</option>
          <option value="new">Sin empezar</option>
          <option value="tried">Intentados</option>
          <option value="solved">Resueltos</option>
        </select>
        <select value={f.mode} onChange={(e) => set('mode', e.target.value as Filters['mode'])} aria-label="Tipo">
          <option value="">Consulta y modificación</option>
          <option value="readonly">Solo consultas</option>
          <option value="sandbox">Solo modificación</option>
        </select>
        <select value={f.source} onChange={(e) => set('source', e.target.value as Filters['source'])} aria-label="Origen">
          <option value="">Todos</option>
          <option value="tp">De los TPs</option>
          <option value="extra">Extra (publicados)</option>
          <option value="propios">Mis ejercicios</option>
        </select>
        {filtering && (
          <button className="link" onClick={() => setF(EMPTY)}>
            Quitar filtros
          </button>
        )}
      </section>

      {groups.length === 0 && <p className="muted pad">Ningún ejercicio coincide con los filtros.</p>}

      {groups.map(({ topic, items, all }) => {
        const done = all.filter((e) => status(e) === 'solved').length;
        return (
          <section key={topic.id} className="topic">
            <header className="topic-head">
              <h2>{topic.name}</h2>
              <span className="topic-meter" aria-label={`${done} de ${all.length} resueltos`}>
                <span className="mini-meter">
                  <span style={{ width: `${(done / all.length) * 100}%` }} />
                </span>
                <span className="muted">
                  {done}/{all.length}
                </span>
              </span>
            </header>
            <ol className="ex-list">
              {items.map((e) => {
                const s = status(e);
                return (
                  <li key={e.id}>
                    <Link to={`/ejercicio/${e.id}`} className={`ex-row st-${s}`}>
                      <span className="dot" title={STATUS_LABEL[s]} aria-label={STATUS_LABEL[s]} />
                      <span className="ex-title">{e.title}</span>
                      <span className="ex-src muted">{e.mine ? 'Propio' : e.custom ? 'Extra' : (e.source ?? '')}</span>
                      <span className={`tag diff-${e.difficulty}`}>{DIFFICULTY_LABEL[e.difficulty]}</span>
                      <span className={`tag mode-${e.mode}`}>{MODE_LABEL[e.mode]}</span>
                      <span className="ex-att muted">{e.progress ? `${e.progress.attempts} intento${e.progress.attempts === 1 ? '' : 's'}` : ''}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </main>
  );
}
