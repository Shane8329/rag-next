import "reflect-metadata";

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./modules/app.module";
import { loadDotEnv } from "./modules/system/env";

@Catch()
class LoggingExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(LoggingExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message = exception instanceof Error ? exception.message : String(exception);

    if (exception instanceof Error) {
      this.logger.error(exception.stack ?? exception.message);
    } else {
      this.logger.error(message);
    }

    response.status(status).json({
      statusCode: status,
      message
    });
  }
}

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalFilters(new LoggingExceptionFilter());
  await app.listen(3000);
}

void bootstrap();
