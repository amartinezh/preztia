import { Body, Controller, Headers, Post } from '@nestjs/common';
import { GrantCreditHandler } from '@preztiaos/application';
import { grantCreditInput } from '@preztiaos/contracts';
import { CreditDrizzleRepository } from './credit.repository';

@Controller()
export class CreditController {
  private handler = new GrantCreditHandler(new CreditDrizzleRepository());
  @Post('credits')
  async grant(@Body() body: unknown, @Headers('x-tenant-id') tenantId: string) {
    const dto = grantCreditInput.parse(body); // validación con zod en la frontera
    // La moneda la fija el servidor por despliegue (Brasil → BRL), no el cliente.
    return this.handler.execute({
      ...dto,
      tenantId,
      currency: process.env.CREDIT_CURRENCY ?? 'COP',
    });
  }
}
