/******************************************************
 * script.js
 * 
 *  - MapLevel.json から全レベルのマップデータを読み込み
 *  - assets_config.json (同フォルダ) で画像アセットを設定
 *  - index.html (左:メニュー, 中:Canvas, 右:Debug Log) で表示
 * 
 *  - 今回の改善点:
 *    1) logDebug(tag, message) 関数を作り、画面の右側にログを表示
 *    2) コンソール出力(console.log)のかわりに logDebug("EVENT","...") 等で区分け
 ******************************************************/

/*********************************************************
 * 0) デバッグログ出力用関数
 *********************************************************/
function logDebug(tag, message) {
  const debugPanel = document.getElementById("debug-messages");
  if (!debugPanel) return;  // 念のため

  // 時刻＋タグ＋メッセージを1行にまとめる
  const now = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.textContent = `[${now}] [${tag}] ${message}`;

  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight; // 自動的に下へスクロール
}

/*********************************************************
 * グローバル変数やHTML要素の取得
 *********************************************************/
const levelSelect     = document.getElementById("level-select");
const startButton     = document.getElementById("start-btn");
const endButton       = document.getElementById("end-btn");
const timeValue       = document.getElementById("time-value");
const canvas          = document.getElementById("game-canvas");
const ctx             = canvas.getContext("2d");

let timeLimit         = 30; // 30秒固定
let timeRemaining     = timeLimit;
let timerInterval     = null;

let isGamePlaying     = false;
let currentMapData    = null;  
let allLevels         = [];       
let config            = null;     
let imageCache        = {};

let playerX           = 0;
let playerY           = 0;
let tileSize          = 64;       

// 敵関連
let enemies = []; // { x, y, speedX, speedY, color }

/*********************************************************
 * ページ読み込み時
 *********************************************************/
window.addEventListener("load", () => {
  logDebug("INFO","Page loaded, start initialization");
  loadConfig()
    .then(() => loadAllMaps())
    .then(() => preloadImages())
    .then(() => initMenu())
    .catch(err => {
      logDebug("ERROR", "Initialization error: " + err.message);
      document.getElementById("map-status").textContent
        = "Failed to load JSON: " + err.message;
    });
});

/*********************************************************
 * 1) assets_config.json を読み込む
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
      logDebug("OUTPUT","config loaded: " + JSON.stringify(config));
    });
}

/*********************************************************
 * 2) MapLevel.json を読み込む
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
      document.getElementById("map-status").textContent = "Map loaded successfully!";
    });
}

/*********************************************************
 * 3) 画像アセットのプリロード
 *********************************************************/
function preloadImages() {
  if (!config || !config.useAssets) {
    logDebug("INFO","useAssets = false, skip image preload");
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
 * 4) メニュー初期化
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
 * 5) ゲーム開始
 *********************************************************/
function startGame(level) {
  logDebug("EVENT",`startGame(level=${level})`);
  if (isGamePlaying) {
    endGame();
  }

  const mapData = allLevels.find(l => l.id === level);
  if (!mapData) {
    alert("指定レベルが見つかりません (id: " + level + ")");
    logDebug("WARN","mapData is undefined for level " + level);
    return;
  }

  currentMapData = mapData;
  initGameState();
  initTimer();
  isGamePlaying = true;

  logDebug("INFO","Game started with level=" + level);
  gameLoop();
}

/*********************************************************
 * 6) ゲーム状態の初期化
 *********************************************************/
function initGameState() {
  timeRemaining = timeLimit;
  timeValue.textContent = timeRemaining.toString();

  enemies = [];  // 敵リストを初期化

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
  logDebug("INFO",`initGameState: player=(${playerX},${playerY}), enemies=${enemies.length}`);
}

/*********************************************************
 * 7) タイマー開始
 *********************************************************/
function initTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!isGamePlaying) return;
    timeRemaining--;
    timeValue.textContent = timeRemaining.toString();
    if (timeRemaining <= 0) {
      gameOver("Time Up! Game Over!");
    }
  }, 1000);
  logDebug("INFO","Timer started");
}

/*********************************************************
 * 8) メインループ
 *********************************************************/
