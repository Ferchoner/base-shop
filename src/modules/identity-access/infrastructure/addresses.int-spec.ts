import { setTimeout as sleep } from 'node:timers/promises';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import pg from 'pg';
import { AppCacheModule } from '../../../platform/cache/app-cache.module.js';
import { ClockModule } from '../../../platform/clock/clock.module.js';
import { validateEnvironment } from '../../../platform/config/environment.js';
import { PersistenceModule } from '../../../platform/persistence/persistence.module.js';
import { PrismaService } from '../../../platform/persistence/prisma.service.js';
import { newId, NotFoundError } from '../../../shared-kernel/index.js';
import { AuditModule } from '../../audit/index.js';
import { AddAddress } from '../application/add-address.use-case.js';
import { MAX_ADDRESSES } from '../application/address-locations.js';
import { IdentityQueries } from '../application/identity.queries.js';
import { RemoveAddress } from '../application/remove-address.use-case.js';
import { UpdateAddress } from '../application/update-address.use-case.js';
import {
  type AddressFields,
  type AddressId,
  AddressLimitReachedError,
} from '../domain/address-book.js';
import { InvalidAddressLocationError } from '../domain/identity-errors.js';
import type { UserId } from '../domain/user.js';
import { IdentityAccessModule } from '../identity-access.module.js';

/** A small limit, so the tests reach it quickly. */
const LIMIT = 3;

const MORELIA: AddressFields = {
  recipientName: 'María López',
  phone: '4431234567',
  street: 'Av. Madero',
  exteriorNumber: '123',
  interiorNumber: null,
  neighborhood: 'Centro',
  postalCode: '58000',
  stateCode: '16',
  municipalityCode: '16053',
  city: null,
  references: null,
};
/** A municipality INEGI retired: kept by existing addresses, never used by new ones (BR-ADR-03). */
const RETIRED = '16999';

