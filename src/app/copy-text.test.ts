import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copy-text';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('copyText', () => {
  it('copies the text and confirms it in a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await copyText('#view=abc', 'View link copied', 'The session token is not included.');

    expect(writeText).toHaveBeenCalledWith('#view=abc');
    expect(toast.success).toHaveBeenCalledWith('View link copied', {
      description: 'The session token is not included.',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports a rejected clipboard write instead of throwing', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')));

    await expect(copyText('value', 'Copied')).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith('Could not copy to clipboard');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
