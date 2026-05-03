import { Server, Socket } from 'socket.io';
import { RoomManager } from './RoomManager';
import { PlayerInput } from '../types/room';

export function setupSocketHandlers(io: Server, roomManager: RoomManager) {
  io.on('connection', (socket: Socket) => {
    console.log('Socket connected:', socket.id);

    // 创建房间
    socket.on('room:create', () => {
      const roomId = roomManager.createRoom();
      socket.emit('room:created', { roomId });
    });

    // 加入房间
    socket.on('room:join', async ({ roomId, characterId, userId }) => {
      const success = await roomManager.joinRoom(roomId, socket, characterId, userId);
      if (!success) {
        socket.emit('room:error', { message: 'Room not found' });
      }
    });

    // 准备就绪
    socket.on('room:ready', ({ roomId }) => {
      const loop = roomManager.getRoom(roomId);
      if (!loop) return;
      const player = loop.players.get(socket.id);
      if (player) {
        player.ready = true;
        io.to(roomId).emit('room:player_ready', { socketId: socket.id, characterId: player.characterId });
      }
    });

    // 队长开始游戏
    socket.on('room:start', ({ roomId }) => {
      const loop = roomManager.getRoom(roomId);
      if (!loop) return;
      // 简化：只要有玩家 ready 就可以 start（后续可扩展 host 校验）
      const allReady = Array.from(loop.players.values()).every((p) => p.ready);
      if (allReady && loop.players.size > 0) {
        loop.start();
        io.to(roomId).emit('room:started', { roomId });
      } else {
        socket.emit('room:error', { message: 'Not all players are ready' });
      }
    });

    // 玩家移动输入
    socket.on('player:input_move', ({ roomId, direction }) => {
      const input: PlayerInput = {
        type: 'move',
        payload: direction,
        timestamp: Date.now(),
      };
      roomManager.handleInput(socket.id, input);
    });

    // 玩家攻击
    socket.on('player:attack', ({ roomId, targetX, targetY }) => {
      const input: PlayerInput = {
        type: 'attack',
        payload: { targetX, targetY },
        timestamp: Date.now(),
      };
      roomManager.handleInput(socket.id, input);
    });

    // 玩家释放技能
    socket.on('player:cast_skill', ({ roomId, skillId, targetX, targetY }) => {
      const input: PlayerInput = {
        type: 'cast',
        payload: { skillId, targetX, targetY },
        timestamp: Date.now(),
      };
      roomManager.handleInput(socket.id, input);
    });

    // 拾取
    socket.on('player:loot', ({ roomId, dropId }) => {
      const input: PlayerInput = {
        type: 'loot',
        payload: { dropId },
        timestamp: Date.now(),
      };
      roomManager.handleInput(socket.id, input);
    });

    // 撤离
    socket.on('player:extract', ({ roomId }) => {
      const input: PlayerInput = {
        type: 'extract',
        payload: {},
        timestamp: Date.now(),
      };
      roomManager.handleInput(socket.id, input);
    });

    // 闪避
    socket.on('player:dodge', ({ roomId }) => {
      const input: PlayerInput = {
        type: 'dodge',
        payload: {},
        timestamp: Date.now(),
      };
      roomManager.handleInput(socket.id, input);
    });

    // 兼容旧事件：直接转发（保留给前端未迁移前的过渡）
    socket.on('player:move', ({ roomId, characterId, x, y, facingAngle }) => {
      socket.to(roomId).emit('player:moved', { characterId, x, y, facingAngle });
    });

    socket.on('player:attacked', ({ roomId, characterId, skillId, targetX, targetY }) => {
      socket.to(roomId).emit('player:attacked', { characterId, skillId, targetX, targetY });
    });

    socket.on('player:use_consumable', ({ roomId, characterId, slotIndex }) => {
      io.to(roomId).emit('player:used_consumable', { characterId, slotIndex });
    });

    socket.on('damage_tick', ({ roomId, playerId, playerName, totalDamage }) => {
      const loop = roomManager.getRoom(roomId);
      if (!loop) return;
      const member = loop.players.get(playerId);
      if (!member) return;
      socket.to(roomId).emit('damage_update', {
        type: 'damage_update',
        playerId,
        playerName,
        totalDamage,
      });
    });

    socket.onAny((eventName, ...args) => {
      console.log(`[WS] ${socket.id} | ${eventName}`, JSON.stringify(args[0] ?? {}));
    });

    // 断开连接
    socket.on('disconnect', () => {
      roomManager.leaveRoom(socket.id);
      console.log('Socket disconnected:', socket.id);
    });
  });
}
