import { ChevronDown, Copy } from 'lucide-react';
import type { ExplorerError, ExplorerRequestOperation } from '../../domain';
import { copyText } from '../copy-text';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

const operationLabels: Readonly<Record<ExplorerRequestOperation, string>> = {
  'load-collection-catalog': 'Loading collection catalog',
  'load-collection-schema': 'Loading collection schema',
  'load-collection-items': 'Loading collection items',
  'load-item-versions': 'Loading item versions',
  'load-item-publishings': 'Loading item publishings',
  'load-instance-users': 'Loading instance users',
};

function technicalDetailsLines(error: ExplorerError): readonly string[] {
  const lines = [`Error kind: ${error.kind}`];
  const diagnostic = error.diagnostic;
  if (!diagnostic) return lines;

  if (diagnostic.operation) {
    lines.push(`Operation: ${operationLabels[diagnostic.operation]}`);
  }
  if (diagnostic.requestUrl) lines.push(`Request URL: ${diagnostic.requestUrl}`);
  if (diagnostic.responseStatus !== undefined) {
    lines.push(`HTTP status: ${diagnostic.responseStatus}`);
  }
  if (diagnostic.issues?.length) {
    lines.push('Decoding issues:');
    for (const issue of diagnostic.issues) {
      lines.push(`- ${issue.path}: expected ${issue.expected}, received ${issue.received}`);
    }
  }
  if (diagnostic.issuesOmitted) lines.push('Further decoding issues were omitted.');
  return lines;
}

interface ErrorTechnicalDetailsProps {
  readonly error: ExplorerError;
}

export function ErrorTechnicalDetails({ error }: ErrorTechnicalDetailsProps) {
  const details = technicalDetailsLines(error).join('\n');

  return (
    <Collapsible className="mt-3 rounded-lg border border-border bg-background/35">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 [&[data-panel-open]>svg]:rotate-180">
        Technical details
        <ChevronDown aria-hidden="true" className="size-3.5 transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 border-t border-border p-3">
        <pre
          className="m-0 max-h-60 overflow-auto rounded-md bg-background p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground"
          aria-label="Technical error details"
        >
          {details}
        </pre>
        <Button
          className="justify-self-start"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void copyText(details, 'Technical details copied')}
        >
          <Copy aria-hidden="true" size={14} />
          Copy technical details
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
