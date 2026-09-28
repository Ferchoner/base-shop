import { Global, Module } from '@nestjs/common';
import { EmailSender, FrontendLinks } from '../../shared-kernel/index.js';
import { ConfigFrontendLinks } from './config-frontend-links.js';
import { SmtpEmailSender } from './smtp-email-sender.js';

/**
 * Email sending and frontend links (ADR-0110), for every context: account emails in Identity & Access and
 * order notifications (T-215). Global, like the audit trail.
 */
@Global()
@Module({
  providers: [
    { provide: EmailSender, useClass: SmtpEmailSender },
    { provide: FrontendLinks, useClass: ConfigFrontendLinks },
  ],
  exports: [EmailSender, FrontendLinks],
})
export class MailModule {}
