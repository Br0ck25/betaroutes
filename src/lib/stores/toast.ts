import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  timeout?: number;
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  let nextId = 0;

  function add(message: string, type: ToastType = 'info', duration = 4000) {
    const id = nextId++;
    const toast: Toast = { id, type, message };

    update((all) => [...all, toast]);

    if (duration > 0) {
      setTimeout(() => {
        dismiss(id);
      }, duration);
    }
  }

  function dismiss(id: number) {
    update((all) => all.filter((t) => t.id !== id));
  }

  return {
    subscribe,
    success: (msg: string, duration?: number) => add(msg, 'success', duration),
    error: (msg: string, duration?: number) => add(msg, 'error', duration),
    warning: (msg: string, duration?: number) => add(msg, 'warning', duration),
    info: (msg: string, duration?: number) => add(msg, 'info', duration),
    dismiss
  };
}

export const toasts = createToastStore();
