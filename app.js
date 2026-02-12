/* =========================
   Study Log Pro (app.js) v4 置き換え版
   - Pro HTML対応（Today/Week/Master/Calendar/History + Settings modal）
   - データが消えない：互換マイグレーション + 自動スナップショット + 書き出し/復元(JSON)
   - Master(推定分) → 試験日まで自動割当（週容量ベース）
   - 今日：自動割当 と 手動追加 を別表示
   - 復習：1/3/7/14日後を自動生成 + 「何回目」表示
   - 学習時間：手動分のみ（minsInputで加算）
   ========================= */

const KEY = "study_pwa_v2"; // ここは固定（変えると別データになる）
const TYPES = ["講義","演習","復習","模試","その他"];

const DEFAULT_SETTINGS = {
  examDate: null,                 // "YYYY-MM-DD"
  weeklyCapMin: 900,              // 週の容量（分）
  dayWeights: [1,1,1,1,1,0.7,0.5], // 月..日 配分
  chunkMaxMin: 60,                // 1枠最大分
  reviewOffsets: [1,3,7,14]        // 復習オフセット（日）
};

// ===== Utils =====
const iso = (d) => new Date(d).toISOString().slice(0,10);

function addDays(isoDate, n){
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
}
function addMonths(d, n){
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
}
function getMonday(d = new Date()){
  const date = new Date(d);
  const day = date.getDay() || 7;
  if(day !== 1) date.setDate(date.getDate() - (day - 1));
  date.setHours(12,0,0,0);
  return iso(date);
}
function weekdayIndex(isoDate){
  const d = new Date(isoDate + "T12:00:00");
  const js = d.getDay(); // Sun0..Sat6
  return (js + 6) % 7;   // Mon0..Sun6
}
function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

// ===== Store (load + migrate) =====
const store = loadStore();

function loadStore(){
  let raw = null;
  try{ raw = JSON.parse(localStorage.getItem(KEY)); }catch(e){ raw = null; }

  // 最低形
  const s = (raw && typeof raw === "object") ? raw : {};
  s.settings ||= {};
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };

  // 旧v2互換（手動日次/週次）
  s.daily ||= {};   // {"YYYY-MM-DD": [{text, done, type}]}
  s.weekly ||= {};  // {"MONDAY_ISO": {tasks:[...]}}
  // v3/v4
  s.master ||= [];  // [{id,title,type,estMin,done,doneAt,createdAt,notes}]
  s.plan   ||= {};  // {"YYYY-MM-DD": {auto:[{...}]}}
  s.logs   ||= {};  // {"YYYY-MM-DD": {studyMin:number}}

  // 旧: dailyTime -> logs へ
  if(s.dailyTime && typeof s.dailyTime === "object"){
    for(const [d, mins] of Object.entries(s.dailyTime)){
      s.logs[d] ||= { studyMin: 0 };
      s.logs[d].studyMin = (Number(s.logs[d].studyMin)||0) + (Number(mins)||0);
    }
    delete s.dailyTime;
  }

  // バージョン
  s._v ||= 4;
  return s;
}

// ===== Backup =====
function autoSnapshot(){
  // 12時間に一回、端末内にスナップショット保持
  const last = Number(localStorage.getItem(KEY + "_lastSnapshot") || 0);
  const now = Date.now();
  if(now - last < 12*60*60*1000) return;
  localStorage.setItem(KEY + "_snapshot", JSON.stringify(store));
  localStorage.setItem(KEY + "_lastSnapshot", String(now));
}

