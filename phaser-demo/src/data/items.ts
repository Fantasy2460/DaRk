import type { Item, Consumable } from '../types';

export const ITEMS: Item[] = [
  // C 级武器
  { id: 'rusty_sword', name: '生锈短剑', rarity: 'C', slot: 'weapon', stats: { attack: 5 }, description: '一把生锈的短剑，勉强能用。' },
  { id: 'wooden_staff', name: '木棍', rarity: 'C', slot: 'weapon', stats: { attack: 4, mp: 10 }, description: '普通的木棍。' },
  { id: 'cracked_wand', name: '裂开的法杖', rarity: 'C', slot: 'weapon', stats: { attack: 6 }, description: '法杖顶端的水晶裂开了。' },

  // B 级武器
  { id: 'iron_sword', name: '铁剑', rarity: 'B', slot: 'weapon', stats: { attack: 10 }, description: '一把锋利的铁剑。' },
  { id: 'crystal_staff', name: '水晶法杖', rarity: 'B', slot: 'weapon', stats: { attack: 12, mp: 20 }, description: '水晶中蕴含着微弱的魔力。' },
  { id: 'shadow_dagger', name: '暗影匕首', rarity: 'B', slot: 'weapon', stats: { attack: 9, speed: 10 }, description: '在阴影中几乎看不见。' },

  // A 级武器
  { id: 'flame_blade', name: '烈焰之刃', rarity: 'A', slot: 'weapon', stats: { attack: 20, defense: 5 }, description: '剑身燃烧着不灭的火焰。' },
  { id: 'arcane_scepter', name: '奥术权杖', rarity: 'A', slot: 'weapon', stats: { attack: 22, mp: 40 }, description: '贤者们世代相传的权杖。' },

  // S 级武器
  { id: 'demon_slayer', name: '斩魔大剑', rarity: 'S', slot: 'weapon', stats: { attack: 35, defense: 10, hp: 30 }, description: '传说中斩杀过恶魔的神器。' },

  // 防具 C
  { id: 'cloth_helm', name: '布帽', rarity: 'C', slot: 'helmet', stats: { defense: 2 }, description: '普通的布帽。' },
  { id: 'leather_armor', name: '皮甲', rarity: 'C', slot: 'armor', stats: { defense: 4 }, description: '粗糙的皮革护甲。' },
  { id: 'cloth_pants', name: '布裤', rarity: 'C', slot: 'pants', stats: { defense: 2 }, description: '普通的布裤。' },
  { id: 'old_boots', name: '旧靴子', rarity: 'C', slot: 'shoes', stats: { defense: 1, speed: 5 }, description: '有些磨脚的旧靴子。' },

  // 防具 B
  { id: 'iron_helm', name: '铁盔', rarity: 'B', slot: 'helmet', stats: { defense: 6, hp: 10 }, description: '坚固的铁头盔。' },
  { id: 'chain_armor', name: '链甲', rarity: 'B', slot: 'armor', stats: { defense: 10 }, description: '由铁环编织而成的护甲。' },
  { id: 'leather_boots', name: '皮靴', rarity: 'B', slot: 'shoes', stats: { defense: 3, speed: 10 }, description: '结实的皮靴。' },

  // 防具 A
  { id: 'mystic_crown', name: '神秘之冠', rarity: 'A', slot: 'helmet', stats: { defense: 8, mp: 30 }, description: '散发着微弱的魔力。' },
  { id: 'dragon_scale_armor', name: '龙鳞甲', rarity: 'A', slot: 'armor', stats: { defense: 18, hp: 20 }, description: '用龙鳞打造的护甲。' },

  // 首饰 / 副手
  { id: 'copper_ring', name: '铜戒指', rarity: 'C', slot: 'accessory', stats: { attack: 2 }, description: '一枚普通的铜戒指。' },
  { id: 'silver_ring', name: '银戒指', rarity: 'B', slot: 'accessory', stats: { attack: 4, defense: 2 }, description: '刻有古老符文的银戒指。' },
  { id: 'wooden_shield', name: '木盾', rarity: 'C', slot: 'offhand', stats: { defense: 3 }, description: '简易的木盾。' },
  { id: 'iron_shield', name: '铁盾', rarity: 'B', slot: 'offhand', stats: { defense: 8 }, description: '坚固的铁盾。' },
  { id: 'magic_orb', name: '魔力宝珠', rarity: 'A', slot: 'offhand', stats: { mp: 50, attack: 8 }, description: '蕴含着强大魔力的宝珠。' },

  // S 级综合
  { id: 'crown_of_kings', name: '王者之冠', rarity: 'S', slot: 'helmet', stats: { defense: 15, hp: 50, attack: 10 }, description: '古代王者留下的头盔。' },
];

export const CONSUMABLES: Consumable[] = [
  { id: 'hp_potion_small', name: '小型生命药水', type: 'instantHp', value: 30, description: '瞬间恢复 30 点生命。' },
  { id: 'hp_potion_large', name: '大型生命药水', type: 'instantHp', value: 80, description: '瞬间恢复 80 点生命。' },
  { id: 'mp_potion_small', name: '小型法力药水', type: 'instantMp', value: 30, description: '瞬间恢复 30 点法力。' },
  { id: 'mp_potion_large', name: '大型法力药水', type: 'instantMp', value: 80, description: '瞬间恢复 80 点法力。' },
  { id: 'regen_potion', name: '再生药剂', type: 'slowHp', value: 5, duration: 10000, description: '10 秒内每 2 秒恢复 5 点生命。' },
  { id: 'mana_regen_potion', name: '回灵药剂', type: 'slowMp', value: 5, duration: 10000, description: '10 秒内每 2 秒恢复 5 点法力。' },
  { id: 'vision_potion', name: '灵视药水', type: 'vision', value: 60, duration: 15000, description: '15 秒内提高 60 点视野范围，抵抗迷雾。' },
];
