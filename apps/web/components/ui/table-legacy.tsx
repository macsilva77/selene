// BACKUP da versão anterior de table.tsx — preservado antes da migração para shadcn/ui primitives
import React from 'react';
import { cn } from '@/lib/utils';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
}
interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  keyExtractor: (row: T) => string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
}
export function Table<T>({ columns, data, isLoading, keyExtractor, emptyMessage = 'Nenhum registro encontrado.', onRowClick, rowClassName }: TableProps<T>) {
  if (isLoading) {
    return (
      <div className="space-y-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/50 animate-pulse border-b border-border" />
        ))}
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-muted/30">
          {columns.map((col) => (
            <th key={col.key} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground tracking-wider uppercase whitespace-nowrap">
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          data.map((row) => (
            <tr
              key={keyExtractor(row)}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'border-b border-border/50 transition-colors',
                onRowClick ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/20',
                rowClassName?.(row) ?? '',
              )}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3.5 text-foreground">
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
