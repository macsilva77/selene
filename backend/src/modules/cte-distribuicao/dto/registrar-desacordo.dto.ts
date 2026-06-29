import { IsString, Length } from 'class-validator';

/** DTO para registrar a Prestação do Serviço em Desacordo (610110) de um CT-e. */
export class RegistrarDesacordoDto {
  /** Observação/justificativa do desacordo — 15 a 255 caracteres */
  @IsString()
  @Length(15, 255, { message: 'A observação do desacordo deve ter entre 15 e 255 caracteres.' })
  xObs!: string;
}
