'use strict';

const { withRetry } = require('../src/retry');

describe('withRetry', () => {
  test('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on retryable status codes', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 1 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on 500 server errors', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce({ status: 500, message: 'server error' })
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on connection reset errors', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'connection reset' })
      .mockResolvedValue('reconnected');

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 1 });
    expect(result).toBe('reconnected');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('throws immediately on non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 401, message: 'unauthorized' });
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('throws after exhausting all retries', async () => {
    const err = { status: 503, message: 'unavailable' };
    const fn = jest.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws on non-retryable error codes', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 422, message: 'validation error' });
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1 })).rejects.toMatchObject({ status: 422 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
