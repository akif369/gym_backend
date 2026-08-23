const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const members = await prisma.member.findMany({
    where: { photoUrl: { startsWith: 'http://localhost:3900/' } }
  });

  for (const m of members) {
    const newUrl = m.photoUrl.replace('http://localhost:3900/', 'http://localhost:5000/api/v1/storage/');
    await prisma.member.update({
      where: { id: m.id },
      data: { photoUrl: newUrl }
    });
    console.log(`Updated photoUrl for member ${m.id}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
