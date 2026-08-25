-- AlterTable
ALTER TABLE "ExamAttempt" ADD COLUMN     "proctorApprovedAt" TIMESTAMP(3),
ADD COLUMN     "proctorRequestedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "CourseProctor" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CourseProctor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseProctor_institutionId_idx" ON "CourseProctor"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseProctor_courseId_userId_key" ON "CourseProctor"("courseId", "userId");

-- AddForeignKey
ALTER TABLE "CourseProctor" ADD CONSTRAINT "CourseProctor_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProctor" ADD CONSTRAINT "CourseProctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
