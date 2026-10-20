import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError } from '../api/client';
import { issueApi, type NewIssueInput } from '../api/issueApi';
import { offlineQueue } from '../offline/queue';
import type { IssueDetail } from '../types/api';

jest.mock('../api/issueApi', () => ({ issueApi: { create: jest.fn() } }));
const create = issueApi.create as jest.Mock;

const input = (id: string): NewIssueInput => ({
  title: 'Garbage near bus stop',
  description: 'A big pile of garbage near the bus stop.',
  category: 1,
  latitude: 9.98,
  longitude: 76.3,
  client_submission_id: id,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  create.mockReset();
});

describe('offline report queue', () => {
  it('stores reports with copied photos and the original capture time', async () => {
    const item = await offlineQueue.enqueue(input('a'), ['file:///cache/photo1.jpg']);
    expect(item.photoUris[0]).toContain('pending-reports/a-0.jpg');
    expect(item.input.client_reported_at).toBeDefined();
    expect(await offlineQueue.count()).toBe(1);
  });

  it('re-queuing the same submission id does not duplicate it', async () => {
    await offlineQueue.enqueue(input('a'), ['file:///cache/1.jpg']);
    await offlineQueue.enqueue(input('a'), ['file:///cache/1.jpg']);
    expect(await offlineQueue.count()).toBe(1);
  });

  it('sends queued reports with their idempotency key and removes them', async () => {
    await offlineQueue.enqueue(input('a'), ['file:///cache/1.jpg']);
    await offlineQueue.enqueue(input('b'), ['file:///cache/2.jpg']);
    create.mockResolvedValue({ id: 1, complaint_id: 'CE-2026-000001' } as IssueDetail);

    const result = await offlineQueue.flush();

    expect(result).toEqual({ sent: expect.any(Array), failed: 0, remaining: 0 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].client_submission_id).toBe('a');
    expect(create.mock.calls[0][1]).toEqual([{ uri: expect.stringContaining('a-0.jpg') }]);
    expect(await offlineQueue.count()).toBe(0);
  });

  it('stops at the first network failure and keeps everything queued', async () => {
    await offlineQueue.enqueue(input('a'), ['file:///cache/1.jpg']);
    await offlineQueue.enqueue(input('b'), ['file:///cache/2.jpg']);
    create.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));

    const result = await offlineQueue.flush();

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.remaining).toBe(2);
    const [first] = await offlineQueue.list();
    expect(first.attempts).toBe(1);
    expect(first.lastError).toBeUndefined();
  });

  it('keeps reports the server rejected, with the reason, and continues with the rest', async () => {
    await offlineQueue.enqueue(input('old'), ['file:///cache/1.jpg']);
    await offlineQueue.enqueue(input('ok'), ['file:///cache/2.jpg']);
    create
      .mockRejectedValueOnce(new ApiError(400, 'validation_error', 'Offline reports must be sent within 72 hours of capture.'))
      .mockResolvedValueOnce({ id: 2 } as IssueDetail);

    const result = await offlineQueue.flush();

    expect(result.sent).toHaveLength(1);
    const remaining = await offlineQueue.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].input.client_submission_id).toBe('old');
    expect(remaining[0].lastError).toContain('72 hours');
  });

  it('removes a report on request', async () => {
    await offlineQueue.enqueue(input('a'), ['file:///cache/1.jpg']);
    await offlineQueue.remove('a');
    expect(await offlineQueue.count()).toBe(0);
  });
});
