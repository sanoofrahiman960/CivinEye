import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { teamApi } from '../api/endpoints';
import { TeamPage } from '../pages/TeamPage';
import { useAuthStore } from '../store/auth';
import { useReferenceStore } from '../store/reference';
import type { Department, JurisdictionArea, TeamMember, User } from '../types/api';

vi.mock('../api/endpoints', () => ({ teamApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), resetPassword: vi.fn() } }));

const ernakulam: JurisdictionArea = { id: 2, name: 'Ernakulam', code: 'ernakulam', level: 'DISTRICT', level_label: 'District', parent: 1, depth: 0, path: '/1/2/' };
const kochi: JurisdictionArea = { id: 3, name: 'Kochi', code: 'kochi', level: 'CORPORATION', level_label: 'Municipal Corporation', parent: 2, depth: 1, path: '/1/2/3/' };
const sanitation = { id: 4, name: 'Sanitation Department', code: 'sanitation', description: '', contact_email: '', service_areas: [] } as Department;

const districtAdmin: User = {
  id: 10,
  username: 'ekm.admin',
  full_name: 'Ernakulam Admin',
  email: null,
  phone_number: '',
  role: 'ADMIN',
  is_authority: true,
  is_global_admin: false,
  department: null,
  service_areas: [ernakulam],
  preferred_language: 'en',
  date_joined: '2026-10-20T00:00:00Z',
};

const officer: TeamMember = {
  id: 11,
  username: 'kochi.sanitation',
  full_name: 'Kochi Sanitation Officer',
  email: null,
  phone_number: '',
  role: 'OFFICER',
  department: { id: 4, name: 'Sanitation Department' },
  service_areas: [kochi],
  is_global_admin: false,
  is_active: true,
  last_login: null,
  date_joined: '2026-10-20T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ status: 'signedIn', user: districtAdmin });
  useReferenceStore.setState({ serviceAreas: [ernakulam, kochi], departments: [sanitation], loaded: true });
  vi.mocked(teamApi.list).mockResolvedValue({ count: 1, next: null, previous: null, results: [officer] });
});

describe('TeamPage (hierarchical administration)', () => {
  it('shows the admin’s jurisdiction and their staff', async () => {
    render(<TeamPage />);
    expect(screen.getByText(/Ernakulam District and every area under it/)).toBeInTheDocument();
    expect(await screen.findByText('Kochi Sanitation Officer')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Kochi (Municipal Corporation)')).toBeInTheDocument();
  });

  it('creates a sub-admin for an area inside the jurisdiction', async () => {
    vi.mocked(teamApi.create).mockResolvedValue({ ...officer, id: 12, username: 'kochi.admin', full_name: 'Kochi Admin', role: 'ADMIN', department: null });
    render(<TeamPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add staff' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Username'), 'Kochi.Admin');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Kochi Admin');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'ADMIN');
    await userEvent.click(within(dialog).getByLabelText('Kochi (Municipal Corporation)'));
    await userEvent.type(within(dialog).getByLabelText('Initial password'), 'Kochi-Secure-2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(teamApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'kochi.admin', role: 'ADMIN', department_id: null, service_area_ids: [3], password: 'Kochi-Secure-2026' }),
      ),
    );
    expect(await screen.findByText(/can now sign in as "kochi.admin"/)).toBeInTheDocument();
  });

  it('finds deep areas by search and shows them as removable chips', async () => {
    const aluva: JurisdictionArea = { id: 5, name: 'Aluva', code: 'aluva', level: 'TALUK', level_label: 'Taluk', parent: 2, depth: 1, path: '/1/2/5/' };
    const chengamanad: JurisdictionArea = { id: 6, name: 'Chengamanad', code: 'chengamanad', level: 'GRAMA_PANCHAYAT', level_label: 'Grama Panchayat', parent: 5, depth: 2, path: '/1/2/5/6/' };
    const edathala: JurisdictionArea = { id: 7, name: 'Edathala', code: 'edathala', level: 'GRAMA_PANCHAYAT', level_label: 'Grama Panchayat', parent: 5, depth: 3, path: '/1/2/5/7/' };
    useReferenceStore.setState({ serviceAreas: [ernakulam, kochi, aluva, chengamanad, edathala] });
    render(<TeamPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add staff' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Edathala (Grama Panchayat)')).toBeNull();

    await userEvent.type(within(dialog).getByLabelText('Search areas'), 'edath');
    expect(within(dialog).getByLabelText('Aluva (Taluk)')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Kochi (Municipal Corporation)')).toBeNull();
    await userEvent.click(within(dialog).getByLabelText('Edathala (Grama Panchayat)'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Edathala (Grama Panchayat)' }));
    expect(within(dialog).getByLabelText('Edathala (Grama Panchayat)')).not.toBeChecked();
  });

  it('requires a department and an area for officers', async () => {
    render(<TeamPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add staff' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Username'), 'new.officer');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'New Officer');
    await userEvent.type(within(dialog).getByLabelText('Initial password'), 'Kochi-Secure-2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(await within(dialog).findByText('Choose a department.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose at least one area.')).toBeInTheDocument();
    expect(teamApi.create).not.toHaveBeenCalled();
  });

  it('resets a staff member’s password', async () => {
    vi.mocked(teamApi.resetPassword).mockResolvedValue({ detail: 'Password reset for kochi.sanitation.' });
    render(<TeamPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password for Kochi Sanitation Officer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('New password'), 'Fresh-Pass-2026');
    await userEvent.type(within(dialog).getByLabelText('Confirm new password'), 'Fresh-Pass-2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(teamApi.resetPassword).toHaveBeenCalledWith(11, 'Fresh-Pass-2026'));
    expect(await screen.findByText('Password reset for kochi.sanitation.')).toBeInTheDocument();
  });

  it('is only for administrators', () => {
    useAuthStore.setState({ user: { ...districtAdmin, role: 'OFFICER' } });
    render(<TeamPage />);
    expect(screen.getByText('Administrators only')).toBeInTheDocument();
  });
});
