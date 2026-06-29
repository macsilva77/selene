import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** DTO para criar uma configuração de monitoramento de distribuição CT-e. */
export class ConfigurarCteDto {
  /** CNPJ monitorado — 14 dígitos sem máscara */
  @Matches(/^\d{14}$/, { message: 'cnpj deve conter 14 dígitos sem máscara' })
  cnpj!: string;

  /** Sigla da UF do autor da consulta (ex: "SP", "PR") */
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'uf deve ser a sigla de 2 letras maiúsculas' })
  uf!: string;

  /** ID do certificado digital a usar (mesmo da NF-e) */
  @IsString()
  certificadoId!: string;

  /** 1 = produção (padrão), 2 = homologação */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  tpAmb?: number;

  /** Horário de captura "HH:MM" (default "00:00") */
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horarioCaptura deve ser no formato HH:MM' })
  horarioCaptura?: string;

  /** Intervalo entre execuções em minutos (default 60) */
  @IsOptional()
  @IsInt()
  @Min(1)
  intervaloMinutos?: number;
}
