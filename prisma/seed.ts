import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

async function seed() {
  // Check if data already exists — never wipe existing data
  const existingSettings = await prisma.festivalSettings.findUnique({ where: { id: "main" } });
  const existingCategories = await prisma.category.count();

  if (existingSettings || existingCategories > 0) {
    console.log("Database already has data — skipping seed to preserve your settings and work.");
    console.log(`  - ${existingCategories} categories`);
    console.log(`  - ${await prisma.shift.count()} shifts`);
    console.log(`  - ${await prisma.volunteer.count()} volunteers`);
    console.log("To force a full reseed, run: npx prisma db push --force-reset && npx tsx prisma/seed.ts");
    return;
  }

  console.log("Seeding empty database...");

  // Festival Settings
  await prisma.festivalSettings.create({
    data: {
      id: "main",
      festivalName: "Harvest Beer Festival",
      festivalDate: "October 18, 2026",
      festivalTime: "2:00 PM - 10:00 PM",
      contactEmail: "volunteers@egrharvestfest.com",
      contactPhone: "(555) 123-4567",
      welcomeMessage:
        "Thank you for volunteering at our annual Harvest Beer Festival! Your help makes this community event possible. Please sign up for shifts below.",
    },
  });

  // Categories
  const [setUp, trash, pour, ice, supplies, kidsGames, vip, breakDown] = await Promise.all([
    prisma.category.create({ data: { name: "Set-Up", description: "Festival setup and preparation", sortOrder: 0, type: "one-time", stationCount: 1, volsPerStation: 10 } }),
    prisma.category.create({ data: { name: "Trash", description: "Waste management and cleanup during event", sortOrder: 1, type: "throughout", stationCount: 4, volsPerStation: 1 } }),
    prisma.category.create({ data: { name: "Pour", description: "Beer pouring and serving", sortOrder: 2, type: "throughout", stationCount: 15, volsPerStation: 2 } }),
    prisma.category.create({ data: { name: "Ice", description: "Ice delivery and management", sortOrder: 3, type: "throughout", stationCount: 2, volsPerStation: 1 } }),
    prisma.category.create({ data: { name: "Supplies", description: "Supply runs and inventory management", sortOrder: 4, type: "throughout", stationCount: 1, volsPerStation: 2 } }),
    prisma.category.create({ data: { name: "Kids Games", description: "Children's activity area supervision", sortOrder: 5, type: "throughout", stationCount: 3, volsPerStation: 2 } }),
    prisma.category.create({ data: { name: "VIP", description: "VIP area service and management", sortOrder: 6, type: "throughout", stationCount: 1, volsPerStation: 3 } }),
    prisma.category.create({ data: { name: "Break-Down", description: "Post-festival teardown and cleanup", sortOrder: 7, type: "one-time", stationCount: 1, volsPerStation: 10 } }),
  ]);

  // Shifts
  const festDate = "2026-10-18";

  const shifts = await Promise.all([
    prisma.shift.create({
      data: { title: "Setup Crew", description: "Help set up tents, tables, and decorations", date: new Date(festDate), startTime: "07:00", endTime: "11:00", capacity: 10, categoryId: setUp.id },
    }),
    prisma.shift.create({
      data: { title: "Gate Check - Morning", description: "Check IDs and wristbands at the entrance", date: new Date(festDate), startTime: "13:00", endTime: "17:00", capacity: 4, categoryId: supplies.id },
    }),
    prisma.shift.create({
      data: { title: "Gate Check - Evening", description: "Check IDs and wristbands at the entrance", date: new Date(festDate), startTime: "17:00", endTime: "22:00", capacity: 4, categoryId: supplies.id },
    }),
    prisma.shift.create({
      data: { title: "Beer Tent Server - Afternoon", description: "Serve beer samples and assist breweries", date: new Date(festDate), startTime: "14:00", endTime: "18:00", capacity: 8, categoryId: pour.id },
    }),
    prisma.shift.create({
      data: { title: "Beer Tent Server - Evening", description: "Serve beer samples and assist breweries", date: new Date(festDate), startTime: "18:00", endTime: "22:00", capacity: 8, categoryId: pour.id },
    }),
    prisma.shift.create({
      data: { title: "Food Court Helper", description: "Assist food vendors and keep area clean", date: new Date(festDate), startTime: "14:00", endTime: "22:00", capacity: 6, categoryId: supplies.id },
    }),
    prisma.shift.create({
      data: { title: "Trash Patrol", description: "Keep the festival grounds clean", date: new Date(festDate), startTime: "14:00", endTime: "22:00", capacity: 6, categoryId: trash.id },
    }),
    prisma.shift.create({
      data: { title: "Ice Runner", description: "Keep beer tents stocked with ice", date: new Date(festDate), startTime: "13:00", endTime: "22:00", capacity: 3, categoryId: ice.id },
    }),
    prisma.shift.create({
      data: { title: "Kids Zone Supervisor", description: "Run games and activities for children", date: new Date(festDate), startTime: "14:00", endTime: "20:00", capacity: 4, categoryId: kidsGames.id },
    }),
    prisma.shift.create({
      data: { title: "VIP Tent Host", description: "Manage VIP area, greet sponsors and special guests", date: new Date(festDate), startTime: "14:00", endTime: "22:00", capacity: 3, categoryId: vip.id },
    }),
    prisma.shift.create({
      data: { title: "Cleanup Crew", description: "Post-festival cleanup and breakdown", date: new Date(festDate), startTime: "22:00", endTime: "01:00", capacity: 15, categoryId: breakDown.id },
    }),
  ]);

  // Volunteers
  const volunteers = await Promise.all([
    prisma.volunteer.create({ data: { name: "Sarah Johnson", email: "sarah@example.com", phone: "+15551001001" } }),
    prisma.volunteer.create({ data: { name: "Mike Chen", email: "mike@example.com", phone: "+15551001002" } }),
    prisma.volunteer.create({ data: { name: "Emily Davis", email: "emily@example.com", phone: "+15551001003" } }),
    prisma.volunteer.create({ data: { name: "Tom Wilson", email: "tom@example.com", phone: "+15551001004" } }),
    prisma.volunteer.create({ data: { name: "Lisa Brown", email: "lisa@example.com", phone: "+15551001005" } }),
    prisma.volunteer.create({ data: { name: "David Martinez", email: "david@example.com", phone: "+15551001006" } }),
    prisma.volunteer.create({ data: { name: "Amy Taylor", email: "amy@example.com" } }),
    prisma.volunteer.create({ data: { name: "Chris Anderson", phone: "+15551001008" } }),
  ]);

  // Some assignments
  await Promise.all([
    prisma.assignment.create({ data: { volunteerId: volunteers[0].id, shiftId: shifts[0].id, assignedBy: "admin" } }),
    prisma.assignment.create({ data: { volunteerId: volunteers[1].id, shiftId: shifts[0].id, assignedBy: "self" } }),
    prisma.assignment.create({ data: { volunteerId: volunteers[2].id, shiftId: shifts[3].id, assignedBy: "self" } }),
    prisma.assignment.create({ data: { volunteerId: volunteers[3].id, shiftId: shifts[1].id, assignedBy: "admin" } }),
    prisma.assignment.create({ data: { volunteerId: volunteers[4].id, shiftId: shifts[5].id, assignedBy: "self" } }),
    prisma.assignment.create({ data: { volunteerId: volunteers[0].id, shiftId: shifts[10].id, assignedBy: "self" } }),
  ]);

  // A pair request
  await prisma.pairRequest.create({
    data: {
      requesterId: volunteers[2].id,
      partnerId: volunteers[5].id,
      message: "We'd like to serve at the beer tent together!",
      status: "pending",
    },
  });

  console.log("Database seeded successfully!");
  console.log(`  - ${await prisma.category.count()} categories`);
  console.log(`  - ${await prisma.shift.count()} shifts`);
  console.log(`  - ${await prisma.volunteer.count()} volunteers`);
  console.log(`  - ${await prisma.assignment.count()} assignments`);
  console.log(`  - ${await prisma.pairRequest.count()} pair requests`);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
