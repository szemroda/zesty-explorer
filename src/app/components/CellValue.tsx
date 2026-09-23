import { formatContentValue } from '../content-item-presentation';

interface CellValueProps {
  readonly value: unknown;
}

export function CellValue({ value }: CellValueProps) {
  const text = formatContentValue(value);
  return (
    <span
      className={
        text.length >= 56
          ? 'block max-w-[440px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground'
          : 'block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground'
      }
    >
      {text}
    </span>
  );
}
