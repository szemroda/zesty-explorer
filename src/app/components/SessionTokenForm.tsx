import { Eye, EyeOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { deploymentLabels, type Deployment, type InstanceZuid } from '../../domain';
import { useFieldProblem } from '../hooks/useFieldProblem';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Field, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

const sessionCookies: Readonly<Record<Deployment, string>> = {
  production: 'APP_SID',
  stage: 'STAGE_APP_SID',
  development: 'DEV_APP_SID',
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
  const cookie = sessionCookies[deployment];

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
            Zesty rejected the {label} session token. Copy a fresh {cookie} cookie from Zesty
            Manager.
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
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground text-left text-xs underline-offset-4 hover:underline">
            How to find the token
          </CollapsibleTrigger>
          <CollapsibleContent className="text-muted-foreground pt-2 text-xs leading-relaxed">
            Copy {cookie} from your {label} Zesty Manager cookies. It carries your permissions. Do
            not share it.
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
