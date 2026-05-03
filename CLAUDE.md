# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 网络环境

本地开发环境已启用系统代理（Clash/V2Ray，`127.0.0.1:7890`）。所有通过终端访问 GitHub、Homebrew 或外网资源时，代理变量已自动生效：

```bash
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
```

> 如果命令行工具（如 `curl`、`git`、`brew`）出现外网连接超时，请检查上述变量是否已设置。

## 项目概述

《黑暗之行》—— 基于 Phaser 3 的 2D 地牢暗黑探险 Roguelike 游戏。全部图形为程序生成，不依赖外部美术资源。

详细需求规格见 `docs/DEV_REQUIREMENTS.md`。

## 技术栈

- **游戏引擎**：Phaser 3.80.1（Arcade Physics）
- **语言**：TypeScript 5.4（ES2020，严格模式）
- **构建工具**：Vite 5.4
- **持久化**：LocalStorage（`dark_journey_save_v1`）+ 后端 PostgreSQL

### 后端技术栈（server/）

- **运行时**：Node.js 20 + TypeScript 5.4
- **Web 框架**：Express 4
- **实时通信**：Socket.io 4
- **ORM**：Prisma 5（**当前使用 PostgreSQL**，开发期曾用 SQLite）
- **认证**：JWT + bcrypt
- **ID 生成**：应用层 Snowflake 风格 19 位纯数字 ID（`server/src/utils/id.ts`）

## 开发命令

开发时需要**同时运行前后端**（两个终端）：

```bash
# 终端 1：后端（项目根目录/server/）
cd server && npm run dev        # localhost:3001，tsx watch 自动热重载

# 终端 2：前端（项目根目录/phaser-demo/）
cd phaser-demo && npm run dev   # localhost:5173，Vite 热重载
```

其他常用命令：

```bash
# 前端
npm run build    # tsc 类型检查 + vite 构建（输出到 dist/）
npm run preview  # 预览生产构建
npx tsc --noEmit # 仅类型检查

# 后端
npm run build           # 编译到 dist/
npx tsc --noEmit        # 仅类型检查
npx prisma migrate dev  # 数据库迁移（schema 变更后执行）
npx prisma generate     # 重新生成 Prisma Client
npx prisma studio       # GUI 管理数据库
npm run db:seed         # 执行种子脚本（如有）
```

**进程管理**：`tsx watch` 容易在后台堆积僵尸进程，导致端口占用或 exit code 144。若后端无法启动，先执行：
```bash
pkill -f 'tsx watch src/index.ts'
```

**约定**：修改代码后 Claude 应主动检查前后端进程是否在运行，必要时自动重启，无需用户手动操作。Vite 与 tsx watch 通常能自动热重载；若修改了 Prisma schema、环境变量或出现端口占用，则需要手动重启对应服务。

## 项目结构

