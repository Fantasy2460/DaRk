# 黑暗之行 — 多人联机数据库表结构设计

> 本文档基于单机版 `GameSave` / `RunState` 双轨状态改造，覆盖账号、角色、物品、战斗、社交、运营全生命周期。
>
> 存储分层：PostgreSQL 持久化 + Redis 运行时缓存（局内房间/实时状态）。

---

## 目录

1. [账号与认证层](#一账号与认证层)
2. [角色层](#二角色层)
3. [物品与装备层](#三物品与装备层)
4. [图鉴与成就层](#四图鉴与成就层)
5. [战斗与副本层](#五战斗与副本层)
6. [组队与社交层](#六组队与社交层)
7. [经济系统层](#七经济系统层)
8. [运营与邮件层](#八运营与邮件层)
9. [排行榜层](#九排行榜层)
10. [审计与风控层](#十审计与风控层)
11. [Redis 运行时结构](#redis-运行时结构)
12. [预留扩展点](#预留扩展点)

---

## 一、账号与认证层

### 1. `users` —— 玩家账号

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID | PK | 主键 |
| `username` | VARCHAR(32) | UNIQUE, NOT NULL | 显示昵称 |
| `email` | VARCHAR(255) | UNIQUE | 登录邮箱（预留手机/第三方登录位） |
| `password_hash` | VARCHAR(255) | | bcrypt |
| `status` | SMALLINT | DEFAULT 0 | 0=正常, 1=封禁, 2=沉默 |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | |
| `last_login_at` | TIMESTAMPTZ | | |
| `last_login_ip` | INET | | 安全审计 |

**备注**：第三方登录可通过新增 `oauth_provider` + `oauth_openid` 字段实现，不改表结构。

### 2. `user_sessions` —— 登录态（服务端吊销用）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users | |
| `refresh_token_hash` | VARCHAR(255) | NOT NULL | |
| `expires_at` | TIMESTAMPTZ | NOT NULL | |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

**备注**：若纯用 JWT 无状态方案，此表可省略。

---

## 二、角色层

### 3. `characters` —— 角色档案

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID | PK | 主键 |
| `user_id` | UUID | FK → users, NOT NULL | |
| `name` | VARCHAR(32) | NOT NULL | 角色名 |
| `class_type` | VARCHAR(16) | NOT NULL | warrior / mage / sage |
| `level` | SMALLINT | DEFAULT 1 | 1~9 |
| `exp` | INTEGER | DEFAULT 0 | 当前经验 |
| `gold` | INTEGER | DEFAULT 0 | 金币 |
| `total_deaths` | INTEGER | DEFAULT 0 | 累计死亡 |
| `total_extracts` | INTEGER | DEFAULT 0 | 累计成功撤离 |
| `deepest_depth` | SMALLINT | DEFAULT 0 | 最高到达层数 |
| `total_enemies_killed` | INTEGER | DEFAULT 0 | 累计击杀 |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | |

**备注**：支持单账号多角色，目前玩法以单角色为主，表结构已预留。

### 4. `character_stats` —— 角色基础属性

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `character_id` | UUID | PK, FK → characters | |
| `base_hp` | INTEGER | DEFAULT 0 | 不含装备加成 |
| `base_mp` | INTEGER | DEFAULT 0 | |
| `base_attack` | INTEGER | DEFAULT 0 | |
| `base_defense` | INTEGER | DEFAULT 0 | |
| `base_speed` | INTEGER | DEFAULT 0 | |
| `fog_resist` | INTEGER | DEFAULT 0 | |
| `available_stat_points` | SMALLINT | DEFAULT 0 | 升级未分配属性点（预留） |

**备注**：转职/洗点时此表行独立变动，不影响历史装备。

### 5. `character_skills` —— 技能等级

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `character_id` | UUID | PK, FK → characters | |
| `skill_id` | VARCHAR(32) | PK | 如 fireball, whirlwind |
| `level` | SMALLINT | DEFAULT 1 | 当前等级 |
| `unlocked_at` | TIMESTAMPTZ | | 解锁时间 |

### 6. `character_talents` —— 天赋树加点

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `character_id` | UUID | PK, FK → characters | |
| `talent_id` | VARCHAR(32) | PK | |
| `points_invested` | SMALLINT | DEFAULT 0 | 已投入点数 |

---

## 三、物品与装备层

### 7. `item_templates` —— 物品静态模板（策划配表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | VARCHAR(32) | PK | 如 iron_sword, health_potion |
| `name` | VARCHAR(64) | NOT NULL | 显示名 |
| `type` | VARCHAR(16) | NOT NULL | equipment / consumable |
| `slot` | VARCHAR(16) | | equipment 时有值（weapon/helmet/...） |
| `rarity` | CHAR(1) | | C/B/A/S |
| `base_stats_json` | JSONB | | 基础属性浮动区间，如 {"attack": [10,15]} |
| `consumable_type` | VARCHAR(16) | | instantHp / slowHp / vision 等 |
| `consumable_value` | INTEGER | | 数值 |
| `consumable_duration` | INTEGER | | 持续 ms |
| `description` | TEXT | | |
| `max_stack` | SMALLINT | DEFAULT 1 | 叠加数量（药水可 99） |
| `buy_price` | INTEGER | DEFAULT 0 | NPC 购买价 |
| `sell_price` | INTEGER | DEFAULT 0 | NPC 出售价 |
| `drop_level_min` | SMALLINT | | 掉落层数下限 |
| `drop_level_max` | SMALLINT | | 掉落层数上限 |
| `is_deleted` | BOOLEAN | DEFAULT false | 软删，老装备实例不受影响 |

### 8. `player_items` —— 玩家物品实例（背包 + 装备栏统一表）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID / BIGSERIAL | PK | 唯一实例 ID |
| `character_id` | UUID | FK → characters, NOT NULL | |
| `template_id` | VARCHAR(32) | FK → item_templates, NOT NULL | |
| `rarity` | CHAR(1) | | 实例实际品质 |
| `stats_json` | JSONB | | 最终随机属性，如 {"attack": 13} |
| `location` | VARCHAR(16) | DEFAULT 'inventory' | inventory / equipped / city_storage |
| `slot_position` | SMALLINT | | 背包格子索引（0~23） |
| `equipped_slot` | VARCHAR(16) | | weapon/helmet/...，仅 equipped 时有值 |
| `stack_count` | SMALLINT | DEFAULT 1 | 当前堆叠数 |
| `obtained_from` | VARCHAR(32) | | drop / shop / mail / craft |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | |

**设计说明**：
- 装备与背包不拆两张表。局内拖拽（背包→装备栏）是同一物品实例的位置变更，单表 + `location` 避免跨表事务。
- `city_storage` 为预留仓库位。

### 9. `item_enchantments` —— 装备附魔/强化（预留）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `item_id` | UUID | PK, FK → player_items | |
| `enchant_level` | SMALLINT | DEFAULT 0 | +1, +2... |
| `bonus_stats_json` | JSONB | | 强化额外属性 |

---

## 四、图鉴与成就层

### 10. `player_bestiary` —— 怪物图鉴

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `character_id` | UUID | PK, FK → characters | |
| `enemy_template_id` | VARCHAR(32) | PK | |
| `kill_count` | INTEGER | DEFAULT 0 | |
| `first_kill_at` | TIMESTAMPTZ | | |
| `last_kill_at` | TIMESTAMPTZ | | |

### 11. `player_equipment_codex` —— 装备图鉴

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `character_id` | UUID | PK, FK → characters | |
| `template_id` | VARCHAR(32) | PK, FK → item_templates | |
| `first_obtain_at` | TIMESTAMPTZ | | |
| `obtain_count` | INTEGER | DEFAULT 0 | |

### 12. `achievements` —— 成就定义（静态）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | VARCHAR(32) | PK | |
| `name` | VARCHAR(64) | NOT NULL | |
| `description` | TEXT | | |
| `category` | VARCHAR(16) | | kill / explore / collection |
| `target_value` | INTEGER | | 达成阈值 |

### 13. `player_achievements` —— 玩家成就进度

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `character_id` | UUID | PK, FK → characters | |
| `achievement_id` | VARCHAR(32) | PK, FK → achievements | |
| `current_value` | INTEGER | DEFAULT 0 | |
| `completed_at` | TIMESTAMPTZ | | NULL 表示未完成 |

---

## 五、战斗与副本层

### 14. `runs` —— 单次黑暗森林探险记录

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID / BIGSERIAL | PK | |
| `character_id` | UUID | FK → characters | 队长/创建者 |
| `party_id` | UUID | FK → parties | 组队 ID |
| `result` | VARCHAR(16) | | extracted / died / abandoned |
| `start_depth` | SMALLINT | | |
| `end_depth` | SMALLINT | | |
| `enemies_killed` | SMALLINT | DEFAULT 0 | |
| `items_found_json` | JSONB | | 本局获得物品 ID 列表 |
| `gained_exp` | INTEGER | DEFAULT 0 | |
| `gained_gold` | INTEGER | DEFAULT 0 | |
| `elapsed_time_sec` | INTEGER | | 耗时（秒） |
| `started_at` | TIMESTAMPTZ | | |
| `ended_at` | TIMESTAMPTZ | | |

### 15. `run_participants` —— 每局队员详情

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `run_id` | UUID / BIGSERIAL | PK, FK → runs | |
| `character_id` | UUID | PK, FK → characters | |
| `is_host` | BOOLEAN | DEFAULT false | 是否为队长 |
| `damage_dealt` | INTEGER | DEFAULT 0 | |
| `damage_taken` | INTEGER | DEFAULT 0 | |
| `healing_done` | INTEGER | DEFAULT 0 | 贤者治疗量 |
| `deaths` | SMALLINT | DEFAULT 0 | 局内死亡次数 |

---

## 六、组队与社交层

### 16. `parties` —— 队伍

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | UUID / BIGSERIAL | PK | |
| `leader_character_id` | UUID | FK → characters | |
| `status` | VARCHAR(16) | DEFAULT 'forming' | forming / in_run / disbanded |
| `current_run_id` | UUID | FK → runs, NULL | |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `disbanded_at` | TIMESTAMPTZ | | |

### 17. `party_members` —— 队伍成员历史

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `party_id` | UUID / BIGSERIAL | PK, FK → parties | |
| `character_id` | UUID | PK, FK → characters | |
| `joined_at` | TIMESTAMPTZ | DEFAULT now() | |
| `left_at` | TIMESTAMPTZ | | NULL 表示仍在队中 |

### 18. `friendships` —— 好友关系

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `requester_id` | UUID | FK → users | 发起者 |
| `addressee_id` | UUID | FK → users | 接收者 |
| `status` | VARCHAR(16) | DEFAULT 'pending' | pending / accepted / blocked |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | |

**索引**：联合唯一索引 `(LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))`，防止重复好友。

### 19. `friend_messages` —— 好友私聊（离线留言）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `sender_id` | UUID | FK → users | |
| `receiver_id` | UUID | FK → users | |
| `content` | TEXT | NOT NULL | |
| `is_read` | BOOLEAN | DEFAULT false | |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

---

## 七、经济系统层

### 20. `shops` —— NPC 商店定义

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | VARCHAR(32) | PK | blacksmith / armorer / alchemist |
| `name` | VARCHAR(64) | NOT NULL | |

### 21. `shop_items` —— 商店货架

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `shop_id` | VARCHAR(32) | FK → shops | |
| `template_id` | VARCHAR(32) | FK → item_templates | |
| `price` | INTEGER | NOT NULL | |
| `currency` | VARCHAR(16) | DEFAULT 'gold' | 预留 crystal 等 |
| `stock` | SMALLINT | DEFAULT -1 | -1 无限，>0 限量 |
| `refresh_type` | VARCHAR(16) | | daily / weekly / permanent |
| `valid_until` | TIMESTAMPTZ | NULL | 限时商品到期时间 |

### 22. `character_transactions` —— 金币/货币流水

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `character_id` | UUID | FK → characters | |
| `type` | VARCHAR(32) | NOT NULL | kill_drop / shop_buy / shop_sell / run_reward / mail_attach / admin_give |
| `amount` | INTEGER | NOT NULL | 正数收入，负数支出 |
| `balance_after` | INTEGER | NOT NULL | 变动后余额 |
| `related_item_id` | UUID | FK → player_items, NULL | |
| `related_run_id` | UUID | FK → runs, NULL | |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

**备注**：反作弊与经济监控必需。所有金币变动必须有流水记录。

---

## 八、运营与邮件层

### 23. `mail` —— 系统邮件 / 补偿 / 奖励

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `character_id` | UUID | FK → characters | 全服广播预留 character_id=0 或另加 `is_broadcast` |
| `sender_name` | VARCHAR(64) | DEFAULT '系统' | |
| `title` | VARCHAR(128) | NOT NULL | |
| `content` | TEXT | | |
| `attachments_json` | JSONB | | 如 [{"template_id":"health_potion","count":5}] |
| `is_read` | BOOLEAN | DEFAULT false | |
| `is_claimed` | BOOLEAN | DEFAULT false | 附件是否领取 |
| `expired_at` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

### 24. `announcements` —— 全服公告

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `type` | VARCHAR(16) | NOT NULL | login_popup / scroll / maintenance |
| `content` | TEXT | NOT NULL | |
| `start_at` | TIMESTAMPTZ | | |
| `end_at` | TIMESTAMPTZ | | |
| `is_active` | BOOLEAN | DEFAULT true | |

---

## 九、排行榜层

### 25. `leaderboard_seasons` —— 赛季/周期

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `name` | VARCHAR(64) | NOT NULL | 如 "第一赛季：深渊觉醒" |
| `start_at` | TIMESTAMPTZ | | |
| `end_at` | TIMESTAMPTZ | | |

### 26. `leaderboard_entries` —— 排行榜记录

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `season_id` | BIGSERIAL | PK, FK → leaderboard_seasons | |
| `category` | VARCHAR(32) | PK | deepest_depth / total_kills / fastest_clear |
| `character_id` | UUID | PK, FK → characters | |
| `score` | INTEGER | NOT NULL | 层数 / 击杀数 / 时间（秒） |
| `rank` | INTEGER | | 结算时快照 |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | |

---

## 十、审计与风控层

### 27. `audit_logs` —— 行为审计

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `user_id` | UUID | FK → users | |
| `character_id` | UUID | FK → characters, NULL | |
| `action` | VARCHAR(64) | NOT NULL | login / equip_item / start_run / use_consumable ... |
| `details_json` | JSONB | | 上下文参数 |
| `client_ip` | INET | | |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

### 28. `anti_cheat_flags` —— 异常标记

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `character_id` | UUID | FK → characters | |
| `type` | VARCHAR(32) | NOT NULL | speed_hack / damage_modifier / impossible_drop |
| `confidence` | SMALLINT | | 0~100 |
| `evidence_json` | JSONB | | 证据详情 |
| `reviewed_by` | VARCHAR(64) | NULL | GM 账号 |
| `reviewed_at` | TIMESTAMPTZ | | |
| `action_taken` | VARCHAR(32) | | 处理结果 |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | |

---

## Redis 运行时结构

Redis 负责高频、低延迟、过期的数据，局内状态原则上**不直接写 PostgreSQL**，由房间服务维护，仅在结算时批量落库。

| Key 模式 | Redis 类型 | 说明 | TTL |
|---|---|---|---|
| `room:{room_id}` | Hash | 房间状态：队长、层数、难度、status | 1h |
| `room:{room_id}:members` | Hash | 成员角色 ID、职业、准备状态 | 1h |
| `run:{run_id}:state` | Hash | 局内实时快照（各玩家 HP/MP/坐标） | 1h |
| `run:{run_id}:entities` | JSON String | 权威敌人/投射物/掉落物状态 | 1h |
| `run:{run_id}:damage_log` | List | 实时伤害事件队列（结算时汇总） | 1h |
| `match_queue:{mode}` | ZSet | 匹配队列，score=入队时间戳 | 10m |
| `session:{token}` | String / Hash | Session 映射或 JWT 黑名单 | 7d |
| `rate_limit:{action}:{user_id}` | String | 登录/创建房间等行为频率限制 | 视规则 |
| `leaderboard:{season}:{cat}:live` | Sorted Set | 实时排行榜，score=分数 | 永久（定时刷回 PG）|

---

## 预留扩展点

以下功能无需新增核心表即可实现：

| 功能 | 实现方式 |
|---|---|
| **多角色** | `characters` 已关联 `user_id`，单账号多行即可 |
| **仓库/银行** | `player_items.location` 增加 `storage` 枚举值 |
| **装备洗练/镶嵌** | 扩展 `item_enchantments` 或 `player_items.stats_json` 结构 |
| **新货币（钻石/代币）** | `character_transactions.currency` 已为字符串，直接复用 |
| **限时活动商店** | `shop_items.valid_until` + `refresh_type` 已支持 |
| **全服邮件** | `mail` 表预留 `character_id=0` 或增加 `is_broadcast` 字段 |
| **公会** | 新增 `guilds` + `guild_members` 两张表，不影响现有结构 |
| **交易行/拍卖** | 新增 `auction_items` 表，复用 `player_items` 实例 |
| **时装/外观** | `item_templates.type` 增加 `cosmetic`，`player_items` 统一存放 |

---

## 待讨论事项

1. **金币层级**：当前设计为角色级（`characters.gold`），若需账号级共享钱包，需拆出 `user_wallets` 表。
2. **局内背包是否同步到数据库**：建议局内 `runInventory` 仅存在 Redis `run:{run_id}:state`，撤离/死亡结算后再写 `player_items`。死亡不保留任何物品，无需回写。
3. **装备唯一 ID 生成策略**：BIGSERIAL 简单但分库分表后需改雪花/UUID；如预期玩家量不大，BIGSERIAL 即可。
4. **是否需要 `user_profiles` 拆分**：`users` 表目前较瘦，若后续加头像、签名、地区等，直接加列或拆 `user_profiles` 均可。
5. **聊天记录保留时长**：`friend_messages` 当前设计永久保留，如量大可加 `archived_at` 字段转冷存。
