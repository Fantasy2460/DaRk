import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { generateId } from '../utils/id';

const JWT_SECRET = process.env.JWT_SECRET || 'dark-journey-dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export async function register(username: string, email: string, password: string) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) {
    throw new Error('用户名或邮箱已存在');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { id: generateId(), username, email, passwordHash },
  });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any });
  return { token, user: { id: user.id, username: user.username, email: user.email } };
}

export async function login(usernameOrEmail: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }] },
  });
  if (!user) {
    throw new Error('用户不存在');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error('密码错误');
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any });
  return { token, user: { id: user.id, username: user.username, email: user.email } };
}
