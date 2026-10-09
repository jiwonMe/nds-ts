/// <reference path="../../sdk/index.d.ts" />

// Pixel Paint: draw 16 x 12 pixel art with the stylus on the bottom screen.
// The top screen hangs the picture in a frame.
//
// The painting is redrawn every frame as a few merged rectangles. They are
// rebuilt only after a stroke changes a cell, which keeps the per-frame cost
// close to the other examples on a 67 MHz ARM9.

var game: NDSGame = (function (): NDSGame {
  var COLS = 16;
  var ROWS = 12;
  var CELL = 12;
  var CANVAS_X = 4;
  var CANVAS_Y = 4;
  var PALETTE = [0xF8F9FA, 0x212529, 0xD6008F, 0xFF8CC6, 0x339AF0, 0xFFD43B, 0x51CF66, 0xFF922B];
  var SWATCH_X = [202, 228];
  var FRAME = 0x2B2F3A;
  var PANEL = 0x22262F;
  var BUTTON = 0x343A46;
  var TEXT = 0xE9ECEF;
  var MUTED = 0x868E96;
  var WALL = 0xDEE2E6;
  // An original picture: the engine's orb under a sun, standing on grass.
  var PICTURE = [
    '0000000000000000',
    '0000000000005500',
    '0000000000055550',
    '0000001110005500',
    '0000012221000000',
    '0000132222100000',
    '0000121212100000',
    '0000122222100000',
    '0000012221000000',
    '0000001110000000',
    '6666666666666666',
    '6666666666666666',
  ];
  var top = nds.top;
  var bottom = nds.bottom;
  var input = nds.input;
  var touch = nds.touch;

  var cells: number[] = [];
  var framed: number[] = []; // x, y, width, height, color of each block on the top screen
  var canvas: number[] = []; // the same blocks at bottom-screen scale
  var dirty = true;
  var color = 2;
  var filling = false;
  var grid = false;
  var history: number[][] = [];
  var lastCol = -1;
  var lastRow = -1;
  var flash = 0;

  // Greedy meshing: grow each unclaimed block right, then down.
  function rebuild(): void {
    var used: number[] = [];
    framed = [];
    canvas = [];
    for (var index = 0; index < COLS * ROWS; index++) used[index] = 0;
    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < COLS; col++) {
        var start = row * COLS + col;
        var value = cells[start];
        if (used[start] || value === 0) continue;
        var width = 1;
        while (col + width < COLS && !used[start + width] && cells[start + width] === value) width++;
        var height = 1;
        grow: while (row + height < ROWS) {
          for (var k = 0; k < width; k++) {
            var below = start + height * COLS + k;
            if (used[below] || cells[below] !== value) break grow;
          }
          height++;
        }
        for (var y = 0; y < height; y++) {
          for (var x = 0; x < width; x++) used[start + y * COLS + x] = 1;
        }
        framed.push(64 + col * 8, 34 + row * 8, width * 8, height * 8, PALETTE[value]);
        canvas.push(CANVAS_X + col * CELL, CANVAS_Y + row * CELL, width * CELL, height * CELL, PALETTE[value]);
      }
    }
    dirty = false;
  }

  function remember(): void {
    history.push(cells.slice(0));
    if (history.length > 8) history.shift();
  }

  function paint(col: number, row: number, value: number): void {
    var index = row * COLS + col;
    if (cells[index] === value) return;
    cells[index] = value;
    dirty = true;
    nds.audio.tone(220 + value * 70, 2, 0.12);
  }

  // Bresenham steps between stylus samples so fast strokes leave no gaps.
  function stroke(fromCol: number, fromRow: number, toCol: number, toRow: number, value: number): void {
    var dx = toCol > fromCol ? toCol - fromCol : fromCol - toCol;
    var dy = toRow > fromRow ? toRow - fromRow : fromRow - toRow;
    var sx = fromCol < toCol ? 1 : -1;
    var sy = fromRow < toRow ? 1 : -1;
    var error = dx - dy;
    for (;;) {
      paint(fromCol, fromRow, value);
      if (fromCol === toCol && fromRow === toRow) return;
      var twice = error * 2;
      if (twice > -dy) {
        error -= dy;
        fromCol += sx;
      }
      if (twice < dx) {
        error += dx;
        fromRow += sy;
      }
    }
  }

  function fill(col: number, row: number, value: number): void {
    var target = cells[row * COLS + col];
    if (target === value) return;
    var queue = [row * COLS + col];
    while (queue.length) {
      var index = queue.pop()!;
      if (cells[index] !== target) continue;
      cells[index] = value;
      var x = index % COLS;
      if (x > 0) queue.push(index - 1);
      if (x < COLS - 1) queue.push(index + 1);
      if (index >= COLS) queue.push(index - COLS);
      if (index < COLS * (ROWS - 1)) queue.push(index + COLS);
    }
    dirty = true;
    nds.audio.tone(330 + value * 60, 8, 0.18);
  }

  function undo(): void {
    if (!history.length) return;
    cells = history.pop()!;
    dirty = true;
    nds.audio.tone(196, 4, 0.15);
  }

  function clearCanvas(): void {
    remember();
    for (var i = 0; i < COLS * ROWS; i++) cells[i] = 0;
    dirty = true;
    nds.audio.tone(147, 10, 0.18);
  }

  function choose(value: number): void {
    color = (value + PALETTE.length) % PALETTE.length;
    flash = 12;
    nds.audio.tone(523 + color * 40, 3, 0.15);
  }

  // Taps on the side panel: two columns of swatches, then the tool buttons.
  function tapPanel(x: number, y: number): void {
    if (y < 98) choose(((y - 4) / 24 | 0) * 2 + (x >= 227 ? 1 : 0));
    else if (y < 124) filling = x >= 227;
    else if (y < 146) undo();
    else if (y < 168) clearCanvas();
    else grid = !grid;
  }

  function button(x: number, y: number, width: number, label: string, active: boolean): void {
    bottom.rect(x, y, width, 18, active ? TEXT : BUTTON);
    bottom.text(label, x + ((width - label.length * 4 + 1) >> 1), y + 7, active ? PANEL : TEXT);
  }

  return {
    init: function () {
      cells = [];
      for (var row = 0; row < ROWS; row++) {
        for (var col = 0; col < COLS; col++) cells.push(+PICTURE[row].charAt(col));
      }
      history = [];
      color = 2;
      filling = false;
      grid = false;
      dirty = true;
    },

    update: function () {
      if (input.hit('l')) choose(color - 1);
      if (input.hit('r')) choose(color + 1);
      if (input.hit('x')) filling = !filling;
      if (input.hit('y')) undo();
      if (input.hit('select')) grid = !grid;

      var col = ((touch.x - CANVAS_X) / CELL) | 0;
      var row = ((touch.y - CANVAS_Y) / CELL) | 0;
      var onCanvas = touch.x >= CANVAS_X && touch.y >= CANVAS_Y && col < COLS && row < ROWS;
      var value = input.down('b') ? 0 : color;
      if (touch.pressed) {
        if (onCanvas) {
          remember();
          if (filling) fill(col, row, value);
          else paint(col, row, value);
        } else if (touch.x >= 200) {
          tapPanel(touch.x, touch.y);
        }
      } else if (touch.down && onCanvas && !filling && lastCol >= 0 && (col !== lastCol || row !== lastRow)) {
        stroke(lastCol, lastRow, col, row, value);
      }
      lastCol = touch.down && onCanvas ? col : -1;
      lastRow = row;
      if (flash > 0) flash -= 1;
      if (dirty) rebuild();
    },

    draw: function () {
      var i = 0;
      // Top screen: the picture in a frame, 8 pixels per cell.
      top.clear(WALL);
      top.rect(0, 172, 256, 20, 0xCED4DA);
      top.rect(52, 22, 152, 120, 0x343A40);
      top.rect(58, 28, 140, 108, 0xF1F3F5);
      top.rect(64, 34, 128, 96, PALETTE[0]);
      for (i = 0; i < framed.length; i += 5) top.rect(framed[i], framed[i + 1], framed[i + 2], framed[i + 3], framed[i + 4]);
      top.rect(100, 150, 56, 12, 0xADB5BD);
      top.text('PIXEL PAINT', 107, 154, 0x343A40);
      if (lastCol >= 0 && (nds.frame & 8)) top.rect(64 + lastCol * 8, 34 + lastRow * 8, 8, 8, 0x212529);

      // Bottom screen: four bands around the canvas cover every pixel once.
      bottom.rect(0, 0, 200, CANVAS_Y, FRAME);
      bottom.rect(0, CANVAS_Y, CANVAS_X, ROWS * CELL, FRAME);
      bottom.rect(196, CANVAS_Y, 4, ROWS * CELL, FRAME);
      bottom.rect(0, 148, 200, 44, FRAME);
      bottom.rect(200, 0, 56, 192, PANEL);
      bottom.rect(CANVAS_X, CANVAS_Y, COLS * CELL, ROWS * CELL, PALETTE[0]);
      for (i = 0; i < canvas.length; i += 5) bottom.rect(canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3], canvas[i + 4]);
      if (grid) {
        for (i = 1; i < COLS; i++) bottom.rect(CANVAS_X + i * CELL, CANVAS_Y, 1, ROWS * CELL, 0xCED4DA);
        for (i = 1; i < ROWS; i++) bottom.rect(CANVAS_X, CANVAS_Y + i * CELL, COLS * CELL, 1, 0xCED4DA);
      }

      for (i = 0; i < PALETTE.length; i++) {
        bottom.rect(SWATCH_X[i & 1], 4 + (i >> 1) * 24, 24, 22, PALETTE[i]);
      }
      var swatchX = SWATCH_X[color & 1];
      var swatchY = 4 + (color >> 1) * 24;
      bottom.rect(swatchX + 8, swatchY + 7, 8, 8, color === 1 ? TEXT : PALETTE[1]);
      if (flash & 4) bottom.rect(swatchX + 10, swatchY + 9, 4, 4, PALETTE[color]);

      button(202, 102, 24, 'PEN', !filling);
      button(228, 102, 24, 'FILL', filling);
      button(202, 126, 50, 'UNDO', false);
      button(202, 148, 50, 'CLEAR', false);
      button(202, 170, 50, 'GRID', grid);
      bottom.text('STYLUS PAINTS   HOLD B TO ERASE', 6, 158, TEXT);
      bottom.text('L/R COLOR  X FILL  Y UNDO', 6, 172, MUTED);
    },
  };
})();