```
phaser-demo/src/
├── main.ts              # 入口：初始化 Phaser.Game，注册全部 Scene
├── config/gameConfig.ts # 游戏常量（分辨率、移动速度、背包容量、生成数量等）
├── types/index.ts       # 全部 TypeScript 接口（Stats、Item、EnemyType、GameSave、RunState 等）
├── data/                # 静态配置表（仍被部分场景用作 fallback）
│   ├── classes.ts       # 3 种职业基础属性与技能定义
│   ├── enemies.ts       # 敌人类型、AI 参数与掉落表（ForestScene 已优先走 API）
│   └── items.ts         # 装备与消耗品定义（ItemDataManager 已优先走 API）
├── scenes/              # Phaser 场景，按游戏流程串联
│   ├── BootScene.ts     # 启动屏
│   ├── LoginScene.ts    # 登录/注册/角色选择/创建（DOM + 程序绘制混合）
│   ├── MainMenuScene.ts # 主菜单
│   ├── MainCityScene.ts # 主城：NPC 商店（购买已后端化）、背包整理、进入森林
│   ├── SkillScene.ts    # 技能页
│   ├── CharacterScene.ts# 角色属性页
│   ├── ForestScene.ts   # 核心战斗场景：敌人生成走 API、掉落、战斗、拾取、传送门
│   └── GameOverScene.ts # 结算
├── entities/
│   ├── Player.ts        # 玩家实体：移动、攻击、闪避、技能冷却、消耗品效果
│   └── Enemy.ts         # 敌人实体：AI、受击、击退
├── systems/
│   ├── EquipmentSystem.ts   # 7 部位装备栏的穿戴/卸下与属性汇总
│   ├── InventorySystem.ts   # 24 格背包的增删、查找空位
│   └── FogSystem.ts         # 动态迷雾：Canvas 径向渐变
├── managers/
│   ├── GameState.ts     # 全局单例：局外存档（GameSave）与局内状态（RunState）
│   ├── SaveManager.ts   # 存档管理：服务器优先 + LocalStorage 兜底
│   └── ItemDataManager.ts # 物品数据：优先从后端 API 加载，失败回退本地
└── utils/
    └── AuditLogger.ts   # 审计日志 fire-and-forget 工具

server/
├── src/
│   ├── index.ts              # Express + Socket.io 入口；初始化技能/敌人/商店模板
│   ├── config/
│   │   └── database.ts       # Prisma Client 单例
│   ├── middleware/
│   │   └── auth.ts           # JWT 校验中间件（AuthRequest 扩展了 userId）
│   ├── routes/
│   │   ├── auth.ts           # 注册/登录
│   │   ├── character.ts      # 角色 CRUD、存档读/写、背包查询、技能查询
│   │   ├── enemy.ts          # 怪物模板查询、图鉴查询
│   │   ├── shop.ts           # 商店列表、商品列表、购买接口
│   │   ├── item.ts           # 物品模板查询
│   │   ├── audit.ts          # 审计日志写入/查询
│   │   └── transaction.ts    # 金币交易记录写入/查询
│   ├── services/
│   │   ├── AuthService.ts    # 认证业务逻辑
│   │   ├── CharacterService.ts # 角色/存档业务逻辑（save 使用 deleteMany + createMany 简化策略）
│   │   ├── ShopService.ts    # 商店业务（含原子购买事务）
│   │   ├── AuditService.ts   # 审计日志业务
│   │   └── TransactionService.ts # 金币交易业务
│   ├── network/
│   │   └── SocketHandlers.ts # Socket.io 房间/转发事件
│   ├── types/
│   │   └── game.ts           # 前后端共享类型
│   └── utils/
│       └── id.ts             # Snowflake 风格 19 位数字 ID 生成器
└── prisma/
    └── schema.prisma         # 数据库模型定义（28+ 张表）
```

## 核心架构

### 1. 局内 / 局外双轨状态

`GameState` 是全局单例，管理两层数据：

- **`GameSave`**（局外永久存档）：职业选择、主城背包/装备、金币、图鉴进度、天赋树。通过 `SaveManager` 持久化到后端 API，失败回退 LocalStorage。
- **`RunState`**（局内临时状态）：当前层数、HP/MP、迷雾值、局内背包/装备、击杀数。仅在单次探险期间存在。

关键状态流转：
- `startRun()`：从 `GameSave.cityEquipment` 复制装备到 `RunState.runEquipment`，初始化 HP/MP。
- `extractRun()`：存活撤离时，将 `RunState.runInventory` 的物品按顺序填入 `GameSave.cityInventory` 的空位；记录图鉴；清空 `RunState`。
- `dieInRun()`：死亡时直接丢弃整个 `RunState`，不合并任何物品回主城。

**多人阶段存档策略**：
`SaveManager` 采用「服务器优先 + 本地兜底」双写：
- 网络正常时，`save()` 异步写入后端 API（`POST /api/characters/:id/save`），同时保留 LocalStorage 副本
- 读档时优先调用 `GET /api/characters/:id/save`，失败则回退 LocalStorage
- `GameState.persist()` 使用 fire-and-forget，不阻塞游戏主循环

**注意**：`CharacterService.saveCharacterData()` 对物品采用**先 deleteMany 再 createMany** 的简化策略。这意味着 `PlayerItem.id` 在每次 persist 时都会重新生成，审计日志中的 `relatedItemId` 可能指向已被删除的记录。

### 2. 后端架构（server/）

当前为**阶段一：账号 + 云存档 + 基础房间转发 + 商店权威**。

**REST API**：Express 提供注册/登录/角色/存档/怪物/商店/物品/审计 CRUD，JWT 鉴权。
**商店购买**：`POST /api/shops/buy` 是原子事务，后端校验金币、库存、背包空位后扣款发货，并写入 `CharacterTransaction`。
**实时通信**：Socket.io 提供房间系统（加入/准备/开始/移动/攻击事件转发），当前阶段不做权威校验，仅做消息中转。
**数据库**：Prisma ORM 管理 28+ 张表，当前使用 **PostgreSQL**。

