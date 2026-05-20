import { PrismaClient } from '/app/node_modules/.prisma/client/index.js';
import bcrypt from '/app/node_modules/bcrypt/bcrypt.js';

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('Admin@123456', 12);
  
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'sigic-default' },
    update: {},
    create: {
      nome: 'SIGIC',
      slug: 'sigic-default',
      cnpj: '00.000.000/0001-00',
      plano: 'enterprise',
      ativo: true,
    },
  });
  console.log('Tenant:', tenant.id, tenant.slug);

  const user = await prisma.usuario.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@sigic.gov.br' } },
    update: {},
    create: {
      tenantId: tenant.id,
      nome: 'Administrador',
      email: 'admin@sigic.gov.br',
      senhaHash: hash,
      role: 'ADMIN',
    },
  });
  console.log('User created:', user.email, user.role);
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
