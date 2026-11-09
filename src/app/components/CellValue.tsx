import { formatContentValue } from '../content-item-presentation';
import { parseRichText } from '../rich-text';
import { RichTextCell } from './RichText';

interface CellValueProps {
  readonly value: unknown;
  /** Show a string value as formatted WYSIWYG HTML; markup that shows nothing reads as empty. */
  readonly richText: boolean;
}

export function CellValue({ value, richText }: CellValueProps) {
  if (richText && typeof value === 'string') {
    const body = parseRichText(value);
    if (body) return <RichTextCell html={value} body={body} />;
  }
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
