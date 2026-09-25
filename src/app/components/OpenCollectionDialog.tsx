import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';

interface OpenCollectionDialogProps {
  /** The collection to open; the dialog is closed while it is undefined. */
  readonly label: string | undefined;
  readonly replacesView: boolean;
  readonly onClose: () => void;
  readonly onOpenHere: () => void;
  readonly onOpenInNewTab: () => void;
}

/** Asks before a collection referenced by code replaces the current Explorer view. */
export function OpenCollectionDialog({
  label,
  replacesView,
  onClose,
  onOpenHere,
  onOpenInNewTab,
}: OpenCollectionDialogProps) {
  // The closing animation still shows the text of the collection that was being opened.
  const [shown, setShown] = useState({ label, replacesView });
  if (label !== undefined && (label !== shown.label || replacesView !== shown.replacesView)) {
    setShown({ label, replacesView });
  }
  return (
    <AlertDialog
      open={label !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="w-[min(520px,calc(100vw-32px))]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-semibold">
            Open {shown.label} in Explorer?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground text-sm">
            {shown.replacesView
              ? `Opening it in Explorer replaces the current Explorer view with ${shown.label} as the root collection.`
              : `Explorer has no open view. ${shown.label} becomes its root collection.`}{' '}
            A new tab keeps this tab as it is, but may ask for your session token.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="outline"
            onClick={() => {
              onOpenInNewTab();
              onClose();
            }}
          >
            Open in new tab
          </Button>
          <Button
            onClick={() => {
              onOpenHere();
              onClose();
            }}
          >
            Open in Explorer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
