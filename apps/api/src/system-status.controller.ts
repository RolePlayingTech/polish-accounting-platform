import { Controller, Get, Header } from '@nestjs/common';
import { getSystemStatus } from '@pap/application';
import { SystemStatusSchema } from '@pap/contracts';

@Controller('/api/v1/system')
export class SystemStatusController {
  @Get('/status')
  @Header('Cache-Control', 'no-store')
  getStatus() {
    return SystemStatusSchema.parse(getSystemStatus());
  }
}
