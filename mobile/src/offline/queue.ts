import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import { issueApi, type NewIssueInput } from '../api/issueApi';
import { toApiError } from '../api/client';
import type { IssueDetail } from '../types/api';

const STORAGE_KEY = 'civiceye.offlineQueue.v1';
const PHOTO_DIR = 'pending-reports';

export interface QueuedReport {
  input: NewIssueInput;
  /** Photo copies inside the app's document directory, so they survive app restarts. */
  photoUris: string[];
  queuedAt: string;
  attempts: number;
  /** Set when the server rejected the report (e.g. too old); the user must fix or delete it. */
  lastError?: string;
}

export interface FlushResult {
  sent: IssueDetail[];
  failed: number;
  remaining: number;
}

async function readQueue(): Promise<QueuedReport[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedReport[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedReport[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function photoDirectory(): Directory {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function deletePhotos(uris: string[]) {
  uris.forEach((uri) => {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Already gone.
    }
  });
}

export const offlineQueue = {
  list: readQueue,

  async count(): Promise<number> {
    return (await readQueue()).length;
  },

  /** Save a report for later. Photos are copied out of the temporary cache first. */
  async enqueue(input: NewIssueInput, photoUris: string[]): Promise<QueuedReport> {
    const dir = photoDirectory();
    const stored = await Promise.all(
      photoUris.map(async (uri, index) => {
        const target = new File(dir, `${input.client_submission_id}-${index}.jpg`);
        if (target.exists) target.delete();
        await new File(uri).copy(target);
        return target.uri;
      }),
    );
    const item: QueuedReport = {
      input: { ...input, client_reported_at: input.client_reported_at ?? new Date().toISOString() },
      photoUris: stored,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    };
    const queue = await readQueue();
    await writeQueue([...queue.filter((q) => q.input.client_submission_id !== input.client_submission_id), item]);
    return item;
  },

  async remove(clientSubmissionId: string) {
    const queue = await readQueue();
    const item = queue.find((q) => q.input.client_submission_id === clientSubmissionId);
    if (item) deletePhotos(item.photoUris);
    await writeQueue(queue.filter((q) => q.input.client_submission_id !== clientSubmissionId));
  },

  /**
   * Try to send every queued report. Safe to call repeatedly: the backend treats the
   * client_submission_id as an idempotency key, so a retry never creates a duplicate.
   */
  async flush(): Promise<FlushResult> {
    const queue = await readQueue();
    const sent: IssueDetail[] = [];
    const remaining: QueuedReport[] = [];
    let failed = 0;
    for (const item of queue) {
      try {
        const issue = await issueApi.create(
          item.input,
          item.photoUris.map((uri) => ({ uri })),
        );
        sent.push(issue);
        deletePhotos(item.photoUris);
      } catch (error) {
        const apiError = toApiError(error);
        failed += 1;
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: apiError.isNetworkError ? undefined : apiError.message,
        });
        if (apiError.isNetworkError) {
          // Still offline: keep the rest untouched and stop early.
          remaining.push(...queue.slice(queue.indexOf(item) + 1));
          break;
        }
      }
    }
    await writeQueue(remaining);
    return { sent, failed, remaining: remaining.length };
  },
};
