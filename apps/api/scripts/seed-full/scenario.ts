import type { schema } from '@preztiaos/db';
import type {
  ClientLanguage,
  CommissionBase,
  MessagingChannelsSettings,
  OperationalSettings,
  RequiredDocumentType,
  Role,
  ScheduleFrequency,
} from '@preztiaos/domain';
import type { PayerProfile } from './model';

// ESCENARIOS de los tenants sembrados: solo datos, sin lógica. El principal replica la estructura
// real de producción (BRL, America/Sao_Paulo, zonas Minas Gerais / São Paulo, usuarios
// @preztia.co); los otros dos cubren el multi-tenant (Colombia en COP) y un tenant SUSPENDIDO.

export const MAIN_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const CO_TENANT_ID = '00000000-0000-0000-0000-000000000002';
export const SUSPENDED_TENANT_ID = '00000000-0000-0000-0000-000000000003';

/** Reales/pesos → unidades menores (centavos). */
export const minor = (units: number): number => Math.round(units * 100);

export interface ZoneSpec {
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly parentKey?: string;
  /** Clave de `CITIES` (solo zonas hoja con operación). */
  readonly city?: string;
  readonly supportPhone?: string;
  readonly commission?: {
    readonly ratePerMille: number;
    readonly base: CommissionBase;
  };
}

export interface UserSpec {
  readonly key: string;
  readonly email: string;
  readonly role: Role;
  readonly zoneKeys: readonly string[];
  readonly active?: boolean;
}

export interface BankAccountSpec {
  readonly key: string;
  readonly label: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly countryCode: string;
  readonly bankCode: string;
  readonly providerType: 'MANUAL' | 'INTER' | 'MERCADOPAGO' | 'PICPAY';
  readonly pixKey: string | null;
  readonly receiverName: string | null;
  readonly unverifiedPolicy: 'HOLD' | 'ALLOCATE';
  readonly verifyPaymentsEnabled: boolean;
  readonly balanceCheckEnabled: boolean;
  /** API key única (Inter). */
  readonly apiKey?: string;
  /** Secretos nombrados (Mercado Pago, PicPay); se cifran al sembrar. */
  readonly credentials?: Readonly<Record<string, string>>;
  readonly reportConfig?: Readonly<Record<string, unknown>>;
}

export interface BoxSpec {
  readonly key: string;
  readonly type: 'CASH' | 'BANK' | 'TRANSIT';
  readonly name: string;
  readonly zoneKey?: string;
  readonly bankAccountKey?: string;
  readonly assignedToKey?: string;
  readonly active?: boolean;
  /** Saldo de apertura (arqueo + ajuste el día anterior al inicio de la liquidación). */
  readonly openingMinor?: number;
}

export interface PlanSpec {
  readonly key: string;
  readonly name: string;
  readonly installmentsCount: number;
  readonly frequency: ScheduleFrequency;
  readonly interestPct: number;
  readonly isActive: boolean;
  readonly isDefault?: boolean;
  /** Peso relativo al elegir el plan de un crédito nuevo (0 = nunca). */
  readonly weight: number;
}

export interface DocumentSpec {
  readonly key: RequiredDocumentType;
  readonly title: string;
  readonly description: string;
  readonly expectedFiles?: number;
  readonly active?: boolean;
}

/** Cobrador con su ruta: zona, caja de ruta, caja de oficina que recibe sus rendiciones. */
export interface CollectorSpec {
  readonly userKey: string;
  readonly zoneKey: string;
  readonly routeBoxKey: string;
  readonly officeBoxKey: string;
  /** Mezcla de perfiles de pago de su cartera (uno por cliente, en orden). */
  readonly profiles: readonly PayerProfile[];
  /** Estilo de rendición: puntual, con atrasos y faltantes, o con consignaciones. */
  readonly style: 'EXACT' | 'LATE_AND_SHORT' | 'DEPOSITS' | 'SHORT_ONCE';
  /** Semana (desde el inicio) en la que se retira; sus clientes pasan a `handoverTo`. */
  readonly retiresAfterWeek?: number;
  readonly handoverTo?: string;
}

