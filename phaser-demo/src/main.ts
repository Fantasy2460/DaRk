import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LoginScene } from './scenes/LoginScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { MainCityScene } from './scenes/MainCityScene';
import { SkillScene } from './scenes/SkillScene';
import { CharacterScene } from './scenes/CharacterScene';
import { BestiaryScene } from './scenes/BestiaryScene';
import { EquipmentCodexScene } from './scenes/EquipmentCodexScene';
import { ForestScene } from './scenes/ForestScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GameState } from './managers/GameState';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  parent: 'game-container',
  backgroundColor: '#1a1a2e',
  pixelArt: false,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, LoginScene, MainMenuScene, MainCityScene, SkillScene, CharacterScene, BestiaryScene, EquipmentCodexScene, ForestScene, GameOverScene],
};

const game = new Phaser.Game(config);
(window as any).game = game;
(window as any).GameState = GameState;
