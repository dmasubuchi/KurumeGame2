/******************************************************
 * script.js
 * 
 *  - MapLevel.json (同じディレクトリに配置) から
 *    全レベルのマップデータを読み込んでゲームをプレイ。
 *  - assets_config.json (同フォルダ) で画像アセットを設定。
 *  - index.html でレイアウト(左側にメニュー/右側にCanvas)。
 * 
 *  - 今回の変更点:
 *    1) 敵キャラ "E" をマップ上で認識し、enemies 配列へ登録
 *    2) 敵をゆっくり動かす (updateEnemies)
 *    3) 敵を赤い四角で描画 (drawEnemies)
 *    4) 敵とプレイヤーが接触したら GameOver
 ******************************************************/

/*********************************************************
 * グローバル変数やHTML要素の取得
 *********************************************************/
const levelSelect     = document.getElementById("level-select");
const startButton     = document.getElementById("start-btn");
const endButton       = document.getElementById("end-btn");
const timeValue       = document.getElementById("time-value");
const canvas          = document.getElementById("game-canvas");
const ctx             = canvas.getContext("2d");

/*********************************************************
 * タイマーやゲーム状態管理用
 *********************************************************/
let timeLimit         = 30; // 30秒固定
let timeRemaining     = timeLimit;
let timerInterval     = null;

let isGamePlaying     = false;
let currentMapData    = null;    // 現在プレイ中のマップ(tilesなど)
let allLevels         = [];       // MapLevel.json の "levels" 配列
let config            = null;     // assets_config.json の内容
let imageCache        = {};       // 画像キャッシュ

/*********************************************************
 * プレイヤーと敵関連
 *********************************************************/
let playerX           = 0;
let playerY           = 0;
let tileSize          = 64;       // タイル1枚のサイズ (ピクセル)

// ★ 敵の配列を管理
let enemies = [];  // { x, y, speedX, speedY, color }

/*********************************************************
 * ページ読み込み時
 *********************************************************/
window.addEventListener("load", () => {
  loadConfig()
    .then(() => loadAllMaps())
    .then(() => preloadImages())
    .then(() => initMenu())
    .catch(err => {
      console.error("Initialization error:", err);
      document.getElementById("map-status").textContent
        = "Failed to load JSON: " + err.message;
    });
});

/*********************************************************
 * 1) assets_config.json を読み込む
 *********************************************************/
function loadConfig() {
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
      console.log("★ config loaded:", config);
    });
}

/*********************************************************
 * 2) MapLevel.json を読み込む
 *********************************************************/
function loadAllMaps() {
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
      console.log("★ allLevels loaded:", allLevels);

      document.getElementById("map-status").textContent = "Map loaded successfully!";
    });
}

/*********************************************************
 * 3) 画像アセットのプリロード
 *********************************************************/
