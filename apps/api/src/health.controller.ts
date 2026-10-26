import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('/health')
  @Header('Cache-Control', 'no-store')
  getHealth() {
    return { status: 'ok' as const };
  }
}