后续阶段演进：
- **阶段二**：组队大厅 + 匹配队列（Redis `match_queue`）
- **阶段三**：局内权威服务器（`GameLoop` 20fps tick，敌人 AI、伤害计算、掉落判定全部 server authoritative）

### 3. 程序生成图形

项目没有 `assets/` 目录，所有视觉元素均为代码实时绘制：
- **角色/敌人**：使用 `Phaser.GameObjects.Container` 组合多个 Ellipse / Circle / Rectangle。
- **森林地图**：`ForestScene.createGround()` 用 Graphics 绘制棋盘格地面 + 边框。
- **树木**：多层 Ellipse 叠加出树冠与树干。
- **迷雾效果**：`FogSystem` 在运行时创建 HTML Canvas，用 `destination-out` 径向渐变挖孔，生成纹理后作为全屏 Image 叠加，随玩家移动。

这意味着添加新敌人或物品不需要准备贴图，只需在 `data/` 中定义新数据并调整颜色/形状参数。

### 4. 场景与输入

场景注册顺序（`main.ts`）：`BootScene → LoginScene → MainMenuScene → MainCityScene → SkillScene → CharacterScene → ForestScene → GameOverScene`。

`ForestScene` 是当前核心战斗场景，使用键盘 + 鼠标输入：
- `WASD`：移动（向量归一化后乘以职业速度）
- **鼠标指针**：武器与角色始终朝向鼠标位置（`Player.faceTo(worldX, worldY)`）
- `Space`：普通攻击（职业差异化）
- `1-5`：快捷使用背包前 5 格的消耗品（药水）
- `Q`：闪避（8s 冷却，0.5s 无敌帧，速度 ×2.5，带闪烁动画）
- `T/Y/U/I/O`：释放对应技能，技能目标点取当前鼠标世界坐标
- `N`：打开/关闭技能页面（`SkillScene`）
- `C`：打开/关闭角色属性页（`CharacterScene`）
- `E`：靠近传送门时呼出菜单，选择「撤离」或「深入下一层」
- `B`：打开/关闭局内背包面板

### 5. 敌人 AI 与生成

敌人在 `ForestScene.loadAndCreateEnemies()` 中**优先从后端 API 获取模板**（`GET /api/enemies`），失败时回退本地 fallback。生成位置随机，数量由 `GAME_CONFIG.enemySpawnCount` 控制。

AI 逻辑在 `Enemy.update()` 中：
1. 待机状态，不主动寻敌。
2. 玩家进入 `aggroRange` 后触发仇恨。
3. 追击直到进入 `attackRange`，停止移动并尝试攻击。
4. 玩家脱离 `aggroRange × 1.5` 后取消仇恨。

Boss 按 `GAME_CONFIG.bossSpawnChance`（15%）概率在每层随机刷新。

### 6. 掉落与拾取

敌人死亡时遍历其 `dropTable`，按概率生成掉落物。掉落物以 Container 形式存在于场景中，玩家靠近（<30px）后自动拾取，通过 `InventorySystem.addItem()` 放入局内背包。背包满时无法拾取。

拾取成功后会触发 `AuditLogger.logItemPickup()` 记录审计日志。

### 7. 商店系统

`MainCityScene` 的 NPC 商店已完全后端化：
- **商品列表**：`GET /api/shops/:id/items` 从数据库读取 `ShopItem` + `ItemTemplate`
- **购买**：`POST /api/shops/buy` 原子事务，后端校验金币、库存、背包空位，扣款后创建 `PlayerItem`
- **前端表现**：购买成功后更新本地 `GameState.save.gold` 与 `cityInventory`，并触发 `logShopBuy` 记录审计日志

## Agent 委派规范（Hermes 工作流）

> **强制性执行声明**：本规范下的所有规则均为硬性约束，Claude Code 在任何情况下都必须严格遵守。无论任务规模大小、时间是否紧迫，均不得以任何理由绕过子 Agent 委派流程。主 Agent 直接修改源代码、直接输出代码实现、或将 Bug 转派给非原编写子 Agent 等行为一律禁止。

### 子 Agent 超时与异常处理

