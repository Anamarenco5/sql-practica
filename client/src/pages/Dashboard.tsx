import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, DIFFICULTY_LABEL, MODE_LABEL, type ExerciseSummary, type Topic } from '../api';
import { ErrorBox } from '../components/Results';

function status(e: ExerciseSummary): 'solved' | 'tried' | 'new' {
  if (e.progress?.solved) return 'solved';
  if ((e.progress?.attempts ?? 0) > 0) return 'tried';
  return 'new';
}

const STATUS_LABEL = { solved: 'Resuelto', tried: 'Intentado', new: 'Sin empezar' };

export function Dashboard() {
  const [list, setList] = useState<ExerciseSummary[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.exercises(), api.topics()])
      .then(([l, t]) => {
        setList(l);
        setTopics(t);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <main className="page narrow">
        <ErrorBox error={{ code: 'ERROR', message: error }} />
      </main>
    );
  }
  if (!list) return <main className="page narrow muted">Cargando…</main>;

  const solved = list.filter((e) => status(e) === 'solved').length;
  const pending = list.find((e) => status(e) !== 'solved');
  const groups = topics.map((t) => ({ topic: t, items: list.filter((e) => e.topic === t.id) })).filter((g) => g.items.length > 0);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <h1>
            {solved} de {list.length} ejercicios resueltos
          </h1>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={solved}>
            <span style={{ width: `${list.length ? (solved / list.length) * 100 : 0}%` }} />
          </div>
          <p className="muted">Consultas sobre la base Universidad de los trabajos prácticos, ejecutadas en tu MySQL real.</p>
        </div>
        {pending && (
          <Link className="btn primary big" to={`/ejercicio/${pending.id}`}>
            {solved === 0 ? 'Empezar' : 'Seguir'} con “{pending.title}”
          </Link>
        )}
      </section>

      {groups.map(({ topic, items }) => {
        const done = items.filter((e) => status(e) === 'solved').length;
        return (
          <section key={topic.id} className="topic">
            <header className="topic-head">
              <h2>{topic.name}</h2>
              <span className="muted">
                {done}/{items.length}
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
                      <span className="ex-src muted">{e.source ?? ''}</span>
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
