-- AlterTable
ALTER TABLE "ExamAnswer" ADD COLUMN     "autoGraded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "gradedById" TEXT,
ADD COLUMN     "pointsAwarded" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ExamAttempt" ADD COLUMN     "gradedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
