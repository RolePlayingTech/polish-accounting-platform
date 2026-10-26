import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { SystemStatusController } from './system-status.controller.js';

@Module({
  controllers: [HealthController, SystemStatusController],
})
export class AppModule {}
