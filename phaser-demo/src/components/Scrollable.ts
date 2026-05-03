import Phaser from 'phaser';

// 通用滚动容器：在固定矩形视口内滚动一个 Container，支持鼠标滚轮与右侧拖动条。
// 使用方将所有需要滚动的子元素 add 到 this.content 中，相对 (0,0) 起向下排布。

export interface ScrollableOptions {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  contentHeight: number;
  scrollSpeed?: number;
  showScrollbar?: boolean;
  trackColor?: number;
  thumbColor?: number;
}

const DEFAULT_SCROLL_SPEED = 60;
const DEFAULT_TRACK_COLOR = 0x1e293b;
const DEFAULT_THUMB_COLOR = 0x475569;
const SCROLLBAR_WIDTH = 4;

export class Scrollable {
  readonly content: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private viewport: Phaser.Geom.Rectangle;
  private viewX: number;
  private viewY: number;
  private viewW: number;
  private viewH: number;
  private contentHeight: number;
  private scrollSpeed: number;
  private showScrollbar: boolean;
  private trackColor: number;
  private thumbColor: number;

  private scrollOffset = 0;

  private maskGraphics: Phaser.GameObjects.Graphics;
  private mask: Phaser.Display.Masks.GeometryMask;

  private track: Phaser.GameObjects.Rectangle | null = null;
  private thumb: Phaser.GameObjects.Rectangle | null = null;
  private thumbMinY = 0;
  private thumbMaxY = 0;
  private thumbHeight = 0;

  private wheelHandler: (
    pointer: Phaser.Input.Pointer,
    over: Phaser.GameObjects.GameObject[],
    dx: number,
    dy: number,
    dz: number,
    event: WheelEvent
  ) => void;

  private dragHandler: (
    pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dragX: number,
    dragY: number
  ) => void;

  constructor(options: ScrollableOptions) {
    this.scene = options.scene;
    this.viewX = options.x;
    this.viewY = options.y;
    this.viewW = options.width;
    this.viewH = options.height;
    this.contentHeight = Math.max(0, options.contentHeight);
    this.scrollSpeed = options.scrollSpeed ?? DEFAULT_SCROLL_SPEED;
    this.showScrollbar = options.showScrollbar !== false;
    this.trackColor = options.trackColor ?? DEFAULT_TRACK_COLOR;
    this.thumbColor = options.thumbColor ?? DEFAULT_THUMB_COLOR;

    this.viewport = new Phaser.Geom.Rectangle(this.viewX, this.viewY, this.viewW, this.viewH);

    // 内容容器：通过移动其 y 实现滚动；初始 y == viewY
    this.content = this.scene.add.container(this.viewX, this.viewY);

    // 遮罩 graphics（不可见，仅作为 mask 几何源）
    this.maskGraphics = this.scene.add.graphics();
    this.maskGraphics.fillStyle(0xffffff, 1);
    this.maskGraphics.fillRect(this.viewX, this.viewY, this.viewW, this.viewH);
    this.maskGraphics.setVisible(false);
    this.mask = this.maskGraphics.createGeometryMask();
    this.content.setMask(this.mask);

    // 滚动条（仅在内容超长且开启时创建）
    this.buildScrollbar();

    // 滚轮监听
    this.wheelHandler = (pointer, _over, _dx, dy, _dz, event) => {
      if (!Phaser.Geom.Rectangle.Contains(this.viewport, pointer.x, pointer.y)) return;
      if (this.contentHeight <= this.viewH) return;
      this.scrollOffset += Math.sign(dy) * this.scrollSpeed;
      this.applyScroll();
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
    };
    this.scene.input.on('wheel', this.wheelHandler);

    // 拖动滑块
    this.dragHandler = (_pointer, gameObject, _dragX, dragY) => {
      if (gameObject !== this.thumb) return;
      if (!this.thumb) return;
      const clampedY = Phaser.Math.Clamp(dragY, this.thumbMinY, this.thumbMaxY);
      this.thumb.y = clampedY;
      const range = this.thumbMaxY - this.thumbMinY;
      const ratio = range > 0 ? (clampedY - this.thumbMinY) / range : 0;
      const maxScroll = Math.max(0, this.contentHeight - this.viewH);
      this.scrollOffset = ratio * maxScroll;
      this.content.y = this.viewY - this.scrollOffset;
    };
    this.scene.input.on('drag', this.dragHandler);

    this.applyScroll();
  }

  setContentHeight(h: number): void {
    this.contentHeight = Math.max(0, h);
    // 重新构建滚动条以反映新比例
    this.destroyScrollbar();
    this.buildScrollbar();
    this.applyScroll();
  }

  scrollTo(y: number): void {
    this.scrollOffset = y;
    this.applyScroll();
  }

  destroy(): void {
    this.scene.input.off('wheel', this.wheelHandler);
    this.scene.input.off('drag', this.dragHandler);

    this.destroyScrollbar();

    if (this.mask) {
      this.mask.destroy();
    }
    this.maskGraphics.destroy();
    this.content.destroy();
  }

  // ---- 内部方法 ----

  private clampOffset(): void {
    const max = Math.max(0, this.contentHeight - this.viewH);
    if (this.scrollOffset < 0) this.scrollOffset = 0;
    if (this.scrollOffset > max) this.scrollOffset = max;
  }

  private applyScroll(): void {
    this.clampOffset();
    this.content.y = this.viewY - this.scrollOffset;
    this.syncThumbToOffset();
  }

  private buildScrollbar(): void {
    if (!this.showScrollbar) return;
    if (this.contentHeight <= this.viewH) return;

    const trackX = this.viewX + this.viewW - SCROLLBAR_WIDTH;
    this.track = this.scene.add.rectangle(
      trackX,
      this.viewY,
      SCROLLBAR_WIDTH,
      this.viewH,
      this.trackColor,
      1
    );
    this.track.setOrigin(0, 0);

    this.thumbHeight = Math.max(20, this.viewH * (this.viewH / this.contentHeight));
    this.thumbMinY = this.viewY;
    this.thumbMaxY = this.viewY + this.viewH - this.thumbHeight;

    this.thumb = this.scene.add.rectangle(
      trackX,
      this.viewY,
      SCROLLBAR_WIDTH,
      this.thumbHeight,
      this.thumbColor,
      1
    );
    this.thumb.setOrigin(0, 0);
    this.thumb.setInteractive({ draggable: true, useHandCursor: true });
    this.thumb.setData('isThumb', true);
    this.scene.input.setDraggable(this.thumb, true);
  }

  private destroyScrollbar(): void {
    if (this.thumb) {
      this.thumb.destroy();
      this.thumb = null;
    }
    if (this.track) {
      this.track.destroy();
      this.track = null;
    }
  }

  private syncThumbToOffset(): void {
    if (!this.thumb) return;
    const maxScroll = Math.max(0, this.contentHeight - this.viewH);
    const ratio = maxScroll > 0 ? this.scrollOffset / maxScroll : 0;
    const range = this.thumbMaxY - this.thumbMinY;
    this.thumb.y = this.thumbMinY + ratio * range;
  }
}
