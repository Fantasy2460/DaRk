

---

# 模块一：图鉴/装备图鉴后端化（Bestiary & Equipment Codex）

> 状态：待分析。当前 `bestiary` 和 `equipmentCodex` 仍为前端 `GameSave` 中的字符串数组，后端 `PlayerBestiary` 表只记录击杀数，未提供完整的图鉴查询 API。

---

# 模块二：审计日志（Audit）补齐

> 本文档供子 Agent 直接阅读并执行开发，无需向用户确认。

---

## 1. 模块概述

| 模块 | 状态 | 说明 |
|------|------|------|
| **审计日志写入** | ⚠️ 部分覆盖 | 后端 API 完整，但前端部分关键操作未发送审计日志 |
| **审计日志查询** | ✅ 已完整 | `GET /api/audit/character/:characterId` 已可用 |

后端审计系统已完整，无需新增端点或改 schema。**本模块只需在前端补齐缺失的审计日志调用**。

---

## 2. 后端现状确认（无需开发）

### 2.1 端点

- `POST /api/audit` — 写入审计日志（含归属校验 + 高频限流 100ms）
- `GET /api/audit/character/:characterId` — 查询某角色的审计日志（最多 500 条）

### 2.2 Service

`server/src/services/AuditService.ts`：
- `createAuditLog(input)` — 创建记录
- `getAuditLogsByCharacter(characterId, limit)` — 查询记录

### 2.3 Schema

```prisma
model AuditLog {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  characterId String?  @map("character_id")
  action      String
  detailsJson String?  @map("details_json")
  clientIp    String?  @map("client_ip")
  createdAt   DateTime @default(now()) @map("created_at")
}
```

表已存在，无需迁移。

---

## 3. 前端审计日志现状

### 3.1 已覆盖的操作

| action | 发送位置 | 说明 |
|--------|----------|------|
| `item_drop` | `ForestScene.ts:1847,1890,1905` | 掉落物品时 |
| `item_pickup` | `ForestScene.ts:2011,2026,2040` | 拾取物品时 |
| `equip_change` | `ForestScene.ts:1496,1526` + `MainCityScene.ts` | 装备/卸下时 |
| `shop_buy` | `MainCityScene.ts:497` | 商店购买时 |
| `consumable_use` | `ForestScene.ts:952` | 使用消耗品时 |
| `player_death` | `ForestScene.ts:2158` | 死亡时 |
| `player_extract` | `ForestScene.ts:1676` | 撤离时 |
| `go_deeper` | `ForestScene.ts:1738` | 深入下一层时 |

### 3.2 缺失的操作（需补齐）

| # | action | 缺失位置 | 说明 | 优先级 |
|---|--------|----------|------|--------|
| 1 | `item_sell` | `MainCityScene.sellSlotItem()` | 出售物品成功时未发送 | 高 |
| 2 | `item_discard` | `MainCityScene.discardSlotItem()` | 丢弃物品时未发送 | 高 |
| 3 | `player_level_up` | `ForestScene.updateHUD()` | 升级时未发送（`state.save.level > this.lastLevel` 处） | 中 |
| 4 | `run_start` | `GameState.startRun()` | 开始探险时未发送 | 低 |

---

## 4. 开发规范

### 4.1 新增 AuditLogger 快捷方法

在 `phaser-demo/src/utils/AuditLogger.ts` 中新增以下方法（参考已有方法格式）：

```typescript
/** 出售物品 */
export function logSell(params: {
  itemName: string;
  itemId: string;
  itemRarity?: string;
  price: number;
  goldBefore: number;
  goldAfter: number;
  location: 'forest' | 'city';
}) {
  logAudit('item_sell', params);
  logTransaction('item_sell', params.price, params.goldAfter, {
    relatedItemId: params.itemId,
  });
}

/** 丢弃物品 */
export function logDiscard(params: {
  itemName: string;
  itemId: string;
  itemRarity?: string;
  location: 'forest' | 'city';
}) {
  logAudit('item_discard', params);
}

/** 升级 */
export function logLevelUp(params: {
  oldLevel: number;
  newLevel: number;
  statsAwarded: number;
}) {
  logAudit('player_level_up', params);
}

/** 开始探险 */
export function logStartRun(params: {
  classType: string;
  depth: number;
}) {
  logAudit('run_start', params);
}
```

### 4.2 在业务代码中调用

