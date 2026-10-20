import { KeyRound, Pencil, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { toApiError } from '../api/client';
import { teamApi, type TeamQuery } from '../api/endpoints';
import { SearchBox } from '../components/IssueFilters';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Select, TextInput } from '../components/ui';
import { useAction, useApi, useDocumentTitle } from '../hooks/useApi';
import { formatRelative } from '../lib/format';
import { ROLE_LABELS } from '../lib/styles';
import { useAuthStore } from '../store/auth';
import { useReferenceStore } from '../store/reference';
import type { JurisdictionArea, TeamMember, TeamMemberInput } from '../types/api';

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,49}$/;

const ROLE_HELP: Record<TeamMember['role'], string> = {
  ADMIN: 'Manages everything in the chosen areas: all departments, issues, and the staff and sub-admins below.',
  SUPERVISOR: 'Leads one department in the chosen areas: sees all its issues and can reassign them.',
  OFFICER: 'Handles one department’s issues located in the chosen areas.',
};

function areaLabel(area: JurisdictionArea) {
  return `${area.name} (${area.level_label})`;
}

/**
 * Hierarchical administration: each admin manages the staff of their own jurisdiction. A district admin
 * creates taluk, panchayat and municipality admins, supervisors and officers for areas inside the district.
 */
export function TeamPage() {
  useDocumentTitle('Team');
  const user = useAuthStore((s) => s.user);
  const areas = useReferenceStore((s) => s.serviceAreas);
  const departments = useReferenceStore((s) => s.departments);
  const [query, setQuery] = useState<TeamQuery>({ active: true });
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(() => teamApi.list({ ...query, page }), [JSON.stringify(query), page]);
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (user?.role !== 'ADMIN') {
    return <EmptyState icon={ShieldCheck} title="Administrators only" message="Ask your administrator to change staff accounts." />;
  }

  const scope = user.is_global_admin
    ? 'All areas (state administrator)'
    : `${user.service_areas.map((a) => `${a.name} ${a.level_label}`).join(', ')} and every area under it`;

  function update(changes: Partial<TeamQuery>) {
    setQuery((q) => ({ ...q, ...changes }));
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={`Staff and sub-admins in your jurisdiction: ${scope}.`}
        actions={
          <Button icon={UserPlus} onClick={() => setEditing('new')}>
            Add staff
          </Button>
        }
      />
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      <Card>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1', maxWidth: 520 }}>
            <SearchBox value={query.search} onChange={(search) => update({ search })} />
          </div>
          <Select label="Role" value={query.role ?? ''} onChange={(e) => update({ role: (e.target.value || undefined) as TeamQuery['role'] })}>
            <option value="">All roles</option>
            <option value="ADMIN">Admins</option>
            <option value="SUPERVISOR">Supervisors</option>
            <option value="OFFICER">Officers</option>
          </Select>
          <Select label="Area" value={query.area ?? ''} onChange={(e) => update({ area: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All my areas</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {'  '.repeat(a.depth)}
                {areaLabel(a)}
              </option>
            ))}
          </Select>
          <Select label="Department" value={query.department ?? ''} onChange={(e) => update({ department: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            label="Status"
            value={query.active === undefined ? 'all' : String(query.active)}
            onChange={(e) => update({ active: e.target.value === 'all' ? undefined : e.target.value === 'true' })}
          >
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
            <option value="all">All</option>
          </Select>
        </div>
      </Card>

      <section className="card" style={{ marginTop: 16 }}>
        {loading && !data ? (
          <LoadingState message="Loading team…" />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.results.length ? (
          <EmptyState
            icon={Users}
            title="No staff here yet"
            message="Add admins for each taluk, panchayat or municipality, and officers for each department."
            action={
              <Button icon={UserPlus} onClick={() => setEditing('new')}>
                Add staff
              </Button>
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Role</th>
                    <th scope="col">Department</th>
                    <th scope="col">Areas</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last sign-in</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((member) => (
                    <tr key={member.id} style={{ cursor: 'default' }}>
                      <td>
                        <strong>{member.full_name}</strong>
                        <div className="subtle mono">{member.username}</div>
                      </td>
                      <td>
                        <span className={`badge ${member.role === 'ADMIN' ? 'badge-info' : 'badge-neutral'}`}>{ROLE_LABELS[member.role]}</span>
                      </td>
                      <td>{member.department?.name ?? (member.role === 'ADMIN' ? 'All departments' : '—')}</td>
                      <td>{member.service_areas.map(areaLabel).join(', ') || '—'}</td>
                      <td>
                        <span className={`badge ${member.is_active ? 'badge-success' : 'badge-danger'}`}>{member.is_active ? 'Active' : 'Deactivated'}</span>
                      </td>
                      <td>{member.last_login ? formatRelative(member.last_login) : 'Never'}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <Button variant="outline" size="sm" icon={Pencil} onClick={() => setEditing(member)} aria-label={`Edit ${member.full_name}`}>
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" icon={KeyRound} onClick={() => setResetting(member)} aria-label={`Reset password for ${member.full_name}`}>
                            Reset password
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="pagination" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={!data.previous} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="subtle">
                {data.count} staff member{data.count === 1 ? '' : 's'}
              </span>
              <Button variant="outline" size="sm" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </nav>
          </>
        )}
      </section>

      {editing ? (
        <MemberDialog
          member={editing === 'new' ? null : editing}
          areas={areas}
          onClose={() => setEditing(null)}
          onSaved={(member, created) => {
            setEditing(null);
            setNotice(created ? `${member.full_name} can now sign in as "${member.username}".` : `${member.full_name} was updated.`);
            reload();
          }}
        />
      ) : null}
      {resetting ? (
        <ResetPasswordDialog
          member={resetting}
          onClose={() => setResetting(null)}
          onDone={(message) => {
            setResetting(null);
            setNotice(message);
          }}
        />
      ) : null}
    </>
  );
}

function MemberDialog({
  member,
  areas,
  onClose,
  onSaved,
}: {
  member: TeamMember | null;
  areas: JurisdictionArea[];
  onClose: () => void;
  onSaved: (member: TeamMember, created: boolean) => void;
}) {
  const departments = useReferenceStore((s) => s.departments);
  const [form, setForm] = useState({
    username: member?.username ?? '',
    full_name: member?.full_name ?? '',
    email: member?.email ?? '',
    phone_number: member?.phone_number ?? '',
    role: member?.role ?? ('OFFICER' as TeamMember['role']),
    department_id: member?.department?.id ?? null,
    service_area_ids: member?.service_areas.map((a) => a.id) ?? [],
    is_active: member?.is_active ?? true,
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const selected = useMemo(() => new Set(form.service_area_ids), [form.service_area_ids]);
  const selectedAreas = useMemo(() => areas.filter((a) => selected.has(a.id)), [areas, selected]);
  const [areaSearch, setAreaSearch] = useState('');
  // With a whole state imported there are 1,000+ areas: search shows matches (with their parents for context).
  const visibleAreas = useMemo(() => {
    const term = areaSearch.trim().toLowerCase();
    if (!term) return areas.filter((a) => a.depth <= 2 || selected.has(a.id));
    const byId = new Map(areas.map((a) => [a.id, a]));
    const show = new Set<number>();
    for (const a of areas) {
      if (!a.name.toLowerCase().includes(term)) continue;
      show.add(a.id);
      for (let p = a.parent; p && byId.has(p); p = byId.get(p)!.parent) show.add(p);
    }
    return areas.filter((a) => show.has(a.id)).slice(0, 300);
  }, [areas, areaSearch, selected]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const username = form.username.trim().toLowerCase();
    const next: Record<string, string | undefined> = {
      username: USERNAME.test(username) ? undefined : 'Use 3–50 lowercase letters, digits, dots, hyphens or underscores.',
      full_name: form.full_name.trim().length >= 2 ? undefined : 'Enter the full name.',
      department_id: form.role !== 'ADMIN' && !form.department_id ? 'Choose a department.' : undefined,
      service_area_ids: form.service_area_ids.length ? undefined : 'Choose at least one area.',
      password: !member && form.password.length < 8 ? 'Use at least 8 characters.' : undefined,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;

    const input: TeamMemberInput = {
      username,
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      phone_number: form.phone_number.replace(/[\s-]/g, ''),
      role: form.role,
      department_id: form.role === 'ADMIN' ? null : form.department_id,
      service_area_ids: form.service_area_ids,
      ...(member ? { is_active: form.is_active } : { password: form.password }),
    };
    await run(async () => {
      try {
        const saved = member ? await teamApi.update(member.id, input) : await teamApi.create(input);
        onSaved(saved, !member);
      } catch (err) {
        const apiError = toApiError(err);
        const fields = ['username', 'full_name', 'email', 'phone_number', 'role', 'department_id', 'service_area_ids', 'password'];
        const fieldErrors = Object.fromEntries(fields.map((f) => [f, apiError.fieldError(f)]));
        setErrors(fieldErrors);
        if (!Object.values(fieldErrors).some(Boolean)) setFormError(apiError.message);
      }
    });
  }

  return (
    <Modal
      open
      wide
      title={member ? `Edit ${member.full_name}` : 'Add staff'}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => submit()} loading={busy}>
            {member ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        {formError ? <Banner tone="danger">{formError}</Banner> : null}
        <div className="grid grid-2" style={{ gap: 12 }}>
          <TextInput label="Username" value={form.username} onChange={(e) => set('username', e.target.value)} error={errors.username} autoCapitalize="none" spellCheck={false} hint="Their login name." />
          <TextInput label="Full name" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} error={errors.full_name} />
          <Select label="Role" value={form.role} onChange={(e) => set('role', e.target.value as TeamMember['role'])} hint={ROLE_HELP[form.role]}>
            <option value="OFFICER">Officer</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="ADMIN">Admin (manages an area and its sub-areas)</option>
          </Select>
          {form.role !== 'ADMIN' ? (
            <Select
              label="Department"
              value={form.department_id ?? ''}
              onChange={(e) => set('department_id', e.target.value ? Number(e.target.value) : null)}
              error={errors.department_id}
            >
              <option value="">Choose a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          ) : (
            <div className="field">
              <label>Department</label>
              <div className="muted" style={{ paddingTop: 8 }}>
                All departments
              </div>
            </div>
          )}
          <TextInput label="Phone (optional)" value={form.phone_number} onChange={(e) => set('phone_number', e.target.value)} error={errors.phone_number} />
          <TextInput label="Email (optional)" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
        </div>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: '6px 0 14px' }}>
          <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Areas (jurisdiction)</legend>
          <span className="hint">They will handle issues located in these areas and every area below them.</span>
          {selectedAreas.length ? (
            <div className="chips" style={{ marginTop: 6 }} aria-label="Selected areas">
              {selectedAreas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="chip"
                  aria-pressed="true"
                  aria-label={`Remove ${areaLabel(a)}`}
                  onClick={() => set('service_area_ids', form.service_area_ids.filter((id) => id !== a.id))}
                >
                  {areaLabel(a)} ×
                </button>
              ))}
            </div>
          ) : null}
          <input
            className="input"
            type="search"
            placeholder="Search areas, e.g. Aluva or Kumbalanghy"
            aria-label="Search areas"
            value={areaSearch}
            onChange={(e) => setAreaSearch(e.target.value)}
            style={{ marginTop: 6 }}
          />
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1.5px solid var(--c-border-strong)', borderRadius: 'var(--radius)', padding: 8, marginTop: 6 }}>
            {visibleAreas.length ? (
              visibleAreas.map((a) => (
                <label key={a.id} className="checkbox" style={{ display: 'flex', padding: '4px 0', paddingLeft: a.depth * 18 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={(e) =>
                      set('service_area_ids', e.target.checked ? [...form.service_area_ids, a.id] : form.service_area_ids.filter((id) => id !== a.id))
                    }
                  />
                  {areaLabel(a)}
                </label>
              ))
            ) : (
              <span className="muted">
                {areas.length ? 'No areas match your search.' : 'No areas in your jurisdiction yet. Ask the state administrator to add them.'}
              </span>
            )}
          </div>
          {errors.service_area_ids ? (
            <span className="error" role="alert">
              {errors.service_area_ids}
            </span>
          ) : null}
        </fieldset>

        {member ? (
          <label className="checkbox">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            Account active (unchecking signs them out and blocks sign-in)
          </label>
        ) : (
          <TextInput
            label="Initial password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            error={errors.password}
            hint="Share it securely. They can change it after signing in."
          />
        )}
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({ member, onClose, onDone }: { member: TeamMember; onClose: () => void; onDone: (message: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | undefined>();
  const { busy, run } = useAction();

  async function submit() {
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    await run(async () => {
      try {
        const result = await teamApi.resetPassword(member.id, password);
        onDone(result.detail);
      } catch (err) {
        const apiError = toApiError(err);
        setError(apiError.fieldError('new_password') ?? apiError.message);
      }
    });
  }

  return (
    <Modal
      open
      title={`Reset password for ${member.full_name}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Reset password
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {member.username} will be signed out everywhere and must use the new password.
      </p>
      <TextInput label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
      <TextInput label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
    </Modal>
  );
}
