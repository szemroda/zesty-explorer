import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { cn } from '../../lib/utils';

function ToggleGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn('inline-flex items-center rounded-md bg-muted p-0.5', className)}
      {...props}
    />
  );
}

function ToggleGroupItem<Value extends string>({
  className,
  ...props
}: TogglePrimitive.Props<Value>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:bg-surface-menu-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-pressed:bg-panel-raised data-pressed:text-foreground data-pressed:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
