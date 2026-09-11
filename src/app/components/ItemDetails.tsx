import { X } from 'lucide-react';
import type { ContentItem } from '../../domain';

interface ItemDetailsProps {
  readonly item: ContentItem | undefined;
  readonly onClose: () => void;
}

function formatted(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '';
}

export function ItemDetails({ item, onClose }: ItemDetailsProps) {
  if (!item) return null;

  return (
    <aside
      className="details-sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby="details-title"
    >
      <header>
        <div>
          <p className="eyebrow">Content item</p>
          <h2 id="details-title">{item.id}</h2>
        </div>
        <button className="icon-button" aria-label="Close item details" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <h3>Content fields</h3>
      <dl>
        {Object.entries(item.fields).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{formatted(value)}</dd>
          </div>
        ))}
      </dl>
      <h3>Technical metadata</h3>
      <dl>
        {Object.entries(item.metadata).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{formatted(value)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
