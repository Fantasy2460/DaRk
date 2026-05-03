/**
 * SkillService（TASK-SKILL-BE）
 *
 * 处理玩家主动消耗 skillPoint 升级技能。
 *
 * 关键约定：
 * - skillPoints 存储在 CharacterStats（@id characterId）模型，不在 Character 主表。
 * - CharacterSkill 复合主键：[characterId, skillId]，复合唯一键名为 characterId_skillId。
 * - 校验失败返回 { ok: false, code }，由路由层映射为 400/404；不抛业务异常给路由。
 * - 严重违规（职业不符 / 等级不达 / 已满级 / SP 不足）写 AntiCheatFlag。
 *
 * 调用方需在 route 层完成 JWT 鉴权 + characterId 归属校验（外层做归属校验是项目惯例）。
 * 但本服务自身仍在事务首步 where: { id, userId } 兜底校验，避免越权。
 */

import { prisma } from '../config/database';
import { flagAnomaly } from './AntiCheatService';
import { createAuditLog } from './AuditService';

export type UpgradeSkillErrorCode =
  | 'CHARACTER_NOT_FOUND'
  | 'SKILL_TEMPLATE_NOT_FOUND'
  | 'SKILL_UPGRADE_CLASS_MISMATCH'
  | 'SKILL_UPGRADE_LEVEL_LOCKED'
  | 'SKILL_UPGRADE_MAXED'
  | 'SKILL_UPGRADE_INSUFFICIENT_SP';

export interface UpgradeSkillError {
  ok: false;
  code: UpgradeSkillErrorCode;
  message: string;
}

export interface UpgradeSkillSuccess {
  ok: true;
  skillPoints: number;
  skillLevels: Record<string, number>;
  upgradedSkillId: string;
  newLevel: number;
}

export type UpgradeSkillResult = UpgradeSkillSuccess | UpgradeSkillError;

/**
 * 主入口：消耗 1 点 skillPoint 把指定技能升 1 级。
 *
 * 校验链（任一失败 → flagAnomaly + 返回 error code）：
 *   1. 角色归属（where { id, userId } 找不到 → CHARACTER_NOT_FOUND，不 flag）
 *   2. SkillTemplate 存在 → SKILL_TEMPLATE_NOT_FOUND（不 flag）
 *   3. classType 匹配 → SKILL_UPGRADE_CLASS_MISMATCH（flag）
 *   4. 角色等级 ≥ requiredLevel → SKILL_UPGRADE_LEVEL_LOCKED（flag）
 *   5. 当前 skill level < maxLevel → SKILL_UPGRADE_MAXED（flag）
 *   6. skillPoints ≥ 1 → SKILL_UPGRADE_INSUFFICIENT_SP（flag）
 *
 * 全部通过后在事务内：
 *   - CharacterStats.skillPoints -1
 *   - CharacterSkill upsert/+1（不存在则 create level=1，存在则 increment）
 *   - 写审计日志 SKILL_UPGRADE
 *
 * 最后回读 CharacterStats.skillPoints + 全部 CharacterSkill，组装 snapshot 返回。
 */
