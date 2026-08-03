# FORGE 鍛 — 間歇訓練計時器 PWA

> 把自己鍛成形。

可自訂動作的 HIIT / 間歇訓練計時器。純靜態網頁，沒有框架也沒有任何 npm 相依，
手機用瀏覽器打開後「加入主畫面」就變成一個全螢幕小 App，離線也能用。

## 快速開始

```bash
node serve.mjs          # 或 npm start
```

打開 http://localhost:5173 。終端機會一併印出區網網址，手機連同一個 Wi-Fi 就能開。

> Service Worker 與「安裝到主畫面」只在 **localhost 或 HTTPS** 生效。
> 用區網 IP（http://192.168.x.x）可以測畫面，但不會有離線快取跟安裝提示。
>
> 開發時網址加上 `?nosw`（例如 `http://localhost:5173/?nosw`）會停用 Service Worker，
> 改完檔案直接重整就看得到，不用手動清快取。

## 放到手機上

三種都行，選一個：

1. **GitHub Pages** — 把整個資料夾推上 repo，Settings → Pages 選 branch，網址就是 HTTPS，手機開了直接可以安裝。
2. **Netlify / Vercel / Cloudflare Pages** — 整個資料夾拖進去就好，不需要 build 指令。
3. **區網 + Chrome 遠端偵錯** — USB 接電腦，用 Chrome 的 port forwarding 把 localhost:5173 轉到手機。

安裝方式：
- **Android Chrome**：選單 →「安裝應用程式」，或設定頁的「立即安裝」按鈕。
- **iOS Safari**：分享 →「加入主畫面」（iOS 不支援自動安裝提示，只能手動加）。

## 功能

**計時頁**
- 大圓環倒數，環內顯示階段、剩餘秒數、當前動作名稱，環下顯示動作描述
- 上方顯示「第 n/N 輪 · 動作 i/M」，下方顯示總進度條、已過秒數 / 總秒數 / 剩餘秒數
- 顏色即狀態：準備＝琥珀、進行＝珊瑚紅、休息＝薄荷綠、輪間休息＝靛藍，整頁背景會跟著染色
- 最後 3 秒數字脈動 + 嗶聲 + 震動；換段有不同音效；結束有完成音
- 休息中會預告下一個動作與它的描述，讓人有時間就位
- 點畫面正中央就能暫停／繼續（運動中不用瞄準小按鈕）
- 重設 / 上一段 / 播放暫停 / 下一段 / 流程總覽（總覽可點任一段直接跳過去）
- 桌機快捷鍵：空白鍵暫停、← → 切換段落、R 重設

**課表頁（後台）**
- 多份課表，可新增 / 複製 / 刪除 / 切換
- 課表層級：名稱、準備秒數、重複輪數、輪間休息秒數、是否略過每輪最後的休息
- 動作層級：名稱、描述、執行秒數、休息秒數，可上移下移、複製、刪除
- 即時顯示「總長 / 實際運動時間 / 共幾段」，改完馬上反映到計時頁

**設定頁**
- 嗶聲、震動、語音報動作、運動中螢幕恆亮（Wake Lock）、淺色主題
- 匯出 / 匯入 JSON（換手機用）、回復預設

## 檔案結構

```
index.html              版面骨架
css/styles.css          全部樣式（CSS 變數控制主題與階段色）
js/
  app.js                進入點：分頁路由、設定頁、課表切換、PWA 安裝
  store.js              資料層：課表與偏好設定，存 localStorage
  engine.js             計時引擎：課表 → segment 時間軸，用時間戳推算進度
  feedback.js           嗶聲（WebAudio 合成，免音檔）、震動、語音、Wake Lock
  ui-timer.js           計時頁渲染
  ui-editor.js          課表編輯頁
sw.js                   Service Worker：預先快取 App shell
manifest.webmanifest    PWA 設定
tools/
  source.png            圖示原圖（2048×2048，不會被部署）
  icons-from-source.mjs 從原圖切出所有尺寸
  make-icons.mjs        備用：用程式畫一版圖示，不需要原圖
  png.mjs               迷你 PNG 編解碼器（只靠 node:zlib）
serve.mjs               本機預覽用的靜態伺服器
```

## 換圖示

把新的正方形高解析度圖（建議 1024 以上）存成 `tools/source.png`，然後：

