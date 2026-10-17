import { Link, Route, Routes } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { ExercisePage } from './pages/ExercisePage';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="currentColor" />
            <g fill="none" stroke="#fff" strokeWidth="2.2">
              <rect x="7" y="8" width="18" height="16" rx="2" />
              <path d="M7 13.5h18M14 13.5V24" />
            </g>
          </svg>
          SQL Práctica
        </Link>
        <span className="topbar-note">Diseño de Bases de Datos</span>
      </header>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ejercicio/:id" element={<ExercisePage />} />
        <Route
          path="*"
          element={
            <main className="page narrow">
              <h1>Esta página no existe</h1>
              <Link to="/">Ir a los ejercicios</Link>
            </main>
          }
        />
      </Routes>
    </div>
  );
}
