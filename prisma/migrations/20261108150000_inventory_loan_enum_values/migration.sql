-- Loans to show stock in another warehouse (T-164, ADR-0172): the reasons and statuses of a loan and of its return.
-- In their own migration, because PostgreSQL does not use a new enum value in the transaction that adds it.

-- AlterEnum
ALTER TYPE "stock_transfer_reason" ADD VALUE 'SHOW';
ALTER TYPE "stock_transfer_reason" ADD VALUE 'LOAN_RETURN';

-- AlterEnum
ALTER TYPE "stock_transfer_status" ADD VALUE 'OPEN';
ALTER TYPE "stock_transfer_status" ADD VALUE 'CLOSED';
