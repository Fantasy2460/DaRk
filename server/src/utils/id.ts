let sequence = 0;
const workerId = Math.floor(Math.random() * 90) + 10; // 10-99

export function generateId(): string {
  const timestamp = Date.now();
  const seq = sequence++ % 10000;
  return `${timestamp}${workerId}${String(seq).padStart(4, '0')}`;
}
