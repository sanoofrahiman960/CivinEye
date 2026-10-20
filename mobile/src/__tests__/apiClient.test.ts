import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';

import { ApiError, toApiError } from '../api/client';

function axiosError(status: number | null, data?: unknown, code?: string) {
  const config = { headers: new AxiosHeaders() };
  const response = status === null ? undefined : ({ status, data, statusText: '', headers: {}, config } as AxiosResponse);
  return new AxiosError('failed', code, config, undefined, response);
}

describe('toApiError', () => {
  it('reads the backend error envelope', () => {
    const error = toApiError(
      axiosError(400, {
        error: { code: 'validation_error', message: 'title: This field is required.', details: { title: ['This field is required.'] } },
      }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('validation_error');
    expect(error.fieldError('title')).toBe('This field is required.');
    expect(error.fieldError('description')).toBeUndefined();
  });

  it('keeps business-rule codes such as proof_check_flagged', () => {
    const error = toApiError(axiosError(409, { error: { code: 'proof_check_flagged', message: 'Flagged', details: { images: [] } } }));
    expect(error.code).toBe('proof_check_flagged');
    expect(error.details).toEqual({ images: [] });
  });

  it('marks connection failures as network errors', () => {
    const error = toApiError(axiosError(null));
    expect(error.code).toBe('network_error');
    expect(error.isNetworkError).toBe(true);
    expect(toApiError(axiosError(null, undefined, 'ECONNABORTED')).code).toBe('timeout');
  });

  it('falls back gracefully for unexpected responses', () => {
    expect(toApiError(axiosError(500, '<html>')).code).toBe('server_error');
    expect(toApiError(new Error('boom')).message).toBe('boom');
  });
});

describe('wrong server detection (development)', () => {
  it('explains when an HTML page comes back instead of the CivicEye API', () => {
    const config = { headers: new AxiosHeaders() };
    const response = {
      status: 400,
      data: '<html><title>DisallowedHost</title></html>',
      statusText: '',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      config,
    } as AxiosResponse;
    const error = toApiError(new AxiosError('failed', undefined, config, undefined, response));
    expect(error.code).toBe('wrong_server');
    expect(error.message).toContain('ngrok http 8001');
  });
});
