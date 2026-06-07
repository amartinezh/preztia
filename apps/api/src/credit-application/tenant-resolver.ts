import { Injectable } from "@nestjs/common";
import { type TenantResolver } from "@preztiaos/application";
import { resolveTenantByWhatsappPhone } from "../tenancy/unit-of-work";

/** Adaptador del puerto TenantResolver: resuelve el tenant por el phone_number_id. */
@Injectable()
export class WhatsappTenantResolver implements TenantResolver {
  resolveByChannel(channelId: string): Promise<string | null> {
    return resolveTenantByWhatsappPhone(channelId);
  }
}
