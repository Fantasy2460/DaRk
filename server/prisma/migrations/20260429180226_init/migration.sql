-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class_type" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "exp" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "total_deaths" INTEGER NOT NULL DEFAULT 0,
    "total_extracts" INTEGER NOT NULL DEFAULT 0,
    "deepest_depth" INTEGER NOT NULL DEFAULT 0,
    "total_enemies_killed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_stats" (
    "character_id" TEXT NOT NULL,
    "base_hp" INTEGER NOT NULL DEFAULT 0,
    "base_mp" INTEGER NOT NULL DEFAULT 0,
    "base_attack" INTEGER NOT NULL DEFAULT 0,
    "base_defense" INTEGER NOT NULL DEFAULT 0,
    "base_speed" INTEGER NOT NULL DEFAULT 0,
    "fog_resist" INTEGER NOT NULL DEFAULT 0,
    "available_stat_points" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "character_stats_pkey" PRIMARY KEY ("character_id")
);

-- CreateTable
CREATE TABLE "skill_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "class_type" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'active',
    "required_level" INTEGER NOT NULL DEFAULT 1,
    "cooldown" INTEGER NOT NULL DEFAULT 0,
    "mp_cost" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER,
    "damage_percent" INTEGER,
    "range" INTEGER,
    "aoe" BOOLEAN NOT NULL DEFAULT false,
    "max_level" INTEGER,

    CONSTRAINT "skill_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_skills" (
    "characterId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "unlocked_at" TIMESTAMP(3),

    CONSTRAINT "character_skills_pkey" PRIMARY KEY ("characterId","skillId")
);

-- CreateTable
CREATE TABLE "character_talents" (
    "characterId" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "points_invested" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "character_talents_pkey" PRIMARY KEY ("characterId","talentId")
);

-- CreateTable
CREATE TABLE "item_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slot" TEXT,
    "rarity" TEXT,
    "base_stats_json" TEXT,
    "consumable_type" TEXT,
    "consumable_value" INTEGER,
    "consumable_duration" INTEGER,
    "description" TEXT,
    "max_stack" INTEGER NOT NULL DEFAULT 1,
    "buy_price" INTEGER NOT NULL DEFAULT 0,
    "sell_price" INTEGER NOT NULL DEFAULT 0,
    "drop_level_min" INTEGER,
    "drop_level_max" INTEGER,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "item_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_items" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "rarity" TEXT,
    "stats_json" TEXT,
    "location" TEXT NOT NULL DEFAULT 'inventory',
    "slot_position" INTEGER,
    "equipped_slot" TEXT,
    "stack_count" INTEGER NOT NULL DEFAULT 1,
    "obtained_from" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_enchantments" (
    "item_id" TEXT NOT NULL,
    "enchant_level" INTEGER NOT NULL DEFAULT 0,
    "bonus_stats_json" TEXT,

    CONSTRAINT "item_enchantments_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "player_bestiary" (
    "characterId" TEXT NOT NULL,
    "enemy_template_id" TEXT NOT NULL,
    "kill_count" INTEGER NOT NULL DEFAULT 0,
    "first_kill_at" TIMESTAMP(3),
    "last_kill_at" TIMESTAMP(3),

    CONSTRAINT "player_bestiary_pkey" PRIMARY KEY ("characterId","enemy_template_id")
);

-- CreateTable
CREATE TABLE "player_equipment_codex" (
    "characterId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "first_obtain_at" TIMESTAMP(3),
    "obtain_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_equipment_codex_pkey" PRIMARY KEY ("characterId","templateId")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "target_value" INTEGER NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_achievements" (
    "characterId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "current_value" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "player_achievements_pkey" PRIMARY KEY ("characterId","achievementId")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "party_id" TEXT,
    "result" TEXT,
    "start_depth" INTEGER NOT NULL,
    "end_depth" INTEGER NOT NULL,
    "enemies_killed" INTEGER NOT NULL DEFAULT 0,
    "items_found_json" TEXT,
    "gained_exp" INTEGER NOT NULL DEFAULT 0,
    "gained_gold" INTEGER NOT NULL DEFAULT 0,
    "elapsed_time_sec" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_participants" (
    "runId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "is_host" BOOLEAN NOT NULL DEFAULT false,
    "damage_dealt" INTEGER NOT NULL DEFAULT 0,
    "damage_taken" INTEGER NOT NULL DEFAULT 0,
    "healing_done" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "run_participants_pkey" PRIMARY KEY ("runId","characterId")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "leader_character_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'forming',
    "current_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disbanded_at" TIMESTAMP(3),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_members" (
    "partyId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "party_members_pkey" PRIMARY KEY ("partyId","characterId")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_items" (
    "id" SERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'gold',
    "stock" INTEGER NOT NULL DEFAULT -1,
    "refresh_type" TEXT,
    "valid_until" TIMESTAMP(3),

    CONSTRAINT "shop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_transactions" (
    "id" SERIAL NOT NULL,
    "character_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "related_item_id" TEXT,
    "related_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail" (
    "id" SERIAL NOT NULL,
    "character_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL DEFAULT '系统',
    "title" TEXT NOT NULL,
    "content" TEXT,
    "attachments_json" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_claimed" BOOLEAN NOT NULL DEFAULT false,
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_seasons" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),

    CONSTRAINT "leaderboard_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "seasonId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rank" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaderboard_entries_pkey" PRIMARY KEY ("seasonId","category","characterId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "character_id" TEXT,
    "action" TEXT NOT NULL,
    "details_json" TEXT,
    "client_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anti_cheat_flags" (
    "id" SERIAL NOT NULL,
    "character_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" INTEGER,
    "evidence_json" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "action_taken" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anti_cheat_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_stats" ADD CONSTRAINT "character_stats_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skill_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_talents" ADD CONSTRAINT "character_talents_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_items" ADD CONSTRAINT "player_items_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_items" ADD CONSTRAINT "player_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "item_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_enchantments" ADD CONSTRAINT "item_enchantments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "player_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_bestiary" ADD CONSTRAINT "player_bestiary_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_equipment_codex" ADD CONSTRAINT "player_equipment_codex_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_equipment_codex" ADD CONSTRAINT "player_equipment_codex_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "item_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_participants" ADD CONSTRAINT "run_participants_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_participants" ADD CONSTRAINT "run_participants_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "item_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_transactions" ADD CONSTRAINT "character_transactions_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "leaderboard_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