#### 4.2.1 出售物品 — `MainCityScene.sellSlotItem()`

位置：`phaser-demo/src/scenes/MainCityScene.ts` 第 775-802 行

在出售成功且后端返回成功（`result.success`）后，添加：

```typescript
logSell({
  itemName: slotItem.name,
  itemId: slotItem.id,
  itemRarity: slotItem.rarity,
  price: result.price ?? 0,
  goldBefore: state.save.gold + (result.price ?? 0), // 或者记录出售前的金币
  goldAfter: state.save.gold,
  location: 'city',
});
```

**注意**：`state.sellItem()` 内部已经更新了 `state.save.gold`，所以调用时金币已是扣除后的值。如果需要记录出售前金额，需在调用 `state.sellItem()` 之前保存 `goldBefore`。

#### 4.2.2 丢弃物品 — `MainCityScene.discardSlotItem()`

位置：`phaser-demo/src/scenes/MainCityScene.ts` 第 802-810 行

在丢弃成功后添加：

```typescript
logDiscard({
  itemName: slotItem.name,
  itemId: slotItem.id,
  itemRarity: slotItem.rarity,
  location: 'city',
});
```

#### 4.2.3 升级 — `ForestScene.updateHUD()`

位置：`phaser-demo/src/scenes/ForestScene.ts` 第 2104-2108 行

在 `state.save.level > this.lastLevel` 条件内添加：

```typescript
logLevelUp({
  oldLevel: this.lastLevel,
  newLevel: state.save.level,
  statsAwarded: 5, // 或从实际升级结果中获取，当前每级固定 5 点
});
```

#### 4.2.4 开始探险 — `GameState.startRun()`

位置：`phaser-demo/src/managers/GameState.ts` 第 104-151 行

在 `startRun()` 成功初始化 run 后添加：

```typescript
logStartRun({
  classType: this.save.selectedClass ?? 'warrior',
  depth: this.run?.forestDepth ?? 1,
});
```

---

## 5. 实现步骤

### Step 1：新增 AuditLogger 快捷方法

**文件**：`phaser-demo/src/utils/AuditLogger.ts`

新增 `logSell`、`logDiscard`、`logLevelUp`、`logStartRun` 四个方法。

### Step 2：在业务代码中插入调用

**文件及位置**：
- `MainCityScene.ts:775` — `sellSlotItem()` 成功后调用 `logSell`
- `MainCityScene.ts:802` — `discardSlotItem()` 成功后调用 `logDiscard`
- `ForestScene.ts:2104` — 升级检测内调用 `logLevelUp`
- `GameState.ts:120` — `startRun()` 内调用 `logStartRun`

### Step 3：验证

- 出售物品 → 检查后端 `AuditLog` 表出现 `action='item_sell'` 记录
- 丢弃物品 → 检查出现 `action='item_discard'` 记录
- 击杀升级 → 检查出现 `action='player_level_up'` 记录
- 开始探险 → 检查出现 `action='run_start'` 记录

---

## 6. 边界与约束

1. **不改后端**：审计日志后端 API 已完整，无需任何后端修改
2. **不改 schema**：`AuditLog` 表已足够
3. **fire-and-forget**：所有审计日志调用继续沿用 `.catch(() => {})` 模式，不阻塞游戏
4. **离线兼容**：离线模式下 `api.logAudit` 会失败并被 catch 静默忽略，这是预期行为
5. **参数尽量完整**：logSell 需要同时记录审计日志和交易日志（`logTransaction`）

---

## 7. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `phaser-demo/src/utils/AuditLogger.ts` | Edit | 新增 4 个快捷方法 |
| `phaser-demo/src/scenes/MainCityScene.ts` | Edit | sellSlotItem + discardSlotItem 中插入调用 |
| `phaser-demo/src/scenes/ForestScene.ts` | Edit | updateHUD 升级检测中插入调用 |
| `phaser-demo/src/managers/GameState.ts` | Edit | startRun 中插入调用 |

---

# 模块三：怪物掉落系统 Bug 调查与修复

> 本文档供子 Agent 直接阅读并执行开发，无需向用户确认。

---

## 1. 问题现象

用户反馈：**怪物击杀后地上不再出现掉落物**。图鉴中怪物描述有掉落概率，但实际游戏中无任何物品掉落。

## 2. 代码链路分析

