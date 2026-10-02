-- The index of the active reservations by expiry was meant for an expiration job of Inventory. The job of T-230
-- lives in Ordering instead: it finds the unpaid orders by `orders.payment_due_at` and expires the reservation of
-- each one (ADR-0136), so nothing reads this index, and it only costs on every write of a reservation. Dropped in
-- step 0 of Sprint 5; a job that needs it can create it again.
DROP INDEX "reservations_active_expiry_idx";
