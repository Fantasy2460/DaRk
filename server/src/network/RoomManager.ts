import { Server, Socket } from 'socket.io';
import { GameLoop } from './GameLoop';
import { PlayerInput } from '../types/room';
import { getCharacterSnapshot } from '../services/CharacterService';

function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export class RoomManager {
  private io: Server;
  rooms = new Map<string, GameLoop>();
  playerToRoom = new Map<string, string>(); // socketId -> roomId

  constructor(io: Server) {
    this.io = io;
  }

  createRoom(): string {
    let roomId = generateRoomId();
    while (this.rooms.has(roomId)) {
      roomId = generateRoomId();
    }
    const loop = new GameLoop(roomId, this.io);
    this.rooms.set(roomId, loop);
    console.log(`[RoomManager] Created room ${roomId}`);
    return roomId;
  }

  async joinRoom(
    roomId: string,
    socket: Socket,
    characterId: string,
    userId: string
  ): Promise<boolean> {
    const loop = this.rooms.get(roomId);
    if (!loop) return false;

    socket.join(roomId);
    this.playerToRoom.set(socket.id, roomId);

    // 初始位置：在地图中心附近随机偏移
    const initialPosition = {
      x: 640 + (Math.random() - 0.5) * 200,
      y: 480 + (Math.random() - 0.5) * 200,
    };

    // 获取角色快照（权威属性）
    let snapshot: Awaited<ReturnType<typeof getCharacterSnapshot>> | undefined;
    try {
      snapshot = await getCharacterSnapshot(characterId);
    } catch (err) {
      console.warn(`[RoomManager] getCharacterSnapshot failed for ${characterId}, using fallback. Error:`, err);
    }

    loop.addPlayer(socket.id, characterId, userId, initialPosition, snapshot ?? undefined);

    // 通知房间内其他玩家
    socket.to(roomId).emit('room:player_joined', {
      socketId: socket.id,
      characterId,
      position: initialPosition,
    });

    // 返回当前房间玩家列表给新加入者
    const members = Array.from(loop.players.values()).map((p) => ({
      socketId: p.id,
      characterId: p.characterId,
      position: p.position,
      ready: p.ready,
    }));
    socket.emit('room:joined', { roomId, members });

    console.log(`[RoomManager] ${socket.id} joined room ${roomId}`);
    return true;
  }

  leaveRoom(socketId: string): void {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) return;

    const loop = this.rooms.get(roomId);
    if (loop) {
      loop.removePlayer(socketId);
      this.io.to(roomId).emit('room:player_left', { socketId });

      if (loop.players.size === 0) {
        loop.stop();
        this.rooms.delete(roomId);
        console.log(`[RoomManager] Destroyed empty room ${roomId}`);
      }
    }

    this.playerToRoom.delete(socketId);
    console.log(`[RoomManager] ${socketId} left room ${roomId}`);
  }

  getRoom(roomId: string): GameLoop | undefined {
    return this.rooms.get(roomId);
  }

  handleInput(socketId: string, input: PlayerInput): void {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) return;
    const loop = this.rooms.get(roomId);
    if (!loop) return;
    loop.handleInput(socketId, input);
  }
}
