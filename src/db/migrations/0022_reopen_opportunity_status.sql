-- Data-only: opportunities reopened before the updateStage fix kept status WON/LOST.
UPDATE "opportunities"
SET "status" = 'OPEN'
WHERE "stage" NOT IN ('FECHADO', 'PERDIDO')
  AND "status" <> 'OPEN';
