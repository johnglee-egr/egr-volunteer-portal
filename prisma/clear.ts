import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

async function clear() {
  console.log("Saving festival settings...");
  const settings = await prisma.festivalSettings.findUnique({ where: { id: "main" } });

  console.log("Clearing all data...");
  await prisma.notification.deleteMany();
  await prisma.pairRequest.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.volunteerGroupMember.deleteMany();
  await prisma.volunteerGroup.deleteMany();
  await prisma.teamMember.deleteMany().catch(() => {});
  await prisma.team.deleteMany().catch(() => {});
  await prisma.shift.deleteMany();
  await prisma.category.deleteMany();
  await prisma.volunteer.deleteMany();
  await prisma.festivalSettings.deleteMany();

  console.log("Restoring festival settings...");
  await prisma.festivalSettings.create({
    data: {
      id: "main",
      festivalName: settings?.festivalName ?? "Harvest Beer Festival",
      festivalDate: settings?.festivalDate ?? null,
      festivalTime: settings?.festivalTime ?? null,
      contactEmail: settings?.contactEmail ?? null,
      contactPhone: settings?.contactPhone ?? null,
      welcomeMessage: settings?.welcomeMessage ?? null,
    },
  });

  console.log("✅ Done! All data cleared. Festival settings preserved:");
  console.log(`   Name: ${settings?.festivalName}`);
  console.log(`   Date: ${settings?.festivalDate}`);
  console.log(`   Time: ${settings?.festivalTime}`);
}

clear()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
