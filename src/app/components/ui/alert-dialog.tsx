import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogClose = AlertDialogPrimitive.Close;
const AlertDialogTitle = AlertDialogPrimitive.Title;
const AlertDialogDescription = AlertDialogPrimitive.Description;

function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px] transition-opacity data-closed:opacity-0 data-open:opacity-100"
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl outline-none',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-1.5', className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex justify-end gap-2', className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
