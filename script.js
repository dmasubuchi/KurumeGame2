/******************************************************
 * script.js
 * 
 * ポイント:
 *   1) フレームごとの処理を細かく行い、それぞれの関数がログ文字列を返す
 *   2) ゲームループ (gameLoop) は最小限の呼び出しだけ行い、
 *      各処理関数の戻り値(ログ文字列)をまとめて steps.push(...) する
 *   3) 最後に addFrameLog(frameCount, steps) で Debug 2 に表示
 *   4) Debug 1 (logDebug) は従来の蓄積ログ: キー入力や開始/終了など
 *   5) Canvasサイズをマップ幅×tileSizeに合わせる (単純案)
 *   6) 敵"E"をゆっくり動かし、衝突でGameOver
 ******************************************************/

/*********************************************************
 * 0) デバッグログ関連
 *********************************************************/

// Debug 1: 蓄積ログ (イベントやキー入力など)
function logDebug(tag, message) {
  const debugPanel = document.getElementById("debug-messages");
  if (!debugPanel) return;

  const now = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.textContent = `[${now}] [${tag}] ${message}`;

  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

// Debug 2: フレームごとの詳細を行追加 (履歴として蓄積)
function addFrameLog(frameNumber, steps) {
  const debug2 = document.getElementById("debug2-frameinfo");
  if (!debug2) return;

  let now = new Date().toLocaleTimeString();
  let content = `[${now}] Frame #${frameNumber}\n`;
  for (let step of steps) {
    content += " - " + step + "\n";
  }

  // 1フレームごとに <div> 追加
  const div = document.createElement("div");
  div.style.borderBottom = "1px dashed #ccc";
  div.style.marginBottom = "5px";
  div.style.whiteSpace = "pre"; // 改行を活かす
  div.textContent = content;

  debug2.appendChild(div);
  debug2.scrollTop = debug2.scrollHeight;
}

/*********************************************************
 * 1) HTML要素やグローバル変数の定義
 *********************************************************/
const levelSelect = document.getElementById("level-select");
const startButton = document.getElementById("start-btn");
const endButton   = document.getElementById("end-btn");
const timeValue   = document.getElementById("time-value");
const canvas      = document.getElementById("game-canvas");
const ctx         = canvas.getContext("2d");

let timeLimit     = 30;
let timeRemaining = timeLimit;
let timerInterval = null;

let isGamePlaying = false;
let currentMapData= null;
let allLevels     = [];
let config        = null;
let imageCache    = {};

let playerX       = 0;
let playerY       = 0;
let tileSize      = 64;

let enemies       = [];
let frameCount    = 0;

/*********************************************************
 * 2) ページ読み込み時 (初期化の流れ)
 *********************************************************/
window.addEventListener("load", () => {
  logDebug("INFO","Page loaded. Start initialization...");
  loadConfig()
    .then(() => loadAllMaps())
    .then(() => preloadImages())
    .then(() => initMenu())
    .catch(err => {
      logDebug("ERROR","Initialization error: " + err.message);
      const statusEl = document.getElementById("map-status");
      if (statusEl) {
        statusEl.textContent = "Failed to load JSON: " + err.message;
      }
    });
});

/*********************************************************
 * 3) assets_config.json 読み込み
 *********************************************************/
function loadConfig() {
  logDebug("EVENT","Loading assets_config.json...");
  return fetch("assets_config.json")
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load assets_config.json (status: ${response.status})`);
      }
      return response.json();
    })
    .then(jsonData => {
      config = jsonData;
      if (config.tileSize) {
        tileSize = config.tileSize;
      }
      logDebug("OUTPUT", "config loaded: " + JSON.stringify(config));
    });
}

/*********************************************************
 * 4) MapLevel.json 読み込み
 *********************************************************/
function loadAllMaps() {
  logDebug("EVENT","Loading MapLevel.json...");
  return fetch("MapLevel.json")
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load MapLevel.json (status: ${response.status})`);
      }
      return response.json();
    })
    .then(jsonData => {
      allLevels = jsonData.levels;
      if (!Array.isArray(allLevels)) {
        throw new Error("MapLevel.json: 'levels' is not an array");
      }
      logDebug("OUTPUT","allLevels loaded successfully!");
      const statusEl = document.getElementById("map-status");
      if (statusEl) {
        statusEl.textContent = "Map loaded successfully!";
      }
    });
}

/*********************************************************
 * 5) 画像のプリロード
 *********************************************************/
