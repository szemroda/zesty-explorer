import { Dialog } from '@base-ui/react/dialog';
import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import type { ContentItem } from '../../domain';

interface ItemDetailsProps {
  readonly item: ContentItem | undefined;
  readonly onClose: () => void;
}

function formatted(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '';
}

function CopyValue({ value, name }: { readonly value: unknown; readonly name: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(formatted(value));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  }
  return (
    <button className="copy-value" aria-label={`Copy ${name}`} onClick={() => void copy()}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export function ItemDetails({ item, onClose }: ItemDetailsProps) {
  const [raw, setRaw] = useState(false);
  if (!item) return null;

  return (
    <Dialog.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Popup className="details-sheet" aria-labelledby="details-title">
          <header>
            <div>
              <p className="eyebrow">Content item</p>
              <Dialog.Title id="details-title">{item.id}</Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close item details">
              <X size={18} />
            </Dialog.Close>
          </header>
          <div className="details-tabs" role="tablist" aria-label="Item detail format">
            <button
              role="tab"
              aria-selected={!raw}
              className="button button--quiet"
              onClick={() => setRaw(false)}
            >
              Fields
            </button>
            <button
              role="tab"
              aria-selected={raw}
              className="button button--quiet"
              onClick={() => setRaw(true)}
            >
              Raw JSON
            </button>
          </div>
          {raw ? (
            <pre className="raw-json">{JSON.stringify(item.raw, null, 2)}</pre>
          ) : (
            <>
              <h3>Content fields</h3>
              <dl>
                {Object.entries(item.fields).map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{formatted(value)}</dd>
                    <CopyValue name={name} value={value} />
                  </div>
                ))}
              </dl>
              <h3>Technical metadata</h3>
              <dl>
                {Object.entries(item.metadata).map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{formatted(value)}</dd>
                    <CopyValue name={name} value={value} />
                  </div>
                ))}
              </dl>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
