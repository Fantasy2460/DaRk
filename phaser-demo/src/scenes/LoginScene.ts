import Phaser from 'phaser';
import { api } from '../network/ApiClient';
import { SaveManager } from '../managers/SaveManager';
import { GameState } from '../managers/GameState';
import { ItemDataManager } from '../managers/ItemDataManager';
import type { ClassType } from '../types';

export class LoginScene extends Phaser.Scene {
  private domContainer!: HTMLDivElement;
  private usernameInput!: HTMLInputElement;
  private passwordInput!: HTMLInputElement;
  private statusText!: Phaser.GameObjects.Text;
  private isLoginMode = true;
  private creatingCharacter = false;
  private loginUiElements: Phaser.GameObjects.GameObject[] = [];
  private selectUiElements: Phaser.GameObjects.GameObject[] = [];
  private charNameInput?: HTMLInputElement;

  constructor() {
    super({ key: 'LoginScene' });
  }

  create() {
    // 暗色背景底
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0f0f1a).setOrigin(0);

    // 标题
    this.add.text(this.scale.width / 2, 80, '黑暗之行', {
      fontSize: '52px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(this.scale.width / 2, 140, '组队挑战黑暗森林', {
      fontSize: '18px',
      color: '#94a3b8',
    }).setOrigin(0.5);

    // 创建 DOM 容器
    this.createDomForm();

    // 状态提示文字
    this.statusText = this.add.text(this.scale.width / 2, 420, '', {
      fontSize: '16px',
      color: '#f87171',
    }).setOrigin(0.5);

    // 程序绘制按钮
    this.createButtons();

