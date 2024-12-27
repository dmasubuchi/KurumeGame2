/******************************************************
 * script.js
 * 
 *  - MapLevel.json (同じディレクトリに配置) から
 *    全レベルのマップデータを読み込んでゲームをプレイ。
 *  - assets_config.json (同じフォルダ) で画像アセットを設定。
 *  - index.html でレイアウト(左側にメニュー/右側にCanvas)。
 ******************************************************/

// ----------------------------------------------------
// 1) HTML要素やグローバル変数の定義
// ----------------------------------------------------
const levelSelect     = document.getElementById("level-select");
const startButton     = document.getElementById("start-btn");
const endButton       = document.getElementById("end-btn");
const timeValue       = document.getElementById("time-value");
const canvas          = document.getElementById("game-canvas");
const ctx             = canvas.getContext("2d");

// タイマー関連
let timeLimit         = 30; // 30秒固定 (変更はご自由に)
let timeRemaining     = timeLimit;
let timerInterval     = null;

// ゲーム進行
let isGamePlaying     = false;
let currentMapData    = null;    // 現在プレイ中のマップ(tilesなど)
let allLevels         = [];       // MapLevel.json の "levels" 配列
let config            = null;     // assets_config.json の内容
let imageCache        = {};       // 画像キャッシュ

// プレイヤー情報
let playerX           = 0;
let playerY           = 0;
let tileSize          = 64;       // タイル1枚のサイズ (ピクセル)


// ----------------------------------------------------
// 2) ページ読み込み時の初期化処理
// ----------------------------------------------------
window.addEventListener("load", () => {
  // 順番:
  // 1) assets_config.json を読み込み
  // 2) MapLevel.json を読み込み (同ディレクトリ)
  // 3) 画像プリロード
  // 4) メニューやUIを初期化
  loadConfig()
    .then(() => loadAllMaps()) 
    .then(() => preloadImages())
    .then(() => initMenu())
    .catch(err => {
      console.error("Initialization error:", err);
    });
});


// ----------------------------------------------------
// 3) assets_config.json を読み込む
// ----------------------------------------------------
function loadConfig() {
  return fetch("assets_config.json")
    .then(response => {
      if (!response.ok) {
        throw new Error("Failed to load assets_config.json");
      }
      return response.json();
    })
    .then(jsonData => {
      config = jsonData;
      // tileSize の指定があれば上書き
      if (config.tileSize) {
        tileSize = config.tileSize;
      }
    });
}


// ----------------------------------------------------
// 4) MapLevel.json (同ディレクトリ) を読み込む
// ----------------------------------------------------
function loadAllMaps() {
  // 同じフォルダにある MapLevel.json を fetch
  return fetch("MapLevel.json")
    .then(response => {
      if (!response.ok) {
        throw new Error("Failed to load MapLevel.json");
      }
      return response.json();
    })
    .then(jsonData => {
      // jsonData.levels に全レベルの配列が入っているはず
      allLevels = jsonData.levels;
      if (!Array.isArray(allLevels)) {
        throw new Error("MapLevel.json: 'levels' is not an array");
      }
    });
}


// ----------------------------------------------------
// 5) 画像アセットのプリロード
// ----------------------------------------------------
function preloadImages() {
  // 画像アセットを使わない設定 or configが未取得なら抜ける
  if (!config || !config.useAssets) {
    return Promise.resolve();
  }

  const promises = [];
  // config.images に定義されているキー(例: wall, floorなど)ごとにロード
  for (const key in config.images) {
    const src = config.images[key];
    if (!src) continue;

    const img = new Image();
    const p = new Promise((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => {
        console.warn("Failed to load image:", src);
        imageCache[key] = null;
        resolve();
      };
    });
    img.src = src;
    imageCache[key] = img;  // 途中でも格納
    promises.push(p);
  }

  return Promise.all(promises);
}


// ----------------------------------------------------
// 6) メニュー初期化 (イベントリスナー設定など)
// ----------------------------------------------------
function initMenu() {
  // 「ゲーム開始」ボタン
  startButton.addEventListener("click", () => {
    const level = parseInt(levelSelect.value, 10);
    startGame(level);
  });

  // 「ゲーム終了」ボタン
  endButton.addEventListener("click", () => {
    endGame();
  });
}


