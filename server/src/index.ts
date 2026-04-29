import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth';
import characterRoutes from './routes/character';
import { setupSocketHandlers } from './network/SocketHandlers';

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

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Socket.io 事件
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`《黑暗之行》后端服务运行在 http://localhost:${PORT}`);
  console.log(`WebSocket 已启用，等待客户端连接...`);
});
