/// <reference path="../../sdk/index.d.ts" />

// Hinge Breakout: the bricks live on the top screen and the paddle on the
// bottom screen. The ball crosses a 24-pixel gap where the hinge would be.
//
// Written for Duktape on a 67 MHz ARM9: the game lives inside one function so
// its variables are fast closure locals instead of global-object lookups, and
// strings are rebuilt only when the score or level changes.

var game: NDSGame = (function (): NDSGame {
  var GAP = 24;
  var BOTTOM = 192 + GAP; // world y of the bottom screen's first row
  var COLS = 8;
  var ROWS = 6;
  var BRICK_W = 28;
  var BRICK_H = 9;
  var PITCH_X = 30;
  var PITCH_Y = 11;
  var BRICK_X = 9;
  var BRICK_Y = 28;
  var BRICK_END = BRICK_Y + ROWS * PITCH_Y;
  var CEILING = 20;
  var PADDLE_Y = 170;
  var BALL = 4;
  var TOP_BG = 0x0E1426;
  var BOTTOM_BG = 0x111933;
  var TEXT = 0xE6EBFF;
  var MUTED = 0x8C96C0;
  var ROW_COLORS = [0xFF5C8A, 0xFF922B, 0xFFD43B, 0x69DB7C, 0x3BC9DB, 0x748FFC];
  var ROW_LIGHTS = [0xFFA3BF, 0xFFC078, 0xFFEC99, 0xB2F2BB, 0x99E9F2, 0xBAC8FF];
  var ROW_TONES = [1047, 880, 784, 659, 587, 523];
  var LEVELS = [
    ['########', '########', '########', '########', '########', '########'],
    ['...##...', '..####..', '.######.', '########', '##.##.##', '#......#'],
    ['#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#'],
    ['########', '#......#', '#.####.#', '#.#..#.#', '#......#', '########'],
  ];
  // Glyphs from the engine's 3 x 5 font, drawn larger with one rect per run.
  var GLYPHS: { [character: string]: number } = {
    A: 23530, C: 25166, E: 29391, G: 27470, L: 29257, M: 23549, O: 11114, R: 23275, V: 11117, '!': 8338,
    '0': 31599, '1': 29850, '2': 29667, '3': 14563, '4': 18925, '5': 14543, '6': 31694, '7': 9383, '8': 31727, '9': 14831,
  };
  var STARS = [12, 40, 63, 118, 101, 22, 150, 87, 197, 131, 228, 54, 34, 160, 176, 9, 240, 104, 85, 146];
  var top = nds.top;
  var bottom = nds.bottom;
  var input = nds.input;
  var touch = nds.touch;

  var bricks: number[] = [];
  var runs: number[] = [];
  var bricksLeft = 0;
  var level = 0;
  var lives = 3;
  var score = 0;
  var mode = 'serve';
  var modeFrames = 0;
  var demo = true;
  var idle = 0;
  var paddleX = 128;
  var paddleW = 44;
  var ballX = 126;
  var ballY = 0;
  var ballVX = 0;
  var ballVY = 0;
  var speed = 2.4;
  var trail: number[] = [];
  var sparks: number[] = []; // x, y, vx, vy, life, color for each spark
  var seed = 1;
  var scoreText = '';
  var levelText = '';
  var jingle: number[] = [];
  var jingleWait = 0;

  // Park-Miller generator: every intermediate product stays exact in a double.
  function random(): number {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  function tone(frequency: number, frames: number): void {
    jingle = [];
    nds.audio.tone(frequency, frames, 0.22);
  }

  function addScore(points: number): void {
    score += points;
    scoreText = 'SCORE ' + score;
  }

  // Neighboring bricks in a row share one rect, and the gaps are painted once
  // per column afterwards. A full wall costs 19 draw calls instead of 96.
  function rebuildRuns(): void {
    runs = [];
    for (var row = 0; row < ROWS; row++) {
      var col = 0;
      while (col < COLS) {
        if (!bricks[row * COLS + col]) {
          col++;
          continue;
        }
        var first = col;
        while (col < COLS && bricks[row * COLS + col]) col++;
        runs.push(BRICK_X + first * PITCH_X, BRICK_Y + row * PITCH_Y, (col - first) * PITCH_X - 2,
          ROW_COLORS[row], ROW_LIGHTS[row]);
      }
    }
  }

  function buildLevel(): void {
    var pattern = LEVELS[level % LEVELS.length];
    bricks = [];
    bricksLeft = 0;
    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < COLS; col++) {
        var alive = pattern[row].charAt(col) === '#' ? 1 : 0;
        bricks.push(alive);
        bricksLeft += alive;
      }
    }
    rebuildRuns();
    levelText = 'LEVEL ' + (level + 1);
    speed = 2.4 + level * 0.3 < 4.2 ? 2.4 + level * 0.3 : 4.2;
  }

  function serve(): void {
    mode = 'serve';
    modeFrames = 0;
    trail = [];
  }

  function newGame(): void {
    level = 0;
    lives = 3;
    score = 0;
    addScore(0);
    buildLevel();
    serve();
  }

  function launch(): void {
    var angle = (random() - 0.5) * 1.1;
    ballVX = Math.sin(angle) * speed;
    ballVY = -Math.cos(angle) * speed;
    mode = 'play';
    modeFrames = 0;
    tone(523, 4);
  }

  function burst(x: number, y: number, color: number): void {
    for (var i = 0; i < 5; i++) {
      if (sparks.length >= 180) sparks.splice(0, 6);
      sparks.push(x, y, (random() - 0.5) * 3, -random() * 2.5, 40 + ((random() * 30) | 0), color);
    }
  }

  function hitBrick(oldY: number): void {
    var cx = ballX + BALL / 2 - BRICK_X;
    var cy = ballY + BALL / 2 - BRICK_Y;
    if (cx < 0 || cy < 0) return;
    var col = (cx / PITCH_X) | 0;
    var row = (cy / PITCH_Y) | 0;
    var index = row * COLS + col;
    if (col >= COLS || row >= ROWS || cx - col * PITCH_X >= BRICK_W || cy - row * PITCH_Y >= BRICK_H || !bricks[index]) return;

    bricks[index] = 0;
    bricksLeft -= 1;
    rebuildRuns();
    var brickTop = BRICK_Y + row * PITCH_Y;
    var oldCenter = oldY + BALL / 2;
    if (oldCenter < brickTop || oldCenter >= brickTop + BRICK_H) ballVY = -ballVY;
    else ballVX = -ballVX;
    if (speed < 5) speed += 0.03;
    addScore((ROWS - row) * 10);
    burst(BRICK_X + col * PITCH_X + BRICK_W / 2, brickTop + BRICK_H / 2, ROW_COLORS[row]);
    tone(ROW_TONES[row], 5);
    if (bricksLeft === 0) {
      mode = 'clear';
      modeFrames = 0;
      jingle = [523, 6, 659, 6, 784, 6, 1047, 16];
      jingleWait = 0;
    }
  }

  function moveBall(): void {
    // Three substeps keep a fast ball from skipping through a 9-pixel brick.
    for (var step = 0; step < 3; step++) {
      var oldY = ballY;
      ballX += ballVX / 3;
      ballY += ballVY / 3;
      if (ballX < 0) {
        ballX = 0;
        ballVX = ballVX < 0 ? -ballVX : ballVX;
        tone(196, 2);
      } else if (ballX > 256 - BALL) {
        ballX = 256 - BALL;
        ballVX = ballVX > 0 ? -ballVX : ballVX;
        tone(196, 2);
      }
      if (ballY < CEILING) {
        ballY = CEILING;
        ballVY = ballVY < 0 ? -ballVY : ballVY;
        tone(196, 2);
      }
      if (ballY < BRICK_END) {
        hitBrick(oldY);
        if (mode !== 'play') return;
      }

      var paddleTop = BOTTOM + PADDLE_Y;
      if (ballVY > 0 && oldY + BALL <= paddleTop && ballY + BALL >= paddleTop &&
          ballX + BALL >= paddleX - paddleW / 2 && ballX <= paddleX + paddleW / 2) {
        // Where the ball lands on the paddle sets the angle, up to 60 degrees.
        var offset = (ballX + BALL / 2 - paddleX) / (paddleW / 2);
        offset = offset < -1 ? -1 : offset > 1 ? 1 : offset;
        ballVX = Math.sin(offset * 1.05) * speed;
        ballVY = -Math.cos(offset * 1.05) * speed;
        ballY = paddleTop - BALL;
        tone(392, 4);
      }
      if (ballY > BOTTOM + 192) {
        lives -= 1;
        mode = lives > 0 ? 'lost' : 'over';
        modeFrames = 0;
        jingle = [330, 6, 262, 6, 196, 16];
        jingleWait = 0;
        return;
      }
    }
  }

  function centerText(screen: NDSScreen, value: string, y: number, color: number): void {
    screen.text(value, 128 - value.length * 2, y, color);
  }

  function bigText(value: string, y: number, scale: number, color: number): void {
    var x = Math.round(128 - (value.length * 4 - 1) * scale / 2);
    for (var i = 0; i < value.length; i++) {
      var bits = GLYPHS[value.charAt(i)] || 0;
      for (var row = 0; row < 5; row++) {
        var line = (bits >> (row * 3)) & 7;
        var col = 0;
        while (col < 3) {
          if (!(line & (1 << col))) {
            col++;
            continue;
          }
          var first = col;
          while (col < 3 && (line & (1 << col))) col++;
          top.rect(x + (i * 4 + first) * scale, y + row * scale, (col - first) * scale, scale, color);
        }
      }
    }
  }

  // Draws a square at world coordinates on whichever screen shows it.
  function dot(x: number, y: number, size: number, color: number): void {
    if (y < 192) top.rect(x, y, size, size, color);
    if (y + size > BOTTOM) bottom.rect(x, y - BOTTOM, size, size, color);
  }

  return {
    init: function () {
      seed = 1;
      demo = true;
      idle = 0;
      sparks = [];
      jingle = [];
      paddleX = 128;
      newGame();
    },

    update: function () {
      var steer = input.dx();
      var pressed = input.hit('a') || input.hit('start') || touch.pressed;
      if (pressed || steer !== 0 || touch.down) {
        idle = 0;
        if (demo) {
          demo = false;
          newGame();
        }
      } else if (++idle > 900 && !demo) {
        // Fifteen quiet seconds return to the self-playing demo.
        demo = true;
        newGame();
      }
      modeFrames += 1;

      var target = paddleX + steer * 6;
      if (demo) target = ballX + BALL / 2 + Math.sin(nds.frame / 31) * 14;
      else if (touch.down) target = touch.x;
      var move = target - paddleX;
      paddleX += move < -7 ? -7 : move > 7 ? 7 : move;
      if (paddleX < paddleW / 2 + 2) paddleX = paddleW / 2 + 2;
      if (paddleX > 254 - paddleW / 2) paddleX = 254 - paddleW / 2;

      if (mode === 'serve') {
        ballX = paddleX - BALL / 2;
        ballY = BOTTOM + PADDLE_Y - BALL;
        if ((demo && modeFrames > 45) || (!demo && pressed && modeFrames > 10)) launch();
      } else if (mode === 'play') {
        moveBall();
        trail.push(ballX, ballY);
        if (trail.length > 6) trail.splice(0, 2);
      } else if (mode === 'lost' && modeFrames > 50) {
        serve();
      } else if (mode === 'clear' && modeFrames > 80) {
        level += 1;
        buildLevel();
        serve();
      } else if (mode === 'over' && modeFrames > 60 && (pressed || (demo && modeFrames > 180))) {
        newGame();
      }

      var alive = 0;
      for (var i = 0; i < sparks.length; i += 6) {
        if (sparks[i + 4] <= 1 || sparks[i + 1] > BOTTOM + 192) continue;
        sparks[alive] = sparks[i] + sparks[i + 2];
        sparks[alive + 1] = sparks[i + 1] + sparks[i + 3];
        sparks[alive + 2] = sparks[i + 2];
        sparks[alive + 3] = sparks[i + 3] + 0.16;
        sparks[alive + 4] = sparks[i + 4] - 1;
        sparks[alive + 5] = sparks[i + 5];
        alive += 6;
      }
      sparks.length = alive;

      if (jingleWait > 0) {
        jingleWait -= 1;
      } else if (jingle.length >= 2) {
        var frequency = jingle.shift()!;
        jingleWait = jingle.shift()!;
        nds.audio.tone(frequency, jingleWait, 0.22);
      }
    },

    draw: function () {
      var i = 0;
      top.clear(TOP_BG);
      bottom.clear(BOTTOM_BG);
      var twinkle = (nds.frame >> 4) % 5;
      for (i = 0; i < STARS.length; i += 4) {
        var star = (i >> 2) === twinkle ? 0x4C5A8C : 0x252F52;
        top.rect(STARS[i], 100 + STARS[i + 1] % 88, 1, 1, star);
        bottom.rect(STARS[i + 2], 8 + STARS[i + 3], 1, 1, star);
      }

      top.text(scoreText, 8, 8, TEXT);
      top.text(levelText, 249 - levelText.length * 4, 8, MUTED);
      for (i = 0; i < lives; i++) top.rect(117 + i * 8, 8, 5, 5, 0xFF5C8A);
      top.rect(0, 17, 256, 1, 0x26304F);
      for (i = 0; i < runs.length; i += 5) {
        top.rect(runs[i], runs[i + 1], runs[i + 2], BRICK_H, runs[i + 3]);
        top.rect(runs[i], runs[i + 1], runs[i + 2], 2, runs[i + 4]);
      }
      for (i = 1; i < COLS; i++) top.rect(BRICK_X + i * PITCH_X - 2, BRICK_Y, 2, ROWS * PITCH_Y, TOP_BG);

      for (i = 0; i < sparks.length; i += 6) dot(sparks[i], sparks[i + 1], 2, sparks[i + 5]);
      if (mode === 'serve') dot(ballX, ballY, BALL, 0xFFFFFF);
      if (mode === 'play') {
        for (i = 0; i < trail.length; i += 2) dot(trail[i] + 1, trail[i + 1] + 1, 2, i === 4 ? 0x7083C2 : 0x3E4C80);
        dot(ballX, ballY, BALL, 0xFFFFFF);
        // The hinge hides the ball for a moment, so mark where it will appear.
        if (ballVY > 0 && ballY > 150 && ballY < BOTTOM) bottom.rect(ballX - 2, 0, BALL + 4, 2, 0xFFFFFF);
        if (ballVY < 0 && ballY > 192 - BALL && ballY < BOTTOM + 40) top.rect(ballX - 2, 190, BALL + 4, 2, 0xFFFFFF);
      }

      var paddleLeft = paddleX - paddleW / 2;
      bottom.rect(paddleLeft, PADDLE_Y, paddleW, 5, 0xD6008F);
      bottom.rect(paddleLeft, PADDLE_Y, paddleW, 1, 0xFF8CCF);

      var blink = nds.frame & 32;
      if (mode === 'over') {
        bigText('GAME OVER', 116, 3, 0xFFFFFF);
        centerText(bottom, scoreText, 76, TEXT);
        if (blink) centerText(bottom, 'TAP OR PRESS A TO PLAY AGAIN', 90, MUTED);
      } else if (mode === 'clear') {
        bigText('CLEAR!', 116, 4, 0xFFD43B);
      } else if (mode === 'serve' && !demo && modeFrames < 70) {
        bigText(levelText, 120, 2, TEXT);
      }
      if (demo) {
        centerText(bottom, 'DEMO', 70, MUTED);
        if (blink) centerText(bottom, 'TOUCH OR PRESS A TO PLAY', 84, TEXT);
      } else if (mode === 'serve') {
        centerText(bottom, 'STYLUS OR D-PAD TO STEER', 182, MUTED);
        if (blink) centerText(bottom, 'TAP OR PRESS A TO LAUNCH', 70, TEXT);
      }
    },
  };
})();
