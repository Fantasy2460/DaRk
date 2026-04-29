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
- **持久化**：LocalStorage（`dark_journey_save_v1`）+ 后端 PostgreSQL/SQLite（多人阶段）

### 后端技术栈（server/）

- **运行时**：Node.js 20 + TypeScript 5.4
- **Web 框架**：Express 4
- **实时通信**：Socket.io 4
- **ORM**：Prisma 5（默认 SQLite，可切 PostgreSQL）
- **认证**：JWT + bcrypt

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

# 后端
npm run build           # 编译到 dist/
npx prisma migrate dev  # 数据库迁移（schema 变更后执行）
npx prisma generate     # 重新生成 Prisma Client
npx prisma studio       # GUI 管理数据库
```

**约定**：修改代码后 Claude 应主动检查前后端进程是否在运行，必要时自动重启，无需用户手动操作。Vite 与 tsx watch 通常能自动热重载；若修改了 Prisma schema、环境变量或出现端口占用，则需要手动重启对应服务。

## 项目结构

```
phaser-demo/src/
├── main.ts              # 入口：初始化 Phaser.Game，注册全部 Scene
├── config/gameConfig.ts # 游戏常量（分辨率、移动速度、背包容量、生成数量等）
├── types/index.ts       # 全部 TypeScript 接口（Stats、Item、EnemyType、GameSave、RunState 等）
├── data/                # 静态配置表
│   ├── classes.ts       # 3 种职业（战士/法师/贤者）的基础属性与技能
│   ├── enemies.ts       # 敌人类型、AI 参数与掉落表
│   └── items.ts         # 装备（C/B/A/S 四级）与消耗品定义
├── scenes/              # Phaser 场景，按游戏流程串联
│   ├── BootScene.ts     # 启动屏（按任意键进入主菜单）
│   ├── MainMenuScene.ts # 主菜单：职业选择、读取存档、开始游戏
│   ├── MainCityScene.ts # 主城：查看/整理装备与背包，NPC商店，进入森林
│   ├── SkillScene.ts    # 技能页：按等级1/3/5/7/9分页浏览职业技能详情
│   ├── CharacterScene.ts# 角色属性页：展示基础属性、装备加成与7部位装备
│   ├── ForestScene.ts   # 核心玩法场景：战斗、探索、拾取、传送门抉择
│   └── GameOverScene.ts # 结算：显示深入层数、击杀数、物品数
├── entities/
│   ├── Player.ts        # 玩家实体：WASD 移动、空格攻击（职业差异化普攻）、Q 闪避、技能冷却、消耗品效果、动态视野
│   └── Enemy.ts         # 敌人实体：仇恨范围触发、追击/攻击、受击闪烁、击退
├── systems/
│   ├── EquipmentSystem.ts   # 7 部位装备栏的穿戴/卸下与属性汇总
│   ├── InventorySystem.ts   # 24 格背包（4×6）的增删、查找空位、交换格子；兼容旧存档自动补位
│   └── FogSystem.ts         # 动态迷雾：Canvas 径向渐变纹理，随玩家位置移动
└── managers/
    ├── GameState.ts     # 全局单例状态：局外存档（GameSave）与局内状态（RunState）
    └── SaveManager.ts   # 存档管理：优先同步服务器，失败回退 LocalStorage

server/
├── src/
│   ├── index.ts              # Express + Socket.io 入口
│   ├── config/
│   │   └── database.ts       # Prisma Client 单例
│   ├── middleware/
│   │   └── auth.ts           # JWT 校验中间件
│   ├── routes/
│   │   ├── auth.ts           # 注册/登录 API
│   │   └── character.ts      # 角色 CRUD、存档读/写 API
│   ├── services/
│   │   ├── AuthService.ts    # 认证业务逻辑
│   │   └── CharacterService.ts # 角色/存档业务逻辑
│   ├── network/
│   │   └── SocketHandlers.ts # Socket.io 房间/转发事件
│   └── types/
│       └── game.ts           # 前后端共享类型
└── prisma/
    └── schema.prisma         # 数据库模型定义
