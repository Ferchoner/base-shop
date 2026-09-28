-- Why a staff member made an audited change (ADR-0112): suspensions and reactivations now; anonymizations,
-- cancellations and other actions that ask for a reason later. Free text written by staff, 1 to 500
-- characters; NULL for actions without a reason. Adding a column changes no row, so the trigger that rejects
-- updates on audit_logs is not involved.
ALTER TABLE "audit_logs" ADD COLUMN "reason" TEXT;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_reason_check"
  CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500);
