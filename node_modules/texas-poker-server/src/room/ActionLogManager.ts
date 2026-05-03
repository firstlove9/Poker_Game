import * as fs from 'fs';
import * as path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'temp_logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export interface ActionLogRecord {
  id: string;
  roomId: string;
  handId: string;
  playerId: string;
  playerName: string;
  action: string;
  amount?: number;
  phase: string;
  timestamp: number;
}

const roomLogs: Map<string, ActionLogRecord[]> = new Map();

export function addActionLog(
  roomId: string,
  handId: string,
  playerId: string,
  playerName: string,
  action: string,
  amount?: number,
  phase?: string
): void {
  const record: ActionLogRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roomId,
    handId,
    playerId,
    playerName,
    action,
    amount,
    phase: phase || '',
    timestamp: Date.now(),
  };

  if (!roomLogs.has(roomId)) {
    roomLogs.set(roomId, []);
  }
  roomLogs.get(roomId)!.push(record);

  persistLogs(roomId);
}

export function getRoomLogs(roomId: string): ActionLogRecord[] {
  return roomLogs.get(roomId) || [];
}

export function getHandLogs(roomId: string, handId: string): ActionLogRecord[] {
  const logs = roomLogs.get(roomId) || [];
  return logs.filter(l => l.handId === handId);
}

export function clearHandLogs(roomId: string, handId: string): void {
  const logs = roomLogs.get(roomId);
  if (logs) {
    roomLogs.set(roomId, logs.filter(l => l.handId !== handId));
    persistLogs(roomId);
  }
}

export function cleanupRoomLogs(roomId: string): void {
  roomLogs.delete(roomId);
  const filePath = path.join(LOGS_DIR, `${roomId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

function persistLogs(roomId: string): void {
  const logs = roomLogs.get(roomId);
  if (!logs) return;
  const filePath = path.join(LOGS_DIR, `${roomId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf-8');
  } catch {}
}

export function loadRoomLogs(roomId: string): void {
  if (roomLogs.has(roomId)) return;
  const filePath = path.join(LOGS_DIR, `${roomId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      roomLogs.set(roomId, JSON.parse(data));
    }
  } catch {}
}