    // 检查本地 token，尝试自动登录
    this.tryAutoLogin();
  }

  private createDomForm() {
    this.domContainer = document.createElement('div');
    this.domContainer.style.position = 'absolute';
    this.domContainer.style.left = `${(window.innerWidth - 960) / 2 + 330}px`;
    this.domContainer.style.top = `${(window.innerHeight - 640) / 2 + 190}px`;
    this.domContainer.style.width = '300px';
    this.domContainer.style.display = 'flex';
    this.domContainer.style.flexDirection = 'column';
    this.domContainer.style.gap = '16px';
    this.domContainer.style.zIndex = '10';

    const style = `
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px 14px;
      color: #e2e8f0;
      fontSize: 14px;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    `;

    this.usernameInput = document.createElement('input');
    this.usernameInput.type = 'text';
    this.usernameInput.placeholder = '用户名或邮箱';
    this.usernameInput.style.cssText = style;
    this.domContainer.appendChild(this.usernameInput);

    this.passwordInput = document.createElement('input');
    this.passwordInput.type = 'password';
    this.passwordInput.placeholder = '密码';
    this.passwordInput.style.cssText = style;
    this.domContainer.appendChild(this.passwordInput);

    document.body.appendChild(this.domContainer);
  }

  private createButtons() {
    const cx = this.scale.width / 2;
    const btnY = 360;
    const btnW = 120;
    const btnH = 40;
    const gap = 20;

    // 登录按钮
    const loginBtn = this.createButton(cx - btnW - gap, btnY, btnW, btnH, '登录', 0x3b82f6, () => {
      this.handleLogin();
    });
    this.loginUiElements.push(loginBtn.container);

    // 注册按钮
    const registerBtn = this.createButton(cx + gap, btnY, btnW, btnH, '注册', 0x22c55e, () => {
      if (this.isLoginMode) {
        this.isLoginMode = false;
        this.usernameInput.placeholder = '用户名';
        registerBtn.text.setText('确认注册');
        loginBtn.text.setText('返回登录');
      } else {
        this.handleRegister();
      }
    });
    this.loginUiElements.push(registerBtn.container);

    // 切换模式时重置
    loginBtn.container.on('pointerdown', () => {
      if (!this.isLoginMode) {
        this.isLoginMode = true;
        this.usernameInput.placeholder = '用户名或邮箱';
        registerBtn.text.setText('注册');
        loginBtn.text.setText('登录');
        this.setStatus('');
      }
    });

    // 游客模式
    const guestBtn = this.createButton(cx, btnY + 60, 160, 36, '游客模式（离线）', 0x475569, () => {
      this.enterAsGuest();
    });
    this.loginUiElements.push(guestBtn.container);
  }

  private createButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    color: number,
    onClick: () => void
  ) {
    const container = this.add.container(x + w / 2, y + h / 2);
    const bg = this.add.rectangle(0, 0, w, h, color).setInteractive({ useHandCursor: true });
    const text = this.add.text(0, 0, label, {
      fontSize: '16px',
      color: '#ffffff',
    }).setOrigin(0.5);

    container.add([bg, text]);

    bg.on('pointerover', () => bg.setFillStyle(color + 0x111111));
    bg.on('pointerout', () => bg.setFillStyle(color));
    bg.on('pointerdown', onClick);

    return { container, text, bg };
  }

  private async tryAutoLogin() {
    if (!api.getToken()) return;

    this.setStatus('正在自动登录...', '#60a5fa');
    try {
      const { characters } = await api.getCharacters();
      if (!characters || characters.length === 0) {
        this.showCharacterCreate();
      } else if (characters.length === 1) {
        SaveManager.setCharacterId(characters[0].id);
        await GameState.getInstance().syncFromServer();
        this.cleanupAndGo('MainMenuScene');
      } else {
        this.showCharacterSelect(characters);
      }
    } catch {
      api.logout();
      this.setStatus('自动登录失败，请重新登录');
    }
  }

  private async handleLogin() {
    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value.trim();
    if (!username || !password) {
      this.setStatus('请输入用户名和密码');
      return;
    }

    this.setStatus('登录中...', '#60a5fa');
    try {
      const data = await api.login(username, password);
      this.setStatus(`欢迎回来，${data.user.username}`, '#4ade80');
      await this.loadCharacterAndProceed();
    } catch (e: any) {
      this.setStatus(e.message || '登录失败');
    }
  }

  private async handleRegister() {
    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value.trim();
    if (!username || !password) {
      this.setStatus('请输入用户名和密码');
      return;
    }
    if (password.length < 6) {
      this.setStatus('密码至少 6 位');
      return;
    }

    this.setStatus('注册中...', '#60a5fa');
    try {
      // 注册时邮箱用用户名占位（简化）
      const data = await api.register(username, `${username}@dark.local`, password);
      this.setStatus(`注册成功，欢迎 ${data.user.username}`, '#4ade80');
      this.isLoginMode = true;
      this.usernameInput.placeholder = '用户名或邮箱';
      await this.loadCharacterAndProceed();
    } catch (e: any) {
      this.setStatus(e.message || '注册失败');
    }
  }

  private async loadCharacterAndProceed() {
    try {
      const { characters } = await api.getCharacters();
      await ItemDataManager.load();
      if (!characters || characters.length === 0) {
        this.showCharacterCreate();
      } else if (characters.length === 1) {
        SaveManager.setCharacterId(characters[0].id);
        await GameState.getInstance().syncFromServer();
        this.cleanupAndGo('MainMenuScene');
      } else {
        this.showCharacterSelect(characters);
      }
    } catch (e: any) {
      this.setStatus(e.message || '获取角色失败');
    }
  }

  private showCharacterSelect(characters: any[]) {
    if (this.creatingCharacter) return;
    this.creatingCharacter = true;

    // 隐藏登录 UI
    this.loginUiElements.forEach((el) => (el as any).setVisible(false));
    this.domContainer.style.display = 'none';
    this.setStatus('');

    const cx = this.scale.width / 2;

    // 标题
    const title = this.add.text(cx, 160, '选择你的角色', {
      fontSize: '28px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.selectUiElements.push(title);

    const classColors: Record<string, number> = {
      warrior: 0xef4444,
      mage: 0x3b82f6,
      sage: 0xeab308,
    };
    const classNames: Record<string, string> = {
      warrior: '战士',
      mage: '法师',
      sage: '贤者',
    };

    const startY = 240;
    const cardH = 70;
    const gap = 16;

    characters.forEach((char, idx) => {
      const y = startY + idx * (cardH + gap);
      const color = classColors[char.classType] || 0x475569;

      const container = this.add.container(cx, y);
      const bg = this.add.rectangle(0, 0, 320, cardH, 0x1e293b, 0.8)
        .setStrokeStyle(2, color)
        .setInteractive({ useHandCursor: true });
      const nameText = this.add.text(-130, -12, char.name, {
        fontSize: '18px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const infoText = this.add.text(-130, 14, `${classNames[char.classType] || char.classType} | Lv.${char.level}`, {
        fontSize: '14px',
        color: '#94a3b8',
      }).setOrigin(0, 0.5);

      container.add([bg, nameText, infoText]);
      this.selectUiElements.push(container);

      bg.on('pointerover', () => bg.setFillStyle(0x334155, 0.9));
      bg.on('pointerout', () => bg.setFillStyle(0x1e293b, 0.8));
      bg.on('pointerdown', async () => {
        SaveManager.setCharacterId(char.id);
        await GameState.getInstance().syncFromServer();
        this.cleanupAndGo('MainMenuScene');
      });
    });

    // 创建新角色按钮
    const btnY = startY + characters.length * (cardH + gap) + 20;
    const newCharBtn = this.createButton(cx, btnY, 180, 40, '+ 创建新角色', 0x22c55e, () => {
      this.selectUiElements.forEach((el) => el.destroy());
      this.selectUiElements = [];
      this.creatingCharacter = false;
      this.showCharacterCreate();
    });
    this.selectUiElements.push(newCharBtn.container);
  }

  private showCharacterCreate() {
    if (this.creatingCharacter) return;
    this.creatingCharacter = true;

    // 隐藏登录 UI
    this.loginUiElements.forEach((el) => (el as any).setVisible(false));
    this.domContainer.style.display = 'none';
    this.setStatus('');

    const cx = this.scale.width / 2;

    // 创建角色面板
    this.add.text(cx, 200, '创建你的角色', {
      fontSize: '28px',
      color: '#e2e8f0',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // 名字输入（独立 DOM，精确对齐画布）
    const canvasRect = this.scale.canvas.getBoundingClientRect();
    const inputWrap = document.createElement('div');
    inputWrap.style.position = 'absolute';
    inputWrap.style.left = `${canvasRect.left + (this.scale.width - 300) / 2}px`;
    inputWrap.style.top = `${canvasRect.top + 260}px`;
    inputWrap.style.width = '300px';
    inputWrap.style.zIndex = '20';

    this.charNameInput = document.createElement('input');
    this.charNameInput.type = 'text';
    this.charNameInput.placeholder = '角色名';
    this.charNameInput.style.cssText = `
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px 14px;
      color: #e2e8f0;
      font-size: 14px;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    `;
    inputWrap.appendChild(this.charNameInput);
    document.body.appendChild(inputWrap);

    const classes: { id: ClassType; name: string; color: number }[] = [
      { id: 'warrior', name: '战士', color: 0xef4444 },
      { id: 'mage', name: '法师', color: 0x3b82f6 },
      { id: 'sage', name: '贤者', color: 0xeab308 },
    ];

    let selectedClass: ClassType = 'warrior';
    const classButtons: { bg: Phaser.GameObjects.Rectangle; id: ClassType }[] = [];

    classes.forEach((cls, idx) => {
      const bx = cx - 140 + idx * 140;
      const by = 340;
      const container = this.add.container(bx, by);
      const bg = this.add.rectangle(0, 0, 100, 100, cls.color, 0.3)
        .setStrokeStyle(2, cls.color)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(0, 0, cls.name, {
        fontSize: '18px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      container.add([bg, label]);
      classButtons.push({ bg, id: cls.id });

      bg.on('pointerover', () => bg.setFillStyle(cls.color, 0.5));
      bg.on('pointerout', () => {
        if (selectedClass !== cls.id) bg.setFillStyle(cls.color, 0.3);
      });
      bg.on('pointerdown', () => {
        selectedClass = cls.id;
        classButtons.forEach((b) => b.bg.setFillStyle(b.id === cls.id ? cls.color : 0x334155, b.id === cls.id ? 0.8 : 0.3));
      });
    });

    // 默认选中战士
    classButtons[0].bg.setFillStyle(0xef4444, 0.8);
    classButtons[1].bg.setFillStyle(0x334155, 0.3);
    classButtons[2].bg.setFillStyle(0x334155, 0.3);

    // 确认创建按钮
    this.createButton(cx, 480, 160, 44, '创建角色', 0x22c55e, async () => {
      const name = this.charNameInput?.value.trim() || '';
      if (!name) {
        this.setStatus('请输入角色名');
        return;
      }
      try {
        const { character } = await api.createCharacter(name, selectedClass);
        SaveManager.setCharacterId(character.id);
        await GameState.getInstance().syncFromServer();
        this.cleanupAndGo('MainMenuScene');
      } catch (e: any) {
        this.setStatus(e.message || '创建角色失败');
      }
    });
  }

  private enterAsGuest() {
    // 游客模式：清除 token，使用本地存档
    api.logout();
    SaveManager.setCharacterId(null);
    this.setStatus('进入游客模式...', '#94a3b8');
    this.cleanupAndGo('MainMenuScene');
  }

  private setStatus(text: string, color = '#f87171') {
    this.statusText.setText(text);
    this.statusText.setColor(color);
  }

  private cleanupAndGo(sceneKey: string) {
    if (this.domContainer && this.domContainer.parentNode) {
      this.domContainer.parentNode.removeChild(this.domContainer);
    }
    if (this.charNameInput && this.charNameInput.parentElement) {
      this.charNameInput.parentElement.remove();
    }
    this.selectUiElements.forEach((el) => el.destroy());
    this.selectUiElements = [];
    this.scene.start(sceneKey);
  }

  shutdown() {
    if (this.domContainer && this.domContainer.parentNode) {
      this.domContainer.parentNode.removeChild(this.domContainer);
    }
    if (this.charNameInput && this.charNameInput.parentElement) {
      this.charNameInput.parentElement.remove();
    }
    this.selectUiElements.forEach((el) => el.destroy());
    this.selectUiElements = [];
  }
}
