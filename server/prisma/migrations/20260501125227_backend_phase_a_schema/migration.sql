-- AlterTable
ALTER TABLE "player_items" ADD COLUMN     "run_id" TEXT;

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "seed" TEXT;

-- AlterTable
ALTER TABLE "skill_templates" ADD COLUMN     "prerequisite_id" TEXT,
ADD COLUMN     "tier" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "player_items_run_id_idx" ON "player_items"("run_id");

-- CreateIndex
CREATE INDEX "skill_templates_tier_idx" ON "skill_templates"("tier");

-- AddForeignKey
ALTER TABLE "skill_templates" ADD CONSTRAINT "skill_templates_prerequisite_id_fkey" FOREIGN KEY ("prerequisite_id") REFERENCES "skill_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_items" ADD CONSTRAINT "player_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