// ----------------------------------------------------
// 7) ゲーム開始
// ----------------------------------------------------
function startGame(level) {
  // 既にプレイ中ならリセット
  if (isGamePlaying) {
    endGame();
  }

  // allLevels から選択レベルを検索
  const mapData = allLevels.find(l => l.id === level);
  if (!mapData) {
    alert("指定レベルが見つかりません (id: " + level + ")");
    return;
  }

  currentMapData = mapData;
  initGameState();
  initTimer();
  isGamePlaying = true;
  // メインループ開始
  gameLoop();
}


// ----------------------------------------------------
// 8) ゲーム状態の初期化
// ----------------------------------------------------
function initGameState() {
  // タイマーリセット
  timeRemaining = timeLimit;
  timeValue.textContent = timeRemaining.toString();

  // プレイヤー座標を S(スタート) に
  const tiles = currentMapData.tiles;
  for (let row = 0; row < currentMapData.height; row++) {
    for (let col = 0; col < currentMapData.width; col++) {
      if (tiles[row][col] === "S") {
        playerY = row;
        playerX = col;
      }
    }
  }
}


// ----------------------------------------------------
// 9) タイマー開始
// ----------------------------------------------------
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
}


// ----------------------------------------------------
// 10) メインループ
// ----------------------------------------------------
function gameLoop() {
  if (!isGamePlaying) return;

  // 描画
  drawGame();

  // 次フレーム
  requestAnimationFrame(gameLoop);
}


// ----------------------------------------------------
// 11) 描画処理
// ----------------------------------------------------
function drawGame() {
  if (!currentMapData) return;

  // Canvasクリア
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // タイルを描画
  const tiles = currentMapData.tiles;
  for (let row = 0; row < currentMapData.height; row++) {
    for (let col = 0; col < currentMapData.width; col++) {
      const ch = tiles[row][col];
      drawTile(ch, col, row);
    }
  }

  // プレイヤー描画
  drawPlayer();
}


// ----------------------------------------------------
// 12) タイルの描画 (画像 or テキスト)
// ----------------------------------------------------
function drawTile(ch, col, row) {
  if (config && config.useAssets) {
    // 画像が使える場合
    let key = null;
    switch (ch) {
      case '#': key = 'wall';  break;
      case 'S': key = 'start'; break;
      case 'G': key = 'goal';  break;
      default:
        // 床その他
        key = 'floor';
        break;
    }
    const img = imageCache[key];
    if (img) {
      ctx.drawImage(img, col * tileSize, row * tileSize, tileSize, tileSize);
      return;
    }
    // 画像ロード失敗時はフォールバック
  }

  // テキスト(ASCII)描画
  ctx.fillStyle = "white";
  ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
  ctx.fillStyle = "black";
  ctx.font = "16px monospace";
  ctx.fillText(ch, col * tileSize + 16, row * tileSize + 32);
}


// ----------------------------------------------------
// 13) プレイヤー描画
// ----------------------------------------------------
function drawPlayer() {
  if (!currentMapData) return;

  const px = playerX * tileSize;
  const py = playerY * tileSize;

  if (config && config.useAssets && imageCache["player"]) {
    ctx.drawImage(imageCache["player"], px, py, tileSize, tileSize);
  } else {
    // ASCII or 四角でプレイヤーを表現
    ctx.fillStyle = "blue";
    ctx.fillRect(px, py, tileSize, tileSize);

    ctx.fillStyle = "white";
    ctx.font = "20px monospace";
    ctx.fillText("P", px + tileSize / 4, py + tileSize / 1.5);
  }
}


// ----------------------------------------------------
// 14) キーボード操作 (上下左右 移動)
// ----------------------------------------------------
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


// ----------------------------------------------------
// 15) 移動可能か判定 (壁,トラップなど)
// ----------------------------------------------------
function canMoveTo(x, y) {
  if (!currentMapData) return false;
  if (y < 0 || y >= currentMapData.height) return false;
  if (x < 0 || x >= currentMapData.width) return false;

  const ch = currentMapData.tiles[y][x];
  if (ch === '#') {
    // 壁
    return false;
  }

  // T (トラップ), W (動く壁), E (敵) などの処理は拡張
  return true;
}


// ----------------------------------------------------
// 16) ゲームクリア
// ----------------------------------------------------
function levelClear() {
  alert("Level Clear!");
  endGame();
}


// ----------------------------------------------------
// 17) ゲームオーバー
// ----------------------------------------------------
function gameOver(message) {
  alert(message);
  endGame();
}


// ----------------------------------------------------
// 18) ゲーム終了
// ----------------------------------------------------
function endGame() {
  isGamePlaying = false;
  clearInterval(timerInterval);
  // 他に初期化する項目があれば実施
}
