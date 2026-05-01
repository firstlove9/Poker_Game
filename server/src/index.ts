import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { RoomManager } from './room/RoomManager';
import { setupWebSocket } from './websocket';
import { createRoomRoutes } from './routes/roomRoutes';
import singlePlayerRoutes from './routes/singlePlayerRoutes';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const CLIENT_URL = process.env.CLIENT_URL || '*'
const PORT = process.env.PORT || 3000;

const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

const roomManager = new RoomManager();

app.use('/api', createRoomRoutes(roomManager));
app.use('/api/single-player', singlePlayerRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const clientDistPath = path.resolve(process.cwd(), '..', 'client', 'dist');
app.use(express.static(clientDistPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// WebSocket设置
setupWebSocket(io, roomManager);

// 定期清理空房间
setInterval(() => {
  roomManager.cleanupEmptyRooms();
}, 60000); // 每分钟清理一次

// 启动服务器
httpServer.listen(PORT, () => {
  console.log(`🎴 德州扑克服务器已启动`);
  console.log(`📡 HTTP API: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`🏥 健康检查: http://localhost:${PORT}/health`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
