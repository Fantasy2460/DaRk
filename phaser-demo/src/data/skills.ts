import type { SkillTreeTier } from '../types';

export const SKILL_TIERS: SkillTreeTier[] = [
  {
    level: 1,
    skills: [
      {
        id: 'power_strike',
        name: '强力打击',
        description: '下一次攻击造成 150% 伤害',
        type: 'active',
        requiredLevel: 1,
        cooldown: 3000,
        mpCost: 5,
        damage: 1.5,
        maxLevel: 3,
      },
      {
        id: 'vitality_boost',
        name: '体质强化',
        description: '最大生命值提升 10%',
        type: 'passive',
        requiredLevel: 1,
        cooldown: 0,
        mpCost: 0,
        maxLevel: 3,
      },
    ],
  },
  {
    level: 3,
    skills: [
      {
        id: 'swift_step',
        name: '迅捷步伐',
        description: '3 秒内移动速度提升 30%',
        type: 'active',
        requiredLevel: 3,
        cooldown: 6000,
        mpCost: 10,
        maxLevel: 3,
      },
      {
        id: 'mana_surge',
        name: '法力涌动',
        description: '每 5 秒自动回复 5 点法力',
        type: 'passive',
        requiredLevel: 3,
        cooldown: 0,
        mpCost: 0,
        maxLevel: 3,
      },
    ],
  },
  {
    level: 5,
    skills: [
      {
        id: 'shockwave',
        name: '震荡波',
        description: '对前方扇形区域造成 80% 攻击力的范围伤害',
        type: 'active',
        requiredLevel: 5,
        cooldown: 5000,
        mpCost: 20,
        damage: 0.8,
        range: 100,
        aoe: true,
        maxLevel: 3,
      },
      {
        id: 'combat_instinct',
        name: '战斗本能',
        description: '攻击力提升 8%',
        type: 'passive',
        requiredLevel: 5,
        cooldown: 0,
        mpCost: 0,
        maxLevel: 3,
      },
    ],
  },
  {
    level: 7,
    skills: [
      {
        id: 'unyielding_will',
        name: '不屈意志',
        description: '3 秒内受到的所有伤害降低 50%',
        type: 'active',
        requiredLevel: 7,
        cooldown: 12000,
        mpCost: 25,
        maxLevel: 3,
      },
      {
        id: 'eagle_eye',
        name: '鹰眼',
        description: '攻击与技能射程提升 15%',
        type: 'passive',
        requiredLevel: 7,
        cooldown: 0,
        mpCost: 0,
        maxLevel: 3,
      },
    ],
  },
  {
    level: 9,
    skills: [
      {
        id: 'devastating_blow',
        name: '毁灭打击',
        description: '造成 300% 伤害，并有 50% 概率眩晕目标 1 秒',
        type: 'active',
        requiredLevel: 9,
        cooldown: 15000,
        mpCost: 40,
        damage: 3.0,
        maxLevel: 3,
      },
      {
        id: 'soul_link',
        name: '灵魂链接',
        description: '击杀敌人时回复自身 3% 最大生命值',
        type: 'passive',
        requiredLevel: 9,
        cooldown: 0,
        mpCost: 0,
        maxLevel: 3,
      },
    ],
  },
];

/** 获取所有技能的最大等级之和，用于计算总进度 */
export function getTotalMaxSkillLevels(): number {
  return SKILL_TIERS.reduce((sum, tier) => sum + tier.skills.reduce((s, sk) => s + (sk.maxLevel ?? 1), 0), 0);
}
