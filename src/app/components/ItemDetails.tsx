import { Check, Copy, X } from 'lucide-react';
import { useState, type RefObject } from 'react';
import type { ContentItem } from '../../domain';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

interface ItemDetailsProps {
  readonly item: ContentItem | undefined;
  readonly onClose: () => void;
  readonly finalFocus: RefObject<HTMLElement | null>;
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
    <Button
      variant="ghost"
      size="icon-xs"
      className="absolute top-2.5 right-2.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      aria-label={`Copy ${name}`}
      onClick={() => void copy()}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </Button>
  );
}

export function ItemDetails({ item, onClose, finalFocus }: ItemDetailsProps) {
  const [raw, setRaw] = useState(false);
  if (!item) return null;

  return (
    <Dialog open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="top-0 right-0 bottom-0 left-auto flex h-screen w-[min(520px,100vw)] translate-x-0 translate-y-0 flex-col gap-0 overflow-auto rounded-none border-y-0 border-r-0 p-0"
        aria-labelledby="details-title"
        finalFocus={finalFocus}
        overlay={false}
        showCloseButton={false}
      >
        <DialogHeader className="sticky top-0 z-10 flex grid-cols-none flex-row items-center justify-between border-b border-border bg-popover/95 px-5 py-4 backdrop-blur">
          <div>
            <span className="text-[10px] font-bold tracking-[.12em] text-primary uppercase">
              Item details
            </span>
            <DialogTitle id="details-title" className="mt-1 text-base font-bold">
              {item.id}
            </DialogTitle>
          </div>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" />}
            aria-label="Close item details"
          >
            <X size={18} />
          </DialogClose>
        </DialogHeader>
        <Tabs
          value={raw ? 'raw' : 'fields'}
          onValueChange={(value) => setRaw(value === 'raw')}
          className="p-5"
        >
          <TabsList aria-label="Item detail format">
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="raw">Raw JSON</TabsTrigger>
          </TabsList>
          <TabsContent value="raw">
            <pre className="text-code-content max-h-[calc(100vh-130px)] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6 whitespace-pre-wrap">
              {JSON.stringify(item.raw, null, 2)}
            </pre>
          </TabsContent>
          <TabsContent value="fields">
            <>
              <h3 className="mt-3 mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Content fields
              </h3>
              <dl className="m-0 divide-y divide-border border-y border-border">
                {Object.entries(item.fields).map(([name, value]) => (
                  <div
                    className="group relative grid grid-cols-[150px_1fr] gap-4 px-3 py-3 pr-10"
                    key={name}
                  >
                    <dt className="text-xs text-muted-foreground">{name}</dt>
                    <dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-xs leading-5 text-foreground">
                      {formatted(value)}
                    </dd>
                    <CopyValue name={name} value={value} />
                  </div>
                ))}
              </dl>
              <h3 className="mt-6 mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Technical metadata
              </h3>
              <dl className="m-0 divide-y divide-border border-y border-border">
                {Object.entries(item.metadata).map(([name, value]) => (
                  <div
                    className="group relative grid grid-cols-[150px_1fr] gap-4 px-3 py-3 pr-10"
                    key={name}
                  >
                    <dt className="text-xs text-muted-foreground">{name}</dt>
                    <dd className="m-0 min-w-0 [overflow-wrap:anywhere] text-xs leading-5 text-foreground">
                      {formatted(value)}
                    </dd>
                    <CopyValue name={name} value={value} />
                  </div>
                ))}
              </dl>
            </>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
