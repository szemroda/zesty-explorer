import { formatContentValue } from '../content-item-presentation';

interface CellValueProps {
  readonly value: unknown;
}

export function CellValue({ value }: CellValueProps) {
  const text = formatContentValue(value);
  return (
    <span className={text.length >= 56 ? 'cell-value cell-value--long' : 'cell-value'}>{text}</span>
  );
}
