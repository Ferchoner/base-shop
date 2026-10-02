-- Why a delivery failed and what came back, as the staff wrote it (ADR-0141). Optional, like the notes of the
-- manual payment and refund.
ALTER TABLE "shipments"
  ADD COLUMN "failure_note" TEXT,
  ADD COLUMN "return_note" TEXT;

-- Each status keeps the date it was reached: a returned shipment failed its delivery first (BR-SHP-09, ADR-0053).
ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_delivered_at_check" CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL),
  ADD CONSTRAINT "shipments_failed_at_check" CHECK (status NOT IN ('DELIVERY_FAILED', 'RETURNED') OR failed_at IS NOT NULL),
  ADD CONSTRAINT "shipments_returned_at_check" CHECK (status <> 'RETURNED' OR returned_at IS NOT NULL);
