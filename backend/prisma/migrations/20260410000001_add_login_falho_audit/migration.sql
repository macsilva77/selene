-- AlterEnum: adiciona valor LOGIN_FALHO para rastreio de tentativas falhas de autenticação
ALTER TYPE "AuditAcao" ADD VALUE IF NOT EXISTS 'LOGIN_FALHO';
