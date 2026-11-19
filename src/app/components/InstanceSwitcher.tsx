import { Building2, ChevronsUpDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { deploymentLabels, type Deployment } from '../../domain';
import { InstancePicker } from './InstancePicker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { TooltipTrigger } from './ui/tooltip';

/**
 * The header's name of the open instance. It applies to every tab, so it stays in the header;
 * a deployment other than Production shows beside it, because data there is not live content.
 */
export function InstanceSwitcherButton({
  name,
  instanceZuid,
  deployment,
  onClick,
}: {
  readonly name: string | undefined;
  readonly instanceZuid: string;
  readonly deployment: Deployment;
  readonly onClick: () => void;
}) {
  return (
    <TooltipTrigger
      text={`Switch instance. Open now: ${instanceZuid}`}
      render={
        <button
          type="button"
          aria-label={`Switch instance, ${name ?? instanceZuid} is open${deployment === 'production' ? '' : ` in ${deploymentLabels[deployment]}`}`}
          className="hover:bg-surface-menu-hover focus-visible:ring-ring/45 flex h-9 max-w-72 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm outline-none focus-visible:ring-2"
          onClick={onClick}
        />
      }
    >
      <Building2 size={15} className="text-muted-foreground shrink-0" aria-hidden="true" />
      <span className="truncate font-semibold">{name ?? instanceZuid}</span>
      {deployment === 'production' ? null : (
        <span className="shrink-0 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          {deploymentLabels[deployment]}
        </span>
      )}
      <ChevronsUpDown size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
    </TooltipTrigger>
  );
}

type InstancePickerProps = ComponentProps<typeof InstancePicker>;

/** Switches instance, or deployment, from any tab without leaving it. */
export function InstanceDialog({
  open,
  onOpenChange,
  viewOpen,
  onChangeSessionToken,
  ...list
}: Omit<InstancePickerProps, 'autoFocus' | 'className'> & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Whether switching closes an open Explorer view. */
  readonly viewOpen: boolean;
  /** Another deployment's instances need its own token, so both change together. */
  readonly onChangeSessionToken: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(640px,85vh)] w-[min(600px,calc(100vw-32px))] flex-col gap-0 overflow-hidden p-0">
        <div className="px-4 pt-4 pr-12 pb-3">
          <DialogTitle className="text-base font-semibold">Switch instance</DialogTitle>
          <DialogDescription className="text-muted-foreground mt-0.5 text-sm">
            {viewOpen
              ? 'Switching closes the open view. The notice that follows can bring it back.'
              : 'Every tab shows the instance you choose.'}{' '}
            <button
              type="button"
              className="text-foreground underline underline-offset-2 hover:no-underline"
              onClick={onChangeSessionToken}
            >
              Use another session token or deployment
            </button>
          </DialogDescription>
        </div>
        <InstancePicker {...list} autoFocus />
      </DialogContent>
    </Dialog>
  );
}
