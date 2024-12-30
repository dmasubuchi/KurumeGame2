/******************************************************
 * script.js
 * 
 *  - MapLevel.json & assets_config.json 読み込み
 *  - title.txt でタイトル画面のASCIIアート
 *  - タイトルBGM: title.mp3
 *  - ゲーム中BGM: game.mp3
 *  - シーン管理で "title" / "game" を切り替え
 *  - シーンごとに音楽を再生/停止
 ******************************************************/

/*********************************************************
 * 0) デバッグログ関連
 *********************************************************/
function logDebug(tag, message) {
  const debugPanel = document.getElementById("debug-messages");
  if (!debugPanel) return;

  const now = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.textContent = `[${now}] [${tag}] ${message}`;
  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

function updateFrameInfo(frameNumber, steps) {
  const debug2 = document.getElementById("debug2-frameinfo");
  if (!debug2) return;

  let content = `Frame #${frameNumber}\n`;
  for (let step of steps) {
    content += " - " + step + "\n";
  }
  debug2.textContent = content;
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

// シーン管理: "title" or "game"
let currentScene  = "title"; 

// マップとアセット
let currentMapData= null;
let allLevels     = [];
let config        = null;
let imageCache    = {};

let playerX       = 0;
let playerY       = 0;
let tileSize      = 64;

// 敵関連
let enemies       = [];
let frameCount    = 0;

// タイマー
let timeLimit     = 30;
let timeRemaining = timeLimit;
let timerInterval = null;

// タイトル文字 (title.txt)
let titleText     = "";

// ★ BGM用のAudioオブジェクト
let audioTitle    = null;
let audioGame     = null;

/*********************************************************
 * 2) ページ読み込み時
 *********************************************************/
window.addEventListener("load", () => {
  logDebug("INFO","Page loaded, start initialization");

  loadConfig()
    .then(() => loadAllMaps())
    .then(() => preloadImages())
    .then(() => loadTitleText())
    .then(() => loadAudio())        // ★ 音楽を読み込む
    .then(() => initMenu())
    .then(() => mainLoop())
    .catch(err => {
      logDebug("ERROR","Initialization error: " + err.message);
      const statusEl = document.getElementById("map-status");
      if (statusEl) {
        statusEl.textContent = "Failed to load JSON: " + err.message;
      }
    });
});

/*********************************************************
 * 新規追加: それぞれのBGMをAudioで読み込み
 *********************************************************/
function loadAudio() {
  return new Promise((resolve) => {
    // タイトル音楽
    audioTitle = new Audio("assets/title.mp3");
    audioTitle.loop = true;  // ループ再生

    // ゲーム音楽
    audioGame = new Audio("assets/game.mp3");
    audioGame.loop = true;

    logDebug("INFO","Audio objects created for title.mp3 & game.mp3");

    // ブラウザの仕様上、ユーザー操作なしで再生がブロックされる場合あり
    // ここではとりあえず作るだけ。実際にplay/pauseはシーン切替で行う

    resolve();
  });
}

/*********************************************************
 * 3) assets_config.json
 *********************************************************/
function loadConfig() {
  logDebug("EVENT","Loading assets_config.json...");
  return fetch("assets_config.json")
    .then(r => {
      if(!r.ok) {
        throw new Error(`Failed to load assets_config.json (status: ${r.status})`);
      }
      return r.json();
    })
    .then(jsonData => {
      config = jsonData;
      if (config.tileSize) tileSize = config.tileSize;
      logDebug("OUTPUT","config loaded: " + JSON.stringify(config));
    });
}

/*********************************************************
 * 4) MapLevel.json
 *********************************************************/
function loadAllMaps() {
  logDebug("EVENT","Loading MapLevel.json...");
  return fetch("MapLevel.json")
    .then(r => {
      if(!r.ok){
        throw new Error(`Failed to load MapLevel.json (status: ${r.status})`);
      }
      return r.json();
    })
    .then(jsonData => {
      allLevels = jsonData.levels;
      if(!Array.isArray(allLevels)){
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
  if(!config || !config.useAssets){
    logDebug("INFO","useAssets = false, skip image preload");
    return Promise.resolve();
  }

  logDebug("EVENT","Preloading images...");
  const promises = [];
  for(const key in config.images){
    const src = config.images[key];
    if(!src) continue;

    const img = new Image();
    const p = new Promise((resolve)=>{
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
 * title.txt 読み込み
 *********************************************************/
function loadTitleText() {
  logDebug("EVENT","Loading title.txt...");
  return fetch("title.txt")
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load title.txt (status: ${response.status})`);
      }
      return response.text();
    })
    .then(txt => {
      titleText = txt;
      logDebug("OUTPUT","title.txt loaded, length=" + titleText.length);
    });
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
 * 7) メインループ (常に回る)
 *********************************************************/
function mainLoop() {
  frameCount++;
  let steps = [];

  if (currentScene === "title") {
    drawTitleScreen();
    steps.push("Title scene drawing");
  } else if (currentScene === "game") {
    steps.push("Update enemies");
    updateEnemies();

    steps.push("Draw game");
    drawGame();
    drawEnemies();

    steps.push("Collision check");
    checkCollisionWithEnemies();
  }

  updateFrameInfo(frameCount, steps);

  requestAnimationFrame(mainLoop);
}

/*********************************************************
 * 8) ゲーム開始
 *********************************************************/
function startGame(level) {
  logDebug("EVENT",`startGame(level=${level})`);
  const mapData = allLevels.find(l => l.id === level);
  if (!mapData) {
    alert("指定レベルが見つかりません (id: " + level + ")");
    return;
  }

  // Canvasサイズをマップに合わせる
  currentMapData = mapData;
  canvas.width  = currentMapData.width  * tileSize;
  canvas.height = currentMapData.height * tileSize;

  logDebug("INFO", `Canvas resized to ${canvas.width} x ${canvas.height}`);

  initGameState();
  initTimer();

  // シーンを "game" に
  currentScene = "game";

  // ★ BGM切り替え: Title停止 → Game再生
  if (audioTitle) {
    audioTitle.pause();
    audioTitle.currentTime = 0; 
  }
  if (audioGame) {
    audioGame.currentTime = 0; 
    audioGame.play().catch(e => {
      logDebug("WARN","audioGame play blocked: " + e.message);
    });
  }

  frameCount = 0;
  logDebug("INFO","Game started with level=" + level);
}

/*********************************************************
 * 9) ゲーム状態初期化
 *********************************************************/
function initGameState() {
  timeRemaining = timeLimit;
  timeValue.textContent = timeRemaining.toString();
  enemies = [];

  if (!currentMapData) return;

  const tiles = currentMapData.tiles;
  for (let row=0; row< currentMapData.height; row++){
    for(let col=0; col< currentMapData.width; col++){
      const ch = tiles[row][col];
      if (ch === "S"){
        playerX = col;
        playerY = row;
      } else if (ch === "E"){
        enemies.push({
          x:col,
          y:row,
          speedX:0.01,
          speedY:0,
          color:"red"
        });
      }
    }
  }
  logDebug("INFO",`initGameState: player=(${playerX},${playerY}), enemies=${enemies.length}`);
}

/*********************************************************
 * 10) タイマー開始
 *********************************************************/
function initTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(()=>{
    if (currentScene !== "game") return;
    timeRemaining--;
    timeValue.textContent = timeRemaining.toString();
    if(timeRemaining<=0){
      gameOver("Time Up! Game Over!");
    }
  },1000);
  logDebug("INFO","Timer started");
}

/*********************************************************
 * 11) ゲーム終了
 *********************************************************/
function endGame() {
  clearInterval(timerInterval);
  logDebug("INFO","endGame called");

  // シーンをタイトルへ
  currentScene = "title";

  // ★ BGM切り替え: Game停止 → Title再生
  if (audioGame) {
    audioGame.pause();
    audioGame.currentTime = 0;
  }
  if (audioTitle) {
    audioTitle.currentTime = 0;
    audioTitle.play().catch(e=>{
      logDebug("WARN","audioTitle play blocked: " + e.message);
    });
  }
}

/*********************************************************
 * 12) ゲームオーバー
 *********************************************************/
function gameOver(msg){
  logDebug("OUTPUT","GameOver: "+ msg);
  alert(msg);
  endGame();
}

/*********************************************************
 * 13) レベルクリア
 *********************************************************/
function levelClear(){
  logDebug("OUTPUT","Level Clear!");
  alert("Level Clear!");
  endGame();
}

/*********************************************************
 * 14) 敵を更新
 *********************************************************/
function updateEnemies() {
  for(let enemy of enemies){
    enemy.x += enemy.speedX;
    enemy.y += enemy.speedY;
    if(enemy.x<1 || enemy.x>currentMapData.width-2){
      enemy.speedX*=-1;
    }
  }
}

/*********************************************************
 * 15) 敵を描画
 *********************************************************/
function drawEnemies() {
  for(let i=0; i<enemies.length; i++){
    const enemy=enemies[i];
    const px = enemy.x * tileSize;
    const py = enemy.y * tileSize;

    if(config && config.useAssets && imageCache["enemy"]){
      ctx.drawImage(imageCache["enemy"],px,py,tileSize,tileSize);
    } else {
      ctx.fillStyle=enemy.color || "red";
      ctx.fillRect(px, py, tileSize, tileSize);
    }
  }
}

/*********************************************************
 * 16) 敵との当たり判定
 *********************************************************/
function checkCollisionWithEnemies(){
  for(let enemy of enemies){
    const ex=Math.floor(enemy.x+0.5);
    const ey=Math.floor(enemy.y+0.5);
    if(ex===playerX && ey===playerY){
      gameOver("敵に触れた！");
      return;
    }
  }
}

/*********************************************************
 * 17) タイトル画面を描画
 *********************************************************/
function drawTitleScreen() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 背景
  ctx.fillStyle="black";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // title.txt の文字を行単位で表示
  const lines = titleText.split("\n");
  ctx.fillStyle="white";
  ctx.font="16px monospace";
  let startY=80;
  for(let i=0; i<lines.length; i++){
    ctx.fillText(lines[i], 50, startY + i*20);
  }
}

/*********************************************************
 * 18) ゲーム描画
 *********************************************************/
function drawGame() {
  if(!currentMapData) return;

  ctx.clearRect(0,0,canvas.width,canvas.height);

  const tiles = currentMapData.tiles;
  for(let row=0; row< currentMapData.height; row++){
    for(let col=0; col< currentMapData.width; col++){
      drawTile(tiles[row][col],col,row);
    }
  }

  drawPlayer();
}

/*********************************************************
 * 19) タイル描画
 *********************************************************/
function drawTile(ch,col,row){
  if(config && config.useAssets){
    let key=null;
    switch(ch){
      case '#': key='wall'; break;
      case 'S': key='start'; break;
      case 'G': key='goal';  break;
      case 'E': key='floor'; break; 
      default:
        key='floor';
        break;
    }
    const img = imageCache[key];
    if(img){
      ctx.drawImage(img, col*tileSize, row*tileSize, tileSize, tileSize);
      return;
    }
  }

  // フォールバック
  ctx.fillStyle="white";
  ctx.fillRect(col*tileSize, row*tileSize, tileSize, tileSize);

  ctx.fillStyle="black";
  ctx.font="16px monospace";
  ctx.fillText(ch, col*tileSize+16, row*tileSize+32);
}

/*********************************************************
 * 20) プレイヤー描画
 *********************************************************/
function drawPlayer(){
  if(!currentMapData) return;
  const px = playerX* tileSize;
  const py = playerY* tileSize;

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
 * 21) キーボード操作 (上下左右)
 *********************************************************/
document.addEventListener("keydown",(e)=>{
  if(currentScene!=="game"){
    return; // タイトル画面では操作無効
  }

  logDebug("INPUT","KeyDown: "+ e.key);
  let newX=playerX;
  let newY=playerY;

  switch(e.key){
    case "ArrowUp":    newY--; break;
    case "ArrowDown":  newY++; break;
    case "ArrowLeft":  newX--; break;
    case "ArrowRight": newX++; break;
    default: return;
  }

  if(!canMoveTo(newX,newY)){
    logDebug("OUTPUT","Cannot move to "+ newX+","+newY);
    return;
  }

  playerX=newX;
  playerY=newY;
  logDebug("INFO",`Player moved to (${playerX},${playerY})`);

  const ch=currentMapData.tiles[newY][newX];
  if(ch==='G'){
    levelClear();
  }
});

/*********************************************************
 * 22) 移動可能か判定
 *********************************************************/
function canMoveTo(x,y){
  if(!currentMapData)return false;
  if(y<0||y>=currentMapData.height)return false;
  if(x<0||x>=currentMapData.width ) return false;

  const ch=currentMapData.tiles[y][x];
  if(ch==='#'){
    return false;
  }
  return true;
}
