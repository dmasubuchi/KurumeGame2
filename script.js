/******************************************************
 * script.js
 * 
 *  - 外部JSON:
 *     1) assets_config.json → 画像アセット設定 & tileSize指定
 *     2) MapLevel.json      → レベルデータ (width, height, tiles)
 *  - Canvasのサイズを MapLevel.json に合わせる(単純案)
 *  - 敵"E"を動かし(ほんの簡単な例)、プレイヤーが動き、衝突でGameOver
 *  - Debug 1 → 履歴ログ (キー入力/イベント)
 *  - Debug 2 → フレームごとの詳細(複数ステップ)を蓄積表示
 ******************************************************/

/*********************************************************
 * 0) デバッグログ関連
 *********************************************************/
// Debug 1: 履歴ログ
function logDebug(tag, message) {
  const debugPanel = document.getElementById("debug-messages");
  if (!debugPanel) return;

  const now = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.textContent = `[${now}] [${tag}] ${message}`;

  debugPanel.appendChild(div);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

// Debug 2: フレームごとの詳細ログ (行追加)
function addFrameLog(frameNumber, steps) {
  const debug2 = document.getElementById("debug2-frameinfo");
  if (!debug2) return;

  let now = new Date().toLocaleTimeString();
  let content = `[${now}] Frame #${frameNumber}\n`;
  for (let step of steps) {
    content += " - " + step + "\n";
  }

  const div = document.createElement("div");
  div.style.borderBottom = "1px dashed #ccc";
  div.style.marginBottom = "5px";
  div.style.whiteSpace = "pre"; // 改行を生かす
  div.textContent = content;

  debug2.appendChild(div);
  debug2.scrollTop = debug2.scrollHeight;
}

/*********************************************************
 * 1) HTML要素やグローバル変数
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
let currentMapData= null;   // 現在のレベルデータ (width, height, tiles)
let allLevels     = [];      // MapLevel.json の全レベル
let config        = null;    // assets_config.json の内容
let imageCache    = {};

let playerX       = 0;
let playerY       = 0;
let tileSize      = 64;

let enemies       = [];  // {x, y, speedX, speedY, color,...}
let frameCount    = 0;

/*********************************************************
 * 2) ページ読み込み時 → JSON読み込み → メニュー初期化
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
 * 3) assets_config.json を読み込む
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
 * 4) MapLevel.json を読み込む
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
      // ex: { "levels": [ {id:1,width:...,height:...,tiles:[...]} , ... ] }
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
 * 5) 画像アセットのプリロード
 *********************************************************/
function preloadImages() {
  if (!config || !config.useAssets) {
    logDebug("INFO","useAssets=false → skip image preload");
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
    const lv = parseInt(levelSelect.value, 10);
    if (isNaN(lv)) {
      alert("レベル選択が不正です");
      return;
    }
    startGame(lv);
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
    alert("指定レベルがありません (id:"+level+")");
    logDebug("WARN","mapData not found for level="+level);
    return;
  }

  currentMapData = mapData;
  // Canvasサイズをレベルサイズに合わせる
  canvas.width  = currentMapData.width  * tileSize;
  canvas.height = currentMapData.height * tileSize;
  logDebug("INFO", `Canvas resized to ${canvas.width} x ${canvas.height}`);

  initGameState();
  initTimer();
  isGamePlaying = true;
  frameCount = 0;

  logDebug("INFO","Game started. => Enter gameLoop");
  gameLoop();
}

/*********************************************************
 * 8) ゲーム状態の初期化
 *********************************************************/
function initGameState() {
  timeRemaining = timeLimit;
  timeValue.textContent = timeRemaining.toString();
  enemies = [];

  const tiles = currentMapData.tiles;
  for (let row = 0; row < currentMapData.height; row++) {
    for (let col = 0; col < currentMapData.width; col++) {
      const ch = tiles[row][col];
      if (ch === "S") {
        // スタート位置
        playerY = row;
        playerX = col;
      } 
      else if (ch === "E") {
        // 敵を配置(簡易)
        enemies.push({
          x: col,
          y: row,
          speedX: 0.01, // ゆっくり移動
          speedY: 0,
          color: "red"
        });
      }
    }
  }
  logDebug("INFO", `initGameState: player=(${playerX},${playerY}), enemyCount=${enemies.length}`);
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
      gameOver("TimeUp!");
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

  // フレーム内のステップログを蓄積
  let steps = [];

  steps.push(updateEnemies());
  steps.push(drawScene());
  steps.push(checkCollision());

  // Debug 2: フレーム詳細ログ
  addFrameLog(frameCount, steps);

  requestAnimationFrame(gameLoop);
}

/*********************************************************
 * 11) 敵を更新
 *********************************************************/
function updateEnemies() {
  for (let enemy of enemies) {
    enemy.x += enemy.speedX;
    enemy.y += enemy.speedY;
    // 左右端で反転
    if (enemy.x<1 || enemy.x> currentMapData.width -2) {
      enemy.speedX *= -1;
    }
  }
  return `Enemies updated (count=${enemies.length})`;
}

/*********************************************************
 * 12) シーン描画 (マップ + プレイヤー + 敵)
 *********************************************************/
function drawScene() {
  if (!currentMapData) return "No mapData to draw";
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // タイル描画
  const tiles = currentMapData.tiles;
  for (let row=0; row< currentMapData.height; row++){
    for (let col=0; col< currentMapData.width; col++){
      drawTile(tiles[row][col], col, row);
    }
  }
  // プレイヤー
  drawPlayer();
  // 敵
  drawEnemies();

  return "Scene drawn";
}

/*********************************************************
 * 13) 衝突判定 (プレイヤー - 敵)
 *********************************************************/
function checkCollision() {
  for (let enemy of enemies){
    const ex = Math.floor(enemy.x + 0.5);
    const ey = Math.floor(enemy.y + 0.5);
    if (ex===playerX && ey===playerY){
      gameOver("敵に触れた!");
      return "Collision -> GameOver";
    }
  }
  return "Collision check done";
}

/*********************************************************
 * 14) タイル描画
 *********************************************************/
function drawTile(ch, col, row){
  if (config && config.useAssets) {
    let key=null;
    switch(ch){
      case '#': key='wall';  break;
      case 'S': key='start'; break;
      case 'G': key='goal';  break;
      case 'E': key='enemy'; break; 
      default:  key='floor'; break;
    }
    const img = imageCache[key];
    if (img){
      ctx.drawImage(img,col*tileSize, row*tileSize, tileSize, tileSize);
      return;
    }
  }

  // ASCII fallback
  ctx.fillStyle="white";
  ctx.fillRect(col*tileSize, row*tileSize, tileSize, tileSize);

  ctx.fillStyle="black";
  ctx.font="16px monospace";
  ctx.fillText(ch,col*tileSize+16, row*tileSize+32);
}

/*********************************************************
 * 15) プレイヤー描画
 *********************************************************/
function drawPlayer(){
  if (!currentMapData) return;
  const px = playerX*tileSize;
  const py = playerY*tileSize;

  if(config && config.useAssets && imageCache["player"]){
    ctx.drawImage(imageCache["player"], px, py, tileSize, tileSize);
  } else {
    ctx.fillStyle="blue";
    ctx.fillRect(px, py, tileSize, tileSize);
    ctx.fillStyle="white";
    ctx.font="20px monospace";
    ctx.fillText("P", px+ tileSize/4, py+ tileSize/1.5);
  }
}

/*********************************************************
 * 16) 敵描画
 *********************************************************/
function drawEnemies(){
  for(let enemy of enemies){
    const px = enemy.x* tileSize;
    const py = enemy.y* tileSize;
    if(config && config.useAssets && imageCache["enemy"]){
      ctx.drawImage(imageCache["enemy"], px, py, tileSize, tileSize);
    } else {
      ctx.fillStyle= enemy.color || "red";
      ctx.fillRect(px, py, tileSize, tileSize);
    }
  }
}

/*********************************************************
 * 17) キー入力でプレイヤー移動
 *********************************************************/
document.addEventListener("keydown",(e)=>{
  if(!isGamePlaying){
    // ループがなければ描画されない
  }

  logDebug("INPUT","KeyDown: "+e.key);

  let newX = playerX;
  let newY = playerY;

  switch(e.key){
    case "ArrowUp":    newY--; break;
    case "ArrowDown":  newY++; break;
    case "ArrowLeft":  newX--; break;
    case "ArrowRight": newX++; break;
    default:
      return;
  }
  if(!canMoveTo(newX,newY)){
    logDebug("OUTPUT", `Cannot move to (${newX},${newY})`);
    return;
  }

  playerX=newX;
  playerY=newY;
  logDebug("INFO", `Player moved to (${playerX},${playerY})`);
});

/*********************************************************
 * 18) 移動可能か判定
 *********************************************************/
function canMoveTo(x,y){
  if(!currentMapData)return false;
  if(x<0 || x>= currentMapData.width) return false;
  if(y<0 || y>= currentMapData.height) return false;

  const ch = currentMapData.tiles[y][x];
  if(ch==='#'){
    return false;
  }
  return true;
}

/*********************************************************
 * 19) レベルクリア
 *********************************************************/
function levelClear(){
  logDebug("OUTPUT","Level Clear!");
  alert("Level Clear!");
  endGame();
}

/*********************************************************
 * 20) ゲームオーバー
 *********************************************************/
function gameOver(msg){
  logDebug("OUTPUT","GameOver: "+msg);
  alert(msg);
  endGame();
}

/*********************************************************
 * 21) ゲーム終了
 *********************************************************/
function endGame(){
  isGamePlaying=false;
  clearInterval(timerInterval);
  logDebug("INFO","endGame called, game stopped");
}