```

## 核心架构

### 1. 局内 / 局外双轨状态

`GameState` 是全局单例，管理两层数据：

- **`GameSave`**（局外永久存档）：职业选择、主城背包/装备、金币、图鉴进度、天赋树。通过 `SaveManager` 持久化到 LocalStorage。
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
- 前端新增 `api.syncFromServer()`，登录成功后调用以拉取云端最新存档

### 2. 后端架构（server/）

当前为**阶段一：账号 + 云存档 + 基础房间转发**。

**REST API**：Express 提供注册/登录/角色/存档 CRUD，JWT 鉴权。
**实时通信**：Socket.io 提供房间系统（加入/准备/开始/移动/攻击事件转发），当前阶段不做权威校验，仅做消息中转。
**数据库**：Prisma ORM 管理 28 张表，开发期默认 SQLite，生产切换 PostgreSQL。

后续阶段演进：
- **阶段二**：组队大厅 + 匹配队列（Redis `match_queue`）
- **阶段三**：局内权威服务器（`GameLoop` 20fps tick，敌人 AI、伤害计算、掉落判定全部 server authoritative）

### 2. 程序生成图形

项目没有 `assets/` 目录，所有视觉元素均为代码实时绘制：
- **角色/敌人**：使用 `Phaser.GameObjects.Container` 组合多个 Ellipse / Circle / Rectangle。
- **森林地图**：`ForestScene.createGround()` 用 Graphics 绘制棋盘格地面 + 边框。
- **树木**：多层 Ellipse 叠加出树冠与树干。
- **迷雾效果**：`FogSystem` 在运行时创建 HTML Canvas，用 `destination-out` 径向渐变挖孔，生成纹理后作为全屏 Image 叠加，随玩家移动。

这意味着添加新敌人或物品不需要准备贴图，只需在 `data/` 中定义新数据并调整颜色/形状参数。

### 3. 场景与输入

场景注册顺序（`main.ts`）：`BootScene → MainMenuScene → MainCityScene → SkillScene → CharacterScene → ForestScene → GameOverScene`。

`ForestScene` 是当前核心战斗场景，使用键盘 + 鼠标输入：
- `WASD`：移动（向量归一化后乘以职业速度）
- **鼠标指针**：武器与角色始终朝向鼠标位置（`Player.faceTo(worldX, worldY)`）
- `Space`：普通攻击（职业差异化，见下方「普攻系统」）
- `1-5`：快捷使用背包前 5 格的消耗品（药水），空槽或满血/满蓝时飘字提示，不消耗物品
- `Q`：闪避（8s 冷却，0.5s 无敌帧，速度 ×2.5，带闪烁动画）
- `T/Y/U/I/O`：释放对应技能，技能目标点取当前鼠标世界坐标
- `N`：打开/关闭技能页面（`SkillScene`），按等级分页展示职业技能详情
- `C`：打开/关闭角色属性页（`CharacterScene`），展示当前装备与属性加成
- `E`：靠近传送门时呼出菜单，选择「撤离」或「深入下一层」
- `B`：打开/关闭局内背包面板

### 4. 敌人 AI

敌人在 `ForestScene.createEnemies()` 中随机位置生成，数量由 `GAME_CONFIG.enemySpawnCount` 控制。AI 逻辑在 `Enemy.update()` 中：
1. 待机状态，不主动寻敌。
2. 玩家进入 `aggroRange` 后触发仇恨。
3. 追击直到进入 `attackRange`，停止移动并尝试攻击。
4. 玩家脱离 `aggroRange × 1.5` 后取消仇恨。

Boss 按 `GAME_CONFIG.bossSpawnChance`（15%）概率在每层随机刷新。

### 5. 掉落与拾取

敌人死亡时遍历其 `dropTable`，按概率生成掉落物。掉落物以 Container 形式存在于场景中，玩家靠近（<30px）后自动拾取，通过 `InventorySystem.addItem()` 放入局内背包。背包满时无法拾取。

### 6. 当前已实现 vs 待实现

#### ✅ 已实现

**ForestScene 核心战斗循环**
- `WASD` 移动、`Space` 普通攻击、`Q` 闪避（带无敌帧与冷却）
- **鼠标指向**：武器与角色始终朝向鼠标指针位置；普通攻击与技能均以角色面朝方向判定
- **等级/经验系统**：击杀敌人获得经验值（`enemy.expValue`），经验条满后升级，每级提升 5% 基础属性（仅基础值，不含装备加成）；最高 9 级
- **普攻系统（三职业差异化）**：
  - 法师：向鼠标方向发射青色法球，命中造成 100% 攻击力伤害 + 小范围 50% 溅射；射程 250px，基础冷却 1 秒
  - 战士：前方 60° 扇形斩击（半径 55px），造成 110% 攻击力 AOE 伤害并附带击退；银色圆弧动画，基础冷却 1 秒
  - 贤者：自动锁定视野范围内最多 3 个敌人，发射金色追踪光球，各造成 80% 攻击力伤害；基础冷却 1 秒
- 技能系统：已绑定 `T/Y/U/I/O` 五个快捷键，支持战士（重斩/旋风斩）、法师（火球术/星落/法力流溢）、贤者（治愈之光/衰弱诅咒）共 7 个技能；技能目标点取当前鼠标世界坐标
- 蓄力系统：法师火球术（T）与星落（Y）支持蓄力，蓄力进度在角色头顶以进度条显示；火球术蓄力时间越长伤害/爆炸范围越大（200%-400% 攻击力），星落蓄力 1 秒后召唤陨石造成 500% 攻击力 AOE
- 法力流溢（U）：20s CD，开启后 10s 内所有攻击附带追踪光球（100% 攻击力），蓄力速度翻倍，技能冷却减半（对自身无效）
- 技能图标：程序化矢量绘制，带冷却遮罩与按键提示
- 投射物系统：法师普攻法球与火球术从玩家位置向鼠标方向发射，命中后产生 AOE 爆炸；贤者普攻光球带自动追踪
- 受击反馈：玩家与敌人均有闪烁动画；敌人带击退效果
- 自动回血回蓝：基于最大 HP/MP 的 1%/秒自然恢复；支持持续恢复药水（slowHp/slowMp）每 2 秒 tick
- HUD：屏幕底部显示血条/蓝条（叠加精确数值，如 `120 / 150`），技能栏在血条下方，消耗品快捷栏（1-5）在血条上方
- 掉落与拾取：敌人死亡按 `dropTable` 掉落装备，另附加独立概率掉落生命球/魔法球/C级/B级装备；靠近自动拾取，背包满时拒收
- 传送门：靠近按 `E` 呼出面板，可选择「安全撤离」或「深入下一层」
- 背包（局内）：按 `B` 打开背包面板，左侧显示 7 部位装备栏，右侧显示 4×6（纵向）物品格；支持点击穿戴/卸下装备，属性实时重算
- 消耗品快捷使用：按 `1-5` 使用背包对应格子药水；即时恢复/持续恢复/视野扩张三种类型，满血/满蓝时拒绝使用并飘字提示

**技能页面（`SkillScene`）**
- 按 `N` 键（局内/局外均可）打开技能浏览页面
- 按等级 `1/3/5/7/9` 分页展示各职业的主动/被动技能
- 每张技能卡片显示：名称、类型标签、描述（启用 `wordWrap.useAdvancedWrap` 支持中文换行）、冷却/消耗/伤害或倍率/射程/AOE 等详细数值、解锁状态

**角色属性页（`CharacterScene`）**
- 按 `C` 键（局内/局外均可）打开角色属性面板
- 左侧面板：职业名称、等级、经验条、当前状态（主城/森林第 X 层）
- 右侧属性面板：生命/法力/攻击/防御/移速，每项展示最终数值 = 基础值 + 装备加成
- 下方装备栏：7 个部位（武器/头盔/衣服/裤子/鞋子/首饰/副手），显示装备名称、品质颜色与品质等级

**敌人 AI**
- 仇恨范围触发 → 追击 → 进入攻击范围停止并攻击 → 脱离 1.5 倍仇恨范围脱战
- Boss 按 15% 概率刷新，头顶显示金色名称与血条（overhead HP bar）

**主城与存档**
- `MainMenuScene`：职业选择（战士/法师/贤者）、存档读取/重置、程序化按钮高亮
- `MainCityScene`：查看当前装备与背包，显示物品详情（悬停提示）；NPC 商店（铁匠/防具师/炼金术士）可购买武器、防具、药水；靠近红色入口按 E 进入森林
- `GameState` 双轨状态：局外存档（LocalStorage）+ 局内临时状态，支持 `startRun/extractRun/dieInRun`
- 图鉴记录：击杀怪物与拾取装备自动记入 `bestiary` / `equipmentCodex`

**程序生成图形**
- 角色/敌人/树木/地面/传送门/技能特效/掉落物均为代码实时绘制，无外部贴图

#### 🚧 待实现

- **玩家头顶血条/蓝条**：怪物已有 overhead 血条，玩家角色头顶暂无血条/蓝条（仅屏幕 HUD 显示）
- **天赋树**：`GameSave.talentProgress` 已预留，但无 UI 与加点逻辑
- **小地图**：无局内小地图或雷达
- **图鉴完整 UI**：目前只有文字统计，无独立的怪物/装备图鉴浏览界面
- **剧情模块**：尚无剧情对话或任务系统
- **深层 A/S 掉落**：A 级与 S 级装备仅在数据表中定义，尚未在森林深层开放获取

后续开发建议优先顺序：`玩家头顶血条` → `小地图` → `天赋树` → `图鉴完整 UI`。