```bash
npm run icons
```

會自動抹掉右下角的 AI 產生器浮水印、面積平均縮圖、依用途決定圓角或滿版，一次產出：

| 檔案 | 尺寸 | 用途 | 形式 |
|---|---|---|---|
| `icons/icon-192.png` | 192 | Android 主畫面 | 圓角＋透明 |
| `icons/icon-512.png` | 512 | 安裝對話框、啟動畫面 | 圓角＋透明 |
| `icons/icon-maskable-512.png` | 512 | Android 自適應圖示 | 滿版 |
| `icons/apple-touch-icon-180.png` | 180 | iOS 加入主畫面 | 滿版（iOS 不吃透明） |
| `icons/favicon-32.png` | 32 | 瀏覽器分頁 | 圓角＋透明 |

原圖要注意兩件事：**正方形**，而且**主體留在中間 80% 以內**（Android 會把圖示切成圓形，邊緣會被吃掉）。
浮水印位置不同的話改 `icons-from-source.mjs` 最上面的 `WATERMARK`，設成 `null` 就不處理。

換完記得把 `sw.js` 的 `VERSION` 加一，否則裝過的人會一直看到舊圖。

## 幾個實作上的重點

- **計時不會走鐘**：`elapsed` 一律用 `performance.now()` 跟起算點相減算出來，
  不是把 `setInterval` 的間隔加起來。手機切到背景被節流、或 rAF 停掉，回到前景時秒數依然正確。
- **時間軸是攤平的**：課表先展開成一維的 segment 陣列（含每段的起訖秒數），
  所以「跳下一段」「點總覽跳到任一段」「算總長」全都只是改 `elapsed` 的數字，沒有狀態機要維護。
- **音效是合成的**：沒有任何 mp3，用 WebAudio 的 oscillator 直接發聲，整個 App 才幾十 KB。
  iOS 規定要有使用者手勢才能發聲，所以第一次按播放時會先 `unlockAudio()`。
- **階段色只作用在計時頁**：`#view-timer { --accent: var(--phase, ...) }`，
  後台編輯時介面顏色不會跟著計時器亂跳。

## iOS 主畫面 App 的兩個坑（踩過了，別再踩）

**1. 不要用 `apple-mobile-web-app-status-bar-style="black-translucent"`**

用了之後 iOS 會把 webview 的**高度**扣掉狀態列（59px），**位置卻仍從 y=0 起算**，
結果螢幕最下緣露出一條約 59px 的空白，怎麼改 CSS 都補不起來（因為那塊在視窗外面）。

當時的診斷數字：`win 393x793` 但 `screen 393x852`，差值 59 正好是 `env(safe-area-inset-top)`。
App 內部其實完全正常 —— 分頁列確實貼齊視窗底部，只是視窗本身比螢幕矮。

用 `content="default"` 就好，狀態列底色會吃 `theme-color`。

**2. `@media (display-mode: standalone)` 在 iOS 不可靠**

從主畫面啟動時 iOS 不保證讓這條媒體查詢成立，要另外看 `navigator.standalone`。
`js/app.js` 兩個都檢查，命中就在 `<html>` 掛 `is-standalone` class，CSS 兩條路都寫。

安裝後改用 `position: fixed; inset: 0` 貼死視窗四邊，比任何視窗單位都可靠；
瀏覽器分頁維持 `100dvh`，因為手機瀏覽器的網址列會收合，那裡反而需要 dvh。

## 改版後使用者看到舊版？

Service Worker 是「快取優先、背景更新」。改完內容部署後，把 `sw.js` 最上面的
`VERSION` 加一，舊快取會在下次啟動時整批換掉。

`js/app.js` 另外監聽 `controllerchange`：新版 SW 搶下控制權時會自動重載一次頁面，
所以使用者不用「關掉再開兩次」才吃得到新版。（只在已經有 controller 時才掛監聽，
避免第一次安裝時多重載一輪。）

## 之後可以加的東西

- 訓練紀錄：完成一次存一筆，看每週累積時間
- 動作圖片 / 短影片示範（存 IndexedDB，離線也看得到）
- 課表分享：把 JSON 壓進網址的 hash，傳連結給朋友就能匯入
- Apple Watch / 藍牙心率顯示
- 背景音樂淡出：換段時把音樂音量壓低再放提示音
