const {PrismaClient}=require("/app/node_modules/@prisma/client");
const bcrypt=require("/app/node_modules/bcrypt");
const p=new PrismaClient();
async function main(){
  const h=await bcrypt.hash("Admin@123456",12);
  const t=await p.tenant.upsert({where:{slug:"sigic-default"},update:{},create:{nome:"SIGIC",slug:"sigic-default",cnpj:"00.000.000/0001-00",plano:"enterprise",ativo:true}});
  const u=await p.usuario.upsert({where:{tenantId_email:{tenantId:t.id,email:"admin@sigic.gov.br"}},update:{},create:{tenantId:t.id,nome:"Administrador",email:"admin@sigic.gov.br",senhaHash:h,role:"ADMIN"}});
  console.log("CREATED:",u.email,u.role);
}
main().catch(e=>{console.error("ERROR:",e.message);process.exit(1);}).finally(()=>process.exit(0));
