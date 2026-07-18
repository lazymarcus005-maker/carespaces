import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { createOpenApiDocument } from '../src/openapi';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  const document = createOpenApiDocument(app);
  const output = resolve('docs/openapi.json');
  await mkdir(resolve('docs'), { recursive: true });
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
