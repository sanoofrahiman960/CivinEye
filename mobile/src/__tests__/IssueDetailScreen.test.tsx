import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { issueApi } from '../api/issueApi';
import { IssueDetailScreen } from '../screens/citizen/IssueDetailScreen';
import { useReferenceStore } from '../store/referenceStore';
import type { AppConfiguration, IssueDetail, PublicIssue } from '../types/api';

jest.mock('../api/issueApi', () => ({
  issueApi: {
    detail: jest.fn(),
    confirmResolution: jest.fn(),
    reopen: jest.fn(),
    support: jest.fn(),
    removeSupport: jest.fn(),
    addComment: jest.fn(),
  },
}));

jest.mock('react-native-maps', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  const MapView = (props: object) => createElement(View, props);
  return { __esModule: true, default: MapView, Marker: () => null, Callout: () => null, PROVIDER_GOOGLE: 'google' };
});

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

const api = issueApi as jest.Mocked<typeof issueApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

const image = (id: number, image_type: 'REPORT' | 'RESOLUTION') => ({
  id,
  image_type,
  image_url: `http://x/${id}.jpg`,
  thumbnail_url: `http://x/${id}_t.jpg`,
  caption: '',
  uploaded_at: '2026-10-19T10:00:00Z',
  resolution_cycle: 1,
  distance_from_issue_m: image_type === 'RESOLUTION' ? 6 : null,
  proof_check_status: image_type === 'RESOLUTION' ? ('PASSED' as const) : ('NOT_APPLICABLE' as const),
});

const resolvedOwnerIssue: IssueDetail = {
  id: 4,
  complaint_id: 'CE-2026-000004',
  title: 'Deep pothole on the main road',
  category: { id: 4, name: 'Pothole / damaged road', slug: 'pothole', icon: 'car-outline', is_life_threatening: false },
  status: 'RESOLVED',
  priority: 'MEDIUM',
  address: 'Kaloor stadium road, Kochi',
  latitude: 9.99,
  longitude: 76.305,
  thumbnail_url: null,
  impact_count: 0,
  is_overdue: false,
  created_at: '2026-10-18T10:00:00Z',
  updated_at: '2026-10-19T10:00:00Z',
  description: 'Deep pothole near the stadium entrance.',
  additional_details: '',
  subcategory: null,
  reported_urgency: '',
  department: { id: 2, name: 'Public Works Department' },
  assigned_officer_name: null,
  acknowledged_at: '2026-10-18T11:00:00Z',
  started_at: '2026-10-18T12:00:00Z',
  resolved_at: '2026-10-19T10:00:00Z',
  closed_at: null,
  reopened_at: null,
  due_at: '2026-10-28T10:00:00Z',
  closure_type: '',
  resolution_description: 'Pothole filled and compacted.',
  reopen_count: 0,
  satisfaction_rating: null,
  satisfaction_comment: '',
  is_recurrence: false,
  parent_complaint_id: null,
  images: [image(1, 'REPORT'), image(2, 'RESOLUTION')],
  history: [
    { id: 1, previous_status: '', new_status: 'SUBMITTED', reason: 'Complaint submitted.', closure_type: '', actor_label: 'You', created_at: '2026-10-18T10:00:00Z' },
    { id: 2, previous_status: 'IN_PROGRESS', new_status: 'RESOLVED', reason: 'Pothole filled and compacted.', closure_type: '', actor_label: 'Public Works Department', created_at: '2026-10-19T10:00:00Z' },
  ],
  comments: [],
  is_owner: true,
  can_confirm: true,
  can_reopen: true,
  can_add_evidence: true,
  supported_by_me: false,
  durability_check_pending: false,
};

function renderScreen(issueId = 4) {
  const navigation = { setOptions: jest.fn(), navigate: jest.fn(), push: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) };
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <IssueDetailScreen navigation={navigation as any} route={{ key: 'IssueDetail', name: 'IssueDetail', params: { issueId } } as any} />
    </SafeAreaProvider>,
  );
  return navigation;
}

const CONFIG_WITH_SUPPORT = {
  features: { affects_me_too: { enabled: true, config: { max_distance_m: 2000 } } },
  policies: {
    verification_timeout_days: 7,
    auto_close_on_verification_timeout: true,
    citizen_reopen_window_days: 14,
    max_images_per_upload: 5,
    max_image_size_mb: 8,
  },
  choices: { priorities: [], statuses: [], closure_types: [], comment_visibility: [] },
} as unknown as AppConfiguration;

/** Auto-accept confirmation dialogs by pressing their non-cancel button. */
beforeEach(() => {
  jest.clearAllMocks();
  useReferenceStore.setState({ config: null });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
});

describe('IssueDetailScreen (citizen verification)', () => {
  it('lets the reporter confirm the fix, which closes the complaint', async () => {
    api.detail.mockResolvedValue(resolvedOwnerIssue);
    api.confirmResolution.mockResolvedValue({ ...resolvedOwnerIssue, status: 'CLOSED', closure_type: 'CITIZEN_CONFIRMED', can_confirm: false });
    renderScreen();

    fireEvent.press(await screen.findByRole('button', { name: "Yes, it's fixed" }));
    fireEvent.press(await screen.findByRole('button', { name: 'Confirm fixed' }));

    await waitFor(() => expect(api.confirmResolution).toHaveBeenCalledWith(4, null, ''));
    await waitFor(() => expect(screen.queryByRole('button', { name: "Yes, it's fixed" })).toBeNull());
  });

  it('requires a reason to reopen and sends it to the backend', async () => {
    api.detail.mockResolvedValue(resolvedOwnerIssue);
    api.reopen.mockResolvedValue({ ...resolvedOwnerIssue, status: 'REOPENED', can_confirm: false, reopen_count: 1 });
    renderScreen();

    fireEvent.press(await screen.findByRole('button', { name: 'No, reopen' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText('Please give a short reason (at least 3 characters).')).toBeTruthy();
    expect(api.reopen).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('What is still wrong?'), 'Only half of the pothole was filled');
    fireEvent.press(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() => expect(api.reopen).toHaveBeenCalledWith(4, 'Only half of the pothole was filled', []));
  });

  it('shows other citizens a privacy-safe view with "affects me too" instead of owner actions', async () => {
    const publicIssue: PublicIssue = {
      ...resolvedOwnerIssue,
      status: 'IN_PROGRESS',
      history: [{ id: 1, new_status: 'SUBMITTED', created_at: '2026-10-18T10:00:00Z' }],
      is_owner: false,
      can_support: true,
    };
    useReferenceStore.setState({ config: CONFIG_WITH_SUPPORT });
    api.detail.mockResolvedValue(publicIssue);
    renderScreen();

    expect(await screen.findByText('Reporter details are private')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'This affects me too' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: "Yes, it's fixed" })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add evidence' })).toBeNull();
  });

  it('shows a not-found state for a missing complaint', async () => {
    const { ApiError } = jest.requireActual('../api/client');
    api.detail.mockRejectedValue(new ApiError(404, 'not_found', 'Not found.'));
    renderScreen(999);
    expect(await screen.findByText('Issue not found')).toBeTruthy();
  });
});
