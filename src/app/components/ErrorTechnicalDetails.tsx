import { ChevronDown, Copy } from 'lucide-react';
import { useState } from 'react';
import type { ExplorerError, ExplorerRequestOperation } from '../../domain';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

const operationLabels: Readonly<Record<ExplorerRequestOperation, string>> = {
  'load-collection-catalog': 'Loading collection catalog',
  'load-collection-schema': 'Loading collection schema',
  'load-collection-items': 'Loading collection items',
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
  const [copied, setCopied] = useState(false);
  const details = technicalDetailsLines(error).join('\n');

  async function copyDetails() {
    await navigator.clipboard.writeText(details);
    setCopied(true);
  }

  return (
    <Collapsible className="error-details">
      <CollapsibleTrigger className="error-details__trigger">
        Technical details
        <ChevronDown aria-hidden="true" size={14} />
      </CollapsibleTrigger>
      <CollapsibleContent className="error-details__content">
        <pre aria-label="Technical error details">{details}</pre>
        <button className="button button--quiet" type="button" onClick={() => void copyDetails()}>
          <Copy aria-hidden="true" size={14} />
          {copied ? 'Copied' : 'Copy technical details'}
        </button>
      </CollapsibleContent>
    </Collapsible>
  );
}
