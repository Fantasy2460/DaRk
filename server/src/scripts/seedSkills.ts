/**
 * 通用技能树种子脚本
 *
 * 数据来源：参考前端 `phaser-demo/src/data/skills.ts` 的 SKILL_TIERS。
 * 为避免与既有职业主动技能（slash / fireball / heal 等）冲突，
 * 全部使用 `gen_t{tier}_s{slot}` 前缀；前置技能链由同 tier 内 slot=0 → slot=1 之间
 * 不设置，而由相邻 tier 的同 slot 之间设置：tier N 的 slot k 解锁 tier N+1 的 slot k。
 *
 * 运行：
 *   npm run seed:skills
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface GenericSkillSeed {
  id: string;
  name: string;
  description: string;
  classType: string;
  type: 'active' | 'passive';
  requiredLevel: number;
  cooldown: number;
  mpCost: number;
  damage: number | null;
  damagePercent: number | null;
  range: number | null;
  aoe: boolean;
  maxLevel: number;
  tier: number;
  prerequisiteId: string | null;
}

// 与前端 SKILL_TIERS 一一对应的通用技能数据（5 tier × 2 = 10 条）
// tier 1 没有前置；tier N（N>=2）的 slot k 前置为 tier N-1 的 slot k
const TIER_SKILLS: Array<Array<Omit<GenericSkillSeed, 'id' | 'tier' | 'prerequisiteId'>>> = [
  // tier 1 (requiredLevel 1)
  [
    {
      name: '强力打击',
      description: '下一次攻击造成 150% 伤害',
      classType: 'general',
      type: 'active',
      requiredLevel: 1,
      cooldown: 3,
      mpCost: 5,
      damage: null,
      damagePercent: 150,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
    {
      name: '体质强化',
      description: '最大生命值提升 10%',
      classType: 'general',
      type: 'passive',
      requiredLevel: 1,
      cooldown: 0,
      mpCost: 0,
      damage: null,
      damagePercent: null,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
  ],
  // tier 2 (requiredLevel 3)
  [
    {
      name: '迅捷步伐',
      description: '3 秒内移动速度提升 30%',
      classType: 'general',
      type: 'active',
      requiredLevel: 3,
      cooldown: 6,
      mpCost: 10,
      damage: null,
      damagePercent: null,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
    {
      name: '法力涌动',
      description: '每 5 秒自动回复 5 点法力',
      classType: 'general',
      type: 'passive',
      requiredLevel: 3,
      cooldown: 0,
      mpCost: 0,
      damage: null,
      damagePercent: null,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
  ],
  // tier 3 (requiredLevel 5)
  [
    {
      name: '震荡波',
      description: '对前方扇形区域造成 80% 攻击力的范围伤害',
      classType: 'general',
      type: 'active',
      requiredLevel: 5,
      cooldown: 5,
      mpCost: 20,
      damage: null,
      damagePercent: 80,
      range: 100,
      aoe: true,
      maxLevel: 3,
    },
    {
      name: '战斗本能',
      description: '攻击力提升 8%',
      classType: 'general',
      type: 'passive',
      requiredLevel: 5,
      cooldown: 0,
      mpCost: 0,
      damage: null,
      damagePercent: null,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
  ],
  // tier 4 (requiredLevel 7)
  [
    {
      name: '不屈意志',
      description: '3 秒内受到的所有伤害降低 50%',
      classType: 'general',
      type: 'active',
      requiredLevel: 7,
      cooldown: 12,
      mpCost: 25,
      damage: null,
      damagePercent: null,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
    {
      name: '鹰眼',
      description: '攻击与技能射程提升 15%',
      classType: 'general',
      type: 'passive',
      requiredLevel: 7,
      cooldown: 0,
      mpCost: 0,
      damage: null,
      damagePercent: null,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
  ],
  // tier 5 (requiredLevel 9)
  [
    {
      name: '毁灭打击',
      description: '造成 300% 伤害，并有 50% 概率眩晕目标 1 秒',
      classType: 'general',
      type: 'active',
      requiredLevel: 9,
      cooldown: 15,
      mpCost: 40,
      damage: null,
      damagePercent: 300,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
    {
      name: '灵魂链接',
      description: '击杀敌人时回复自身 3% 最大生命值',
      classType: 'general',
      type: 'passive',
      requiredLevel: 9,
      cooldown: 0,
      mpCost: 0,
      damage: null,
      damagePercent: null,
      range: null,
      aoe: false,
      maxLevel: 3,
    },
  ],
];

function buildSeeds(): GenericSkillSeed[] {
  const seeds: GenericSkillSeed[] = [];
  for (let t = 0; t < TIER_SKILLS.length; t++) {
    const tier = t + 1;
    const slots = TIER_SKILLS[t];
    for (let s = 0; s < slots.length; s++) {
      const id = `gen_t${tier}_s${s + 1}`;
      const prerequisiteId = tier > 1 ? `gen_t${tier - 1}_s${s + 1}` : null;
      seeds.push({
        id,
        ...slots[s],
        tier,
        prerequisiteId,
      });
    }
  }
  return seeds;
}

async function main(): Promise<void> {
  const seeds = buildSeeds();

  // 第一遍：仅 upsert id/name/description/...，不写 prerequisiteId（避免外键顺序问题）
  for (const s of seeds) {
    const existing = await prisma.skillTemplate.findUnique({ where: { id: s.id } });
    if (existing) {
      // 既有同 id 跳过 create，但允许更新 tier 与可能未填充的字段（保险）
      await prisma.skillTemplate.update({
        where: { id: s.id },
        data: {
          tier: s.tier,
        },
      });
      continue;
    }

    await prisma.skillTemplate.create({
      data: {
        id: s.id,
        name: s.name,
        description: s.description,
        classType: s.classType,
        type: s.type,
        requiredLevel: s.requiredLevel,
        cooldown: s.cooldown,
        mpCost: s.mpCost,
        damage: s.damage ?? undefined,
        damagePercent: s.damagePercent ?? undefined,
        range: s.range ?? undefined,
        aoe: s.aoe,
        maxLevel: s.maxLevel,
        tier: s.tier,
        // prerequisiteId 第二遍再补
      },
    });
  }

  // 第二遍：补 prerequisiteId
  for (const s of seeds) {
    if (!s.prerequisiteId) continue;
    await prisma.skillTemplate.update({
      where: { id: s.id },
      data: { prerequisiteId: s.prerequisiteId },
    });
  }

  const total = await prisma.skillTemplate.count();
  const generic = await prisma.skillTemplate.count({ where: { id: { startsWith: 'gen_t' } } });
  console.log(`[seedSkills] 完成：通用技能 ${generic} 条，SkillTemplate 总计 ${total} 条`);
}

main()
  .catch((err) => {
    console.error('[seedSkills] 失败：', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
