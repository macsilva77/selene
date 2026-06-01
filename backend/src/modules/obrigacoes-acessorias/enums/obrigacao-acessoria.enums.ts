// RN-03: Enums gerenciados na camada de aplicação para flexibilidade.
// O banco armazena VARCHAR — nenhuma constraint de enum é criada no DDL.

export enum TipoObrigacao {
  EFD_ICMS_IPI      = 'EFD_ICMS_IPI',
  EFD_CONTRIBUICOES = 'EFD_CONTRIBUICOES',
  ECD               = 'ECD',
  ECF               = 'ECF',
}

export enum FinalidadeObrigacao {
  ORIGINAL    = 'Original',
  RETIFICACAO = 'Retificacao',
}

export enum StatusProcessamento {
  RECEBIDO                    = 'Recebido',
  PROCESSADO                  = 'Processado',
  ERRO_VALIDACAO              = 'Erro_Validacao',
  ERRO_ARQUIVO_NAO_ENCONTRADO = 'Erro_Arquivo_Nao_Encontrado',
  ERRO_HASH_DIVERGENTE        = 'Erro_Hash_Divergente',
  ERRO_DUPLICATA_ORIGINAL     = 'Erro_Duplicata_Original',
}

export enum OrigemObrigacao {
  TOPICO        = 'Topico',
  UPLOAD_MANUAL = 'Upload_Manual',
}