### 2.1 完整调用链

```
ForestScene.handleEnemyDeath()
  └─→ ForestScene.processKillReward()          [ForestScene.ts:1791]
        ├─ 在线分支：state.recordKill()
        │     └─→ api.reportKill()             [ApiClient.ts:553]
        │           └─→ POST /api/characters/:id/kill
        │                 └─→ CharacterService.handleKillEnemy()
        │                       ├─→ ExpService.gainExp()
        │                       ├─→ PlayerBestiary upsert
        │                       └─→ LootService.rollEnemyLoot()   [LootService.ts:95]
        │                             ├─ parseDropTable(dropTableJson)
        │                             ├─ PRNG 抽奖
        │                             ├─ prisma.playerItem.create()
        │                             └─ 返回 RolledLootItem[]
        │
        │     ← 返回 KillResult { exp, level, leveledUp, newItems?, ... }
        │
        │     GameState.recordKill() 内部把 newItems 放入 runInventory
        │
        └─← ForestScene 拿到 result.newItems
              ├─ 从 runInventory 取出（撤回再地面化）
              └─ spawnDropFromKill() → spawnDrop() / spawnConsumableDrop()
                    └─ this.drops.push({ container, item })
                          └─ updateEnemies() 中玩家靠近 30px 触发拾取
```

### 2.2 关键数据类型差异

**后端返回的 `RolledLootItem`**（`LootService.ts:60-70`）：
```typescript
export interface RolledLootItem {
  id: string;              // ← PlayerItem.id（实例ID，如 "177..."）
  templateId: string;      // ← ItemTemplate.id（模板ID，如 "rusty_sword"）
  rarity: string | null;
  name: string;
  slot: string | null;
  description: string | null;
  stackCount: number;
  runId: string | null;
  location: string;
}
```

**前端 `Item` 接口**（`types/index.ts:25-32`）：
```typescript
export interface Item {
  id: string;              // ← 期望 ItemTemplate.id
  name: string;
  rarity: ItemRarity;
  slot: ItemSlot;
  stats: Partial<Stats>;   // ← RolledLootItem 缺少此字段！
  description: string;
}
```

**注意**：`RolledLootItem.id` 是 `PlayerItem.id`（实例ID），而前端 `Item.id` 语义是 `ItemTemplate.id`（模板ID）。这导致 `itemsFound` / `equipmentCodex` 记录的是实例ID，每次运行都不同，图鉴无法正确去重。

## 3. 根因假设（按可能性排序）

### 假设 A：`runId` 缺失导致后端拒绝，降级到本地公式（最可能）

**证据**：
- `reportKill` 端点**强制要求** `runId`（`routes/character.ts:253`）
- 如果 `GameState.runId` 为 `null`，请求缺少 `runId`，后端返回 **400**
- `GameState.recordKill()` catch 后降级到本地公式，本地公式**不返回 `newItems`**
- `ForestScene.processKillReward()` 看到 `result.newItems` 为 `undefined`，不生成掉落物

**`runId` 为 null 的可能原因**：
1. `startRun()` 网络失败，未拿到后端 `runId`
2. `extractRun()` / `dieInRun()` 后 `runId` 被重置，但玩家仍留在 ForestScene（异常状态）
3. 页面刷新后 `runId` 丢失（只存于内存，未持久化到 LocalStorage）

### 假设 B：后端 `EnemyTemplate.dropTableJson` 为空

**证据**：
- `initEnemyTemplates()` 使用 `upsert` + `update: {}`（`server/src/index.ts:188`）
- 如果数据库已存在 `EnemyTemplate` 记录（`count > 0`），**直接跳过**，不会更新 `dropTableJson`
- 若早期迁移/测试创建了空记录，`dropTableJson` 永远为空
- `parseDropTable(null)` 返回 `[]` → `rollEnemyLoot` 返回空数组 → 无掉落

### 假设 C：`Run.seed` 为 null

**证据**：
- `handleKillEnemy` 中：`if (run.seed) { lootResult = await rollEnemyLoot(...) }`
- 若 `Run.seed` 为 null/undefined，**跳过** `rollEnemyLoot`，`newItems` 为空数组
- `Run` 模型中 `seed` 是 `String?`（可空），虽然 `startRun()` 正常情况下会设置 `randomUUID()`，但异常路径可能遗漏

### 假设 D：`RolledLootItem` 类型不完整导致运行时异常

