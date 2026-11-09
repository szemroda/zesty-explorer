import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { createElement, Fragment, useState, type ReactNode } from 'react';
import { parseRichText } from '../rich-text';
import { PopoverContent } from './ui/popover';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** `inline` flattens blocks onto one line for a table cell; `block` keeps paragraphs and lists. */
type RichTextLayout = 'inline' | 'block';

interface ElementRendering {
  readonly tag: string;
  readonly className?: string;
  /** Starts and ends a line; spaces keep its text apart from its neighbors when flattened. */
  readonly block?: boolean;
}

// A div, not a heading, so the preview adds no page outline; a div also fits any nested block.
const heading: ElementRendering = { tag: 'div', className: 'my-2 font-semibold', block: true };
const strong: ElementRendering = { tag: 'strong' };
const em: ElementRendering = { tag: 'em' };
const underline: ElementRendering = { tag: 'u' };
const strike: ElementRendering = { tag: 's' };
const blockDiv: ElementRendering = { tag: 'div', block: true };

// The formatting WYSIWYG editors produce. Other elements keep only their text.
const renderings: ReadonlyMap<string, ElementRendering> = new Map(
  Object.entries({
    p: { tag: 'p', block: true },
    div: blockDiv,
    section: blockDiv,
    article: blockDiv,
    figure: blockDiv,
    figcaption: blockDiv,
    table: blockDiv,
    tr: blockDiv,
    td: { tag: 'span', block: true },
    th: { tag: 'span', className: 'font-semibold', block: true },
    h1: heading,
    h2: heading,
    h3: heading,
    h4: heading,
    h5: heading,
    h6: heading,
    ul: { tag: 'ul', block: true },
    ol: { tag: 'ol', block: true },
    li: { tag: 'li', block: true },
    blockquote: { tag: 'blockquote', block: true },
    pre: { tag: 'pre', block: true },
    strong,
    b: strong,
    em,
    i: em,
    u: underline,
    ins: underline,
    s: strike,
    strike,
    del: strike,
    sub: { tag: 'sub' },
    sup: { tag: 'sup' },
    code: { tag: 'code', className: 'rounded-sm bg-muted px-1 font-mono text-[0.92em]' },
    a: { tag: 'span', className: 'text-accent underline underline-offset-2' },
  }),
);

// Elements whose content is never readable text.
const droppedElements = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
]);

// TinyMCE underlines and strikes through with an inline style instead of a tag.
function styledSpanRendering(element: Element): ElementRendering | undefined {
  if (element.localName !== 'span' || !(element instanceof HTMLElement)) return undefined;
  const decoration = element.style.textDecoration;
  if (decoration.includes('underline')) return underline;
  if (decoration.includes('line-through')) return strike;
  return undefined;
}

function renderChildren(parent: Node, layout: RichTextLayout): ReactNode[] {
  return Array.from(parent.childNodes, (child, key) => renderNode(child, layout, key));
}

function renderNode(node: Node, layout: RichTextLayout, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.localName;
  if (droppedElements.has(tag)) return null;
  if (tag === 'br') return layout === 'inline' ? ' ' : <br key={key} />;
  if (tag === 'img') {
    return (
      <span key={key} className="text-muted-foreground">
        [{node.getAttribute('alt') || 'image'}]{' '}
      </span>
    );
  }

  const children = renderChildren(node, layout);
  const rendering = renderings.get(tag) ?? styledSpanRendering(node);
  const separator = rendering?.block ? ' ' : null;
  return (
    <Fragment key={key}>
      {separator}
      {!rendering || (rendering.block && layout === 'inline')
        ? children
        : createElement(rendering.tag, { className: rendering.className }, ...children)}
      {separator}
    </Fragment>
  );
}

/**
 * Renders WYSIWYG HTML, parsed by `parseRichText`, as React elements. No attribute survives, and
 * elements outside the formatting allowlist keep only their text, so stored markup cannot run
 * script or load anything.
 */
export function RichText({
  body,
  layout,
}: {
  readonly body: HTMLElement;
  readonly layout: RichTextLayout;
}) {
  return renderChildren(body, layout);
}

// One preview serves every rich text cell, so long tables don't mount a popover per cell.
const richTextPreview = PopoverPrimitive.createHandle<string>();

/**
 * A table cell's rich text on one line; hover or click previews all of it. `body` is `html`
 * parsed by `parseRichText`. Needs a mounted <SharedRichTextPreview />.
 */
export function RichTextCell({
  html,
  body,
}: {
  readonly html: string;
  readonly body: HTMLElement;
}) {
  return (
    <PopoverPrimitive.Trigger
      handle={richTextPreview}
      payload={html}
      openOnHover
      delay={400}
      className="block w-full overflow-hidden text-left text-xs text-ellipsis whitespace-nowrap text-foreground outline-none hover:text-content-hover focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/45"
    >
      <RichText body={body} layout="inline" />
    </PopoverPrimitive.Trigger>
  );
}

const sourceLabels = { formatted: 'Formatted', html: 'HTML' } as const;
type RichTextSource = keyof typeof sourceLabels;

/**
 * The single rich text preview popup; mount it once near the app root. The Formatted/HTML choice
 * carries over to the next preview, so reading markup across cells takes one click, not one each.
 */
export function SharedRichTextPreview() {
  const [source, setSource] = useState<RichTextSource>('formatted');
  return (
    <PopoverPrimitive.Root handle={richTextPreview}>
      {({ payload }) => {
        const body = payload === undefined ? undefined : parseRichText(payload);
        return payload === undefined || !body ? null : (
          <PopoverContent
            align="start"
            aria-label="Rich text preview"
            className="flex max-h-[min(24rem,var(--available-height))] w-[min(32rem,calc(100vw-2rem))] flex-col"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
              <span className="text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
                Rich text
              </span>
              <ToggleGroup
                aria-label="Rich text source"
                value={[source]}
                onValueChange={([next]) => {
                  if (next) setSource(next);
                }}
              >
                <ToggleGroupItem value="formatted">{sourceLabels.formatted}</ToggleGroupItem>
                <ToggleGroupItem value="html">{sourceLabels.html}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="min-h-0 overflow-auto px-3 py-2.5 text-sm leading-relaxed [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:whitespace-pre-wrap [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
              {source === 'html' ? (
                <pre className="m-0 font-mono text-xs whitespace-pre-wrap wrap-break-word text-foreground/90">
                  {payload}
                </pre>
              ) : (
                <RichText body={body} layout="block" />
              )}
            </div>
          </PopoverContent>
        );
      }}
    </PopoverPrimitive.Root>
  );
}
