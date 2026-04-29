const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('dj_token', token);
    } else {
      localStorage.removeItem('dj_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('dj_token');
    }
    return this.token;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || `请求失败: ${res.status}`);
    }
    return data;
  }

  // 认证
  async register(username: string, email: string, password: string) {
    const data = await this.request('POST', '/auth/register', { username, email, password });
    this.setToken(data.token);
    return data;
  }

  async login(usernameOrEmail: string, password: string) {
    const data = await this.request('POST', '/auth/login', { usernameOrEmail, password });
    this.setToken(data.token);
    return data;
  }

  logout() {
    this.setToken(null);
  }

  // 角色
  async getCharacters() {
    return this.request('GET', '/characters/list');
  }

  async createCharacter(name: string, classType: string) {
    return this.request('POST', '/characters/create', { name, classType });
  }

  async getCharacterSave(characterId: string) {
    return this.request('GET', `/characters/${characterId}/save`);
  }

  async getCharacterInventory(characterId: string) {
    return this.request('GET', `/characters/${characterId}/inventory`);
  }

  async saveCharacterData(characterId: string, payload: any) {
    return this.request('POST', `/characters/${characterId}/save`, payload);
  }

  // 健康检查
  async health() {
    return this.request('GET', '/health');
  }
}

export const api = new ApiClient();
