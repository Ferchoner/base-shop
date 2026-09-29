import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLS_ID, ClsService } from 'nestjs-cls';
import type { EnvironmentVariables } from '../../../platform/config/environment.js';
import { DuplicateValueError, newId } from '../../../shared-kernel/index.js';
import {
  CreateFirstSuperadmin,
  SuperadminAlreadyExistsError,
} from '../application/create-first-superadmin.use-case.js';

const REQUIRED = [
  'SUPERADMIN_EMAIL',
  'SUPERADMIN_FIRST_NAMES',
  'SUPERADMIN_LAST_NAMES',
] as const;

/**
 * The operator's command that creates the first superadmin (UC-IAM-20, ADR-0116), from the `SUPERADMIN_*`
 * variables. The temporary password goes to `output` (the terminal) once and never to the log, which may be
 * kept or shipped elsewhere. Returns the exit code: 0 when created, 1 when refused.
 */
@Injectable()
export class FirstSuperadminCommand {
  private readonly logger = new Logger('FirstSuperadmin');

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly createFirstSuperadmin: CreateFirstSuperadmin,
    private readonly cls: ClsService,
  ) {}

  async run(
    output: (text: string) => void = (text) => process.stdout.write(text),
  ): Promise<number> {
    const missing = REQUIRED.filter(
      (name) => this.config.get(name, { infer: true }) === undefined,
    );
    if (missing.length > 0) {
      this.logger.error(
        `Set ${missing.join(', ')} to create the first superadmin`,
      );
      return 1;
    }
    const email = this.config.get('SUPERADMIN_EMAIL', {
      infer: true,
    }) as string;
    try {
      // Its own async context with an id, as a scheduled job has: the audit trail records SYSTEM.
      const { userId, temporaryPassword } = await this.cls.run(() => {
        this.cls.set(CLS_ID, newId());
        return this.createFirstSuperadmin.execute({
          email,
          firstNames: this.config.get('SUPERADMIN_FIRST_NAMES', {
            infer: true,
          }) as string,
          lastNames: this.config.get('SUPERADMIN_LAST_NAMES', {
            infer: true,
          }) as string,
        });
      });
      this.logger.log(`First superadmin created: user ${userId}`);
      output(
        [
          `Superadministrador creado: ${email}`,
          `Contraseña temporal (se muestra solo esta vez): ${temporaryPassword}`,
          'Cámbiala al iniciar sesión: la API pide una nueva antes de permitir otra cosa.',
          '',
        ].join('\n'),
      );
      return 0;
    } catch (error) {
      if (error instanceof SuperadminAlreadyExistsError) {
        this.logger.error(
          'An active superadmin already exists: create staff through the API',
        );
        return 1;
      }
      if (error instanceof DuplicateValueError) {
        this.logger.error('SUPERADMIN_EMAIL already belongs to an account');
        return 1;
      }
      throw error;
    }
  }
}
