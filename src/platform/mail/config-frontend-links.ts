import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Frontend, FrontendLinks } from '../../shared-kernel/index.js';
import type { EnvironmentVariables } from '../config/environment.js';

/**
 * Frontend links on `FRONTEND_BASE_URL`, the shop, and `BACKOFFICE_BASE_URL` (ADR-0056, ADR-0110, ADR-0169), which
 * may include a path.
 */
@Injectable()
export class ConfigFrontendLinks extends FrontendLinks {
  private readonly baseUrls: Readonly<Record<Frontend, string>>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    this.baseUrls = {
      shop: config.get('FRONTEND_BASE_URL', { infer: true }),
      backoffice: config.get('BACKOFFICE_BASE_URL', { infer: true }),
    };
  }

  link(
    frontend: Frontend,
    path: string,
    params: Readonly<Record<string, string>> = {},
  ): string {
    if (!path.startsWith('/')) {
      throw new Error(`A frontend path starts with "/": ${path}`);
    }
    const url = new URL(`${this.baseUrls[frontend]}${path}`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  }
}