function gameLoop() {
  if (!isGamePlaying) return;

  updateEnemies();
  drawGame();
  drawEnemies();
  checkCollisionWithEnemies();

  requestAnimationFrame(gameLoop);
}

/*********************************************************
 * 9) 敵を更新
 *********************************************************/
function updateEnemies() {
  for (let enemy of enemies) {
    enemy.x += enemy.speedX;
    enemy.y += enemy.speedY;

    // 簡易的にマップ左右端で反転
    if (enemy.x < 1 || enemy.x > currentMapData.width - 2) {
      enemy.speedX *= -1;
    }
  }
}

/*********************************************************
 * 10) 敵を描画
 *********************************************************/
function drawEnemies() {
  for (let enemy of enemies) {
    let px = enemy.x * tileSize;
    let py = enemy.y * tileSize;

    ctx.fillStyle = enemy.color;
    ctx.fillRect(px, py, tileSize, tileSize);
  }
}

/*********************************************************
 * 11) 敵との当たり判定
 *********************************************************/
function checkCollisionWithEnemies() {
  for (let enemy of enemies) {
    // 敵は小数座標, プレイヤーは整数
    let ex = Math.floor(enemy.x + 0.5);
    let ey = Math.floor(enemy.y + 0.5);

    if (ex === playerX && ey === playerY) {
      gameOver("敵に触れた！");
      return;
    }
  }
}

/*********************************************************
 * 12) 画面描画 (タイル + プレイヤー)
 *********************************************************/
function drawGame() {
  if (!currentMapData) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const tiles = currentMapData.tiles;
  for (let row = 0; row < currentMapData.height; row++) {
    for (let col = 0; col < currentMapData.width; col++) {
      drawTile(tiles[row][col], col, row);
    }
  }

  drawPlayer();
}

/*********************************************************
 * 13) タイル描画 (画像 or テキスト)
 *********************************************************/
function drawTile(ch, col, row) {
  if (config && config.useAssets) {
    let key = null;
    switch (ch) {
      case '#': key = 'wall';  break;
      case 'S': key = 'start'; break;
      case 'G': key = 'goal';  break;
      default:
        key = 'floor';
        break;
    }
    const img = imageCache[key];
    if (img) {
      ctx.drawImage(img, col * tileSize, row * tileSize, tileSize, tileSize);
      return;
    }
  }

  ctx.fillStyle = "white";
  ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
  ctx.fillStyle = "black";
  ctx.font = "16px monospace";
  ctx.fillText(ch, col * tileSize + 16, row * tileSize + 32);
}

/*********************************************************
 * 14) プレイヤー描画
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
    ctx.fillText("P", px + tileSize / 4, py + tileSize / 1.5);
  }
}

/*********************************************************
 * 15) キーボード操作 (上下左右移動)
 *********************************************************/
document.addEventListener("keydown", (e) => {
  if (!isGamePlaying) return;

  logDebug("INPUT", "KeyDown: " + e.key);

  let newX = playerX;
  let newY = playerY;

  switch (e.key) {
    case "ArrowUp":    newY--; break;
    case "ArrowDown":  newY++; break;
    case "ArrowLeft":  newX--; break;
    case "ArrowRight": newX++; break;
    default: return;
  }

  if (!canMoveTo(newX, newY)) {
    logDebug("OUTPUT","Cannot move to " + newX + "," + newY);
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
 * 16) 移動可能か判定
 *********************************************************/
function canMoveTo(x, y) {
  if (!currentMapData) return false;
  if (y < 0 || y >= currentMapData.height) return false;
  if (x < 0 || x >= currentMapData.width) return false;

  const ch = currentMapData.tiles[y][x];
  if (ch === '#') {
    return false;
  }
  return true;
}

/*********************************************************
 * 17) ゲームクリア
 *********************************************************/
function levelClear() {
  logDebug("OUTPUT","Level Clear!");
  alert("Level Clear!");
  endGame();
}

/*********************************************************
 * 18) ゲームオーバー
 *********************************************************/
function gameOver(message) {
  logDebug("OUTPUT","GameOver: " + message);
  alert(message);
  endGame();
}

/*********************************************************
 * 19) ゲーム終了
 *********************************************************/
function endGame() {
  isGamePlaying = false;
  clearInterval(timerInterval);
  logDebug("INFO","endGame called, game stopped");
}