**证据**：
- `RolledLootItem` 缺少前端 `Item` 接口要求的 `stats` 字段
- `spawnDropFromKill()` 将 `RolledLootItem` 强制 `as Item` 传入 `spawnDrop()`
- 当前 `spawnDrop()` 只使用 `item.name`，但如果后续代码（如装备系统）访问 `item.stats` 会返回 `undefined`
- 此问题不会阻止掉落物生成，但会导致拾取后的物品功能异常

## 4. 修复方案

### 4.1 修复 `runId` 缺失问题（假设 A）

**目标**：确保 `reportKill` 时 `runId` 始终有效；若无效则明确走离线分支生成本地掉落。

**修改点 1：`ForestScene.processKillReward()`**（`ForestScene.ts:1791`）

在调用 `state.recordKill()` 前，增加 `runId` 守卫：
```typescript
const offline = SaveManager.isOffline();
const runId = state.runId;

// 如果没有有效的 runId，强制走离线分支（避免后端 400）
if (!offline && !runId) {
  console.warn('[ForestScene] runId 缺失，强制使用本地掉落兜底');
  void state.recordKill(enemyConfig.id);
  this.spawnLocalDropsFromTable(enemyConfig, enemyX, enemyY, depth);
  return;
}
```

**修改点 2：`GameState.startRun()` 持久化 `runId`**（可选，增强鲁棒性）

将 `runId` 持久化到 `GameSave` 或 LocalStorage，避免刷新后丢失。

### 4.2 修复 `EnemyTemplate` 数据初始化（假设 B）

**目标**：确保 `dropTableJson` 始终有数据，即使记录已存在也要更新。

**修改点：`server/src/index.ts:116-189`**

将 `initEnemyTemplates()` 改为**无条件 upsert**（去掉 `count > 0` 短路）：
```typescript
async function initEnemyTemplates() {
  const enemies = [ /* ... 现有数据 ... */ ];
  for (const e of enemies) {
    await prisma.enemyTemplate.upsert({
      where: { id: e.id },
      create: e,
      update: e,  // ← 改为 update: e，确保已有记录也能更新 dropTableJson
    });
  }
  console.log(`[初始化] 已同步 ${enemies.length} 条敌人模板`);
}
```

### 4.3 修复 `Run.seed` 非空约束（假设 C）

**目标**：确保 `startRun` 创建的 `Run` 一定有 `seed`。

**修改点：`server/src/services/RunService.ts:121-193`**

已在 `startRun` 中设置 `seed = randomUUID()`，但需增加防御性检查：
```typescript
if (!seed) {
  throw new Error('Run 创建失败：seed 未生成');
}
```

同时，在 `handleKillEnemy` 中若发现 `run.seed` 缺失，应记录 `LOOT_INVALID_RUN` flag 并降级处理。

### 4.4 补齐 `RolledLootItem` → 前端 `Item` 的字段映射（假设 D）

**目标**：让后端返回的掉落物包含完整的 `stats`，与前端的 `Item` 接口兼容。

**修改点 1：`LootService.rollEnemyLoot()`**（`LootService.ts:134-146`）

在查询 `ItemTemplate` 时，一并查出 `statsJson`：
```typescript
const templates = await prisma.itemTemplate.findMany({
  where: { id: { in: templateIds } },
  select: {
    id: true,
    name: true,
    slot: true,
    rarity: true,
    description: true,
    statsJson: true,  // ← 新增
  },
});
```

**修改点 2：`RolledLootItem` 类型扩展**

```typescript
export interface RolledLootItem {
  // ... 现有字段 ...
  stats: Partial<Stats> | null;  // ← 新增
}
```

**修改点 3：创建 `RolledLootItem` 时传入 `stats`**

```typescript
items.push({
  // ...
  stats: tpl.statsJson ? JSON.parse(tpl.statsJson) : null,
});
```

**修改点 4：前端 `spawnDropFromKill` 中 `newItem.id` 使用 `templateId`**

当前 `RolledLootItem.id` 是 `PlayerItem.id`，但前端 `Item.id` 语义应为 `ItemTemplate.id`。建议：
- 后端 `RolledLootItem` 增加 `templateId` 字段（已有）
- 前端放入 `runInventory` 和 `drops` 时，使用 `templateId` 作为 `item.id`
- 或者增加 `instanceId` 字段区分

