# 黑暗之行 — 后端服务

《黑暗之行》多人联机后端，基于 Node.js + Express + Socket.io + Prisma。

## 技术栈

- **运行时**：Node.js 20 + TypeScript 5.4
- **Web 框架**：Express 4
- **实时通信**：Socket.io 4
- **ORM**：Prisma 5（默认 SQLite，可切 PostgreSQL）
- **认证**：JWT + bcrypt

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 初始化数据库（已包含在 npm install 后，如 schema 有变则执行）
npx prisma migrate dev

# 3. 启动开发服务器（带热重载）
npm run dev
```

服务默认运行在 `http://localhost:3001`。

## 环境变量

复制 `.env.example` 为 `.env`：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | 数据库连接串 |
| `JWT_SECRET` | `dark-journey-dev-secret-change-me` | JWT 签名密钥 |
| `JWT_EXPIRES_IN` | `7d` | 令牌有效期 |
| `PORT` | `3001` | 服务端口 |
| `CLIENT_URL` | `http://localhost:5173` | 前端地址（CORS 白名单） |

### 切换到 PostgreSQL

修改 `.env`：
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/dark_journey?schema=public"
```

然后修改 `prisma/schema.prisma` 第一行：
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

再执行 `npx prisma migrate dev` 即可。

## 可用脚本

```bash
npm run dev        # 开发模式（tsx watch）
npm run build      # 编译到 dist/
npm run start      # 生产模式运行 dist/index.js
npm run db:migrate # 执行数据库迁移
npm run db:generate# 重新生成 Prisma Client
npm run db:studio  # 打开 Prisma Studio GUI 管理数据
```

## API 概览

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 `{ username, email, password }` |
| POST | `/api/auth/login` | 登录 `{ usernameOrEmail, password }` |

### 角色

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/characters/list` | 获取当前用户角色列表 |
| POST | `/api/characters/create` | 创建角色 `{ name, classType }` |
| GET | `/api/characters/:id/save` | 读取角色存档（GameSave 格式） |
| POST | `/api/characters/:id/save` | 保存角色存档 |

### 通用

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |

## Socket.io 事件

### 客户端 → 服务器

| 事件 | 说明 |
|---|---|
| `room:join` | 加入房间 `{ roomId, characterId, classType }` |
| `room:ready` | 准备就绪 `{ roomId, characterId }` |
| `room:start` | 队长开始游戏 `{ roomId, characterId }` |
| `player:move` | 玩家移动 `{ roomId, characterId, x, y, facingAngle }` |
| `player:attack` | 玩家攻击 `{ roomId, characterId, skillId?, targetX?, targetY? }` |
| `player:use_consumable` | 使用消耗品 `{ roomId, characterId, slotIndex }` |

### 服务器 → 客户端

| 事件 | 说明 |
|---|---|
| `room:members` | 房间成员列表更新 |
| `room:member_ready` | 某成员已准备 |
| `room:member_left` | 某成员离开 |
| `room:started` | 游戏开始 `{ roomId, depth }` |
| `player:moved` | 队友移动 |
| `player:attacked` | 队友攻击 |
| `player:used_consumable` | 队友使用消耗品 |

## 项目结构

```
server/
├── src/
│   ├── index.ts              # Express + Socket.io 入口
│   ├── config/
│   │   └── database.ts       # Prisma Client 单例
│   ├── middleware/
│   │   └── auth.ts           # JWT 校验中间件
│   ├── routes/
│   │   ├── auth.ts           # 注册/登录路由
│   │   └── character.ts      # 角色/存档路由
│   ├── services/
│   │   ├── AuthService.ts    # 认证业务逻辑
│   │   └── CharacterService.ts # 角色/存档业务逻辑
│   ├── network/
│   │   └── SocketHandlers.ts # Socket.io 事件处理
│   └── types/
│       └── game.ts           # 共享类型定义
├── prisma/
│   └── schema.prisma         # 数据库模型定义
├── .env                      # 环境变量（本地配置）
├── .env.example              # 环境变量模板
└── package.json
```

## 注意事项

- 当前阶段（阶段一）的房间系统为**转发模式**，局内伤害/掉落等权威校验尚未实现。
- 存档采用「服务器优先 + 本地兜底」双写策略：网络正常时写数据库，离线时自动回退 LocalStorage。
- 数据库默认 SQLite，仅适合开发。生产环境务必切换 PostgreSQL。