function exportBackup(){
  try{
    const data = JSON.stringify(store, null, 2);
    const blob = new Blob([data], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `studylog_backup_${iso(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    alert("バックアップを書き出しました（Files/Downloadsに保存されます）");
  }catch(e){
    alert("バックアップ失敗: " + e.message);
  }
}

function importBackup(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      if(!obj || typeof obj !== "object") throw new Error("JSONが不正です");
      // 保存してリロード（整形はloadStoreでやる）
      localStorage.setItem(KEY, JSON.stringify(obj));
      location.reload();
    }catch(e){
      alert("復元失敗: " + e.message);
    }
  };
  reader.readAsText(file);
}

function restoreFromSnapshot(){
  const snap = localStorage.getItem(KEY + "_snapshot");
  if(!snap) return alert("スナップショットがありません");
  if(!confirm("スナップショットから復元しますか？")) return;
  localStorage.setItem(KEY, snap);
  location.reload();
}

window.exportBackup = exportBackup;
window.importBackup = importBackup;
window.restoreFromSnapshot = restoreFromSnapshot;

// ===== Save =====
function save(){
  autoSnapshot();
  localStorage.setItem(KEY, JSON.stringify(store));
  render();
}

// ===== State =====
const todayKey = iso(new Date());
let selectedDayKey = todayKey;
let selectedWeekKey = getMonday();
let calMonth = new Date(); calMonth.setDate(1);

// ===== Tabs / Views (Pro HTML) =====
function setActiveTab(view){
  const map = {
    daily: "tabDaily",
    weekly: "tabWeekly",
    master: "tabMaster",
    calendar: "tabCalendar",
    history: "tabHistory",
  };
  for(const [k,id] of Object.entries(map)){
    const b = document.getElementById(id);
    if(!b) continue;
    b.classList.toggle("active", k === view);
  }
}
function show(view){
  const views = ["daily","weekly","master","calendar","history"];
  for(const v of views){
    const el = document.getElementById(v);
    if(el) el.hidden = (v !== view);
  }
  setActiveTab(view);
  render();
}
window.show = show;

// ===== Navigation =====
function shiftDay(delta){ selectedDayKey = addDays(selectedDayKey, delta); render(); }
function goToday(){ selectedDayKey = todayKey; render(); }
function shiftWeek(delta){
  selectedWeekKey = addDays(selectedWeekKey, delta*7);
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  render();
}
function goThisWeek(){ selectedWeekKey = getMonday(); store.weekly[selectedWeekKey] ||= { tasks: [] }; render(); }
function shiftMonth(delta){ calMonth = addMonths(calMonth, delta); render(); }
function goThisMonth(){ calMonth = new Date(); calMonth.setDate(1); render(); }

window.shiftDay = shiftDay;
window.goToday = goToday;
window.shiftWeek = shiftWeek;
window.goThisWeek = goThisWeek;
window.shiftMonth = shiftMonth;
window.goThisMonth = goThisMonth;

// ===== Time logs (manual only) =====
function getStudyMin(dayIso){
  return Number(store.logs?.[dayIso]?.studyMin || 0) || 0;
}
function addMinutes(){
  const inp = document.getElementById("minsInput");
  const v = parseInt(inp?.value || "0", 10) || 0;
  if(inp) inp.value = "";
  if(v <= 0) return;
  store.logs[selectedDayKey] ||= { studyMin: 0 };
  store.logs[selectedDayKey].studyMin = getStudyMin(selectedDayKey) + v;
  save();
}
function resetDayMinutes(){
  if(!confirm("この日の学習時間を0分にしますか？")) return;
  store.logs[selectedDayKey] ||= { studyMin: 0 };
  store.logs[selectedDayKey].studyMin = 0;
  save();
}
window.addMinutes = addMinutes;
window.resetDayMinutes = resetDayMinutes;

// ===== Manual tasks (Daily manual) =====
function addManualTask(){
  const text = prompt("手動タスク内容");
  if(!text) return;
  const type = pickType("演習");
  store.daily[selectedDayKey] ||= [];
  store.daily[selectedDayKey].push({ text, done:false, type });
  save();
}
window.addManualTask = addManualTask;

function toggleManual(dayIso, idx){
  const list = store.daily[dayIso] || [];
  if(!list[idx]) return;
  list[idx].done = !list[idx].done;
  save();
}
function deleteManual(dayIso, idx){
  if(!confirm("削除しますか？")) return;
  const list = store.daily[dayIso] || [];
  list.splice(idx,1);
  store.daily[dayIso] = list;
  save();
}

// ===== Master =====
function pickType(defaultType="演習"){
  const msg =
    "タイプを選んで番号を入力:\n" +
    TYPES.map((t,i)=>`${i+1}) ${t}`).join("\n") +
    `\n\n(空欄なら ${defaultType})`;
  const raw = prompt(msg, "");
  const n = parseInt(raw,10);
  if(!raw) return defaultType;
  if(Number.isFinite(n) && n>=1 && n<=TYPES.length) return TYPES[n-1];
  if(TYPES.includes(raw)) return raw;
  return defaultType;
}

function addMasterTask(){
  const title = prompt("Masterタスク名（例: FAR Ch3 講義）");
  if(!title) return;
  const type = pickType("講義");

  const est = prompt("推定時間（分）例: 120", "120");
  if(est === null) return;
  const estMin = Math.max(1, parseInt(est,10) || 0);
  const notes = prompt("メモ（任意）","") || "";

  store.master.push({
    id: uid("m"),
    title, type, estMin, notes,
    createdAt: iso(new Date()),
    done: false,
    doneAt: null
  });
  save();
}
window.addMasterTask = addMasterTask;

// FAR bulk seed
function seedFARChapters(){
  // 既にあるなら重複防止したい場合はここでチェック可能
  for(let i=1;i<=23;i++){
    store.master.push({
      id: uid("m"),
      title: `FAR Ch${i}`,
      type: "講義",
      estMin: 120, // デフォ2時間
      notes: "",
      createdAt: iso(new Date()),
      done: false,
      doneAt: null
    });
  }
  save();
  alert("FAR Ch1〜23 を追加しました");
}
function seedFARWithMinutes(){
  const raw = prompt("Ch1〜23の推定分を23個（カンマ区切り）\n例: 120,120,90,...", "");
  if(!raw) return;
  const arr = raw.split(",").map(x=>parseInt(x.trim(),10)).filter(n=>Number.isFinite(n));
  if(arr.length !== 23){
    alert("23個にしてください（今: " + arr.length + "）");
    return;
  }
  for(let i=1;i<=23;i++){
    store.master.push({
      id: uid("m"),
      title: `FAR Ch${i}`,
      type: "講義",
      estMin: arr[i-1],
      notes: "",
      createdAt: iso(new Date()),
      done: false,
      doneAt: null
    });
  }
  save();
  alert("FAR Ch1〜23（分数つき）を追加しました");
}
window.seedFARChapters = seedFARChapters;
window.seedFARWithMinutes = seedFARWithMinutes;

// Demo/utility buttons (Weekの操作欄用)
function seedDemo(){
  if(!confirm("USCPAテンプレを追加しますか？（既存は残ります）")) return;
  // FAR Ch1-5だけ軽く入れる例
  for(let i=1;i<=5;i++){
    store.master.push({
      id: uid("m"),
      title: `FAR Ch${i}`,
      type: "講義",
      estMin: 120,
      notes: "demo",
      createdAt: iso(new Date()),
      done: false,
      doneAt: null
    });
  }
  save();
  alert("テンプレを投入しました（例）");
}
function wipeAll(){
  if(!confirm("全データ削除しますか？（バックアップ推奨）")) return;
  localStorage.removeItem(KEY);
  location.reload();
}
window.seedDemo = seedDemo;
window.wipeAll = wipeAll;

// ===== Auto plan =====
function rebuildAuto(){
  generateAutoPlan();
}
window.rebuildAuto = rebuildAuto;

function buildDailyCapacityMap(startIso, endIso){
  const cap = {};
  const weeklyCapMin = Math.max(0, Number(store.settings.weeklyCapMin || 0) || 0);
  const w = Array.isArray(store.settings.dayWeights) && store.settings.dayWeights.length===7
    ? store.settings.dayWeights : DEFAULT_SETTINGS.dayWeights;
  const sumW = w.reduce((a,b)=>a+(Number(b)||0),0) || 1;

  let d = startIso;
  while(d <= endIso){
    const wi = weekdayIndex(d);
    const frac = (Number(w[wi])||0)/sumW;
    cap[d] = Math.round(weeklyCapMin * frac);
    d = addDays(d,1);
  }
  return cap;
}

function collectLockedAuto(){
  const out = {};
  for(const [d,p] of Object.entries(store.plan || {})){
    const locked = (p.auto||[]).filter(t=>t.locked);
    if(locked.length) out[d] = locked.map(x=>({...x}));
  }
  return out;
}

function generateAutoPlan(){
  const exam = store.settings.examDate;
  if(!exam){
    alert("まず Settings で試験日を設定してください");
    openSettings();
    return;
  }

  const start = todayKey;
  const end = exam;
  if(end < start){
    alert("試験日が過去になっています");
    return;
  }

  // lockedを残して作り直し
  const locked = collectLockedAuto();
  store.plan = {};
  for(const [d,arr] of Object.entries(locked)){
    store.plan[d] ||= { auto: [] };
    store.plan[d].auto = [...arr];
  }

  const cap = buildDailyCapacityMap(start, end);
  // locked分を差し引く
  for(const d of Object.keys(cap)){
    const used = (store.plan[d]?.auto||[]).reduce((a,t)=>a+(t.estMin||0),0);
    cap[d] = Math.max(0, cap[d]-used);
  }

  const chunkMax = Math.max(10, Number(store.settings.chunkMaxMin || 60) || 60);
  const masters = (store.master||[]).filter(m=>!m.done);

  // Master -> 近い日から詰める
  for(const m of masters){
    let remaining = Math.max(0, Number(m.estMin||0) || 0);
    let d = start;
    while(remaining > 0 && d <= end){
      const c = cap[d] || 0;
      if(c > 0){
        const chunk = Math.min(c, remaining, chunkMax);
        store.plan[d] ||= { auto: [] };
        store.plan[d].auto.push({
          id: uid("auto"),
          masterId: m.id,
          title: m.title + (remaining > chunk ? "（続き）" : ""),
          type: m.type || "その他",
          estMin: chunk,
          done: false,
          origin: "master",
          locked: false
        });
        remaining -= chunk;
        cap[d] -= chunk;
      }
      d = addDays(d,1);
    }
    if(remaining > 0){
      alert(`割当不足: "${m.title}" が残り ${remaining}分\n週の容量を増やすか、試験日を後ろにしてください。`);
      break;
    }
  }

  // Review generation (with nth count)
  const offsets = (store.settings.reviewOffsets||DEFAULT_SETTINGS.reviewOffsets).filter(n=>n>0);
  const firstDateByMaster = {};
  Object.keys(store.plan).sort().forEach(d=>{
    (store.plan[d].auto||[]).forEach(t=>{
      if(t.origin==="master" && t.masterId && !firstDateByMaster[t.masterId]){
        firstDateByMaster[t.masterId] = d;
      }
    });
  });

  for(const [mid, firstDay] of Object.entries(firstDateByMaster)){
    const m = store.master.find(x=>x.id===mid);
    if(!m) continue;
    if(m.type !== "講義" && m.type !== "演習") continue;

    offsets.forEach((k, idx)=>{
      const rd = addDays(firstDay, k);
      if(rd < start || rd > end) return;

      store.plan[rd] ||= { auto: [] };
      const nth = idx + 1;
      const name = `復習(${nth}回目): ${m.title}（${k}日後）`;

      // 重複防止
      const exists = (store.plan[rd].auto||[]).some(x =>
        x.origin==="review" && x.masterId===mid && x.reviewNth===nth
      );
      if(exists) return;

      store.plan[rd].auto.push({
        id: uid("auto"),
        masterId: mid,
        title: name,
        type: "復習",
        estMin: 20 + idx*5,
        done: false,
        origin: "review",
        reviewNth: nth,
        reviewOffset: k,
        locked: false
      });
    });
  }

  save();
}

// ===== Auto task actions =====
function toggleAuto(dayIso, autoId){
  const day = store.plan?.[dayIso];
  if(!day) return;
  const t = (day.auto||[]).find(x=>x.id===autoId);
  if(!t) return;
  t.done = !t.done;
  save();
}

function autoMenu(dayIso, autoId){
  const day = store.plan?.[dayIso];
  if(!day) return;
  const idx = (day.auto||[]).findIndex(x=>x.id===autoId);
  if(idx < 0) return;
  const t = day.auto[idx];

  const msg =
`操作:
1) 日付移動（YYYY-MM-DD）
2) 推定分変更
3) 削除
4) 手動へ移す（今日の手動へ）

