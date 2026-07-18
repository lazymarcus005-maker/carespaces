import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './configure-application';
import { configureSwagger } from './openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  configureSwagger(app);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
