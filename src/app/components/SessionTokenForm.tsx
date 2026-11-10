import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { deploymentLabels, type Deployment, type InstanceZuid } from '../../domain';
import { useFieldProblem } from '../hooks/useFieldProblem';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Field, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/**
 * Each deployment's session cookie, and a Zesty page that sends signed-out users to sign in first.
 * Every page sees the cookie because Zesty sets it on `.zesty.io`.
 */
const tokenSources: Readonly<
  Record<Deployment, { readonly cookie: string; readonly signInUrl: string }>
> = {
  production: { cookie: 'APP_SID', signInUrl: 'https://www.zesty.io/instances/' },
  stage: { cookie: 'STAGE_APP_SID', signInUrl: 'https://accounts.stage.zesty.io/instances' },
  development: { cookie: 'DEV_APP_SID', signInUrl: 'https://accounts.dev.zesty.io/instances' },
};
const deployments: readonly Deployment[] = ['production', 'stage', 'development'];

interface SessionTokenFormProps {
  readonly deployment: Deployment;
  readonly savedToken: string;
  readonly rejected: boolean;
  readonly instance: InstanceZuid | undefined;
  readonly onDeploymentChange: ((deployment: Deployment) => void) | undefined;
  readonly onSubmit: (token: string) => void;
  readonly onBack: (() => void) | undefined;
}

export function SessionTokenForm({
  deployment,
  savedToken,
  rejected,
  instance,
  onDeploymentChange,
  onSubmit,
  onBack,
}: SessionTokenFormProps) {
  const [draft, setDraft] = useState(savedToken);
  const [draftSource, setDraftSource] = useState({ deployment, savedToken });
  const [showToken, setShowToken] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);
  const problem = useFieldProblem({ 'session-token': tokenInput });
  if (deployment !== draftSource.deployment) {
    setDraftSource({ deployment, savedToken });
    if (!draft || draft === draftSource.savedToken) setDraft(savedToken);
    setShowToken(false);
    problem.clear();
  }
  const label = deploymentLabels[deployment];
  const { cookie, signInUrl } = tokenSources[deployment];

  return (
    <Card className="mx-auto my-[8vh] w-full max-w-xl py-0">
      <form
        className="grid gap-4 p-6"
        aria-labelledby="start-title"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const token = draft.trim();
          if (!token) {
            problem.report('session-token', `Enter the ${label} session token.`);
            return;
          }
          onSubmit(token);
        }}
      >
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {rejected ? 'Session expired' : instance ? 'Session token needed' : 'Start a view'}
        </p>
        <h2 className="text-xl font-semibold" id="start-title">
          {rejected
            ? 'Replace your session token'
            : instance
              ? `Enter your ${label} session token`
              : 'Open a Zesty collection'}
        </h2>
        {rejected ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
          >
            Zesty rejected the {label} session token. Copy a fresh {cookie} cookie using the steps
            below.
            {onDeploymentChange
              ? " If you copied another deployment's cookie, choose that deployment."
              : ''}
          </p>
        ) : null}
        {onDeploymentChange ? (
          <Field>
            <FieldLabel>Zesty deployment</FieldLabel>
            <ToggleGroup<Deployment>
              aria-label="Zesty deployment"
              value={[deployment]}
              onValueChange={(values) => {
                const next = values[0];
                if (next) onDeploymentChange(next);
              }}
            >
              {deployments.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {deploymentLabels[value]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        ) : (
          <p className="text-muted-foreground text-sm">
            {instance} is on the {label} deployment.
          </p>
        )}
        <Field error={problem.messageFor('session-token')}>
          <FieldLabel>Zesty session token</FieldLabel>
          <div className="relative">
            <Input
              ref={tokenInput}
              autoFocus={!savedToken}
              className="pr-10"
              type={showToken ? 'text' : 'password'}
              value={draft}
              autoComplete="off"
              onChange={(event) => {
                setDraft(event.target.value);
                problem.clear('session-token');
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 size-7"
              aria-label={showToken ? 'Hide session token' : 'Reveal session token'}
              onClick={() => setShowToken((visible) => !visible)}
            >
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
        </Field>
        {/* Keyed so each deployment opens the steps exactly when it has no saved token. */}
        <Collapsible key={deployment} defaultOpen={!savedToken}>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground text-left text-xs underline-offset-4 hover:underline">
            How to find the token
          </CollapsibleTrigger>
          <CollapsibleContent className="text-muted-foreground pt-2 text-xs leading-relaxed">
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                <a
                  className="text-foreground inline-flex items-center gap-1 font-medium underline underline-offset-4"
                  href={signInUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    // Coming back from Zesty lands in the token field, ready to paste.
                    window.addEventListener('focus', () => tokenInput.current?.focus(), {
                      once: true,
                    });
                  }}
                >
                  Open your {label} Zesty instances
                  <ExternalLink size={12} aria-hidden />
                </a>{' '}
                in a new tab and sign in if Zesty asks.
              </li>
              <li>Open Chrome or Edge Developer Tools with F12, or Cmd+Option+I on macOS.</li>
              <li>Go to Application → Cookies and select the Zesty site.</li>
              <li>
                Type <code className="text-foreground">{cookie}</code> in the filter box and select
                its row.
              </li>
              <li>Copy the whole value under Cookie Value. The table can cut it short.</li>
              <li>Come back here and paste it above.</li>
            </ol>
            <p className="pt-2">The token carries your Zesty permissions. Do not share it.</p>
          </CollapsibleContent>
        </Collapsible>
        <div className="flex flex-wrap justify-end gap-2">
          {onBack ? (
            <Button variant="outline" type="button" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </Card>
  );
}
