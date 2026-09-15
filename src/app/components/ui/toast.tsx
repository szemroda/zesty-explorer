import { Toast } from '@base-ui/react/toast';
import { X } from 'lucide-react';
import { useAppToastManager } from './toast-context';

export function Toaster() {
  const { toasts } = useAppToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="toast-viewport">
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} className="toast-root">
            <Toast.Content className="toast-content">
              <div className="toast-copy">
                <Toast.Title className="toast-title" />
                <Toast.Description className="toast-description" />
              </div>
              {toast.data?.retry ? (
                <Toast.Action className="toast-action" onClick={toast.data.retry}>
                  Retry refresh
                </Toast.Action>
              ) : null}
              <Toast.Close className="toast-close" aria-label="Dismiss notification">
                <X size={14} />
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
