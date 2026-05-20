'use client';
import React, { useCallback, useState } from 'react';
import { CheckCircleIcon, WarningIcon, XIcon } from '@phosphor-icons/react';

interface Toast { id: string; type: 'success' | 'error' | 'info'; message: string; }

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast['type'], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const success = useCallback((msg: string) => add('success', msg), [add]);
  const error   = useCallback((msg: string) => add('error', msg), [add]);
  const info    = useCallback((msg: string) => add('info', msg), [add]);
  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  return { toasts, success, error, info, dismiss };
}

export function ToastContainer({ toasts, onDismiss }: Readonly<{ toasts: Toast[]; onDismiss: (id: string) => void }>) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border border-border bg-card min-w-[280px] max-w-sm animate-in slide-in-from-bottom-2">
          {t.type === 'success' && <CheckCircleIcon size={16} className="text-emerald-500 shrink-0" />}
          {t.type === 'error' && <WarningIcon size={16} className="text-destructive shrink-0" />}
          {t.type === 'info' && <CheckCircleIcon size={16} className="text-primary shrink-0" />}
          <span className="text-sm text-foreground flex-1">{t.message}</span>
          <button type="button" onClick={() => onDismiss(t.id)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Fechar">
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
