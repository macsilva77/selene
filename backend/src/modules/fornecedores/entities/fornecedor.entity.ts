export class FornecedorEntity {
  id: string;
  nome: string;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;

  constructor(partial: Partial<FornecedorEntity>) {
    Object.assign(this, partial);
  }
}
