-- Seed item_templates with equipment and consumables
INSERT INTO "item_templates" (
  "id", "name", "type", "slot", "rarity", "base_stats_json",
  "consumable_type", "consumable_value", "consumable_duration",
  "description", "max_stack", "buy_price", "sell_price"
)
VALUES
  -- C 级武器
  ('rusty_sword', '生锈短剑', 'equipment', 'weapon', 'C', '{"attack":5}', NULL, NULL, NULL, '一把生锈的短剑，勉强能用。', 1, 50, 10),
  ('wooden_staff', '木棍', 'equipment', 'weapon', 'C', '{"attack":4,"mp":10}', NULL, NULL, NULL, '普通的木棍。', 1, 50, 10),
  ('cracked_wand', '裂开的法杖', 'equipment', 'weapon', 'C', '{"attack":6}', NULL, NULL, NULL, '法杖顶端的水晶裂开了。', 1, 50, 10),

  -- B 级武器
  ('iron_sword', '铁剑', 'equipment', 'weapon', 'B', '{"attack":10}', NULL, NULL, NULL, '一把锋利的铁剑。', 1, 200, 40),
  ('crystal_staff', '水晶法杖', 'equipment', 'weapon', 'B', '{"attack":12,"mp":20}', NULL, NULL, NULL, '水晶中蕴含着微弱的魔力。', 1, 200, 40),
  ('shadow_dagger', '暗影匕首', 'equipment', 'weapon', 'B', '{"attack":9,"speed":10}', NULL, NULL, NULL, '在阴影中几乎看不见。', 1, 200, 40),

  -- A 级武器
  ('flame_blade', '烈焰之刃', 'equipment', 'weapon', 'A', '{"attack":20,"defense":5}', NULL, NULL, NULL, '剑身燃烧着不灭的火焰。', 1, 800, 160),
  ('arcane_scepter', '奥术权杖', 'equipment', 'weapon', 'A', '{"attack":22,"mp":40}', NULL, NULL, NULL, '贤者们世代相传的权杖。', 1, 800, 160),

  -- S 级武器
  ('demon_slayer', '斩魔大剑', 'equipment', 'weapon', 'S', '{"attack":35,"defense":10,"hp":30}', NULL, NULL, NULL, '传说中斩杀过恶魔的神器。', 1, 3000, 600),

  -- 防具 C
  ('cloth_helm', '布帽', 'equipment', 'helmet', 'C', '{"defense":2}', NULL, NULL, NULL, '普通的布帽。', 1, 30, 6),
  ('leather_armor', '皮甲', 'equipment', 'armor', 'C', '{"defense":4}', NULL, NULL, NULL, '粗糙的皮革护甲。', 1, 40, 8),
  ('cloth_pants', '布裤', 'equipment', 'pants', 'C', '{"defense":2}', NULL, NULL, NULL, '普通的布裤。', 1, 30, 6),
  ('old_boots', '旧靴子', 'equipment', 'shoes', 'C', '{"defense":1,"speed":5}', NULL, NULL, NULL, '有些磨脚的旧靴子。', 1, 25, 5),

  -- 防具 B
  ('iron_helm', '铁盔', 'equipment', 'helmet', 'B', '{"defense":6,"hp":10}', NULL, NULL, NULL, '坚固的铁头盔。', 1, 150, 30),
  ('chain_armor', '链甲', 'equipment', 'armor', 'B', '{"defense":10}', NULL, NULL, NULL, '由铁环编织而成的护甲。', 1, 180, 36),
  ('leather_boots', '皮靴', 'equipment', 'shoes', 'B', '{"defense":3,"speed":10}', NULL, NULL, NULL, '结实的皮靴。', 1, 120, 24),

  -- 防具 A
  ('mystic_crown', '神秘之冠', 'equipment', 'helmet', 'A', '{"defense":8,"mp":30}', NULL, NULL, NULL, '散发着微弱的魔力。', 1, 600, 120),
  ('dragon_scale_armor', '龙鳞甲', 'equipment', 'armor', 'A', '{"defense":18,"hp":20}', NULL, NULL, NULL, '用龙鳞打造的护甲。', 1, 800, 160),

  -- 首饰 / 副手
  ('copper_ring', '铜戒指', 'equipment', 'accessory', 'C', '{"attack":2}', NULL, NULL, NULL, '一枚普通的铜戒指。', 1, 20, 4),
  ('silver_ring', '银戒指', 'equipment', 'accessory', 'B', '{"attack":4,"defense":2}', NULL, NULL, NULL, '刻有古老符文的银戒指。', 1, 100, 20),
  ('wooden_shield', '木盾', 'equipment', 'offhand', 'C', '{"defense":3}', NULL, NULL, NULL, '简易的木盾。', 1, 35, 7),
  ('iron_shield', '铁盾', 'equipment', 'offhand', 'B', '{"defense":8}', NULL, NULL, NULL, '坚固的铁盾。', 1, 150, 30),
  ('magic_orb', '魔力宝珠', 'equipment', 'offhand', 'A', '{"mp":50,"attack":8}', NULL, NULL, NULL, '蕴含着强大魔力的宝珠。', 1, 600, 120),

  -- S 级综合
  ('crown_of_kings', '王者之冠', 'equipment', 'helmet', 'S', '{"defense":15,"hp":50,"attack":10}', NULL, NULL, NULL, '古代王者留下的头盔。', 1, 2500, 500),

  -- 消耗品
  ('hp_potion_small', '小型生命药水', 'consumable', NULL, 'C', NULL, 'instantHp', 30, NULL, '瞬间恢复 30 点生命。', 20, 15, 3),
  ('hp_potion_large', '大型生命药水', 'consumable', NULL, 'B', NULL, 'instantHp', 80, NULL, '瞬间恢复 80 点生命。', 20, 50, 10),
  ('mp_potion_small', '小型法力药水', 'consumable', NULL, 'C', NULL, 'instantMp', 30, NULL, '瞬间恢复 30 点法力。', 20, 15, 3),
  ('mp_potion_large', '大型法力药水', 'consumable', NULL, 'B', NULL, 'instantMp', 80, NULL, '瞬间恢复 80 点法力。', 20, 50, 10),
  ('regen_potion', '再生药剂', 'consumable', NULL, 'C', NULL, 'slowHp', 5, 10000, '10 秒内每 2 秒恢复 5 点生命。', 20, 30, 6),
  ('mana_regen_potion', '回灵药剂', 'consumable', NULL, 'C', NULL, 'slowMp', 5, 10000, '10 秒内每 2 秒恢复 5 点法力。', 20, 30, 6),
  ('vision_potion', '灵视药水', 'consumable', NULL, 'B', NULL, 'vision', 60, 15000, '15 秒内提高 60 点视野范围，抵抗迷雾。', 20, 40, 8);
