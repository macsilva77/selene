import { Role } from '@prisma/client';

export class UsuarioEntity {
  id: string;
  nome: string;
  email: string;
  role: Role;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;

  // Nunca expõe a hash
  constructor(partial: Partial<UsuarioEntity & { senhaHash?: string }>) {
    const { senhaHash: _, ...safe } = partial as any;
    Object.assign(this, safe);
  }
}