function preloadImages() {
  if (!config || !config.useAssets) {
    logDebug("INFO","useAssets = false, skip images");
    return Promise.resolve();
  }
  logDebug("EVENT","Preloading images...");
  const promises = [];
  for (const key in config.images) {
    const src = config.images[key];
    if (!src) continue;

    const img = new Image();
    const p = new Promise((resolve) => {
      img.onload = () => {
        logDebug("OUTPUT","Image loaded: " + src);
        resolve();
      };
      img.onerror = () => {
        logDebug("WARN","Failed to load image: " + src);
        imageCache[key] = null;
        resolve();
      };
    });
    img.src = src;
    imageCache[key] = img;
    promises.push(p);
  }
  return Promise.all(promises);
}

/*********************************************************
 * 6) メニュー初期化
 *********************************************************/
function initMenu() {
  logDebug("EVENT","initMenu called");
  startButton.addEventListener("click", () => {
    logDebug("INPUT","[Button] Start clicked");
    const levelValue = parseInt(levelSelect.value, 10);
    if (isNaN(levelValue)) {
      alert("レベルの値が不正です。");
      return;
    }
    startGame(levelValue);
  });
  endButton.addEventListener("click", () => {
    logDebug("INPUT","[Button] End clicked");
    endGame();
  });
  logDebug("INFO","Menu initialized");
}

/*********************************************************
 * 7) ゲーム開始
 *********************************************************/
function startGame(level) {
  logDebug("EVENT",`startGame(level=${level})`);
  if (isGamePlaying) endGame();

  const mapData = allLevels.find(l => l.id === level);
  if (!mapData) {
    alert("指定レベルが見つかりません (id:"+level+")");
    logDebug("WARN","mapData undefined for level="+level);
    return;
  }

  currentMapData = mapData;
  // Canvasをマップに合わせる
  canvas.width  = currentMapData.width  * tileSize;
  canvas.height = currentMapData.height * tileSize;
  logDebug("INFO", `Canvas resized to ${canvas.width} x ${canvas.height}`);

  initGameState();
  initTimer();
  isGamePlaying = true;
  frameCount = 0;

  logDebug("INFO","Game started with level="+level);
  gameLoop();
}

/*********************************************************
 * 8) ゲーム状態初期化
 *********************************************************/
function initGameState() {
  timeRemaining = timeLimit;
  timeValue.textContent = timeRemaining;

  enemies = [];

  const tiles = currentMapData.tiles;
  for (let row = 0; row < currentMapData.height; row++) {
    for (let col = 0; col < currentMapData.width; col++) {
      const ch = tiles[row][col];
      if (ch === "S") {
        playerY = row;
        playerX = col;
      }
      else if (ch === "E") {
        enemies.push({
          x: col,
          y: row,
          speedX: 0.01,
          speedY: 0,
          color: "red"
        });
      }
    }
  }
  logDebug("INFO", `initGameState: player=(${playerX},${playerY}), enemies=${enemies.length}`);
}

/*********************************************************
 * 9) タイマー開始
 *********************************************************/
function initTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!isGamePlaying) return;
    timeRemaining--;
    timeValue.textContent = timeRemaining;
    if (timeRemaining <= 0) {
      gameOver("Time Up! GameOver!");
    }
  }, 1000);
  logDebug("INFO","Timer started");
}

/*********************************************************
 * 10) メインループ
 *********************************************************/
function gameLoop() {
  if (!isGamePlaying) return;

  frameCount++;

  // ▼ 各処理ごとにログ用文字列を集める
  const steps = [];
  steps.push(handleInput());
  steps.push(updateEnemies());
  steps.push(updatePlayer());
  steps.push(checkCollision());
  steps.push(drawScene());

  // Debug 2: フレームログ蓄積
  addFrameLog(frameCount, steps);

  requestAnimationFrame(gameLoop);
}

/*********************************************************
 * 11) 入力処理 (例)
 *********************************************************/
function handleInput() {
  // ここで実際にはキー状態などを見てプレイヤー移動判定
  // 今回は簡略化
  let inputHappened = false; 
  // ... placeholder
  return inputHappened ? "Handled input" : "No input this frame";
}

/*********************************************************
 * 12) 敵を更新
 *********************************************************/
function updateEnemies() {
  for (let enemy of enemies) {
    enemy.x += enemy.speedX;
    enemy.y += enemy.speedY;
    // 左右端で反転
    if (enemy.x < 1 || enemy.x > currentMapData.width - 2) {
      enemy.speedX *= -1;
    }
  }
  return `Updated enemies (count=${enemies.length})`;
}

