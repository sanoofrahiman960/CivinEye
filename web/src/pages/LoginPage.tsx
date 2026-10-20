import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { toApiError } from '../api/client';
import { Banner, Button, TextInput } from '../components/ui';
import { useAction, useDocumentTitle } from '../hooks/useApi';
import { useAuthStore } from '../store/auth';

/** Staff sign in with the username + password their administrator created. There is no self-service sign-up. */
export function LoginPage() {
  useDocumentTitle('Sign in');
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, run } = useAction();

  if (status === 'signedIn') return <Navigate to={from} replace />;

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const next = {
      username: username.trim() ? undefined : 'Enter your username.',
      password: password ? undefined : 'Enter your password.',
    };
    setErrors(next);
    if (next.username || next.password) return;
    await run(async () => {
      try {
        await login(username, password);
        navigate(from, { replace: true });
      } catch (error) {
        const apiError = toApiError(error);
        if (apiError.code === 'wrong_portal') {
          setFormError('This is a citizen account. Citizens use the CivicEye mobile app; this dashboard is for department staff.');
        } else if (apiError.status === 401) {
          setFormError('Incorrect username or password.');
        } else {
          setFormError(apiError.message);
        }
      }
    });
  }

  return (
    <div className="auth-page">
      <section className="auth-hero" aria-hidden>
        <div>
          <img src="/favicon.svg" alt="" width={48} height={48} />
          <h1>CivicEye Authority Dashboard</h1>
          <p>Review, prioritise and resolve civic issues reported in your area.</p>
          <ul>
            <li>Only issues located in your service areas</li>
            <li>Live KPIs, SLA tracking and overdue alerts</li>
            <li>Location-checked resolution evidence (Proof-Lock)</li>
            <li>Citizen verification before closure</li>
          </ul>
        </div>
        <small>Accounts are created by your system administrator.</small>
      </section>
      <section className="auth-form">
        <form onSubmit={onLogin} noValidate>
          <h1 style={{ marginBottom: 6 }}>Authority sign in</h1>
          <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
            For department officers, supervisors and administrators.
          </p>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <TextInput
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={errors.username}
            autoFocus
          />
          <TextInput
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <Button type="submit" icon={LogIn} loading={busy} style={{ width: '100%' }}>
            Sign in
          </Button>
          <p className="subtle" style={{ textAlign: 'center', marginTop: 14 }}>
            Forgot your username or password? Ask your system administrator to reset it.
          </p>
        </form>
      </section>
    </div>
  );
}
