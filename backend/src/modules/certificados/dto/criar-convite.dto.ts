import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CriarConviteDto {
  @IsEmail({}, { message: 'Informe um e-mail válido para o cliente.' })
  email!: string;

  /** Apelido para o admin localizar o convite (ex.: "Padaria do João"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  apelido?: string;

  /** Validade do link em horas (padrão 72h). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  validadeHoras?: number;
}