function preloadImages() {
  if (!config || !config.useAssets) {
    console.log("★ useAssets = false, skip image preload");
    return Promise.resolve();
  }

  const promises = [];
  for (const key in config.images) {
    const src = config.images[key];
    if (!src) continue;

    const img = new Image();
    const p = new Promise((resolve) => {
      img.onload = () => {
        console.log(`★ Image loaded: ${src}`);
        resolve();
      };
      img.onerror = () => {
        console.warn("Failed to load image:", src);
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
  startButton.addEventListener("click", () => {
    const levelValue = parseInt(levelSelect.value, 10);
    if (isNaN(levelValue)) {
      alert("レベルの値が不正です。");
      return;
    }
    startGame(levelValue);
  });

  endButton.addEventListener("click", () => {
    endGame();
  });

  console.log("★ Menu initialized");
}

/*********************************************************
 * 5) ゲーム開始
 *********************************************************/
function startGame(level) {
  if (isGamePlaying) {
    endGame();
  }

  const mapData = allLevels.find(l => l.id === level);
  if (!mapData) {
    alert("指定レベルが見つかりません (id: " + level + ")");
    console.warn("★ mapData is undefined for level:", level);
    return;
  }

  console.log("★ startGame with level =", level, "mapData =", mapData);

  currentMapData = mapData;
  initGameState();
  initTimer();
  isGamePlaying = true;

  gameLoop();
}

/*********************************************************
 * 6) ゲーム状態の初期化 (プレイヤー位置 / 敵初期化)
 *********************************************************/
function initGameState() {
  timeRemaining = timeLimit;
  timeValue.textContent = timeRemaining.toString();

  enemies = [];  // 敵リストをリセット

  const tiles = currentMapData.tiles;
  for (let row = 0; row < currentMapData.height; row++) {
    for (let col = 0; col < currentMapData.width; col++) {
      const ch = tiles[row][col];
      if (ch === "S") {
        playerY = row;
        playerX = col;
      }
      // ★ E を敵とみなし、enemiesに登録
      else if (ch === "E") {
        enemies.push({
          x: col,
          y: row,
          speedX: 0.01,  // ゆっくり右へ動く
          speedY: 0,
          color: "red"   // 赤い四角で描画
        });
      }
    }
  }
  console.log(`★ initGameState, start at playerX=${playerX}, playerY=${playerY}`);
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
  console.log("★ Timer started");
}

/*********************************************************
 * 8) メインループ
 *********************************************************/
function gameLoop() {
  if (!isGamePlaying) return;

  // 敵を更新
  updateEnemies();

  // 画面描画
  drawGame();
  drawEnemies();

  // 敵との当たり判定
  checkCollisionWithEnemies();

  requestAnimationFrame(gameLoop);
}

/*********************************************************
 * 9) 敵を更新 (速度で移動, 端で反転)
 *********************************************************/
function updateEnemies() {
  for (let enemy of enemies) {
    enemy.x += enemy.speedX;
    enemy.y += enemy.speedY;

    // 壁衝突など細かい判定は省略し、マップ左右端で反転
    if (enemy.x < 1 || enemy.x > currentMapData.width - 2) {
      enemy.speedX *= -1;
    }
  }
}

/*********************************************************
 * 10) 敵を描画 (四角形)
 *********************************************************/
function drawEnemies() {
  for (let enemy of enemies) {
    let px = enemy.x * tileSize;
    let py = enemy.y * tileSize;

    // 画像を使う場合はここで drawImage(enemyImg, px, py, tileSize, tileSize)
    // 今回は単純に色付きの四角で描画
    ctx.fillStyle = enemy.color;
    ctx.fillRect(px, py, tileSize, tileSize);
  }
}

/*********************************************************
 * 11) 敵との当たり判定
 *********************************************************/
function checkCollisionWithEnemies() {
  for (let enemy of enemies) {
    // 敵座標は小数、プレイヤーは整数タイル座標
    // 同じタイルにいるかどうか判定
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
      const ch = tiles[row][col];
      drawTile(ch, col, row);
    }
  }

  drawPlayer();
}

/*********************************************************
 * 13) タイル描画 (画像 or テキスト)
 *********************************************************/
function drawTile(ch, col, row) {
  if (config && config.useAssets) {
    // 画像アセットある場合
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

  // テキスト(ASCII)描画
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
    return;  // 壁やトラップで通れない
  }

  playerX = newX;
  playerY = newY;

  // ゴール判定
  const ch = currentMapData.tiles[newY][newX];
  if (ch === 'G') {
    levelClear();
  }
});

/*********************************************************
 * 16) 移動可能か判定 (壁,トラップなど)
 *********************************************************/
function canMoveTo(x, y) {
  if (!currentMapData) return false;
  if (y < 0 || y >= currentMapData.height) return false;
  if (x < 0 || x >= currentMapData.width) return false;

  const ch = currentMapData.tiles[y][x];
  if (ch === '#') {
    return false;
  }
  // T, W, E等はここでは通れる扱い (Eは敵)
  return true;
}

/*********************************************************
 * 17) ゲームクリア
 *********************************************************/
function levelClear() {
  alert("Level Clear!");
  endGame();
}

/*********************************************************
 * 18) ゲームオーバー
 *********************************************************/
function gameOver(message) {
  alert(message);
  endGame();
}

/*********************************************************
 * 19) ゲーム終了
 *********************************************************/
function endGame() {
  isGamePlaying = false;
  clearInterval(timerInterval);
  console.log("★ endGame called, game stopped");
}
