import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent text-sm font-semibold outline-none transition-[color,background-color,border-color,box-shadow,transform] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/45 active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/80 hover:shadow-md',
        outline:
          'border-border bg-panel text-foreground hover:border-input hover:bg-surface-menu-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'text-muted-foreground hover:bg-surface-menu-hover hover:text-foreground',
        destructive:
          'bg-destructive/15 text-destructive hover:bg-destructive/30 hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3',
        sm: 'h-8 rounded-md px-2.5 text-xs',
        lg: 'h-10 px-4',
        icon: 'size-9',
        'icon-sm': 'size-8 rounded-md',
        'icon-xs': 'size-7 rounded-md [&_svg:not([class*="size-"])]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