export interface TenantScenario {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly currency: string;
  readonly language: ClientLanguage;
  readonly countryCode: 'BR' | 'CO';
  readonly operational: Partial<OperationalSettings>;
  readonly reminder: schema.CollectionReminderSettings;
  readonly messaging: MessagingChannelsSettings;
  readonly knowledgeBase: string;
  readonly zones: readonly ZoneSpec[];
  readonly users: readonly UserSpec[];
  readonly coordinatorZones: ReadonlyArray<readonly [string, string]>;
  readonly bankAccounts: readonly BankAccountSpec[];
  readonly boxes: readonly BoxSpec[];
  readonly plans: readonly PlanSpec[];
  readonly documents: readonly DocumentSpec[];
  readonly collectors: readonly CollectorSpec[];
  /** Semanas de historia simulada (0 = tenant sin operación). */
  readonly historyWeeks: number;
  /** Montos de capital ofrecidos (unidades menores). */
  readonly principalOptions: readonly number[];
  /** Canales de demostración (solo si no hay canales reales que conservar). */
  readonly demoWhatsapp: ReadonlyArray<{
    zoneKey: string;
    phoneNumberId: string;
  }>;
  readonly demoTelegram?: { zoneKey: string; botId: string; username: string };
  readonly features: {
    readonly pix: boolean;
    readonly applications: boolean;
    readonly migrations: boolean;
    readonly deposits: boolean;
    readonly routes: boolean;
    readonly commissions: boolean;
  };
}

const MAIN_KNOWLEDGE_BASE = `
# Base de Conhecimento — Preztia (empréstimo para quem tem negócio)

## 1. Produto
* Empréstimo rápido, fácil e seguro para donos de comércio e prestadores de serviço.
* Exclusivo para quem tem negócio próprio (loja, salão, oficina, lanchonete, ambulante, motorista de aplicativo).
* Atendimento por WhatsApp e Telegram. Pagamento por PIX ou em dinheiro com o cobrador da sua região.

## 2. Requisitos
1. Documento de identidade com foto (frente e verso).
2. Comprovante do negócio (Cartão CNPJ, MEI ou alvará).
3. Foto atual da fachada ou do interior do negócio.
4. Conta de luz, água ou gás recente com o endereço.
* No momento da solicitação, compartilhe sua localização em tempo real (no negócio ou em casa).

## 3. Planos de pagamento (valores em R$)
* 11 parcelas diárias (juros de 10%) · 20 parcelas diárias (20%) · 24 parcelas diárias (20%).
* 4 parcelas semanais (20%) · 8 parcelas semanais (30%) · 4 parcelas quinzenais (25%) · 3 parcelas mensais (30%).

| Valor | 11 diárias | 20 diárias | 24 diárias |
| :--- | :--- | :--- | :--- |
| R$ 200,00 | R$ 20,00 | R$ 12,00 | R$ 10,00 |
| R$ 500,00 | R$ 50,00 | R$ 30,00 | R$ 25,00 |
| R$ 1.000,00 | R$ 100,00 | R$ 60,00 | R$ 50,00 |
| R$ 2.000,00 | R$ 200,00 | R$ 120,00 | R$ 100,00 |

## 4. Regras para o assistente
* Valor mínimo R$ 200,00 e máximo R$ 3.000,00 no primeiro crédito.
* Para pagar: PIX para a chave pix@preztia.co e envie a foto do comprovante neste chat.
* Dúvidas fora deste conteúdo: encaminhe para o atendimento humano da sua região.
`.trim();

const CO_KNOWLEDGE_BASE = `
# Base de conocimiento — Créditos Antioquia (demo)

* Crédito para dueños de negocio en Medellín y Envigado. Cobro diario en efectivo con el cobrador de la ruta.
* Requisitos: cédula (ambos lados), certificado del negocio (RUT o Cámara de Comercio) y recibo de servicios.
* Planes: 20 cuotas diarias (20 %), 30 cuotas diarias (25 %), 6 cuotas semanales (20 %), 2 cuotas mensuales (15 %).
* Montos: desde $ 200.000 hasta $ 2.000.000. Atención humana: (604) 444-0000.
`.trim();