1. **1 分钟无响应即中止**：启动子 Agent 后，若 60 秒内无返回（无输出、无进度更新、状态未变化），主 Agent 必须主动中断该子 Agent 任务，**不得无限期等待**。
2. **报错立即上报**：子 Agent 返回错误、异常终止或工具调用失败时，主 Agent 应立即停止当前流程，向用户报告具体错误信息（哪个 Agent、哪个文件、什么错误），**不得静默重试或自行兜底修复**。
3. **超时后处理**：子 Agent 超时中止后，主 Agent 应记录失败原因到 registry（状态标记为「已中止：超时/报错」），**并立即向用户完整汇报错误日志**（哪个 Agent、什么任务、卡在哪一步、已等待多久）。主 Agent **不得擅自替用户决定重启或跳过**，必须等待用户明确反馈后再决定下一步（重新委派、调整方案或终止），形成完整的用户可见日志链。

### 核心原则

1. **主 Agent 零代码输出**：主 Agent（当前会话）**绝不直接输出任何代码块**，所有编码、调试、重构、测试任务全权委派给子 Agent。主 Agent 只输出决策、审查意见和委派指令。
2. **代码所有权与 Bug 追责**：谁编写的代码，谁负责修复。测试失败时，必须将 Bug 指派给**原编写子 Agent**，不得转派给其他子 Agent，也不得由主 Agent 自行修改。
3. **子 Agent 持久化**：每个子 Agent 拥有独立的 `CLAUDE.md`（`.claude/subagents/CLAUDE.md`），每次启动时自动加载。主 Agent 必须在 `.claude/subagents/registry.md` 中记录任务与子 Agent 的映射关系。

### 主 Agent 职责边界

- 接收用户需求，拆解为可执行的子任务
- 审查子 Agent 返回的方案/代码，做最终确认和整合决策
- 管理跨模块的依赖关系和接口契约
- 运行测试，发现 Bug 后查询 registry 找到原编写子 Agent
- 保持主上下文绝对清爽，不包含任何代码实现细节

### 必须委派给子 Agent 的任务

| 任务类型 | 推荐子 Agent 类型 | 触发条件 |
|---|---|---|
| 代码库探索/文件查找 | `Explore` | 需要查找超过 3 个文件，或不确定文件位置 |
| 实现方案设计 | `Plan` | 涉及 3 个以上文件的修改，或需要架构决策 |
| 任何编码实现 | `general-purpose` | 无论代码量多少，一律委派 |
| 测试用例编写 | `general-purpose` | 任何需要写测试的任务 |
| Bug 修复 | `general-purpose` | 必须由原编写子 Agent 修复 |
| 构建/依赖问题排查 | `general-purpose` | npm/prisma 相关错误 |
| Claude Code 功能咨询 | `claude-code-guide` | 关于 Claude Code 本身的使用问题 |

### 委派与记录流程

1. **任务拆解**：主 Agent 将需求拆分为独立子任务，为每个子任务分配唯一标识（如 `TASK-001`）。
2. **启动子 Agent**：通过 `Agent` 工具启动子 Agent，在 prompt 中明确告知其加载 `.claude/subagents/CLAUDE.md`。
3. **记录 Registry**：子 Agent 返回结果后，主 Agent 立即在 `.claude/subagents/registry.md` 中追加记录：
   ```markdown
   - `TASK-001` | 子 Agent 对话记录 ID: `<id>` | 负责范围: `ForestScene.ts 敌人 AI` | 状态: 已完成
   ```
4. **测试验证**：主 Agent 运行测试，记录结果。
5. **Bug 指派**：测试失败时，主 Agent 根据失败代码定位到对应 `TASK-xxx`，通过 `claude --resume <对话记录ID>` 恢复该子 Agent 的完整上下文，指令格式：「修复你之前实现的 `<负责范围>` 中的 Bug：`<具体错误信息>`」。

### Bug 修复流程

```
测试失败
  → 定位失败代码范围
  → 查询 .claude/subagents/registry.md 找到原编写子 Agent 的对话记录 ID
  → claude --resume <ID> 恢复该子 Agent 上下文
  → 指令：「修复你之前实现的 X 中的 Bug：具体错误信息 + 复现步骤」
  → 子 Agent 修复并返回 diff
  → 主 Agent 审查 → 重新运行测试
      ├─ 通过 → 更新 registry 状态为「已修复」
      └─ 失败 → 追加调试信息，再次指派给同一子 Agent（循环直到通过）
```

### 禁止行为

- 主 Agent 直接输出任何代码块（包括示例、伪代码、片段）
- 主 Agent 自行修改任何源代码文件
- 主 Agent 将 Bug 修复指派给非原编写的子 Agent
- 子 Agent 之间直接通信（所有协调必须通过主 Agent）
- 主 Agent 在单个工具调用中混合高层决策和底层实现
