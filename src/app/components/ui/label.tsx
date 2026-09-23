import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('flex items-center gap-2 text-xs font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export { Label };
