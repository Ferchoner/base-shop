import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsModule } from 'nestjs-cls';
import { TransactionManager } from '../../shared-kernel/transaction-manager.js';
import { validateEnvironment } from '../config/environment.js';
import { PersistenceModule } from './persistence.module.js';
import { PrismaService } from './prisma.service.js';
import type { PrismaTransactionAdapter } from './transactional-plugin.js';

const NAME_PREFIX = 'tx-test-';

/** Stands in for a repository: it only knows TransactionHost, never whether a transaction is active. */
@Injectable()
class BrandProbeRepository {
  constructor(
    private readonly txHost: TransactionHost<PrismaTransactionAdapter>,
  ) {}

  async insert(name: string): Promise<void> {
    await this.txHost.tx.brand.create({
      data: {
        id: randomUUID(),
        name: `${NAME_PREFIX}${name}`,
        slug: `${NAME_PREFIX}${name}`,
        status: 'ACTIVE',
      },
    });
  }
}

/**
 * Transaction context (T-111, ADR-0093): repositories join the transaction opened by TransactionManager
 * without receiving it, and a failure rolls back every write.
 */
describe('ClsTransactionManager (T-111)', () => {
  let moduleRef: TestingModule;
  let transactions: TransactionManager;
  let brands: BrandProbeRepository;
  let prisma: PrismaService;

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
      ],
      providers: [BrandProbeRepository],
    }).compile();
    await moduleRef.init();

    transactions = moduleRef.get(TransactionManager);
    brands = moduleRef.get(BrandProbeRepository);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    await prisma.brand.deleteMany({
      where: { name: { startsWith: NAME_PREFIX } },
    });
  });

  it('commits every write when the work succeeds', async () => {
    await transactions.run(async () => {
      await brands.insert('a');
      await brands.insert('b');
    });

    expect(await committedNames()).toEqual(['a', 'b']);
  });

  it('rolls back every write and rethrows the error when the work fails', async () => {
    const failure = new Error('use case failed');

    await expect(
      transactions.run(async () => {
        await brands.insert('a');
        await brands.insert('b');
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await committedNames()).toEqual([]);
  });

  it('rolls back when a database constraint fails halfway', async () => {
    await expect(
      transactions.run(async () => {
        await brands.insert('a');
        await brands.insert('a');
      }),
    ).rejects.toThrow(/Unique constraint/);

    expect(await committedNames()).toEqual([]);
  });

  it('keeps uncommitted writes invisible to other connections until the commit', async () => {
    let seenDuringTransaction: string[] | undefined;

    await transactions.run(async () => {
      await brands.insert('a');
      seenDuringTransaction = await committedNames();
    });

    expect(seenDuringTransaction).toEqual([]);
    expect(await committedNames()).toEqual(['a']);
  });

  it('joins the outer transaction when runs are nested', async () => {
    await expect(
      transactions.run(async () => {
        await brands.insert('outer');
        await transactions.run(() => brands.insert('inner'));
        throw new Error('outer work failed after the inner run');
      }),
    ).rejects.toThrow('outer work failed');

    expect(await committedNames()).toEqual([]);
  });

  it('commits writes made outside a transaction right away', async () => {
    await brands.insert('a');

    expect(await committedNames()).toEqual(['a']);
  });

  it('keeps concurrent transactions apart', async () => {
    const results = await Promise.allSettled([
      transactions.run(async () => {
        await brands.insert('failing');
        await sleep(50);
        throw new Error('first transaction failed');
      }),
      transactions.run(async () => {
        await brands.insert('succeeding');
        await sleep(50);
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'fulfilled',
    ]);
    expect(await committedNames()).toEqual(['succeeding']);
  });

  it('rolls back a transaction that runs longer than 5 seconds', async () => {
    await expect(
      transactions.run(async () => {
        await brands.insert('slow');
        await sleep(5_500);
      }),
    ).rejects.toThrow(/timeout/i);

    expect(await committedNames()).toEqual([]);
  }, 15_000);

  /** Names committed so far, read through a separate connection outside any transaction. */
  async function committedNames(): Promise<string[]> {
    const rows = await prisma.brand.findMany({
      where: { name: { startsWith: NAME_PREFIX } },
      orderBy: { name: 'asc' },
      select: { name: true },
    });
    return rows.map((row) => row.name.slice(NAME_PREFIX.length));
  }
});
