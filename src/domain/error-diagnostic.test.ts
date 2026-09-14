import { describe, expect, it } from 'vitest';
import { safeRequestUrl } from './error-diagnostic';

describe('safe request diagnostics', () => {
  it('removes credentials and secret-shaped URL parameters', () => {
    expect(
      safeRequestUrl(
        'https://user:password@8-abc123.api.zesty.io/items?lang=en-US&access_token=private&api_key=secret#fragment',
      ),
    ).toBe('https://8-abc123.api.zesty.io/items?lang=en-US');
  });
});
