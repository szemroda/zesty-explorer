import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '../../lib/utils';

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-3', className)} {...props} />;
}
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex h-9 w-fit items-center rounded-lg bg-muted p-1', className)}
      {...props}
    />
  );
}
function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        'inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-3 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:bg-surface-menu-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-active:bg-panel-raised data-active:text-foreground data-active:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}
function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel className={cn('outline-none', className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
