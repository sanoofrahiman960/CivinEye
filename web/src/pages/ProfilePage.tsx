import { KeyRound, Save } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { toApiError } from '../api/client';
import { authApi } from '../api/endpoints';
import { Banner, Button, Card, KeyValues, PageHeader, TextInput } from '../components/ui';
import { useAction, useDocumentTitle } from '../hooks/useApi';
import { formatDate } from '../lib/format';
import { ROLE_LABELS } from '../lib/styles';
import { useAuthStore } from '../store/auth';

const PHONE = /^\+?[0-9]{7,15}$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,49}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ProfilePage() {
  useDocumentTitle('Profile');
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const applyAuthResponse = useAuthStore((s) => s.applyAuthResponse);

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone_number ?? '');
  const [profileErrors, setProfileErrors] = useState<Record<string, string | undefined>>({});
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const saveProfile = useAction();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string | undefined>>({});
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const savePassword = useAction();

  if (!user) return null;

  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    setProfileNotice(null);
    const cleanedPhone = phone.replace(/[\s-]/g, '');
    const cleanedUsername = username.trim().toLowerCase();
    const cleanedEmail = email.trim().toLowerCase();
    const errors = {
      username: !cleanedUsername
        ? 'Enter a username.'
        : !USERNAME.test(cleanedUsername)
          ? 'Use 3–50 lowercase letters, digits, dots, hyphens or underscores.'
          : undefined,
      email: cleanedEmail && !EMAIL.test(cleanedEmail) ? 'Enter a valid email address.' : undefined,
      full_name: fullName.trim().length < 2 ? 'Enter your full name.' : undefined,
      phone_number: cleanedPhone && !PHONE.test(cleanedPhone) ? 'Enter a valid phone number.' : undefined,
    };
    setProfileErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    const usernameChanged = cleanedUsername !== user?.username;
    const emailChanged = cleanedEmail !== (user?.email ?? '');
    await saveProfile.run(async () => {
      try {
        const updated = await authApi.updateProfile({
          // Only send login details when they change, so unchanged values never trip the uniqueness check.
          ...(usernameChanged ? { username: cleanedUsername } : {}),
          ...(emailChanged ? { email: cleanedEmail } : {}),
          full_name: fullName.trim(),
          phone_number: cleanedPhone,
        });
        setUser(updated);
        setUsername(updated.username ?? '');
        setEmail(updated.email ?? '');
        setProfileNotice(usernameChanged ? `Profile saved. Sign in with your new username "${updated.username}" from now on.` : 'Profile saved.');
      } catch (err) {
        const apiError = toApiError(err);
        const fieldErrors = {
          username: apiError.fieldError('username'),
          email: apiError.fieldError('email'),
          full_name: apiError.fieldError('full_name'),
          phone_number: apiError.fieldError('phone_number'),
        };
        setProfileErrors({ ...fieldErrors, form: Object.values(fieldErrors).some(Boolean) ? undefined : apiError.message });
      }
    });
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setPasswordNotice(null);
    const errors = { current: current ? undefined : 'Enter your current password.', next: next.length < 8 ? 'Use at least 8 characters.' : undefined };
    setPasswordErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    await savePassword.run(async () => {
      try {
        applyAuthResponse(await authApi.changePassword(current, next));
        setCurrent('');
        setNext('');
        setPasswordNotice('Password changed. Other sessions have been signed out.');
      } catch (err) {
        const apiError = toApiError(err);
        setPasswordErrors({
          current: apiError.fieldError('current_password'),
          next: apiError.fieldError('new_password'),
          form: apiError.fieldError('current_password') || apiError.fieldError('new_password') ? undefined : apiError.message,
        });
      }
    });
  }

  return (
    <>
      <PageHeader title="Profile" subtitle={`${ROLE_LABELS[user.role]}${user.department ? ` · ${user.department.name}` : ''}`} />
      <div className="grid grid-2">
        <Card title="Your details">
          <KeyValues
            items={[
              ['Username', user.username ?? '—'],
              ['Role', ROLE_LABELS[user.role]],
              ['Department', user.department?.name ?? 'All departments'],
              [
                'Service areas',
                user.service_areas.map((a) => a.name).join(', ') || (user.role === 'ADMIN' ? 'All areas' : 'None: ask your administrator'),
              ],
              ['Email', user.email ?? '—'],
              ['Member since', formatDate(user.date_joined)],
            ]}
          />
          <form onSubmit={submitProfile} style={{ marginTop: 18 }} noValidate>
            {profileNotice ? <Banner tone="success">{profileNotice}</Banner> : null}
            {profileErrors.form ? <Banner tone="danger">{profileErrors.form}</Banner> : null}
            <TextInput
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={profileErrors.username}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              hint="Your login name: lowercase letters, digits, dots, hyphens or underscores."
            />
            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={profileErrors.email}
              autoComplete="email"
              hint="Optional."
            />
            <TextInput label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} error={profileErrors.full_name} autoComplete="name" />
            <TextInput label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} error={profileErrors.phone_number} autoComplete="tel" />
            <Button type="submit" icon={Save} loading={saveProfile.busy}>
              Save profile
            </Button>
          </form>
        </Card>
        <Card title="Change password">
          <form onSubmit={submitPassword} noValidate>
            {passwordNotice ? <Banner tone="success">{passwordNotice}</Banner> : null}
            {passwordErrors.form ? <Banner tone="danger">{passwordErrors.form}</Banner> : null}
            <TextInput label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={passwordErrors.current} />
            <TextInput label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={passwordErrors.next} hint="At least 8 characters; avoid common passwords." />
            <Button type="submit" icon={KeyRound} loading={savePassword.busy}>
              Change password
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
