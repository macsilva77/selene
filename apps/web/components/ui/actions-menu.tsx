'use client';
import React, { useState, useRef, useEffect } from 'react';
import { DotsThreeVertical } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface Action {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger';
  hidden?: boolean;
}
export function ActionsMenu({ actions }: { actions: Action[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = actions.filter((a) => !a.hidden);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  if (visible.length === 0) return null;
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
        <DotsThreeVertical size={16} weight="bold" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 w-40 bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden py-1">
          {visible.map((action) => (
            <button type="button" key={action.label} onClick={() => { action.onClick(); setOpen(false); }}
              className={cn('w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors text-left',
                action.variant === 'danger' ? 'text-red-600' : 'text-slate-700')}>
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