番号を入力`;
  const n = parseInt(prompt(msg,""),10);
  if(!Number.isFinite(n)) return;

  if(n===1){
    const to = prompt("移動先（YYYY-MM-DD）", dayIso);
    if(!to) return;
    store.plan[to] ||= { auto: [] };
    store.plan[to].auto.push(t);
    day.auto.splice(idx,1);
    save();
    return;
  }
  if(n===2){
    const v = prompt("推定分（min）", String(t.estMin||0));
    if(v===null) return;
    t.estMin = Math.max(1, parseInt(v,10)||t.estMin);
    save();
    return;
  }
  if(n===3){
    if(!confirm("削除しますか？")) return;
    day.auto.splice(idx,1);
    save();
    return;
  }
  if(n===4){
    store.daily[dayIso] ||= [];
    store.daily[dayIso].push({ text: t.title, done: t.done, type: t.type || "その他" });
    day.auto.splice(idx,1);
    save();
    return;
  }
}

// ===== Rendering helpers =====
function getAutoTasks(dayIso){ return store.plan?.[dayIso]?.auto || []; }
function getManualTasks(dayIso){ return store.daily?.[dayIso] || []; }

function sumEst(list){ return (list||[]).reduce((a,t)=>a+(Number(t.estMin||0)||0),0); }
function fmtMin(min){
  min = Number(min||0)||0;
  const h = Math.floor(min/60);
  const m = min%60;
  if(h<=0) return `${m}m`;
  if(m===0) return `${h}h`;
  return `${h}h ${m}m`;
}

function buildCountdown(){
  const el = document.getElementById("examCountdown");
  if(!el) return;
  const ex = store.settings.examDate;
  if(!ex){ el.textContent = "試験日 未設定"; return; }
  const today = todayKey;
  const diff = Math.round((new Date(ex+"T00:00:00") - new Date(today+"T00:00:00")) / (1000*60*60*24));
  el.textContent = diff >= 0 ? `Exam in ${diff} days` : `Exam passed`;
}

// ===== Calendar =====
const WEEKDAYS = ["月","火","水","木","金","土","日"];
function rateOfTasks(list){
  if(!list || list.length===0) return null;
  const done = list.filter(t=>t.done).length;
  return Math.round(done/list.length*100);
}
function heatClass(rate){
  if(rate===null) return "r0";
  if(rate===0) return "r0";
  if(rate<50) return "r1";
  if(rate<80) return "r2";
  return "r3";
}
function renderCalendar(){
  const grid = document.getElementById("calendarGrid");
  if(!grid) return;

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const lab = document.getElementById("calMonthLabel");
  if(lab) lab.textContent = `${y}年 ${m+1}月`;

  grid.innerHTML = "";
  WEEKDAYS.forEach(w=>{
    const h = document.createElement("div");
    h.className = "calHead";
    h.textContent = w;
    grid.appendChild(h);
  });

  const first = new Date(y, m, 1);
  const firstIso = iso(first);
  const jsDay = first.getDay();
  const idx = (jsDay + 6) % 7;
  const startIso = addDays(firstIso, -idx);

  for(let i=0;i<42;i++){
    const dayIso = addDays(startIso, i);
    const d = new Date(dayIso + "T12:00:00");
    const inMonth = d.getMonth() === m;

    const all = [...getAutoTasks(dayIso), ...getManualTasks(dayIso)];
    const r = rateOfTasks(all);

    const cell = document.createElement("div");
    cell.className = `calCell ${heatClass(r)} ${inMonth ? "" : "outMonth"} ${dayIso===todayKey ? "todayRing" : ""}`;

    const top = document.createElement("div");
    top.className = "calTop";
    const dayNum = document.createElement("span");
    dayNum.className = "calDay";
    dayNum.textContent = String(d.getDate());
    const badge = document.createElement("span");
    badge.className = "calRate";
    badge.textContent = r===null ? "" : `${r}%`;
    top.appendChild(dayNum);
    top.appendChild(badge);

    const bottom = document.createElement("div");
    bottom.className = "calRate";
    const done = all.filter(t=>t.done).length;
    bottom.textContent = all.length ? `${done}/${all.length}` : "";

    cell.appendChild(top);
    cell.appendChild(bottom);

    cell.onclick = ()=>{
      selectedDayKey = dayIso;
      show("daily");
    };

    grid.appendChild(cell);
  }
}

// ===== Weekly Board =====
function daysOfWeek(mondayIso){
  return Array.from({length:7}, (_,i)=>addDays(mondayIso, i));
}

// ===== Settings modal =====
function openSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  m.hidden = false;

  const ex = document.getElementById("examDateInput");
  const wc = document.getElementById("weeklyCapInput");
  const ro = document.getElementById("reviewOffsetsInput");

  if(ex) ex.value = store.settings.examDate || "";
  if(wc) wc.value = String(store.settings.weeklyCapMin || 0);
  if(ro) ro.value = (store.settings.reviewOffsets||DEFAULT_SETTINGS.reviewOffsets).join(",");

  setTimeout(()=>ex?.focus(), 0);
}
function closeSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  m.hidden = true;
}
function parseOffsets(v){
  if(!v) return DEFAULT_SETTINGS.reviewOffsets.slice();
  return String(v)
    .split(/[,\s]+/)
    .map(x=>parseInt(x,10))
    .filter(n=>Number.isFinite(n) && n>0)
    .slice(0, 20);
}
function saveSettings(){
  const ex = document.getElementById("examDateInput")?.value || "";
  const wc = parseInt(document.getElementById("weeklyCapInput")?.value || "0", 10) || 0;
  const ro = parseOffsets(document.getElementById("reviewOffsetsInput")?.value || "");

  if(ex) store.settings.examDate = ex;
  store.settings.weeklyCapMin = Math.max(0, wc);
  store.settings.reviewOffsets = ro;

  save();
  closeSettings();
}
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;

// Settings icon
document.addEventListener("DOMContentLoaded", ()=>{
  const btn = document.getElementById("btnSettings");
  if(btn) btn.addEventListener("click", openSettings);
});

// ===== Render =====
function renderDaily(){
  const elDate = document.getElementById("dailyDate");
  if(elDate) elDate.textContent = selectedDayKey;

  const auto = getAutoTasks(selectedDayKey);
  const manual = getManualTasks(selectedDayKey);

  // 今日の自動
  const autoList = document.getElementById("dailyAutoList");
  if(autoList){
    autoList.innerHTML = "";
    if(auto.length===0){
      const li = document.createElement("li");
      li.textContent = "まだ割当がありません（Settings→試験日/週容量→再計算）";
      li.style.opacity = "0.75";
      autoList.appendChild(li);
    }else{
      auto.forEach(t=>{
        const li = document.createElement("li");

        const left = document.createElement("span");
        const nth = (t.origin==="review" && t.reviewNth) ? `(${t.reviewNth}回目)` : "";
        left.textContent = `【${t.type}】 ${t.title} ${nth} • ${t.estMin||0}m`;
        if(t.done) left.className = "done";

        const right = document.createElement("span");
        right.textContent = t.done ? "✓" : "";

        li.appendChild(left);
        li.appendChild(right);

        let pressTimer = null;
        let longPressed = false;
        li.addEventListener("pointerdown", ()=>{
          longPressed = false;
          pressTimer = setTimeout(()=>{
            longPressed = true;
            autoMenu(selectedDayKey, t.id);
          }, 550);
        });
        li.addEventListener("pointerup", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
          if(!longPressed) toggleAuto(selectedDayKey, t.id);
        });
        li.addEventListener("pointerleave", ()=>{ if(pressTimer) clearTimeout(pressTimer); });

        autoList.appendChild(li);
      });
    }
  }

  // 今日の手動
  const manList = document.getElementById("dailyManualList");
  if(manList){
    manList.innerHTML = "";
    if(manual.length===0){
      const li = document.createElement("li");
      li.textContent = "手動タスクはまだありません";
      li.style.opacity = "0.75";
      manList.appendChild(li);
    }else{
      manual.forEach((t,i)=>{
        const li = document.createElement("li");

        const left = document.createElement("span");
        left.textContent = `【${t.type||"その他"}】 ${t.text}`;
        if(t.done) left.className = "done";

        const right = document.createElement("span");
        right.textContent = t.done ? "✓" : "";

        li.appendChild(left);
        li.appendChild(right);

        let pressTimer=null, longPressed=false;
        li.addEventListener("pointerdown", ()=>{
          longPressed=false;
          pressTimer=setTimeout(()=>{
            longPressed=true;
            deleteManual(selectedDayKey, i);
          }, 550);
        });
        li.addEventListener("pointerup", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
          if(!longPressed) toggleManual(selectedDayKey, i);
        });
        li.addEventListener("pointerleave", ()=>{ if(pressTimer) clearTimeout(pressTimer); });

        manList.appendChild(li);
      });
    }
  }

  // 学習時間
  const todayMin = document.getElementById("todayMinutes");
  if(todayMin) todayMin.textContent = `Today: ${getStudyMin(selectedDayKey)} min`;

  // 復習ヒント：今日の復習だけ抜く
  const reviewList = document.getElementById("todayReviewList");
  const hint = document.getElementById("reviewHint");
  if(reviewList){
    const reviews = auto.filter(t=>t.origin==="review");
    reviewList.innerHTML = "";
    if(reviews.length===0){
      const li = document.createElement("li");
      li.textContent = "今日の復習はありません";
      li.style.opacity="0.75";
      reviewList.appendChild(li);
      if(hint) hint.textContent = "—";
    }else{
      if(hint) hint.textContent = `${reviews.length} items`;
      reviews.forEach(t=>{
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = `復習(${t.reviewNth||""}回目) • ${t.estMin||0}m — ${t.title.replace(/^復習$begin:math:text$\\d\+回目$end:math:text$:\s*/,"")}`;
        if(t.done) left.className="done";
        const right = document.createElement("span");
        right.textContent = t.done ? "✓" : "";
        li.appendChild(left); li.appendChild(right);

        let pressTimer=null, longPressed=false;
        li.addEventListener("pointerdown", ()=>{
          longPressed=false;
          pressTimer=setTimeout(()=>{ longPressed=true; autoMenu(selectedDayKey, t.id); }, 550);
        });
        li.addEventListener("pointerup", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
          if(!longPressed) toggleAuto(selectedDayKey, t.id);
        });
        li.addEventListener("pointerleave", ()=>{ if(pressTimer) clearTimeout(pressTimer); });

        reviewList.appendChild(li);
      });
    }
  }

  // daily meta（達成率/分）
  const meta = document.getElementById("dailyMeta");
  if(meta){
    const all = [...auto, ...manual];
    const r = rateOfTasks(all);
    meta.textContent = `達成率: ${r===null?"—":r+"%"} • 自動${auto.filter(x=>x.done).length}/${auto.length} • 手動${manual.filter(x=>x.done).length}/${manual.length} • Study ${getStudyMin(selectedDayKey)}m`;
  }
}

function renderWeekly(){
  const label = document.getElementById("weekLabel");
  if(label) label.textContent = `Week: ${selectedWeekKey} 〜 ${addDays(selectedWeekKey,6)}`;

  const days = daysOfWeek(selectedWeekKey);
  const board = document.getElementById("weeklyAutoBoard");
  if(board){
    board.innerHTML = "";
    days.forEach(d=>{
      const card = document.createElement("div");
      card.className = "boardCol";
      const head = document.createElement("div");
      head.className = "boardHead";
      const tasks = getAutoTasks(d);
      head.textContent = `${d.slice(5)} • ${tasks.filter(x=>x.done).length}/${tasks.length}`;
      card.appendChild(head);

      if(tasks.length===0){
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.style.padding="10px";
        empty.textContent = "—";
        card.appendChild(empty);
      }else{
        tasks.forEach(t=>{
          const row = document.createElement("div");
          row.className = "boardItem";
          row.textContent = `【${t.type}】 ${t.title} (${t.estMin||0}m)`;
          if(t.done) row.classList.add("done");

          let pressTimer=null, longPressed=false;
          row.addEventListener("pointerdown", ()=>{
            longPressed=false;
            pressTimer=setTimeout(()=>{ longPressed=true; autoMenu(d, t.id); }, 550);
          });
          row.addEventListener("pointerup", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
            if(!longPressed) toggleAuto(d, t.id);
          });
          row.addEventListener("pointerleave", ()=>{ if(pressTimer) clearTimeout(pressTimer); });

          card.appendChild(row);
        });
      }
      board.appendChild(card);
    });
  }

  // KPI
  const capEl = document.getElementById("weeklyCap");
  const assignedEl = document.getElementById("weeklyAssigned");
  const remainEl = document.getElementById("weeklyRemain");

  const cap = Number(store.settings.weeklyCapMin||0)||0;
  const assigned = days.reduce((a,d)=>a+sumEst(getAutoTasks(d)),0);
  const remain = cap - assigned;

  if(capEl) capEl.textContent = fmtMin(cap);
  if(assignedEl) assignedEl.textContent = fmtMin(assigned);
  if(remainEl) remainEl.textContent = fmtMin(remain);
}

function renderMaster(){
  const list = document.getElementById("masterList");
  if(!list) return;

  const q = (document.getElementById("masterSearch")?.value || "").trim().toLowerCase();
  const filter = document.getElementById("masterFilter")?.value || "all";

  let items = [...(store.master||[])];
  if(q){
    items = items.filter(m =>
      (m.title||"").toLowerCase().includes(q) ||
      (m.notes||"").toLowerCase().includes(q) ||
      (m.type||"").toLowerCase().includes(q)
    );
  }
  if(filter==="open") items = items.filter(m=>!m.done);
  if(filter==="done") items = items.filter(m=>m.done);

  list.innerHTML = "";
  if(items.length===0){
    const li = document.createElement("li");
    li.textContent = "Masterタスクがありません";
    li.style.opacity="0.75";
    list.appendChild(li);
    return;
  }

  items.forEach(m=>{
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = `【${m.type}】 ${m.title} • ${fmtMin(m.estMin)}${m.notes?` • ${m.notes}`:""}`;
    if(m.done) left.className="done";

    const right = document.createElement("span");
    right.textContent = m.done ? "✓" : "";

    li.appendChild(left);
    li.appendChild(right);

    li.addEventListener("click", ()=>{
      // 簡易編集メニュー
      const msg =
`操作:
1) 完了/未完了
2) 推定分変更
3) タイトル変更
4) 削除

