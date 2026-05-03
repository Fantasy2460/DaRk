-- CreateTable
CREATE TABLE "enemy_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hp" INTEGER NOT NULL,
    "attack" INTEGER NOT NULL,
    "defense" INTEGER NOT NULL,
    "speed" INTEGER NOT NULL,
    "aggro_range" INTEGER NOT NULL,
    "attack_range" INTEGER NOT NULL,
    "color_hex" TEXT NOT NULL,
    "is_boss" BOOLEAN NOT NULL DEFAULT false,
    "drop_table_json" TEXT,
    "exp_value" INTEGER NOT NULL,

    CONSTRAINT "enemy_templates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "player_bestiary" ADD CONSTRAINT "player_bestiary_enemy_template_id_fkey" FOREIGN KEY ("enemy_template_id") REFERENCES "enemy_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
