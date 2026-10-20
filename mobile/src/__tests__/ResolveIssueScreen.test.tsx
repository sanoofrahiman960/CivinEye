import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { authorityApi } from '../api/authorityApi';
import { ApiError } from '../api/client';
import { ResolveIssueScreen } from '../screens/authority/ResolveIssueScreen';
import { useAuthStore } from '../store/authStore';
import { useReferenceStore } from '../store/referenceStore';
import type { AuthorityIssueDetail, AuthorityIssueImage, User } from '../types/api';

jest.mock('../api/authorityApi', () => ({
  authorityApi: { detail: jest.fn(), resolve: jest.fn(), overrideProofCheck: jest.fn() },
}));

jest.mock('react-native-maps', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: (props: object) => createElement(View, props), Marker: () => null };
});

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

/** Stand-in for the Proof-Lock camera: one button that "captures" a photo with a GPS fix at the issue. */
jest.mock('../components/GhostOverlayCamera', () => {
  const { createElement } = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    GhostOverlayCamera: ({ visible, onCapture }: { visible: boolean; onCapture: (c: object) => void }) =>
      visible
        ? createElement(
            Pressable,
            {
              accessibilityRole: 'button',
              accessibilityLabel: 'Fake capture',
              onPress: () =>
                onCapture({
                  uri: 'file:///cache/fix.jpg',
                  width: 1600,
                  height: 1200,
                  capture_latitude: 9.99,
                  capture_longitude: 76.305,
                  capture_accuracy_m: 6,
                  captured_at: '2026-10-20T09:00:00Z',
                }),
            },
            createElement(Text, null, 'Fake capture'),
          )
        : null,
  };
});

const api = authorityApi as jest.Mocked<typeof authorityApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

const inProgress = {
  id: 3,
  complaint_id: 'CE-2026-000003',
  title: 'Road flooded after rain',
  category: { id: 3, name: 'Waterlogging', slug: 'waterlogging', icon: 'water-outline', is_life_threatening: false },
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  address: 'Kadavanthra junction',
  latitude: 9.99,
  longitude: 76.305,
  resolution_cycle: 1,
  images: [
    {
      id: 10,
      image_type: 'REPORT',
      image_url: 'http://x/10.jpg',
      thumbnail_url: 'http://x/10_t.jpg',
      resolution_cycle: 1,
      proof_check_status: 'NOT_APPLICABLE',
      distance_from_issue_m: null,
    },
  ],
  available_actions: ['resolve', 'assign', 'change_priority', 'comment'],
} as unknown as AuthorityIssueDetail;

const flagged = {
  id: 11,
  image_type: 'RESOLUTION',
  image_url: 'http://x/11.jpg',
  thumbnail_url: 'http://x/11_t.jpg',
  resolution_cycle: 1,
  proof_check_status: 'FLAGGED',
  distance_from_issue_m: 1450,
  proof_check_notes: 'Photo taken 1450 m from the reported location (limit 50 m).',
} as unknown as AuthorityIssueImage;

function user(role: User['role']): User {
  return {
    id: 1,
    username: 'test.officer',
    full_name: 'Test Officer',
    email: null,
    phone_number: '',
    role,
    is_authority: true,
    is_global_admin: false,
    department: { id: 1, name: 'Municipal Corporation' },
    service_areas: [{ id: 1, name: 'Kochi', code: 'kochi', level: 'CORPORATION', level_label: 'Municipal Corporation', parent: null }],
    preferred_language: 'en',
    date_joined: '2026-01-01T00:00:00Z',
  };
}

function renderScreen() {
  const navigation = { setOptions: jest.fn(), goBack: jest.fn(), navigate: jest.fn() };
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ResolveIssueScreen navigation={navigation as any} route={{ key: 'r', name: 'ResolveIssue', params: { issueId: 3 } } as any} />
    </SafeAreaProvider>,
  );
  return navigation;
}

async function captureAndDescribe() {
  fireEvent.press(await screen.findByRole('button', { name: 'Take resolution photo' }));
  fireEvent.press(screen.getByRole('button', { name: 'Fake capture' }));
  fireEvent.changeText(screen.getByLabelText('Resolution description'), 'Drain cleared and water pumped out.');
  fireEvent.press(screen.getByRole('button', { name: 'Submit resolution' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  api.detail.mockResolvedValue(inProgress);
  useReferenceStore.setState({ loaded: true, load: jest.fn(async () => undefined) });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
});

describe('ResolveIssueScreen (Proof-Lock resolution)', () => {
  it('submits the in-app photo with its GPS position and returns to the issue', async () => {
    useAuthStore.setState({ user: user('OFFICER') });
    api.resolve.mockResolvedValue({ ...inProgress, status: 'RESOLVED' });
    const navigation = renderScreen();

    await captureAndDescribe();

    await waitFor(() =>
      expect(api.resolve).toHaveBeenCalledWith(3, 'Drain cleared and water pumped out.', [{ uri: 'file:///cache/fix.jpg' }], {
        capture_source: 'CAMERA',
        capture_latitude: 9.99,
        capture_longitude: 76.305,
        capture_accuracy_m: 6,
        captured_at: '2026-10-20T09:00:00Z',
      }),
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('lets a supervisor override a flagged photo and resolve without re-uploading', async () => {
    useAuthStore.setState({ user: user('SUPERVISOR') });
    api.resolve
      .mockRejectedValueOnce(new ApiError(409, 'proof_check_flagged', 'The resolution photo did not pass the check.', { images: [flagged] }))
      .mockResolvedValueOnce({ ...inProgress, status: 'RESOLVED' });
    api.detail.mockResolvedValueOnce(inProgress).mockResolvedValue({ ...inProgress, images: [...inProgress.images, flagged] });
    api.overrideProofCheck.mockResolvedValue({ ...flagged, proof_check_status: 'OVERRIDDEN' });
    const navigation = renderScreen();

    await captureAndDescribe();
    fireEvent.press(await screen.findByRole('button', { name: 'Override (supervisor)' }));
    fireEvent.changeText(screen.getByLabelText('Reason'), 'Crew confirmed by phone; GPS drift in the underpass.');
    fireEvent.press(screen.getByRole('button', { name: 'Override & resolve' }));

    await waitFor(() => expect(api.overrideProofCheck).toHaveBeenCalledWith(11, 'Crew confirmed by phone; GPS drift in the underpass.'));
    await waitFor(() => expect(api.resolve).toHaveBeenLastCalledWith(3, 'Drain cleared and water pumped out.', [], { capture_source: 'CAMERA' }));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not offer an override to a regular officer', async () => {
    useAuthStore.setState({ user: user('OFFICER') });
    api.resolve.mockRejectedValueOnce(new ApiError(409, 'proof_check_flagged', 'Flagged.', { images: [flagged] }));
    renderScreen();

    await captureAndDescribe();
    expect(await screen.findByRole('button', { name: 'Retake photo at the location' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Override (supervisor)' })).toBeNull();
  });
});
