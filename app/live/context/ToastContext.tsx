'use client';

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from 'react';

// ── Toast shape ───────────────────────────────────
export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id:        string;
  variant:   ToastVariant;
  title:     string;
  message?:  string;       // optional subtitle
  duration:  number;       // ms before auto-dismiss
  createdAt: number;       // ms timestamp
}

// ── State & actions ───────────────────────────────
interface ToastState {
  toasts: Toast[];
}

type ToastAction =
  | { type: 'ADD';     payload: Toast   }
  | { type: 'REMOVE';  payload: string  } // id
  | { type: 'CLEAR'                     };

const MAX_TOASTS = 5; // backpressure cap

function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case 'ADD': {
      // If at cap, drop the oldest toast (index 0) before adding new one.
      // This is exactly how a circular buffer works — fixed size, overwrite oldest.
      const toasts = state.toasts.length >= MAX_TOASTS
        ? [...state.toasts.slice(1), action.payload]
        : [...state.toasts, action.payload];
      return { toasts };
    }
    case 'REMOVE':
      return { toasts: state.toasts.filter(t => t.id !== action.payload) };
    case 'CLEAR':
      return { toasts: [] };
    default:
      return state;
  }
}

// ── Context types ─────────────────────────────────
interface ToastContextValue {
  toasts:  Toast[];
  toast:   (opts: Omit<Toast, 'id' | 'createdAt'>) => void;
  dismiss: (id: string) => void;
  clear:   () => void;
  // Convenience methods — these are the public API
  // most components will actually use
  success: (title: string, message?: string) => void;
  error:   (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info:    (title: string, message?: string) => void;
}

// ── Create context ────────────────────────────────
const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ──────────────────────────────────────
export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, { toasts: [] });

  // Core dispatcher
  const toast = useCallback((opts: Omit<Toast, 'id' | 'createdAt'>) => {
    const newToast: Toast = {
      ...opts,
      id:        `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    dispatch({ type: 'ADD', payload: newToast });
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', payload: id });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  // Convenience shortcuts — pre-fill variant and default duration
  const success = useCallback(
    (title: string, message?: string) =>
      toast({ variant: 'success', title, message, duration: 4000 }),
    [toast]
  );

  const error = useCallback(
    (title: string, message?: string) =>
      toast({ variant: 'error', title, message, duration: 6000 }),
    [toast]
  );

  const warning = useCallback(
    (title: string, message?: string) =>
      toast({ variant: 'warning', title, message, duration: 5000 }),
    [toast]
  );

  const info = useCallback(
    (title: string, message?: string) =>
      toast({ variant: 'info', title, message, duration: 4000 }),
    [toast]
  );

  // ── Auto-dismiss via a single interval ────────────
  // CS Note: Instead of scheduling one setTimeout per toast
  // (which creates N timers for N toasts — an O(n) resource leak),
  // we run ONE interval at 500ms and sweep for expired toasts.
  // This is the same pattern used in garbage collectors and
  // TTL caches — periodic sweeps are cheaper than per-item timers.
  useEffect(() => {
    if (state.toasts.length === 0) return;

    const id = setInterval(() => {
      const now     = Date.now();
      const expired = state.toasts.filter(
        t => now - t.createdAt >= t.duration
      );
      expired.forEach(t => dispatch({ type: 'REMOVE', payload: t.id }));
    }, 500);

    return () => clearInterval(id);
  }, [state.toasts]);

  const value = useMemo(
    () => ({ toasts: state.toasts, toast, dismiss, clear, success, error, warning, info }),
    [state.toasts, toast, dismiss, clear, success, error, warning, info]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

// ── Custom hook ───────────────────────────────────
export function useToast() {
  const ctx = useContext(ToastContext);
  // Build-safe fallback for pre-rendering
  return ctx || {
    toasts: [],
    toast: () => {},
    dismiss: () => {},
    clear: () => {},
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  } as ToastContextValue;
}