const BR_DOCUMENTS: readonly DocumentSpec[] = [
  {
    key: 'IDENTITY_DOCUMENT',
    title: 'Envie uma foto do seu documento de identidade (frente e verso).',
    description: 'RG, CNH ou CIN com foto, legível, frente e verso.',
    expectedFiles: 2,
  },
  {
    key: 'BUSINESS_VALIDITY_CERTIFICATE',
    title: 'Envie o comprovante do seu negócio (Cartão CNPJ, MEI ou alvará).',
    description:
      'Documento que acredita o negócio: Cartão CNPJ, certificado MEI ou alvará.',
  },
  {
    key: 'BUSINESS_PHOTO',
    title: 'Envie uma foto atual da fachada ou do interior do seu negócio.',
    description: 'Foto do local (letreiro, balcão ou interior) tirada hoje.',
  },
  {
    key: 'PUBLIC_SERVICES_RECEIPT',
    title: 'Envie uma conta de luz, água ou gás recente.',
    description:
      'Conta de serviço público dos últimos 3 meses com o endereço visível.',
  },
  {
    key: 'BANK_STATEMENT',
    title: 'Envie um extrato bancário dos últimos 3 meses.',
    description: 'Extrato bancário em PDF ou foto legível.',
    active: false,
  },
  {
    key: 'INCOME_PROOF',
    title: 'Envie um comprovante de renda.',
    description: 'Comprovante de faturamento do negócio.',
    active: false,
  },
];

const CO_DOCUMENTS: readonly DocumentSpec[] = [
  {
    key: 'IDENTITY_DOCUMENT',
    title: 'Envía una foto de tu cédula (ambos lados).',
    description: 'Cédula de ciudadanía legible, anverso y reverso.',
    expectedFiles: 2,
  },
  {
    key: 'BUSINESS_VALIDITY_CERTIFICATE',
    title: 'Envía el RUT o el certificado de Cámara de Comercio de tu negocio.',
    description: 'Documento que acredita el negocio.',
  },
  {
    key: 'PUBLIC_SERVICES_RECEIPT',
    title: 'Envía un recibo de servicios públicos reciente.',
    description: 'Recibo de EPM (agua, luz o gas) con la dirección visible.',
  },
];

export const MAIN_SCENARIO: TenantScenario = {
  id: MAIN_TENANT_ID,
  name: 'Preztia',
  slug: 'preztia-tenant',
  status: 'ACTIVE',
  currency: 'BRL',
  language: 'pt-BR',
  countryCode: 'BR',
  operational: {
    timeZone: 'America/Sao_Paulo',
    blockBackdatedPayments: true,
    backdateMaxDays: 3,
    blockInterestChange: true,
    adminCustomInterestAllowed: true,
    commissionsEnabled: true,
    commissionPctBaseThousand: 30,
    commissionBase: 'COLLECTED',
    commissionMaxPctBaseThousand: 60,
    defaultCreditLimitMinor: minor(3000),
    applyColorByOverdue: true,
    clientChoosesPlan: false,
    planOfferTtlHours: 24,
    allowAdminOverride: true,
    autoConfirmSettlement: false,
    visitOverdueThreshold: 3,
    remittanceDeadlineHourLocal: 20,
    settlementFrequency: 'WEEKLY',
    settlementAnchorDay: 1,
    settlementAutoClose: true,
  },
  // Apagado a propósito: con canales reales en producción, un recordatorio automático le
  // escribiría a los teléfonos de prueba. Se enciende desde Ajustes cuando se quiera probar.
  reminder: { enabled: false, sendHourLocal: 8, pixKey: 'pix@preztia.co' },
  messaging: {
    whatsappEnabled: true,
    telegramEnabled: true,
    preferredProactiveChannel: 'WHATSAPP',
  },
  knowledgeBase: MAIN_KNOWLEDGE_BASE,
  zones: [
    {
      key: 'mg',
      path: 'minas_gerais',
      name: 'Minas Gerais',
      supportPhone: '+55 37 3222-0000',
      commission: { ratePerMille: 30, base: 'COLLECTED' },
    },
    {
      key: 'div',
      path: 'minas_gerais.divinopolis',
      name: 'Divinópolis',
      parentKey: 'mg',
      city: 'divinopolis',
      supportPhone: '+55 37 3222-0000',
    },
    // Configurada por encima del tope vigente (el ADMIN lo bajó después): se recorta al tope.
    {
      key: 'bh',
      path: 'minas_gerais.belo_horizonte',
      name: 'Belo Horizonte',
      parentKey: 'mg',
      city: 'belo_horizonte',
      supportPhone: '+55 31 3333-0000',
      commission: { ratePerMille: 80, base: 'COLLECTED' },
    },
    {
      key: 'ctg',
      path: 'minas_gerais.contagem',
      name: 'Contagem (nueva, sin operación)',
      parentKey: 'mg',
      city: 'contagem',
    },
    {
      key: 'sp',
      path: 'sao_paulo',
      name: 'São Paulo',
      supportPhone: '+55 11 4000-0000',
      commission: { ratePerMille: 50, base: 'REMITTED' },
    },
    {
      key: 'spc',
      path: 'sao_paulo.sao_paulo_capital',
      name: 'São Paulo Capital',
      parentKey: 'sp',
      city: 'sao_paulo_capital',
      supportPhone: '+55 11 4000-0000',
    },
    {
      key: 'cps',
      path: 'sao_paulo.campinas',
      name: 'Campinas',
      parentKey: 'sp',
      city: 'campinas',
      supportPhone: '+55 19 3000-0000',
      commission: { ratePerMille: 40, base: 'PRINCIPAL_RECOVERED' },
    },
  ],
  users: [
    { key: 'admin', email: 'admin@preztia.co', role: 'ADMIN', zoneKeys: [] },
    {
      key: 'coordMg',
      email: 'coordinador.mg@preztia.co',
      role: 'COORDINATOR',
      zoneKeys: ['mg'],
    },
    {
      key: 'coordSp',
      email: 'coordinador.sp@preztia.co',
      role: 'COORDINATOR',
      zoneKeys: ['sp'],
    },
    {
      key: 'cobDiv',
      email: 'cobrador.divinopolis@preztia.co',
      role: 'COLLECTOR',
      zoneKeys: ['div'],
    },
    {
      key: 'cobBh',
      email: 'cobrador.bh@preztia.co',
      role: 'COLLECTOR',
      zoneKeys: ['bh'],
    },
    {
      key: 'cobSp',
      email: 'cobrador.saopaulo@preztia.co',
      role: 'COLLECTOR',
      zoneKeys: ['spc'],
    },
    {
      key: 'cobCps',
      email: 'cobrador.campinas@preztia.co',
      role: 'COLLECTOR',
      zoneKeys: ['cps'],
    },
    {
      key: 'cobRet',
      email: 'cobrador.retirado@preztia.co',
      role: 'COLLECTOR',
      zoneKeys: ['bh'],
    },
  ],
  coordinatorZones: [
    ['coordMg', 'mg'],
    ['coordSp', 'sp'],
  ],
  bankAccounts: [
    {
      key: 'picpay',
      label: 'PicPay Recaudo',
      bankName: 'PicPay',
      accountNumber: 'PicPay Empresas 1234567-8',
      countryCode: 'BR',
      bankCode: 'PICPAY',
      providerType: 'PICPAY',
      pixKey: 'pix@preztia.co',
      receiverName: 'PREZTIA SERVICOS FINANCEIROS LTDA',
      unverifiedPolicy: 'HOLD',
      verifyPaymentsEnabled: true,
      balanceCheckEnabled: false,
      credentials: {
        client_id: 'picpay-demo-client-id',
        client_secret: 'picpay-demo-client-secret',
        webhook_secret: 'picpay-demo-webhook-token',
      },
    },
    {
      key: 'inter',
      label: 'Inter Tesouraria',
      bankName: 'Banco Inter',
      accountNumber: '0001 / 1234567-0',
      countryCode: 'BR',
      bankCode: 'INTER',
      providerType: 'INTER',
      pixKey: 'tesouraria@preztia.co',
      receiverName: 'PREZTIA SERVICOS FINANCEIROS LTDA',
      unverifiedPolicy: 'HOLD',
      verifyPaymentsEnabled: true,
      balanceCheckEnabled: true,
      apiKey: 'INTER_SANDBOX_API_KEY_REPLACE_ME',
    },
    {
      key: 'mp',
      label: 'Mercado Pago',
      bankName: 'Mercado Pago',
      accountNumber: 'MP 998877',
      countryCode: 'BR',
      bankCode: 'MERCADOPAGO',
      providerType: 'MERCADOPAGO',
      pixKey: 'mp@preztia.co',
      receiverName: 'PREZTIA SERVICOS FINANCEIROS LTDA',
      unverifiedPolicy: 'HOLD',
      verifyPaymentsEnabled: false,
      balanceCheckEnabled: false,
      credentials: {
        public_key: 'APP_USR-demo-public-key',
        access_token: 'APP_USR-demo-access-token',
        webhook_secret: 'mp-demo-webhook-secret',
      },
      reportConfig: {
        prefix: 'preztia-settlement',
        reportTranslation: 'pt',
        timezone: 'America/Sao_Paulo',
        windowDays: 3,
      },
    },
    {
      key: 'caixa',
      label: 'Caixa Econômica (manual)',
      bankName: 'Caixa Econômica Federal',
      accountNumber: '0123 / 00045678-9',
      countryCode: 'BR',
      bankCode: 'CAIXA',
      providerType: 'MANUAL',
      pixKey: null,
      receiverName: null,
      unverifiedPolicy: 'ALLOCATE',
      verifyPaymentsEnabled: false,
      balanceCheckEnabled: false,
    },
  ],
  boxes: [
    {
      key: 'bankPicpay',
      type: 'BANK',
      name: 'PicPay Recaudo',
      bankAccountKey: 'picpay',
      openingMinor: minor(15000),
    },
    {
      key: 'bankInter',
      type: 'BANK',
      name: 'Inter Tesouraria',
      bankAccountKey: 'inter',
      openingMinor: minor(80000),
    },
    {
      key: 'bankMp',
      type: 'BANK',
      name: 'Mercado Pago',
      bankAccountKey: 'mp',
      openingMinor: minor(3000),
    },
    {
      key: 'bankCaixa',
      type: 'BANK',
      name: 'Caixa (manual)',
      bankAccountKey: 'caixa',
      openingMinor: minor(5000),
    },
    { key: 'transit', type: 'TRANSIT', name: 'Fondos en Tránsito' },
    {
      key: 'officeMg',
      type: 'CASH',
      name: 'Efectivo Minas Gerais',
      zoneKey: 'mg',
      openingMinor: minor(15000),
    },
    {
      key: 'officeSp',
      type: 'CASH',
      name: 'Efectivo São Paulo',
      zoneKey: 'sp',
      openingMinor: minor(15000),
    },
    {
      key: 'petty',
      type: 'CASH',
      name: 'Caja Menor Oficina',
      openingMinor: minor(2000),
    },
    {
      key: 'routeDiv',
      type: 'CASH',
      name: 'Ruta Divinópolis',
      zoneKey: 'div',
      assignedToKey: 'cobDiv',
    },
    {
      key: 'routeBh',
      type: 'CASH',
      name: 'Ruta Belo Horizonte',
      zoneKey: 'bh',
      assignedToKey: 'cobBh',
    },
    {
      key: 'routeSp',
      type: 'CASH',
      name: 'Ruta São Paulo Capital',
      zoneKey: 'spc',
      assignedToKey: 'cobSp',
    },
    {
      key: 'routeCps',
      type: 'CASH',
      name: 'Ruta Campinas',
      zoneKey: 'cps',
      assignedToKey: 'cobCps',
    },
    {
      key: 'routeRet',
      type: 'CASH',
      name: 'Ruta BH 2 (cobrador retirado)',
      zoneKey: 'bh',
      assignedToKey: 'cobRet',
    },
    {
      key: 'legacy',
      type: 'CASH',
      name: 'Caja antigua (desactivada)',
      active: false,
    },
  ],
  plans: [
    {
      key: 'd11',
      name: '11 parcelas diárias · 10%',
      installmentsCount: 11,
      frequency: 'DAILY',
      interestPct: 100,
      isActive: true,
      weight: 2,
    },
    {
      key: 'd20',
      name: '20 parcelas diárias · 20%',
      installmentsCount: 20,
      frequency: 'DAILY',
      interestPct: 200,
      isActive: true,
      isDefault: true,
      weight: 6,
    },
    {
      key: 'd24',
      name: '24 parcelas diárias · 20%',
      installmentsCount: 24,
      frequency: 'DAILY',
      interestPct: 200,
      isActive: true,
      weight: 3,
    },
    {
      key: 'w4',
      name: '4 parcelas semanais · 20%',
      installmentsCount: 4,
      frequency: 'WEEKLY',
      interestPct: 200,
      isActive: true,
      weight: 1,
    },
    {
      key: 'w8',
      name: '8 parcelas semanais · 30%',
      installmentsCount: 8,
      frequency: 'WEEKLY',
      interestPct: 300,
      isActive: true,
      weight: 1,
    },
    {
      key: 'b4',
      name: '4 parcelas quinzenais · 25%',
      installmentsCount: 4,
      frequency: 'BIWEEKLY',
      interestPct: 250,
      isActive: true,
      weight: 1,
    },
    {
      key: 'm3',
      name: '3 parcelas mensais · 30%',
      installmentsCount: 3,
      frequency: 'MONTHLY',
      interestPct: 300,
      isActive: true,
      weight: 1,
    },
    {
      key: 't10',
      name: '10 parcelas (teste) · 10%',
      installmentsCount: 10,
      frequency: 'DAILY',
      interestPct: 100,
      isActive: false,
      weight: 0,
    },
    {
      key: 't15',
      name: '15 parcelas (teste) · 20%',
      installmentsCount: 15,
      frequency: 'DAILY',
      interestPct: 200,
      isActive: false,
      weight: 0,
    },
  ],
  documents: BR_DOCUMENTS,
  collectors: [
    {
      userKey: 'cobDiv',
      zoneKey: 'div',
      routeBoxKey: 'routeDiv',
      officeBoxKey: 'officeMg',
      style: 'EXACT',
      profiles: [
        'PUNCTUAL',
        'PUNCTUAL',
        'PIX',
        'LATE',
        'PUNCTUAL',
        'DEFAULTER',
        'PARTIAL',
        'PIX',
        'SETTLER',
        'PUNCTUAL',
        'LATE',
        'DEFAULTER',
        'PUNCTUAL',
        'PIX',
        'PUNCTUAL',
        'LATE',
      ],
    },
    {
      userKey: 'cobBh',
      zoneKey: 'bh',
      routeBoxKey: 'routeBh',
      officeBoxKey: 'officeMg',
      style: 'LATE_AND_SHORT',
      profiles: [
        'PUNCTUAL',
        'PIX',
        'LATE',
        'DEFAULTER',
        'PUNCTUAL',
        'PARTIAL',
        'PIX',
        'PUNCTUAL',
        'LATE',
        'SETTLER',
      ],
    },
    {
      userKey: 'cobRet',
      zoneKey: 'bh',
      routeBoxKey: 'routeRet',
      officeBoxKey: 'officeMg',
      style: 'SHORT_ONCE',
      profiles: ['PUNCTUAL', 'LATE', 'DEFAULTER', 'PUNCTUAL'],
      retiresAfterWeek: 4,
      handoverTo: 'cobBh',
    },
    {
      userKey: 'cobSp',
      zoneKey: 'spc',
      routeBoxKey: 'routeSp',
      officeBoxKey: 'officeSp',
      style: 'DEPOSITS',
      profiles: [
        'PUNCTUAL',
        'PIX',
        'PUNCTUAL',
        'LATE',
        'DEFAULTER',
        'PIX',
        'PUNCTUAL',
        'PARTIAL',
        'SETTLER',
        'PUNCTUAL',
        'LATE',
        'PIX',
        'PUNCTUAL',
        'DEFAULTER',
      ],
    },
    {
      userKey: 'cobCps',
      zoneKey: 'cps',
      routeBoxKey: 'routeCps',
      officeBoxKey: 'officeSp',
      style: 'SHORT_ONCE',
      profiles: [
        'PUNCTUAL',
        'PUNCTUAL',
        'PIX',
        'LATE',
        'DEFAULTER',
        'PUNCTUAL',
        'PARTIAL',
        'PIX',
        'PUNCTUAL',
        'LATE',
        'SETTLER',
        'PUNCTUAL',
      ],
    },
  ],
  historyWeeks: 10,
  principalOptions: [
    minor(200),
    minor(300),
    minor(400),
    minor(500),
    minor(800),
    minor(1000),
    minor(1500),
    minor(2000),
  ],
  demoWhatsapp: [
    {
      zoneKey: 'div',
      phoneNumberId:
        process.env.SEED_WHATSAPP_PHONE_NUMBER_ID ?? '1108588789011965',
    },
    { zoneKey: 'spc', phoneNumberId: '900000000000101' },
    { zoneKey: 'cps', phoneNumberId: '900000000000102' },
  ],
  demoTelegram: {
    zoneKey: 'bh',
    botId: '7000000001',
    username: 'preztia_bh_demo_bot',
  },
  features: {
    pix: true,
    applications: true,
    migrations: true,
    deposits: true,
    routes: true,
    commissions: true,
  },
};

export const CO_SCENARIO: TenantScenario = {
  id: CO_TENANT_ID,
  name: 'Créditos Antioquia (demo)',
  slug: 'creditos-antioquia-demo',
  status: 'ACTIVE',
  currency: 'COP',
  language: 'es',
  countryCode: 'CO',
  operational: {
    timeZone: 'America/Bogota',
    blockBackdatedPayments: false,
    backdateMaxDays: 5,
    relaxedPaymentDates: true,
    blockInterestChange: false,
    commissionsEnabled: false,
    defaultCreditLimitMinor: 0,
    applyColorByOverdue: false,
    clientChoosesPlan: true,
    planOfferTtlHours: 48,
    allowAdminOverride: false,
    visitOverdueThreshold: 4,
    remittanceDeadlineHourLocal: 19,
    settlementFrequency: 'MONTHLY',
    settlementAnchorDay: 1,
    settlementAutoClose: true,
  },
  reminder: { enabled: false, sendHourLocal: 7, pixKey: null },
  messaging: {
    whatsappEnabled: true,
    telegramEnabled: false,
    preferredProactiveChannel: 'WHATSAPP',
  },
  knowledgeBase: CO_KNOWLEDGE_BASE,
  zones: [
    {
      key: 'ant',
      path: 'antioquia',
      name: 'Antioquia',
      supportPhone: '(604) 444-0000',
    },
    {
      key: 'med',
      path: 'antioquia.medellin',
      name: 'Medellín',
      parentKey: 'ant',
      city: 'medellin',
      supportPhone: '(604) 444-0000',
    },
    {
      key: 'env',
      path: 'antioquia.envigado',
      name: 'Envigado',
      parentKey: 'ant',
      city: 'envigado',
    },
  ],
  users: [
    {
      key: 'admin',
      email: 'admin.antioquia@preztia.co',
      role: 'ADMIN',
      zoneKeys: [],
    },
    {
      key: 'coord',
      email: 'coordinador.antioquia@preztia.co',
      role: 'COORDINATOR',
      zoneKeys: ['ant'],
    },
    {
      key: 'cobMed',
      email: 'cobrador.medellin@preztia.co',
      role: 'COLLECTOR',
      zoneKeys: ['med'],
    },
    {
      key: 'cobEnv',
      email: 'cobrador.envigado@preztia.co',
      role: 'COLLECTOR',
      zoneKeys: ['env'],
    },
  ],
  coordinatorZones: [['coord', 'ant']],
  bankAccounts: [
    {
      key: 'bancolombia',
      label: 'Bancolombia Ahorros',
      bankName: 'Bancolombia',
      accountNumber: '123-456789-01',
      countryCode: 'CO',
      bankCode: 'BANCOLOMBIA',
      providerType: 'MANUAL',
      pixKey: null,
      receiverName: null,
      unverifiedPolicy: 'HOLD',
      verifyPaymentsEnabled: false,
      balanceCheckEnabled: false,
    },
  ],
  boxes: [
    {
      key: 'bank',
      type: 'BANK',
      name: 'Bancolombia Ahorros',
      bankAccountKey: 'bancolombia',
      openingMinor: minor(40_000_000),
    },
    { key: 'transit', type: 'TRANSIT', name: 'Fondos en Tránsito' },
    {
      key: 'office',
      type: 'CASH',
      name: 'Efectivo Antioquia',
      zoneKey: 'ant',
      openingMinor: minor(15_000_000),
    },
    {
      key: 'petty',
      type: 'CASH',
      name: 'Caja Menor',
      openingMinor: minor(500_000),
    },
    {
      key: 'routeMed',
      type: 'CASH',
      name: 'Ruta Medellín',
      zoneKey: 'med',
      assignedToKey: 'cobMed',
    },
    {
      key: 'routeEnv',
      type: 'CASH',
      name: 'Ruta Envigado',
      zoneKey: 'env',
      assignedToKey: 'cobEnv',
    },
  ],
  plans: [
    {
      key: 'd20',
      name: 'Diario 20 cuotas · 20%',
      installmentsCount: 20,
      frequency: 'DAILY',
      interestPct: 200,
      isActive: true,
      isDefault: true,
      weight: 4,
    },
    {
      key: 'd30',
      name: 'Diario 30 cuotas · 25%',
      installmentsCount: 30,
      frequency: 'DAILY',
      interestPct: 250,
      isActive: true,
      weight: 2,
    },
    {
      key: 'w6',
      name: 'Semanal 6 cuotas · 20%',
      installmentsCount: 6,
      frequency: 'WEEKLY',
      interestPct: 200,
      isActive: true,
      weight: 1,
    },
    {
      key: 'm2',
      name: 'Mensual 2 cuotas · 15%',
      installmentsCount: 2,
      frequency: 'MONTHLY',
      interestPct: 150,
      isActive: true,
      weight: 1,
    },
  ],
  documents: CO_DOCUMENTS,
  collectors: [
    {
      userKey: 'cobMed',
      zoneKey: 'med',
      routeBoxKey: 'routeMed',
      officeBoxKey: 'office',
      style: 'EXACT',
      profiles: [
        'PUNCTUAL',
        'LATE',
        'PUNCTUAL',
        'DEFAULTER',
        'PARTIAL',
        'PUNCTUAL',
        'LATE',
        'PUNCTUAL',
      ],
    },
    {
      userKey: 'cobEnv',
      zoneKey: 'env',
      routeBoxKey: 'routeEnv',
      officeBoxKey: 'office',
      style: 'SHORT_ONCE',
      profiles: [
        'PUNCTUAL',
        'PUNCTUAL',
        'DEFAULTER',
        'LATE',
        'PUNCTUAL',
        'PARTIAL',
      ],
    },
  ],
  historyWeeks: 9,
  principalOptions: [
    minor(200_000),
    minor(300_000),
    minor(500_000),
    minor(800_000),
    minor(1_000_000),
    minor(1_500_000),
  ],
  demoWhatsapp: [{ zoneKey: 'med', phoneNumberId: '900000000000201' }],
  features: {
    pix: false,
    applications: true,
    migrations: false,
    deposits: false,
    routes: true,
    commissions: false,
  },
};

export const SUSPENDED_SCENARIO: TenantScenario = {
  id: SUSPENDED_TENANT_ID,
  name: 'Financiera Norte (suspendida)',
  slug: 'financiera-norte-suspendida',
  status: 'SUSPENDED',
  currency: 'BRL',
  language: 'pt-BR',
  countryCode: 'BR',
  operational: { timeZone: 'America/Sao_Paulo' },
  reminder: { enabled: false, sendHourLocal: 7, pixKey: null },
  messaging: {
    whatsappEnabled: true,
    telegramEnabled: false,
    preferredProactiveChannel: 'WHATSAPP',
  },
  knowledgeBase:
    'Tenant suspendido por falta de pago de la suscripción (dato de prueba).',
  zones: [{ key: 'norte', path: 'norte', name: 'Norte' }],
  users: [
    {
      key: 'admin',
      email: 'admin.suspendida@preztia.co',
      role: 'ADMIN',
      zoneKeys: [],
    },
  ],
  coordinatorZones: [],
  bankAccounts: [],
  boxes: [{ key: 'office', type: 'CASH', name: 'Caja Principal' }],
  plans: [
    {
      key: 'd20',
      name: '20 parcelas diárias · 20%',
      installmentsCount: 20,
      frequency: 'DAILY',
      interestPct: 200,
      isActive: true,
      isDefault: true,
      weight: 1,
    },
  ],
  documents: BR_DOCUMENTS.slice(0, 4),
  collectors: [],
  historyWeeks: 0,
  principalOptions: [],
  demoWhatsapp: [],
  features: {
    pix: false,
    applications: false,
    migrations: false,
    deposits: false,
    routes: false,
    commissions: false,
  },
};

export const SCENARIOS: readonly TenantScenario[] = [
  MAIN_SCENARIO,
  CO_SCENARIO,
  SUSPENDED_SCENARIO,
];

/** SUPER_ADMIN del plano de control (sin tenant). */
export const SUPER_ADMIN_EMAIL = 'super@preztia.co';
