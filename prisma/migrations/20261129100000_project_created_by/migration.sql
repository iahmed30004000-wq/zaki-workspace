-- «أنشأها فلان» on projects (the owner, 2026-11-25). Additive: the projects already there keep NULL and show their date alone.
ALTER TABLE "Project" ADD COLUMN "createdById" TEXT;
