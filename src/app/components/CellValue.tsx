import { formatContentValue } from '../content-item-presentation';

interface CellValueProps {
  readonly label: string;
  readonly value: unknown;
  readonly onPreview: (label: string, value: string) => void;
}

export function CellValue({ label, value, onPreview }: CellValueProps) {
  const text = formatContentValue(value);
  if (text.length < 56) return <span className="cell-value">{text}</span>;
  return (
    <button
      className="cell-preview-trigger"
      aria-label={`Preview full ${label}`}
      onMouseEnter={() => onPreview(label, text)}
      onFocus={() => onPreview(label, text)}
      onClick={() => onPreview(label, text)}
    >
      {text}
    </button>
  );
}
