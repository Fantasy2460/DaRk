import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth';
import characterRoutes from './routes/character';
import enemyRoutes from './routes/enemy';
import shopRoutes from './routes/shop';
import itemRoutes from './routes/item';
import auditRoutes from './routes/audit';
import transactionRoutes from './routes/transaction';
import configRoutes from './routes/config';
import runRoutes from './routes/run';
import skillRoutes from './routes/skill';
import enchantRoutes from './routes/enchant';
import achievementRoutes from './routes/achievement';
import leaderboardRoutes from './routes/leaderboard';
import announcementRoutes from './routes/announcement';
import mailRoutes from './routes/mail';
import combatRoutes from './routes/combat';
import antiCheatRoutes from './routes/anticheat';
import { setupSocketHandlers } from './network/SocketHandlers';
import { RoomManager } from './network/RoomManager';
import { prisma } from './config/database';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
}));
app.use(express.json());

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = Math.random().toString(36).slice(2, 8).toUpperCase();
  (req as any).reqId = reqId;

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // 打印请求进入日志
  let reqBody = '';
  if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
    const body = { ...req.body };
    if (body.password) body.password = '***';
    reqBody = ` | Body: ${JSON.stringify(body)}`;
  }
  console.log(`[${reqId}] → ${req.method} ${req.originalUrl} | IP: ${clientIp}${reqBody}`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const contentLength = res.getHeader('content-length') || 0;
    console.log(`[${reqId}] ← ${res.statusCode} | ${duration}ms | ${contentLength}bytes`);
  });
  next();
});

