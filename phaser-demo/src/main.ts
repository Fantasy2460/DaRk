import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { MainCityScene } from './scenes/MainCityScene';
import { SkillScene } from './scenes/SkillScene';
import { CharacterScene } from './scenes/CharacterScene';
import { ForestScene } from './scenes/ForestScene';
import { GameOverScene } from './scenes/GameOverScene';

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
  scene: [BootScene, MainMenuScene, MainCityScene, SkillScene, CharacterScene, ForestScene, GameOverScene],
};

new Phaser.Game(config);
