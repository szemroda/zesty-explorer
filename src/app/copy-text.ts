import { toast } from 'sonner';

/** Copies text to the clipboard and reports the outcome in a toast; never throws. */
export async function copyText(text: string, successTitle: string, description?: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast.error('Could not copy to clipboard');
    return;
  }
  toast.success(successTitle, description ? { description } : undefined);
}
