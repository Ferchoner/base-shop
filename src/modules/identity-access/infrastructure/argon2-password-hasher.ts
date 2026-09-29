import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '../application/password-hasher.js';
import { normalizePassword } from '../domain/password.js';

const deriveKey = promisify(argon2);

interface Argon2Cost {
  /** Memory in KiB. */
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
}

/**
 * OWASP's recommended minimum for Argon2id: 19 MiB, 2 passes, 1 lane (ADR-0114). Each hash records its own
 * cost, so raising it later keeps the old hashes verifiable.
 */
const COST: Argon2Cost = { memory: 19_456, passes: 2, parallelism: 1 };
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const ARGON2_VERSION = 19;

/** Bounds for a stored hash, so a corrupted row cannot ask for gigabytes of memory. */
const MAX_COST: Argon2Cost = { memory: 1_048_576, passes: 16, parallelism: 16 };

const PHC_PATTERN =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface StoredHash {
  readonly cost: Argon2Cost;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

/**
 * Argon2id from `node:crypto` (Node 24.7 or later), so there is no native dependency (ADR-0114). Hashes use
 * the PHC string format of the reference implementation: `$argon2id$v=19$m=…,t=…,p=…$salt$hash`, in base64
 * without padding. Passwords are normalized to Unicode NFKC first, as NIST SP 800-63B recommends, so the
 * same password typed on different keyboards gives the same hash.
 */
@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  /** Hash of a random password, compared against when there is no account (ADR-0062). */
  private standIn?: Promise<string>;

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const tag = await derive(password, salt, COST, TAG_BYTES);
    const { memory, passes, parallelism } = COST;
    return `$argon2id$v=${ARGON2_VERSION}$m=${memory},t=${passes},p=${parallelism}$${encode(salt)}$${encode(tag)}`;
  }

  async verify(password: string, hash: string | null): Promise<boolean> {
    const stored = parse(hash ?? (await this.standInHash()));
    if (stored === undefined) {
      // A malformed stored hash never matches, after the same work as a real one.
      await this.verify(password, null);
      return false;
    }
    const tag = await derive(
      password,
      stored.salt,
      stored.cost,
      stored.tag.length,
    );
    return hash !== null && timingSafeEqual(tag, stored.tag);
  }

  private standInHash(): Promise<string> {
    this.standIn ??= this.hash(randomBytes(32).toString('base64url'));
    return this.standIn;
  }
}

function derive(
  password: string,
  salt: Buffer,
  cost: Argon2Cost,
  tagLength: number,
): Promise<Buffer> {
  return deriveKey('argon2id', {
    message: normalizePassword(password),
    nonce: salt,
    memory: cost.memory,
    passes: cost.passes,
    parallelism: cost.parallelism,
    tagLength,
  });
}

function parse(hash: string): StoredHash | undefined {
  const match = PHC_PATTERN.exec(hash);
  if (match === null) return undefined;
  const [version, memory, passes, parallelism] = match.slice(1, 5).map(Number);
  const cost = { memory, passes, parallelism };
  const salt = Buffer.from(match[5], 'base64');
  const tag = Buffer.from(match[6], 'base64');
  const withinBounds =
    version === ARGON2_VERSION &&
    parallelism >= 1 &&
    parallelism <= MAX_COST.parallelism &&
    passes >= 1 &&
    passes <= MAX_COST.passes &&
    memory >= 8 * parallelism &&
    memory <= MAX_COST.memory &&
    salt.length >= 8 &&
    tag.length >= 16 &&
    tag.length <= 64;
  return withinBounds ? { cost, salt, tag } : undefined;
}

function encode(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}