### 4.5 修复 `itemsFound` / `equipmentCodex` 的 ID 混淆

**修改点：`ForestScene.updateEnemies()` 拾取逻辑**（`ForestScene.ts:2038`）

```typescript
// 当前：recordItemFound(drop.item.id) 传入的是 PlayerItem.id（实例ID）
// 修复：应使用 ItemTemplate.id
const templateId = (drop.item as any).templateId ?? drop.item.id;
GameState.getInstance().recordItemFound(templateId);
```

同时，`GameState.extractRun()` 中的 `itemsFound` 遍历也应确保使用 `templateId`。

## 5. 实现步骤

### Step 1：诊断当前数据库状态

执行以下 SQL 查询确认假设 B/C：
```sql
-- 检查 EnemyTemplate.dropTableJson 是否为空
SELECT id, name, drop_table_json IS NULL AS is_null, LENGTH(drop_table_json) AS len
FROM enemy_templates;

-- 检查 Run.seed 是否为 null
SELECT id, seed IS NULL AS seed_null, result, ended_at
FROM runs
ORDER BY created_at DESC
LIMIT 5;
```

### Step 2：修复 `initEnemyTemplates`（假设 B）

- 文件：`server/src/index.ts`
- 操作：将 `upsert` 的 `update: {}` 改为 `update: e`
- 重启后端生效

### Step 3：修复 `runId` 守卫（假设 A）

- 文件：`phaser-demo/src/scenes/ForestScene.ts`
- 操作：在 `processKillReward()` 开头增加 `runId` 缺失时的离线兜底

### Step 4：补齐 `stats` 字段映射（假设 D）

- 文件：`server/src/services/LootService.ts`
- 操作：查询 `statsJson`，解析后填入 `RolledLootItem.stats`
- 文件：`phaser-demo/src/types/index.ts`（如有需要，调整 `Item.id` 语义）

### Step 5：修复 `itemsFound` ID 混淆

- 文件：`phaser-demo/src/scenes/ForestScene.ts`
- 操作：拾取时使用 `templateId` 而非 `PlayerItem.id`

### Step 6：验证

1. 启动后端，确认 `enemy_templates` 表中 `drop_table_json` 有值
2. 进入森林，击杀哥布林
3. 观察地上是否出现掉落物（黄色方块 + 名称标签）
4. 走过去拾取，确认进入背包
5. 检查 `PlayerItem` 表中有新记录（`runId` 正确）
6. 撤离后检查 `equipmentCodex` 是否记录 `ItemTemplate.id`（非实例ID）

## 6. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/src/index.ts` | Edit | `initEnemyTemplates` 改为无条件 upsert |
| `server/src/services/LootService.ts` | Edit | 查询 `statsJson`，补齐 `RolledLootItem.stats` |
| `phaser-demo/src/scenes/ForestScene.ts` | Edit | `processKillReward` 增加 `runId` 守卫；拾取逻辑使用 `templateId` |
| `phaser-demo/src/managers/GameState.ts` | Edit（可选） | `startRun` 持久化 `runId` 到 LocalStorage |

---

# 模块四：实时伤害计算系统（Damage Tracker）

> 本文档供子 Agent 直接阅读并执行开发，无需向用户确认。

---

## 1. 模块概述

| 模块 | 状态 | 说明 |
|------|------|------|
| **实时伤害统计** | 待开发 | 局内实时统计玩家造成的伤害，支持技能/普攻拆解 |
| **伤害排名条** | 待开发 | 右上角显示自己（+队友）的总伤害，点击展开详情 |
| **伤害结构面板** | 待开发 | 横向柱状图，按占比降序展示各技能/普攻的伤害量与占比 |
| **联机同步预留** | 待开发 | Socket.io 秒级汇总广播，兼容后续多人伤害排名 |

**约束**：局内死亡数据直接丢弃；撤离后仅当局展示，**不持久化到数据库**。

---

## 2. 数据模型设计

### 2.1 前端类型（`types/index.ts`）

```typescript
/** 单一伤害来源的统计数据 */
export interface DamageSourceStat {
  id: string;        // 'attack_normal' 或 skill.id
  name: string;      // '普通攻击' 或 skill.name
  color: number;     // 柱状图颜色（十六进制）
  castCount: number; // 释放/普攻次数
  totalDamage: number;
}

/** 当前局内的完整伤害统计 */
export interface RunDamageStats {
  totalDamage: number;
  sources: Record<string, DamageSourceStat>;
  version: number;   // 单调递增，用于秒级广播去重
}
```

