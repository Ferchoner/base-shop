import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnvironment } from './config/environment.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Tests read their variables only from the process, so a local .env cannot change their results.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
