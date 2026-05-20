'use client';
import React from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}
export function Pagination({ page, totalPages, total, limit, onPageChange }: PaginationProps) {
  const from = Math.min((page - 1) * limit + 1, total);
  const to = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between pt-2 text-sm text-slate-500">
      <span>{total > 0 ? `${from}–${to} de ${total}` : '0 registros'}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <CaretLeft size={14} />
        </button>
        <span className="px-2 text-xs font-medium">{page} / {Math.max(totalPages, 1)}</span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          <CaretRight size={14} />
        </button>
      </div>
    </div>
  );
}