### 2.2 `RunState` 扩展

```typescript
export interface RunState {
  // ... 现有字段 ...
  damageStats: RunDamageStats;
}
```

`GameState.startRun()` 初始化时：
```typescript
damageStats: {
  totalDamage: 0,
  sources: {},
  version: 0,
}
```

---

## 3. 核心逻辑设计

### 3.1 `DamageTracker` 工具类（新建）

**文件**：`phaser-demo/src/utils/DamageTracker.ts`

职责：提供纯函数式的伤害记录 API，不依赖 Phaser/网络。

```typescript
export function recordDamage(
  stats: RunDamageStats,
  sourceId: string,
  sourceName: string,
  color: number,
  amount: number
): RunDamageStats {
  const next = { ...stats, sources: { ...stats.sources } };
  const existing = next.sources[sourceId];
  if (existing) {
    next.sources[sourceId] = {
      ...existing,
      totalDamage: existing.totalDamage + amount,
    };
  } else {
    next.sources[sourceId] = {
      id: sourceId,
      name: sourceName,
      color,
      castCount: 0,
      totalDamage: amount,
    };
  }
  next.totalDamage += amount;
  return next;
}

export function recordCast(
  stats: RunDamageStats,
  sourceId: string,
  sourceName: string,
  color: number
): RunDamageStats {
  const next = { ...stats, sources: { ...stats.sources } };
  const existing = next.sources[sourceId];
  if (existing) {
    next.sources[sourceId] = {
      ...existing,
      castCount: existing.castCount + 1,
    };
  } else {
    next.sources[sourceId] = {
      id: sourceId,
      name: sourceName,
      color,
      castCount: 1,
      totalDamage: 0,
    };
  }
  return next;
}

export function getSortedSources(
  stats: RunDamageStats
): DamageSourceStat[] {
  return Object.values(stats.sources).sort(
    (a, b) => b.totalDamage - a.totalDamage
  );
}

export function getDamagePercent(
  stat: DamageSourceStat,
  total: number
): number {
  if (total <= 0) return 0;
  return Math.round((stat.totalDamage / total) * 100);
}
```

### 3.2 伤害 Hook 点（ForestScene）

**设计原则**：在每次对敌人造成实际伤害的代码处，**紧接着**调用 `DamageTracker.recordDamage`。

当前 `ForestScene` 中所有 `enemy.takeDamage(...)` 调用点：

| # | 位置 | 来源 | sourceId | sourceName | 颜色 |
|---|------|------|----------|------------|------|
| 1 | `warriorAttack()` ~779 | 战士普攻 | `attack_normal` | `普通攻击` | `0xe5e7eb` |
| 2 | `mageAttack()` ~660 | 法师扇形 | `attack_normal` | `普通攻击` | `0xe5e7eb` |
| 3 | `castSkillEffect()` ~996 | 火球术 | `fireball` | `火球术` | 从 `CLASSES` 读取 |
| 4 | `castSkillEffect()` ~1065 | 陨石术 | `meteor` | `陨石术` | 从 `CLASSES` 读取 |
| 5 | `castSkillEffect()` ~1135 | 贤者技能1 | 对应 skill.id | 对应 skill.name | 从 `CLASSES` 读取 |
| 6 | `castSkillEffect()` ~1163 | 贤者技能2 | 对应 skill.id | 对应 skill.name | 从 `CLASSES` 读取 |
| 7 | `castSkillEffect()` ~1223 | 贤者投射物 | 对应 skill.id | 对应 skill.name | 从 `CLASSES` 读取 |

**实现方式**：在每个 `enemy.takeDamage(dmg)` 调用后增加：
```typescript
const run = GameState.getInstance().run;
if (run) {
  run.damageStats = DamageTracker.recordDamage(
    run.damageStats,
    sourceId,
    sourceName,
    color,
    dmg
  );
}
```

**普攻次数记录**：在 `ForestScene.handleAttack()` 中，当 `attackNearest` 返回命中目标时，记录一次 `attack_normal` 的 `castCount`。

**技能次数记录**：在 `ForestScene.castSkillEffect()` 开头，记录一次对应技能的 `castCount`。

