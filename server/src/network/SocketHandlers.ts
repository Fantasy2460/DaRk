import { Server, Socket } from 'socket.io';

interface RoomState {
  roomId: string;
  hostId: string;
  members: Map<string, { socketId: string; characterId: string; classType: string; ready: boolean }>;
  status: 'waiting' | 'playing' | 'finished';
  currentDepth: number;
}

const rooms = new Map<string, RoomState>();

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log('Socket connected:', socket.id);

    // 加入房间
    socket.on('room:join', ({ roomId, characterId, classType }) => {
      let room = rooms.get(roomId);
      if (!room) {
        room = {
          roomId,
          hostId: characterId,
          members: new Map(),
          status: 'waiting',
          currentDepth: 1,
        };
        rooms.set(roomId, room);
      }

      room.members.set(characterId, {
        socketId: socket.id,
        characterId,
        classType,
        ready: false,
      });
      socket.join(roomId);

      // 广播成员列表
      io.to(roomId).emit('room:members', {
        members: Array.from(room.members.values()).map((m) => ({
          characterId: m.characterId,
          classType: m.classType,
          ready: m.ready,
          isHost: m.characterId === room.hostId,
        })),
      });
    });

    // 准备就绪
    socket.on('room:ready', ({ roomId, characterId }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const member = room.members.get(characterId);
      if (member) {
        member.ready = true;
        io.to(roomId).emit('room:member_ready', { characterId });
      }
    });

    // 队长开始游戏
    socket.on('room:start', ({ roomId, characterId }) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== characterId) return;
      room.status = 'playing';
      io.to(roomId).emit('room:started', { roomId, depth: room.currentDepth });
    });

    // 玩家移动（阶段三再做权威校验，现在仅转发）
    socket.on('player:move', ({ roomId, characterId, x, y, facingAngle }) => {
      socket.to(roomId).emit('player:moved', { characterId, x, y, facingAngle });
    });

    // 玩家攻击（阶段三再做权威校验，现在仅转发）
    socket.on('player:attack', ({ roomId, characterId, skillId, targetX, targetY }) => {
      socket.to(roomId).emit('player:attacked', { characterId, skillId, targetX, targetY });
    });

    // 使用消耗品
    socket.on('player:use_consumable', ({ roomId, characterId, slotIndex }) => {
      // 阶段三：服务器校验冷却、背包、效果，再广播
      io.to(roomId).emit('player:used_consumable', { characterId, slotIndex });
    });

    socket.onAny((eventName, ...args) => {
      console.log(`[WS] ${socket.id} | ${eventName}`, JSON.stringify(args[0] ?? {}));
    });

    // 断开连接
    socket.on('disconnect', () => {
      for (const [roomId, room] of rooms) {
        for (const [cid, member] of room.members) {
          if (member.socketId === socket.id) {
            room.members.delete(cid);
            io.to(roomId).emit('room:member_left', { characterId: cid });
            if (room.members.size === 0) {
              rooms.delete(roomId);
            }
            return;
          }
        }
      }
    });
  });
}
