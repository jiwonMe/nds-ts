/// <reference path="../../sdk/index.d.ts" />

// This entire game runs unchanged in the DS ROM and browser preview.
// Keep game code in this ES5-compatible global script for the v0.1 prototype.
var player = { x: 120, y: 138, vy: 0 };
var palette = [0xD6008F, 0x00BCD4, 0x202020];
var accentIndex = 0;
var hops = 0;
var teleports = 0;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

var game: NDSGame = {
  init: function () {
    player.x = 120;
    player.y = 138;
    player.vy = 0;
    accentIndex = 0;
    hops = 0;
    teleports = 0;
  },
  update: function () {
    player.x = clamp(player.x + nds.input.dx() * 2, 8, 232);

    if (nds.input.hit('a') && player.y >= 138) {
      player.vy = -5.8;
      hops += 1;
      nds.audio.tone(660, 7, 0.22);
    }
    if (nds.input.hit('b')) {
      accentIndex = (accentIndex + 1) % palette.length;
      nds.audio.tone(440 + accentIndex * 110, 5, 0.18);
    }
    if (nds.touch.pressed) {
      player.x = clamp(nds.touch.x - 8, 8, 232);
      player.y = clamp(nds.touch.y - 8, 16, 138);
      player.vy = 0;
      teleports += 1;
      nds.audio.tone(880, 4, 0.15);
    }

    player.vy += 0.32;
    player.y += player.vy;
    if (player.y >= 138) {
      player.y = 138;
      player.vy = 0;
    }
  },
  draw: function () {
    var accent = palette[accentIndex];
    var top = nds.top;
    var bottom = nds.bottom;

    top.clear(0xFFFFFF);
    top.text('NDS.TS / PLAYGROUND', 12, 12, 0x202020);
    top.text('ONE TYPESCRIPT GAME. TWO SCREENS.', 12, 22, 0x666666);
    top.rect(12, 32, 232, 2, accent);
    top.rect(28, 62, 28, 2, 0xD8D8D8);
    top.rect(34, 58, 16, 2, 0xD8D8D8);
    top.rect(192, 82, 36, 2, 0xD8D8D8);
    top.rect(200, 78, 20, 2, 0xD8D8D8);
    top.rect(player.x + 3, 151, 10, 2, 0xBBBBBB);
    top.sprite('orb', player.x, player.y);
    top.rect(0, 154, 256, 38, 0xF0F0F0);
    top.rect(0, 154, 256, 2, accent);
    top.text('D-PAD MOVE  /  A JUMP  /  B COLOR', 12, 166, 0x444444);
    top.text('HOPS ' + hops + '   TOUCHES ' + teleports, 12, 178, 0x202020);

    bottom.clear(0xFFFFFF);
    bottom.text('TOUCH TO TELEPORT THE ORB', 12, 12, 0x202020);
    bottom.text('TOUCH POSITION = TOP SCREEN POSITION', 12, 22, 0x666666);
    bottom.rect(12, 34, 232, 116, 0xF0F0F0);
    for (var gridX = 28; gridX < 240; gridX += 24) {
      bottom.rect(gridX, 34, 1, 116, 0xD8D8D8);
    }
    for (var gridY = 46; gridY < 150; gridY += 24) {
      bottom.rect(12, gridY, 232, 1, 0xD8D8D8);
    }
    bottom.rect(player.x + 6, player.y + 6, 4, 4, accent);
    if (nds.touch.down) {
      bottom.rect(nds.touch.x - 6, nds.touch.y, 13, 1, accent);
      bottom.rect(nds.touch.x, nds.touch.y - 6, 1, 13, accent);
    }
    bottom.text('FRAME ' + nds.frame + '   HEAP ' + Math.round(nds.stats.heapBytes / 1024) + 'K', 12, 161, 0x444444);
    bottom.text('UPDATE ' + nds.stats.updateMicros + 'US', 12, 172, 0x666666);
    bottom.text('DRAW   ' + nds.stats.drawMicros + 'US', 12, 182, 0x666666);
  }
};
