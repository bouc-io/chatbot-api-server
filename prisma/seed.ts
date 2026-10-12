// Load .env before the Prisma client module reads DATABASE_URL (Prisma 7 no longer loads it).
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('Start seeding...');

  const users = ['user-1', 'user-2'];
  const chatLimits = { 'user-1': 10, 'user-2': 5 };

  let defaultModel = await prisma.model.findFirst();
  if (!defaultModel) {
    defaultModel = await prisma.model.create({
      data: {
        name: 'Default Model',
        description: 'A default model for seeding',
        modelId: 'default-model',
      },
    });
    console.log('Created default model for seeding.');
  }

  for (const username of users) {
    const limit = chatLimits[username as keyof typeof chatLimits];
    const chatDate = new Date();

    for (let i = 0; i < limit; i++) {
      const chat = await prisma.chat.create({
        data: {
          username: username,
          createdAt: chatDate,
          title: `Chat for ${username} - ${i + 1}`,
          modelId: defaultModel.id,
        },
      });
      console.log(`Created chat ${chat.id} for ${username}`);

      const numMessages = Math.floor(Math.random() * 25) + 1; // 1 to 25 messages
      let currentRole: 'user' | 'assistant' = 'user';

      for (let j = 0; j < numMessages; j++) {
        await prisma.message.create({
          data: {
            chatId: chat.id,
            role: currentRole,
            content: `This is a message from ${currentRole} in chat ${chat.id}, message ${j + 1}.`,
            username: username,
          },
        });
        currentRole = currentRole === 'user' ? 'assistant' : 'user'; // Alternate roles
      }
      console.log(`  Added ${numMessages} messages to chat ${chat.id}`);

      chatDate.setDate(chatDate.getDate() + 1); // Add one day for the next chat
    }
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
