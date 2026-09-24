import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

// One tooltip serves every trigger, so long tables don't mount a tooltip per cell.
const sharedTooltip = TooltipPrimitive.createHandle<string>();

const TooltipProvider = TooltipPrimitive.Provider;

/** Shows `text` in the shared tooltip on hover and keyboard focus. Needs a mounted <SharedTooltip />. */
function TooltipTrigger({
  text,
  ...props
}: Omit<TooltipPrimitive.Trigger.Props<string>, 'handle' | 'payload'> & {
  readonly text: string;
}) {
  return <TooltipPrimitive.Trigger handle={sharedTooltip} payload={text} {...props} />;
}

/** The single tooltip popup; mount it once near the app root. */
function SharedTooltip() {
  return (
    <TooltipPrimitive.Root handle={sharedTooltip}>
      {({ payload }) =>
        payload === undefined ? null : (
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Positioner className="isolate z-50" sideOffset={6}>
              <TooltipPrimitive.Popup
                data-slot="tooltip-content"
                className="max-w-72 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md"
              >
                {payload}
              </TooltipPrimitive.Popup>
            </TooltipPrimitive.Positioner>
          </TooltipPrimitive.Portal>
        )
      }
    </TooltipPrimitive.Root>
  );
}

export { SharedTooltip, TooltipProvider, TooltipTrigger };