---

## 4. UI 设计

### 4.1 右上角 `DamageBar`

**文件**：`phaser-demo/src/components/DamageBar.ts`（新建）

**外观**：
- 位置：右上角（`x = GAME_CONFIG.width - 20, y = 20`，右对齐）
- 尺寸：宽度 180px，高度自适应（单人时约 40px，多人时扩展）
- 背景：`Rectangle` 填充 `rgba(0,0,0,0.6)`，圆角（用 Graphics 模拟）
- 内容：
  - 第一行：🔥 图标（小色块）+ `总伤害: 12,345`（白色文字，右对齐）
  - 下方（联机时扩展）：队友列表，每人一行 `玩家名 | 伤害`

**交互**：
- 点击整个 `DamageBar` → 展开/关闭 `DamageDetailPanel`
- 鼠标悬停时背景透明度提高到 0.8

**刷新频率**：在 `ForestScene.update()` 中，每秒更新一次数字（用 `time.now` 做节流）。

### 4.2 伤害详情面板 `DamageDetailPanel`

**文件**：`phaser-demo/src/components/DamageDetailPanel.ts`（新建）

**外观**：
- 位置：屏幕中央偏右（`x = GAME_CONFIG.width - 220, y = 80`）
- 尺寸：宽度 200px，最大高度 320px（超出可滚动，但先不做滚动，最多显示前 8 项）
- 背景：`Rectangle` 填充 `rgba(0,0,0,0.85)`，边框 2px `0x475569`

**每行布局**（横向柱状图）：
```
┌────────────────────────────────────────┐
│ [色块] 火球术      3,600      45%      │
│ ████████████████████░░░░░░░░░░░░░░░░   │  ← 横向进度条（占整行宽度的 0-100%）
├────────────────────────────────────────┤
│ [色块] 普通攻击    2,100      26%      │
│ ███████████░░░░░░░░░░░░░░░░░░░░░░░░░   │
├────────────────────────────────────────┤
│ [色块] 陨石术      1,800      23%      │
│ ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░   │
├────────────────────────────────────────┤
│ [色块] 治愈术        600       6%      │
│ ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
└────────────────────────────────────────┘
```

**每行组件**（从上到下）：
1. **图标色块**：`Rectangle` 20x20，颜色为 `source.color`
2. **技能名**：`Text`，白色，`fontSize: 12px`，左对齐，最大宽度 80px（超出截断）
3. **伤害量**：`Text`，`0xfbbf24`（金色），`fontSize: 12px`，右对齐，千分位格式化
4. **占比**：`Text`，`0x9ca3af`（灰色），`fontSize: 11px`，右对齐
5. **进度条**：底部一条细横线（`Rectangle` 高度 4px），填充色为 `source.color`，宽度 = `占比% * 行宽`

**排序**：按 `totalDamage` 降序排列。`DamageTracker.getSortedSources()` 提供。

**关闭方式**：
- 再次点击 `DamageBar`
- 点击面板外部任意位置（在 `ForestScene.update` 中检测鼠标点击）
- 按 `Esc` 键（可选，先不做）

---

## 5. 联机同步预留（Socket.io）

### 5.1 客户端发送（秒级汇总）

在 `ForestScene.update()` 中，每秒执行一次：
```typescript
const now = this.time.now;
if (now - this.lastDamageBroadcast > 1000) {
  this.lastDamageBroadcast = now;
  const stats = GameState.getInstance().run?.damageStats;
  if (stats && stats.version > this.lastBroadcastVersion) {
    this.lastBroadcastVersion = stats.version;
    // 通过 Socket.io 发送（目前先预留接口）
    this.socket?.emit('damage_tick', {
      roomId: this.roomId,
      totalDamage: stats.totalDamage,
      sources: stats.sources,
      version: stats.version,
    });
  }
}
```

### 5.2 客户端接收

```typescript
this.socket?.on('damage_update', (payload: {
  playerId: string;
  playerName: string;
  totalDamage: number;
}) => {
  // 更新 DamageBar 中的队友排名列表
  this.damageBar.updateTeammate(playerId, playerName, totalDamage);
});
```

### 5.3 服务端处理（`server/src/network/SocketHandlers.ts`）

新增 `damage_tick` 事件处理：
- 校验 `roomId` 和 `playerId`
- 将 `totalDamage` 广播给同 room 的其他玩家（排除发送者）
- 格式：`{ type: 'damage_update', playerId, playerName, totalDamage }`

