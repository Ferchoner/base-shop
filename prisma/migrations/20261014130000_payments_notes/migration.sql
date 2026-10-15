-- The note of the staff on a manual payment and on a manual refund (T-197, ADR-0163): until now it was only the
-- reason of their audit entry, which the cashier cannot read. Anonymization keeps it.
ALTER TABLE "payment_attempts" ADD COLUMN "note" TEXT;

ALTER TABLE "refunds" ADD COLUMN "note" TEXT;

-- The same bounds as the reason of the audit (ADR-0112).
ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_note_check" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_note_check" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500);

-- The notes written before, copied once from the audit trail (ADR-0163): the reason of each manual capture goes to
-- the captured attempt of its payment, and that of each manual refund to its completed refund. Payments reads
-- audit_logs only here, and entries already archived out of the database are not copied.
UPDATE "payment_attempts" AS attempt
   SET "note" = audit."reason"
  FROM "audit_logs" AS audit
 WHERE audit."action" = 'payments.manual-capture'
   AND audit."result" = 'SUCCESS'
   AND audit."resource_type" = 'payment'
   AND audit."resource_id" = attempt."payment_id"::text
   AND attempt."status" = 'CAPTURED';

UPDATE "refunds" AS refund
   SET "note" = audit."reason"
  FROM "audit_logs" AS audit
 WHERE audit."action" = 'payments.manual-refund'
   AND audit."result" = 'SUCCESS'
   AND audit."resource_type" = 'payment'
   AND audit."resource_id" = refund."payment_id"::text
   AND refund."status" = 'COMPLETED';