番号を入力`;
      const n = parseInt(prompt(msg,""),10);
      if(!Number.isFinite(n)) return;

      if(n===1){
        m.done = !m.done;
        m.doneAt = m.done ? iso(new Date()) : null;
        save(); return;
      }
      if(n===2){
        const v = prompt("推定分(min)", String(m.estMin||0));
        if(v===null) return;
        m.estMin = Math.max(1, parseInt(v,10)||m.estMin);
        save(); return;
      }
      if(n===3){
        const v = prompt("タイトル", m.title);
        if(!v) return;
        m.title = v;
        save(); return;
      }
      if(n===4){
        if(!confirm("削除しますか？")) return;
        store.master = store.master.filter(x=>x.id!==m.id);
        save(); return;
      }
    });

    list.appendChild(li);
  });
}

function renderHistory(){
  const hw = document.getElementById("historyWeeks");
  const hd = document.getElementById("historyDays");

  if(hw){
    hw.innerHTML = "";
    const weeks = Object.keys(store.weekly||{}).sort().reverse();
    if(weeks.length===0){
      const li = document.createElement("li");
      li.textContent = "週次データなし";
      li.style.opacity="0.75";
      hw.appendChild(li);
    }else{
      weeks.forEach(w=>{
        const li = document.createElement("li");
        li.textContent = `${w} 〜 ${addDays(w,6)}`;
        li.onclick = ()=>{ selectedWeekKey = w; show("weekly"); };
        hw.appendChild(li);
      });
    }
  }

  if(hd){
    hd.innerHTML = "";
    // 日付は plan/daily/logs のユニオン
    const set = new Set([
      ...Object.keys(store.plan||{}),
      ...Object.keys(store.daily||{}),
      ...Object.keys(store.logs||{})
    ]);
    const days = [...set].sort().slice(-14).reverse();
    if(days.length===0){
      const li = document.createElement("li");
      li.textContent = "日次データなし";
      li.style.opacity="0.75";
      hd.appendChild(li);
    }else{
      days.forEach(d=>{
        const all = [...getAutoTasks(d), ...getManualTasks(d)];
        const r = rateOfTasks(all);
        const li = document.createElement("li");
        li.textContent = `${d} • ${r===null?"—":r+"%"} • Study ${getStudyMin(d)}m`;
        li.onclick = ()=>{ selectedDayKey = d; show("daily"); };
        hd.appendChild(li);
      });
    }
  }
}

function render(){
  // countdown
  buildCountdown();

  // ensure weekly container exists
  store.weekly[selectedWeekKey] ||= { tasks: [] };

  renderDaily();
  renderWeekly();
  renderMaster();
  renderCalendar();
  renderHistory();
}

// ===== Notify (optional nudge) =====
function nightlyNudge(){
  const hour = new Date().getHours();
  if(hour < 20) return;
  const nudgedKey = "nudged_" + todayKey;
  if(localStorage.getItem(nudgedKey) === "1") return;

  const all = [...getAutoTasks(todayKey), ...getManualTasks(todayKey)];
  if(all.length === 0) return;

  const r = rateOfTasks(all);
  if(r===null) return;
  localStorage.setItem(nudgedKey, "1");
  const undone = all.filter(t=>!t.done).length;
  alert(undone>0 ? `今日は ${r}%（未完了 ${undone}）。1つだけ回収しよう。` : `今日は ${r}%！おつかれ。`);
}

// ===== Hook Pro HTML buttons =====
document.addEventListener("DOMContentLoaded", ()=>{
  // 初期：daily表示
  show("daily");
  // 1回だけ：未設定なら勝手に再計算しない（ユーザーが押す）
  nightlyNudge();
});

// ===== Expose for inline onclick =====
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.rebuildAuto = rebuildAuto;

// ここでPro HTMLにある操作ボタンが使えるように公開
window.seedDemo = seedDemo;
window.wipeAll = wipeAll;
window.seedFARChapters = seedFARChapters;
window.seedFARWithMinutes = seedFARWithMinutes;

// 初回描画
render();