export async function upgradeSkill(
  userId: string,
  characterId: string,
  skillId: string,
  clientIp?: string
): Promise<UpgradeSkillResult> {
  // 1) 归属校验（route 层已做，此处作为兜底）
  const character = await prisma.character.findUnique({
    where: { id: characterId, userId },
    select: {
      id: true,
      level: true,
      classType: true,
      stats: { select: { skillPoints: true } },
    },
  });
  if (!character) {
    return {
      ok: false,
      code: 'CHARACTER_NOT_FOUND',
      message: '角色不存在或无权操作',
    };
  }

  // 2) 取 SkillTemplate + 当前 CharacterSkill（同事务前的并行查询，无需事务）
  const [template, characterSkill] = await Promise.all([
    prisma.skillTemplate.findUnique({ where: { id: skillId } }),
    prisma.characterSkill.findUnique({
      where: { characterId_skillId: { characterId, skillId } },
    }),
  ]);

  if (!template) {
    return {
      ok: false,
      code: 'SKILL_TEMPLATE_NOT_FOUND',
      message: `技能模板不存在: ${skillId}`,
    };
  }

  // 3) classType 匹配（'general' 视为通用，所有职业可学）
  if (template.classType !== 'general' && template.classType !== character.classType) {
    await flagAnomaly({
      reason: 'SKILL_UPGRADE_CLASS_MISMATCH',
      characterId,
      details: {
        skillId,
        skillClass: template.classType,
        characterClass: character.classType,
      },
      confidence: 70,
    });
    return {
      ok: false,
      code: 'SKILL_UPGRADE_CLASS_MISMATCH',
      message: '该技能不属于当前职业',
    };
  }

  // 4) 等级校验
  if (character.level < template.requiredLevel) {
    await flagAnomaly({
      reason: 'SKILL_UPGRADE_LEVEL_LOCKED',
      characterId,
      details: {
        skillId,
        requiredLevel: template.requiredLevel,
        characterLevel: character.level,
      },
      confidence: 60,
    });
    return {
      ok: false,
      code: 'SKILL_UPGRADE_LEVEL_LOCKED',
      message: `角色等级不足，需要 ${template.requiredLevel} 级`,
    };
  }

  // 5) 已满级校验（maxLevel 为 null 视为无上限）
  const currentLevel = characterSkill?.level ?? 0;
  if (template.maxLevel !== null && currentLevel >= template.maxLevel) {
    await flagAnomaly({
      reason: 'SKILL_UPGRADE_MAXED',
      characterId,
      details: {
        skillId,
        currentLevel,
        maxLevel: template.maxLevel,
      },
      confidence: 50,
    });
    return {
      ok: false,
      code: 'SKILL_UPGRADE_MAXED',
      message: '该技能已达最大等级',
    };
  }

  // 6) skillPoints 校验
  const currentSp = character.stats?.skillPoints ?? 0;
  if (currentSp < 1) {
    await flagAnomaly({
      reason: 'SKILL_UPGRADE_INSUFFICIENT_SP',
      characterId,
      details: {
        skillId,
        currentSp,
        required: 1,
      },
      confidence: 50,
    });
    return {
      ok: false,
      code: 'SKILL_UPGRADE_INSUFFICIENT_SP',
      message: '技能点不足',
    };
  }

  const fromLevel = currentLevel;
  const toLevel = currentLevel + 1;

  // 7) 事务内执行升级 + 回读 snapshot
  const result = await prisma.$transaction(async (tx) => {
    // 7.1 扣 skillPoints
    const updatedStats = await tx.characterStats.update({
      where: { characterId },
      data: { skillPoints: { decrement: 1 } },
      select: { skillPoints: true },
    });

    // 7.2 升级 / 创建 CharacterSkill
    if (characterSkill) {
      await tx.characterSkill.update({
        where: { characterId_skillId: { characterId, skillId } },
        data: { level: { increment: 1 } },
      });
    } else {
      await tx.characterSkill.create({
        data: {
          characterId,
          skillId,
          level: 1,
          unlockedAt: new Date(),
        },
      });
    }

    // 7.3 回读全部 CharacterSkill
    const allSkills = await tx.characterSkill.findMany({
      where: { characterId },
      select: { skillId: true, level: true },
    });

    return {
      skillPoints: updatedStats.skillPoints,
      skillLevels: Object.fromEntries(
        allSkills.map((s) => [s.skillId, s.level])
      ) as Record<string, number>,
    };
  });

  // 8) 审计日志（fire-and-forget）
  await createAuditLog({
    userId,
    characterId,
    action: 'SKILL_UPGRADE',
    details: {
      skillId,
      fromLevel,
      toLevel,
      skillPointsAfter: result.skillPoints,
    },
    clientIp,
  }).catch(() => {});

  return {
    ok: true,
    skillPoints: result.skillPoints,
    skillLevels: result.skillLevels,
    upgradedSkillId: skillId,
    newLevel: toLevel,
  };
}