**注意**：服务端不存储伤害数据，只做转发。

---

## 6. 实现步骤

### Step 1：新建 `DamageTracker.ts`

**文件**：`phaser-demo/src/utils/DamageTracker.ts`

实现 `recordDamage`、`recordCast`、`getSortedSources`、`getDamagePercent`。

### Step 2：扩展 `RunState` 与 `GameState`

**文件**：`phaser-demo/src/types/index.ts`、`phaser-demo/src/managers/GameState.ts`

- `RunState` 增加 `damageStats: RunDamageStats`
- `GameState.startRun()` 初始化 `damageStats`

### Step 3：在伤害调用点 Hook

**文件**：`phaser-demo/src/scenes/ForestScene.ts`

遍历所有 `enemy.takeDamage(...)` 调用点（约 7 处），在每次调用后追加 `DamageTracker.recordDamage`。

同时，在 `handleAttack()` 和 `castSkillEffect()` 开头增加 `recordCast` 调用。

### Step 4：新建 `DamageBar.ts`

**文件**：`phaser-demo/src/components/DamageBar.ts`

实现右上角总伤害显示 + 点击展开面板逻辑。

### Step 5：新建 `DamageDetailPanel.ts`

**文件**：`phaser-demo/src/components/DamageDetailPanel.ts`

实现横向柱状图列表，调用 `DamageTracker.getSortedSources` 获取数据。

### Step 6：ForestScene 集成

**文件**：`phaser-demo/src/scenes/ForestScene.ts`

- `create()` 中初始化 `DamageBar` 和 `DamageDetailPanel`
- `update()` 中每秒刷新 `DamageBar` 数字
- 处理 `DamageBar` 点击事件：展开/关闭面板
- `extractRun()` / `dieInRun()` 时销毁面板（或保持到场景切换）

### Step 7：联机同步预留（后端）

**文件**：`server/src/network/SocketHandlers.ts`

新增 `damage_tick` 接收和 `damage_update` 广播逻辑。

### Step 8：验证

1. 进入森林，击杀多个敌人（使用普攻 + 多种技能）
2. 观察右上角 `DamageBar` 数字随时间增长
3. 点击 `DamageBar`，展开详情面板
4. 确认面板中：
   - 各技能/普攻按伤害量降序排列
   - 伤害量、占比、释放次数正确
   - 横向进度条长度与占比成正比
5. 死亡后重新开始，确认伤害数据已清零
6. 撤离后回到主城，再次进入森林，确认新局伤害从零开始

---

## 7. 边界与约束

1. **不持久化**：`RunDamageStats` 仅存在于 `RunState`，死亡/撤离/刷新后丢失
2. **单人优先**：联机同步目前只做接口预留，DamageBar 先只显示自己的伤害
3. **不统计溢出伤害**：如果 `enemy.hp = 10`，玩家造成了 100 伤害，只记录实际扣除的 10（由 `Enemy.takeDamage` 内部计算后的 `dmg` 决定）
4. **不统计对玩家的伤害**：只统计玩家对敌人造成的伤害
5. **不统计召唤物/环境伤害**：只统计玩家本体直接造成的伤害
6. **伤害条每秒刷新**：数字更新频率 1Hz，避免频繁重绘 Text

---

## 8. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `phaser-demo/src/types/index.ts` | Edit | 新增 `DamageSourceStat`、`RunDamageStats` 接口 |
| `phaser-demo/src/managers/GameState.ts` | Edit | `RunState` 初始化 `damageStats` |
| `phaser-demo/src/utils/DamageTracker.ts` | Write | 新建：伤害统计核心逻辑 |
| `phaser-demo/src/components/DamageBar.ts` | Write | 新建：右上角总伤害条 |
| `phaser-demo/src/components/DamageDetailPanel.ts` | Write | 新建：横向柱状图详情面板 |
| `phaser-demo/src/scenes/ForestScene.ts` | Edit | 7 处 `takeDamage` 后 Hook；集成 DamageBar + Panel |
| `phaser-demo/src/entities/Player.ts` | Edit（可能） | 如 `attackNearest` 需记录普攻次数 |
| `server/src/network/SocketHandlers.ts` | Edit | 预留 `damage_tick` / `damage_update` Socket 事件 |