/*********************************************************
 * 13) プレイヤー更新
 *********************************************************/
function updatePlayer() {
  // 実際にはキー押下でplayerX,playerYを変える等
  // 今回は省略
  return `Player=(${playerX},${playerY}) updated`;
}

/*********************************************************
 * 14) 衝突判定 (敵)
 *********************************************************/
function checkCollision() {
  for (let enemy of enemies) {
    const ex = Math.floor(enemy.x + 0.5);
    const ey = Math.floor(enemy.y + 0.5);
    if (ex === playerX && ey === playerY) {
      gameOver("敵に触れた！");
      return "Collision -> GameOver";
    }
  }
  return "Collision check done";
}

/*********************************************************
 * 15) 描画処理
 *********************************************************/
function drawScene() {
  if (!currentMapData) return "No map data";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // タイル描画
  const tiles = currentMapData.tiles;
  for (let row = 0; row < currentMapData.height; row++) {
    for (let col = 0; col < currentMapData.width; col++) {
      drawTile(tiles[row][col], col, row);
    }
  }
  // プレイヤー
  drawPlayer();
  // 敵
  drawEnemies();

  return "Scene drawn (tiles+player+enemies)";
}

/*********************************************************
 * 16) タイル描画
 *********************************************************/
function drawTile(ch, col, row) {
  if (config && config.useAssets) {
    let key = null;
    switch (ch) {
      case '#': key='wall';  break;
      case 'S': key='start'; break;
      case 'G': key='goal';  break;
      default:  key='floor'; break;
    }
    const img = imageCache[key];
    if (img) {
      ctx.drawImage(img, col*tileSize, row*tileSize, tileSize, tileSize);
      return;
    }
  }
  ctx.fillStyle = "white";
  ctx.fillRect(col*tileSize, row*tileSize, tileSize, tileSize);

  ctx.fillStyle = "black";
  ctx.font = "16px monospace";
  ctx.fillText(ch, col*tileSize+16, row*tileSize+32);
}

/*********************************************************
 * 17) プレイヤー描画
 *********************************************************/
function drawPlayer() {
  if (!currentMapData) return;
  const px = playerX * tileSize;
  const py = playerY * tileSize;

  if (config && config.useAssets && imageCache["player"]) {
    ctx.drawImage(imageCache["player"], px, py, tileSize, tileSize);
  } else {
    ctx.fillStyle = "blue";
    ctx.fillRect(px, py, tileSize, tileSize);
    ctx.fillStyle = "white";
    ctx.font = "20px monospace";
    ctx.fillText("P", px+tileSize/4, py+tileSize/1.5);
  }
}

/*********************************************************
 * 18) キーボード操作 (上下左右)
 *********************************************************/
document.addEventListener("keydown", (e) => {
  if (!isGamePlaying) return;

  logDebug("INPUT","KeyDown: " + e.key);
  let newX = playerX;
  let newY = playerY;

  switch(e.key){
    case "ArrowUp":    newY--; break;
    case "ArrowDown":  newY++; break;
    case "ArrowLeft":  newX--; break;
    case "ArrowRight": newX++; break;
    default: return;
  }

  if (!canMoveTo(newX, newY)) {
    logDebug("OUTPUT", `Cannot move to (${newX},${newY})`);
    return;
  }

  playerX = newX;
  playerY = newY;
  logDebug("INFO", `Player moved to (${playerX},${playerY})`);

  // ゴール判定
  const ch = currentMapData.tiles[newY][newX];
  if (ch === 'G') {
    levelClear();
  }
});

/*********************************************************
 * 19) 移動可能か判定
 *********************************************************/
function canMoveTo(x, y){
  if (!currentMapData) return false;
  if (y<0 || y>= currentMapData.height) return false;
  if (x<0 || x>= currentMapData.width ) return false;

  const ch = currentMapData.tiles[y][x];
  if (ch === '#') {
    return false;
  }
  return true;
}

/*********************************************************
 * 20) レベルクリア
 *********************************************************/
function levelClear(){
  logDebug("OUTPUT","Level Clear!");
  alert("Level Clear!");
  endGame();
}

/*********************************************************
 * 21) ゲームオーバー
 *********************************************************/
function gameOver(msg){
  logDebug("OUTPUT", "GameOver: " + msg);
  alert(msg);
  endGame();
}

/*********************************************************
 * 22) ゲーム終了
 *********************************************************/
function endGame(){
  isGamePlaying=false;
  clearInterval(timerInterval);
  logDebug("INFO","endGame called, game stopped");
}
