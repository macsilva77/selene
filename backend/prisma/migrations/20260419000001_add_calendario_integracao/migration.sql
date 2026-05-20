-- CreateEnum
CREATE TYPE "CalendarioTipo" AS ENUM ('google', 'outlook');

-- CreateTable
CREATE TABLE "calendario_integracoes" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" "CalendarioTipo" NOT NULL,
    "email" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendario_integracoes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "calendario_integracoes" ADD CONSTRAINT "calendario_integracoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
