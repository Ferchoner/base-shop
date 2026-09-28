import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FrontendLinks } from '../../shared-kernel/index.js';
import type { EnvironmentVariables } from '../config/environment.js';

/** Frontend links on `FRONTEND_BASE_URL` (ADR-0056, ADR-0110), which may include a path. */
@Injectable()
export class ConfigFrontendLinks extends FrontendLinks {
  private readonly baseUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    this.baseUrl = config.get('FRONTEND_BASE_URL', { infer: true });
  }

  link(path: string, params: Readonly<Record<string, string>> = {}): string {
    if (!path.startsWith('/')) {
      throw new Error(`A frontend path starts with "/": ${path}`);
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  }
}
