-- «الأهداف والنتائج»: an objective may now be set for a calendar quarter.
--
-- Additive only: one new value on an existing enum, in a migration of its own (a new value cannot be used in the
-- transaction that adds it). No row is touched.
ALTER TYPE "GoalPeriod" ADD VALUE IF NOT EXISTS 'QUARTERLY';
