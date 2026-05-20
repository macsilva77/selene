'use client';
import React from 'react';
import { Modal } from './modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Confirmar', onConfirm, onCancel }: Readonly<ConfirmDialogProps>) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
      <p className="text-sm text-muted-foreground mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted text-muted-foreground transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={onConfirm} className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors font-medium">
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