/** The customer address book against PostgreSQL 18 and the real geographic catalog (T-130 part c). */
describe('Customer addresses (T-130, UC-IAM-11)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cls: ClsService;
  let queries: IdentityQueries;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnvironment,
        }),
        ClsModule.forRoot({ global: true }),
        PersistenceModule,
        ClockModule,
        AppCacheModule,
        AuditModule,
        IdentityAccessModule,
      ],
    })
      .overrideProvider(MAX_ADDRESSES)
      .useValue(LIMIT)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    cls = moduleRef.get(ClsService);
    queries = moduleRef.get(IdentityQueries);
    for (const [code, name] of [
      ['16', 'Michoacán de Ocampo'],
      ['14', 'Jalisco'],
    ]) {
      await prisma.geoState.upsert({
        where: { code },
        create: { code, name },
        update: {},
      });
    }
    for (const [code, stateCode, name, isActive] of [
      ['16053', '16', 'Morelia', true],
      ['14039', '14', 'Guadalajara', true],
      [RETIRED, '16', 'Municipio retirado', false],
    ] as const) {
      await prisma.geoMunicipality.upsert({
        where: { code },
        create: { code, stateCode, name, isActive },
        update: { isActive },
      });
    }
  });

  afterAll(async () => {
    await prisma.geoMunicipality.deleteMany({ where: { code: RETIRED } });
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.customerAddress.deleteMany();
    await prisma.user.deleteMany();
  });

  async function insertCustomer(): Promise<UserId> {
    const id = newId<'User'>();
    await prisma.user.create({
      data: {
        id,
        type: 'CUSTOMER',
        email: `${id}@example.com`,
        firstNames: 'Ana',
        lastNames: 'Pérez',
        // Not a real hash: these tests never sign in.
        passwordHash: 'not-a-real-hash',
      },
    });
    return id;
  }

  const add = (
    customerId: UserId,
    fields: AddressFields = MORELIA,
    makeDefault = false,
  ) =>
    cls.run(() =>
      moduleRef.get(AddAddress).execute({ customerId, fields, makeDefault }),
    );
  const update = (
    customerId: UserId,
    addressId: AddressId,
    changes: Partial<AddressFields>,
    makeDefault?: boolean,
  ) =>
    cls.run(() =>
      moduleRef
        .get(UpdateAddress)
        .execute({ customerId, addressId, changes, makeDefault }),
    );
  const remove = (customerId: UserId, addressId: AddressId) =>
    cls.run(() =>
      moduleRef.get(RemoveAddress).execute({ customerId, addressId }),
    );

  const defaultIds = async (customerId: UserId) =>
    (await queries.listAddresses(customerId))
      .filter((a) => a.isDefault)
      .map((a) => a.id);

  it('keeps one default: the first address, then the one marked as default', async () => {
    const customer = await insertCustomer();

    const first = await add(customer);
    const second = await add(customer);
    expect(await defaultIds(customer)).toEqual([first]);

    const third = await add(customer, MORELIA, true);
    expect(await defaultIds(customer)).toEqual([third]);

    await update(customer, second, {}, true);
    expect(await defaultIds(customer)).toEqual([second]);
  });

  it('lists the default first, then the newest, with the catalog names', async () => {
    const customer = await insertCustomer();
    const first = await add(customer);
    const second = await add(customer, {
      ...MORELIA,
      stateCode: '14',
      municipalityCode: '14039',
    });

    const addresses = await queries.listAddresses(customer);

    expect(addresses.map((a) => a.id)).toEqual([first, second]);
    expect(addresses[1]).toMatchObject({
      stateName: 'Jalisco',
      municipalityName: 'Guadalajara',
      isDefault: false,
    });
  });

  it('rejects an address beyond the limit (BR-ADR-04)', async () => {
    const customer = await insertCustomer();
    for (let i = 0; i < LIMIT; i += 1) await add(customer);

    await expect(add(customer)).rejects.toThrow(
      new AddressLimitReachedError(LIMIT),
    );
  });

  it('lets only one of two simultaneous additions take the last place', async () => {
    const customer = await insertCustomer();
    for (let i = 0; i < LIMIT - 1; i += 1) await add(customer);
    // Hold the customer row, so both additions queue behind it and then run one after the other.
    const holder = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
      customer,
    ]);

    const results = Promise.allSettled([add(customer), add(customer)]);
    await waitForLockWaiters(holder, 2);
    await holder.query('COMMIT');
    await holder.end();
    const settled = await results;

    expect(settled.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(
      await prisma.customerAddress.count({ where: { userId: customer } }),
    ).toBe(LIMIT);
  });

  it.each([
    [{ stateCode: '99' }, 'stateCode', 'isState'],
    [
      { municipalityCode: '14039' },
      'municipalityCode',
      'isMunicipalityOfState',
    ],
    [{ municipalityCode: RETIRED }, 'municipalityCode', 'isActiveMunicipality'],
  ])(
    'rejects a new address with %o (BR-ADR-02)',
    async (change, field, code) => {
      const customer = await insertCustomer();

      const error = await add(customer, { ...MORELIA, ...change }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(InvalidAddressLocationError);
      expect((error as InvalidAddressLocationError).details).toEqual({
        errors: [expect.objectContaining({ field, code })],
      });
    },
  );

  it('keeps a retired municipality on an existing address, but never moves one to it', async () => {
    const customer = await insertCustomer();
    const kept = newId<'Address'>();
    await prisma.customerAddress.create({
      data: {
        id: kept,
        userId: customer,
        ...MORELIA,
        municipalityCode: RETIRED,
        isDefault: true,
      },
    });
    const other = await add(customer);

    await update(customer, kept, { street: 'Calle Nueva' });
    expect((await queries.findAddress(customer, kept))?.municipalityCode).toBe(
      RETIRED,
    );
    await expect(
      update(customer, other, { municipalityCode: RETIRED }),
    ).rejects.toThrow(InvalidAddressLocationError);
  });

  it('leaves no default when the default is removed or unmarked', async () => {
    const customer = await insertCustomer();
    const first = await add(customer);
    const second = await add(customer);

    await remove(customer, first);
    expect(await defaultIds(customer)).toEqual([]);

    await update(customer, second, {}, true);
    await update(customer, second, {}, false);
    expect(await defaultIds(customer)).toEqual([]);
  });

  it("answers another customer's address as missing", async () => {
    const owner = await insertCustomer();
    const other = await insertCustomer();
    const address = await add(owner);

    await expect(update(other, address, { street: 'X' })).rejects.toThrow(
      NotFoundError,
    );
    await expect(remove(other, address)).rejects.toThrow(NotFoundError);
    expect(await queries.findAddress(other, address)).toBeNull();
  });
});

/** Waits until `count` sessions are blocked on a lock, or a few seconds pass. */
async function waitForLockWaiters(
  client: pg.Client,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await client.query<{ waiting: string }>(
      "SELECT count(*) AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'",
    );
    if (Number(rows[0].waiting) >= count) return;
    await sleep(100);
  }
}