// REST API 路由
app.use('/api/auth', authRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/enemies', enemyRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/config', configRoutes);
app.use('/api/runs', runRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/enchant', enchantRoutes);
app.use('/api', achievementRoutes);
app.use('/api/leaderboards', leaderboardRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api', mailRoutes);
app.use('/api/combat', combatRoutes);
app.use('/api/anticheat', antiCheatRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Socket.io 事件
const roomManager = new RoomManager(io);
setupSocketHandlers(io, roomManager);

async function initSkillTemplates() {
  const templates = [
    // 战士
    { id: 'slash', name: '重斩', description: '对前方敌人造成高额物理伤害', classType: 'warrior', type: 'active', requiredLevel: 1, cooldown: 1200, mpCost: 0, damage: 35, damagePercent: null, range: 60, aoe: false, maxLevel: 5 },
    { id: 'whirlwind', name: '旋风斩', description: '旋转攻击周围所有敌人', classType: 'warrior', type: 'active', requiredLevel: 3, cooldown: 5000, mpCost: 20, damage: 25, damagePercent: null, range: 80, aoe: true, maxLevel: 5 },
    // 法师
    { id: 'fireball', name: '火球术', description: '蓄力发射一枚火球，命中后造成范围爆炸伤害', classType: 'mage', type: 'active', requiredLevel: 1, cooldown: 8000, mpCost: 15, damage: null, damagePercent: 200, range: 200, aoe: true, maxLevel: 5 },
    { id: 'meteor', name: '星落', description: '蓄力引导陨星降临，对指定区域造成毁灭性打击', classType: 'mage', type: 'active', requiredLevel: 3, cooldown: 10000, mpCost: 40, damage: null, damagePercent: 500, range: 120, aoe: true, maxLevel: 3 },
    { id: 'manaOverflow', name: '法力流溢', description: '开启后10秒内攻击附带光球，蓄力速度翻倍，技能冷却减半', classType: 'mage', type: 'active', requiredLevel: 5, cooldown: 20000, mpCost: 50, damage: null, damagePercent: null, range: 0, aoe: false, maxLevel: 3 },
    // 贤者
    { id: 'heal', name: '治愈之光', description: '恢复自身 40 点生命值', classType: 'sage', type: 'active', requiredLevel: 1, cooldown: 4000, mpCost: 20, damage: 0, damagePercent: null, range: 0, aoe: false, maxLevel: 5 },
    { id: 'curse', name: '衰弱诅咒', description: '对周围敌人造成伤害并降低其攻击力', classType: 'sage', type: 'active', requiredLevel: 3, cooldown: 8000, mpCost: 30, damage: 15, damagePercent: null, range: 100, aoe: true, maxLevel: 5 },
  ];

  for (const t of templates) {
    await prisma.skillTemplate.upsert({
      where: { id: t.id },
      create: t,
      update: t,
    });
  }
  console.log(`[初始化] 已插入 ${templates.length} 条技能模板`);
}

async function initEnemyTemplates() {
  const enemies = [
    {
      id: 'goblin', name: '哥布林', hp: 40, attack: 10, defense: 3, speed: 60,
      aggroRange: 180, attackRange: 40, colorHex: '4ade80', isBoss: false,
      dropTableJson: JSON.stringify([
        { itemId: 'rusty_sword', chance: 0.1 },
        { itemId: 'copper_ring', chance: 0.08 },
        { itemId: 'hp_potion_small', chance: 0.15 },
      ]),
      expValue: 15,
    },
    {
      id: 'skeleton', name: '骷髅兵', hp: 55, attack: 14, defense: 5, speed: 55,
      aggroRange: 200, attackRange: 40, colorHex: 'e5e7eb', isBoss: false,
      dropTableJson: JSON.stringify([
        { itemId: 'iron_sword', chance: 0.05 },
        { itemId: 'wooden_shield', chance: 0.08 },
        { itemId: 'hp_potion_small', chance: 0.1 },
      ]),
      expValue: 20,
    },
    {
      id: 'wolf', name: '暗影狼', hp: 45, attack: 16, defense: 2, speed: 100,
      aggroRange: 250, attackRange: 45, colorHex: '8b5cf6', isBoss: false,
      dropTableJson: JSON.stringify([
        { itemId: 'shadow_dagger', chance: 0.04 },
        { itemId: 'leather_boots', chance: 0.06 },
        { itemId: 'mp_potion_small', chance: 0.12 },
      ]),
      expValue: 18,
    },
    {
      id: 'orc', name: '兽人战士', hp: 90, attack: 20, defense: 8, speed: 55,
      aggroRange: 200, attackRange: 50, colorHex: '166534', isBoss: false,
      dropTableJson: JSON.stringify([
        { itemId: 'iron_helm', chance: 0.05 },
        { itemId: 'chain_armor', chance: 0.04 },
        { itemId: 'hp_potion_large', chance: 0.08 },
      ]),
      expValue: 25,
    },
    {
      id: 'dark_mage', name: '黑暗法师', hp: 50, attack: 24, defense: 3, speed: 50,
      aggroRange: 300, attackRange: 180, colorHex: '7c3aed', isBoss: false,
      dropTableJson: JSON.stringify([
        { itemId: 'crystal_staff', chance: 0.04 },
        { itemId: 'magic_orb', chance: 0.02 },
        { itemId: 'mp_potion_large', chance: 0.1 },
      ]),
      expValue: 22,
    },
    {
      id: 'forest_troll', name: '森林巨魔', hp: 200, attack: 30, defense: 12, speed: 40,
      aggroRange: 220, attackRange: 55, colorHex: '92400e', isBoss: true,
      dropTableJson: JSON.stringify([
        { itemId: 'flame_blade', chance: 0.05 },
        { itemId: 'dragon_scale_armor', chance: 0.03 },
        { itemId: 'crown_of_kings', chance: 0.01 },
        { itemId: 'hp_potion_large', chance: 0.2 },
      ]),
      expValue: 60,
    },
  ];

  for (const e of enemies) {
    await prisma.enemyTemplate.upsert({
      where: { id: e.id },
      create: e,
      update: e,
    });
  }
  console.log(`[初始化] 已同步 ${enemies.length} 条敌人模板`);
}

async function initShops() {
  const count = await prisma.shop.count();
  if (count > 0) return;

  const shops = [
    { id: 'weapon', name: '铁匠铺' },
    { id: 'armor', name: '防具店' },
    { id: 'potion', name: '炼金工坊' },
  ];

  for (const s of shops) {
    await prisma.shop.upsert({
      where: { id: s.id },
      create: s,
      update: {},
    });
  }

  const shopItems = [
    // 武器店
    { shopId: 'weapon', templateId: 'rusty_sword', price: 50 },
    { shopId: 'weapon', templateId: 'wooden_staff', price: 50 },
    { shopId: 'weapon', templateId: 'cracked_wand', price: 50 },
    { shopId: 'weapon', templateId: 'iron_sword', price: 150 },
    { shopId: 'weapon', templateId: 'shadow_dagger', price: 150 },
    // 防具店
    { shopId: 'armor', templateId: 'cloth_helm', price: 40 },
    { shopId: 'armor', templateId: 'leather_armor', price: 60 },
    { shopId: 'armor', templateId: 'cloth_pants', price: 40 },
    { shopId: 'armor', templateId: 'old_boots', price: 40 },
    { shopId: 'armor', templateId: 'iron_helm', price: 120 },
    { shopId: 'armor', templateId: 'chain_armor', price: 180 },
    { shopId: 'armor', templateId: 'leather_boots', price: 100 },
    { shopId: 'armor', templateId: 'wooden_shield', price: 40 },
    { shopId: 'armor', templateId: 'iron_shield', price: 120 },
    // 炼金工坊
    { shopId: 'potion', templateId: 'hp_potion_small', price: 30 },
    { shopId: 'potion', templateId: 'hp_potion_large', price: 80 },
    { shopId: 'potion', templateId: 'mp_potion_small', price: 30 },
    { shopId: 'potion', templateId: 'mp_potion_large', price: 80 },
    { shopId: 'potion', templateId: 'regen_potion', price: 60 },
    { shopId: 'potion', templateId: 'mana_regen_potion', price: 60 },
    { shopId: 'potion', templateId: 'vision_potion', price: 100 },
  ];

  for (const si of shopItems) {
    await prisma.shopItem.create({
      data: si,
    });
  }
  console.log(`[初始化] 已插入 ${shops.length} 个商店，${shopItems.length} 条商品`);
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, async () => {
  console.log(`《黑暗之行》后端服务运行在 http://localhost:${PORT}`);
  console.log(`WebSocket 已启用，等待客户端连接...`);
  await initSkillTemplates();
  await initEnemyTemplates();
  await initShops();
});
