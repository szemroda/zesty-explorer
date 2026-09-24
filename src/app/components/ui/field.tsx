import { Field as FieldPrimitive } from '@base-ui/react/field';
import { cn } from '../../lib/utils';

// Base UI links the label, description and error to the control and marks it invalid.
// A field with an `error` is invalid and shows the message below its other content.
function Field({
  className,
  children,
  error,
  ...props
}: Omit<FieldPrimitive.Root.Props, 'invalid'> & { readonly error?: string | undefined }) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      className={cn('grid gap-2', className)}
      invalid={error !== undefined}
      {...props}
    >
      {children}
      {error === undefined ? null : (
        <FieldPrimitive.Error
          data-slot="field-error"
          match
          className="text-sm font-normal text-destructive"
        >
          {error}
        </FieldPrimitive.Error>
      )}
    </FieldPrimitive.Root>
  );
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn('flex items-center gap-2 text-xs font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn('text-xs leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldLabel };
