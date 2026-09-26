process.env.JWT_SECRET = 'test-secret-please-change';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { NewExpense } from '@preztiaos/application';
import { RECEIPT_MAX_BYTES } from '@preztiaos/domain';
import { signToken, TOKEN_TTL } from '../auth/jwt';
import { JwtGuard } from '../auth/jwt.guard';
import { DomainExceptionFilter } from '../shared/domain-exception.filter';
import { ZodExceptionFilter } from '../shared/zod-exception.filter';
import { CashController } from './cash.controller';
import { ExpenseDrizzleRepository } from './expense.repository';
import { CashQueryRepository } from './cash-query.repository';
import { MinioExpenseReceiptStorage } from './expense-receipt.storage';

// Prueba HTTP REAL del multipart de la solicitud de gasto (multer + FileInterceptor): verifica que
// el archivo y los campos llegan intactos, que multer corta el tamaño máximo (413) y que sin
// archivo el dominio responde 400. Sin BD ni MinIO: el almacén y el storage son dobles de prueba.
const TENANT = '11111111-1111-1111-1111-111111111111';
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

const bearer = `Bearer ${signToken(
  {
    sub: '22222222-2222-2222-2222-222222222222',
    tenantId: TENANT,
    role: 'COLLECTOR',
    zonePaths: ['norte'],
    typ: 'access',
  },
  TOKEN_TTL.access,
)}`;

describe('POST /expenses (multipart real)', () => {
  let app: INestApplication<App>;
  const created: NewExpense[] = [];
  const stored: { bytes: Uint8Array; mimeType: string }[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CashController],
      providers: [
        {
          provide: ExpenseDrizzleRepository,
          useValue: {
            create: (e: NewExpense) => Promise.resolve(void created.push(e)),
          },
        },
        { provide: CashQueryRepository, useValue: {} },
        {
          provide: MinioExpenseReceiptStorage,
          useValue: {
            store: (input: { bytes: Uint8Array; mimeType: string }) => {
              stored.push(input);
              return Promise.resolve({
                storageKey: 'k',
                mimeType: input.mimeType,
                sha256: 's',
              });
            },
          },
        },
      ],
    })
      // El guard real valida el JWT contra la BD de tenants; aquí basta con la sesión del token.
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainExceptionFilter(), new ZodExceptionFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  it('recibe la foto y los campos intactos', async () => {
    await request(app.getHttpServer())
      .post('/expenses')
      .set('x-tenant-id', TENANT)
      .set('authorization', bearer)
      .field('description', 'Gasolina')
      .field('amountMinor', '15000')
      .attach('receipt', JPEG, {
        filename: 'recibo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect(stored[0]).toMatchObject({ mimeType: 'image/jpeg' });
    expect(Buffer.from(stored[0].bytes).equals(JPEG)).toBe(true);
    expect(created[0]).toMatchObject({
      description: 'Gasolina',
      amountMinor: 15_000,
    });
  });

  it('multer corta un archivo más grande que el máximo (413)', async () => {
    await request(app.getHttpServer())
      .post('/expenses')
      .set('x-tenant-id', TENANT)
      .set('authorization', bearer)
      .field('description', 'Enorme')
      .field('amountMinor', '100')
      .attach('receipt', Buffer.alloc(RECEIPT_MAX_BYTES + 1), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
  });

  it('sin foto responde 400 y no guarda nada', async () => {
    const before = created.length;
    await request(app.getHttpServer())
      .post('/expenses')
      .set('x-tenant-id', TENANT)
      .set('authorization', bearer)
      .field('description', 'Sin foto')
      .field('amountMinor', '100')
      .expect(400);
    expect(created).toHaveLength(before);
  });
});
