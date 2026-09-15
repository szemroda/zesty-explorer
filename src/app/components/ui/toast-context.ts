import { Toast } from '@base-ui/react/toast';

export interface AppToastData {
  readonly retry?: () => void;
}

export const ToastProvider = Toast.Provider;

export function useAppToastManager() {
  return Toast.useToastManager<AppToastData>();
}
