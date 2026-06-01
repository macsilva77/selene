'use client';

import React, { useState, useRef, useCallback } from 'react';
import { UploadSimpleIcon, XIcon, WarningIcon } from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import {
  obrigacoesApi,
  type TipoObrigacao,
  type FinalidadeObrigacao,
  type UploadPayload,
} from '@/lib/obrigacoes-api';

interface Props {
  isOpen:    boolean;
  onClose:   () => void;
  /** Tipo pré-selecionado pela tela mãe */
  tipoInicial?: TipoObrigacao;
  onSuccess: (id: string) => void;
}

const TIPOS: { value: TipoObrigacao; label: string }[] = [
  { value: 'EFD_ICMS_IPI',    label: 'EFD ICMS/IPI' },
  { value: 'EFD_CONTRIBUICOES', label: 'EFD Contribuições' },
  { value: 'ECD',             label: 'ECD' },
  { value: 'ECF',             label: 'ECF' },
];

const FINALIDADES: { value: FinalidadeObrigacao; label: string }[] = [
  { value: 'Original',    label: 'Original' },
  { value: 'Retificacao', label: 'Retificação' },
];

function mascararCnpj(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function UploadObrigacaoModal({ isOpen, onClose, tipoInicial, onSuccess }: Readonly<Props>) {
  const [tipo, setTipo] = useState<TipoObrigacao>(tipoInicial ?? 'EFD_ICMS_IPI');
  const [cnpjMask, setCnpjMask] = useState('');
  const [ie, setIe] = useState('');
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [finalidade, setFinalidade] = useState<FinalidadeObrigacao>('Original');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cnpjSoDigitos = cnpjMask.replace(/\D/g, '');
  const precisaIE = tipo === 'EFD_ICMS_IPI';

  const resetForm = useCallback(() => {
    setCnpjMask('');
    setIe('');
    setDataInicial('');
    setDataFinal('');
    setFinalidade('Original');
    setArquivo(null);
    setProgresso(null);
    setErro('');
    setEnviando(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f && !f.name.toLowerCase().endsWith('.txt')) {
      setErro('Somente arquivos .txt são aceitos');
      return;
    }
    setErro('');
    setArquivo(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');

    if (cnpjSoDigitos.length !== 14) { setErro('CNPJ inválido (14 dígitos requeridos)'); return; }
    if (!arquivo)                      { setErro('Selecione um arquivo .txt'); return; }
    if (!dataInicial || !dataFinal)    { setErro('Informe o período'); return; }
    if (precisaIE && !ie.trim())       { setErro('Inscrição Estadual obrigatória para EFD ICMS/IPI'); return; }

    const payload: UploadPayload = {
      tipoObrigacao:     tipo,
      cnpj:              cnpjSoDigitos,
      dataInicial,
      dataFinal,
      finalidade,
      arquivo,
      onProgress:        setProgresso,
    };
    if (precisaIE) payload.inscricaoEstadual = ie.trim();

    try {
      setEnviando(true);
      const { id } = await obrigacoesApi.upload(payload);
      resetForm();
      onSuccess(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar arquivo';
      setErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  const labelCls = 'block text-xs font-medium text-muted-foreground mb-1';
  const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
  const selectCls = inputCls;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Upload Manual" subtitle="Origem: Upload Manual (automático)" size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-4">

        {/* Tipo */}
        <div>
          <label className={labelCls}>Tipo de Obrigação *</label>
          <select className={selectCls} value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoObrigacao)}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* CNPJ */}
          <div>
            <label className={labelCls}>CNPJ *</label>
            <input type="text" className={inputCls} placeholder="00.000.000/0000-00"
              value={cnpjMask}
              onChange={(e) => setCnpjMask(mascararCnpj(e.target.value))}
              maxLength={18} />
          </div>

          {/* Inscrição Estadual — condicional (RN-04) */}
          {precisaIE && (
            <div>
              <label className={labelCls}>Inscrição Estadual *</label>
              <input type="text" className={inputCls} placeholder="ex: 123456789"
                value={ie} onChange={(e) => setIe(e.target.value)} maxLength={20} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Data Inicial *</label>
            <input type="date" className={inputCls} value={dataInicial}
              onChange={(e) => setDataInicial(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Data Final *</label>
            <input type="date" className={inputCls} value={dataFinal}
              onChange={(e) => setDataFinal(e.target.value)} />
          </div>
        </div>

        {/* Finalidade */}
        <div>
          <label className={labelCls}>Finalidade *</label>
          <select className={selectCls} value={finalidade}
            onChange={(e) => setFinalidade(e.target.value as FinalidadeObrigacao)}>
            {FINALIDADES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {/* Arquivo */}
        <div>
          <label className={labelCls}>Arquivo (.txt) *</label>
          <div
            className="flex items-center gap-3 rounded-md border border-dashed border-input bg-muted/20 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <UploadSimpleIcon size={18} className="text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground truncate flex-1">
              {arquivo ? arquivo.name : 'Clique para selecionar ou arraste o arquivo'}
            </span>
            {arquivo && (
              <button type="button" onClick={(e) => { e.stopPropagation(); setArquivo(null); if (inputRef.current) inputRef.current.value = ''; }}>
                <XIcon size={14} className="text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
          <input ref={inputRef} type="file" accept=".txt" className="hidden" onChange={handleFileChange} />
        </div>

        {/* Origem (somente leitura — RN-12) */}
        <div>
          <label className={labelCls}>Origem</label>
          <input type="text" className={`${inputCls} bg-muted/30 text-muted-foreground cursor-not-allowed`}
            value="Upload Manual" readOnly />
        </div>

        {/* Barra de progresso */}
        {progresso !== null && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-150 rounded-full"
                style={{ width: `${progresso}%` }} />
            </div>
            <p className="text-xs text-muted-foreground text-right">{progresso}%</p>
          </div>
        )}

        {/* Erro */}
        {erro && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <WarningIcon size={16} className="shrink-0" />
            {erro}
          </div>
        )}

        {/* Ações */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={handleClose}
            className="px-4 py-2 rounded-md text-sm border border-input hover:bg-muted transition-colors"
            disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" disabled={enviando}
            className="px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60">
            {enviando ? 'Enviando…' : 'Enviar arquivo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
