-- CreateEnum
CREATE TYPE "AttemptEventType" AS ENUM ('WINDOW_BLUR', 'VISIBILITY_HIDDEN', 'FULLSCREEN_EXIT');

-- AlterEnum
ALTER TYPE "AttemptStatus" ADD VALUE 'TERMINATED';

-- CreateTable
CREATE TABLE "AttemptEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" "AttemptEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttemptEvent_attemptId_idx" ON "AttemptEvent"("attemptId");

-- AddForeignKey
ALTER TABLE "AttemptEvent" ADD CONSTRAINT "AttemptEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
