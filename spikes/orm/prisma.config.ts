import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url:
      process.env.PRISMA_SPIKE_DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:5433/carespaces_prisma',
  },
});
