// Pantalla de acceso: iniciar sesión o crear una cuenta.
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

export function AuthPage() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setUser(mode === 'login' ? await api.login(email, password) : await api.register(name, email, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m: 'login' | 'register') => {
    setMode(m);
    setError(null);
  };

  return (
    <main className="auth">
      <section className="auth-intro">
        <h1>Practicá SQL sobre MySQL real</h1>
        <p>
          94 ejercicios de Diseño de Bases de Datos sobre la base Universidad: consultas, JOIN, subconsultas, restricciones, triggers,
          procedimientos y transacciones. Escribís tu consulta, la ejecutás y te dice si es correcta.
        </p>
        <p className="muted">Tu progreso, tus intentos y tus ejercicios propios quedan guardados en tu cuenta.</p>
      </section>

      <form className="auth-form" onSubmit={submit}>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchTo('login')}>
            Iniciar sesión
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => switchTo('register')}>
            Crear cuenta
          </button>
        </div>

        {mode === 'register' && (
          <label className="field">
            <span className="field-label">Nombre</span>
            <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
        )}
        <label className="field">
          <span className="field-label">Email</span>
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Contraseña</span>
          <input
            required
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && <span className="field-help">Al menos 8 caracteres.</span>}
        </label>

        {error && (
          <p className="error-msg form-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary big" type="submit" disabled={busy}>
          {busy ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </button>
        <p className="muted small">
          {mode === 'login' ? '¿Primera vez? ' : '¿Ya tenés cuenta? '}
          <button type="button" className="link" onClick={() => switchTo(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Creá una cuenta' : 'Iniciá sesión'}
          </button>
        </p>
      </form>
    </main>
  );
}
