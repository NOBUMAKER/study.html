/* =========================
   Study Log (app.js) v3
   - タイマー削除（学習時間は手動入力だけ）
   - マスタータスク（推定時間つき）→ 試験日まで自動割当
   - 今日：自動割当タスク と 手動タスク を別表示
   - 自動割当タスクは後から移動/分割/削除/手動化できる
   - 復習タイミング（1/3/7/14日）を自動で提案＆割当（簡易）
   ========================= */

// ===== Storage =====
const KEY = "study_pwa_v2"; // 既存データを生かす（v2互換・自動マイグレーション）
const TYPES = ["講義", "演習", "復習", "模試", "その他"];

const DEFAULT_SETTINGS = {
  examDate: null,           // "YYYY-MM-DD"
  weeklyHours: 12,          // 週に勉強できる時間（時間）
  dayWeights: [1,1,1,1,1,0.7,0.5], // 月..日（配分）
  dailyChunkMin: 60,        // 1タスクの最大割当（分） ※分割に使う
  reviewOffsets: [1,3,7,14] // 復習日（講義/演習完了の翌日〜）
};

// store（v2互換）
// - daily: {"YYYY-MM-DD": [{text, done, type}] }  // 手動タスク（互換）
// - weekly: {"YYYY-MM-DD(monday)": {tasks:[{text, done, type}]}} // 手動週次（互換）
// v3追加：
// - settings
// - master: [{id, title, type, estMin, notes, createdAt, done, doneAt}]
// - plan: {"YYYY-MM-DD": { auto:[{id, masterId, title, type, estMin, done, origin, locked}], timeMin?: number }}
// - logs: {"YYYY-MM-DD": { studyMin: number }} // 手動入力の学習時間（分）

const store = loadStore();
function loadStore(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch(e){ raw = null; }
  const s = raw && typeof raw === "object" ? raw : { daily:{}, weekly:{} };

  // v2->v3 migrate
  s.settings ||= {...DEFAULT_SETTINGS};
  // 設定の欠けを埋める
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };

  s.master ||= [];
  s.plan ||= {};
  s.logs ||= {};
  // v2にdailyTimeがあったらlogsへ移す
  if(s.dailyTime && typeof s.dailyTime === "object"){
    Object.entries(s.dailyTime).forEach(([d, mins])=>{
      s.logs[d] ||= { studyMin: 0 };
      s.logs[d].studyMin = (s.logs[d].studyMin || 0) + (Number(mins)||0);
    });
    delete s.dailyTime;
  }
  // version
  s._v ||= 3;
  return s;
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(store));
  render();
}

// ===== Date utils =====
const iso = (d) => new Date(d).toISOString().slice(0,10);

function getMonday(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay() || 7; // Sun=7
  if (day !== 1) date.setDate(date.getDate() - (day - 1));
  date.setHours(12,0,0,0);
  return iso(date);
}
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
function weekRangeLabel(mondayIso){
  const sunIso = addDays(mondayIso, 6);
  return `${mondayIso} 〜 ${sunIso}`;
}
function listWeeksSorted(){
  const keys = Object.keys(store.weekly || {});
  keys.sort();
  return keys;
}
function listDaysSorted(){
  // 手動＋自動があるので union
  const a = new Set([
    ...Object.keys(store.daily || {}),
    ...Object.keys(store.plan || {}),
    ...Object.keys(store.logs || {})
  ]);
  return [...a].sort();
}
function weekdayIndex(isoDate){
  // Monday=0..Sunday=6
  const d = new Date(isoDate + "T12:00:00");
  const js = d.getDay(); // 0..6 (Sun..Sat)
  return (js + 6) % 7;
}

// ===== Rate / heat =====
function rateOfTasks(list){
  if (!list || list.length === 0) return null;
  const done = list.filter(t => t.done).length;
  return Math.round(done / list.length * 100);
}
function heatClass(rate){
  if(rate === null) return "r0";
  if(rate === 0) return "r0";
  if(rate < 50) return "r1";
  if(rate < 80) return "r2";
  return "r3";
}

// ===== IDs =====
function uid(prefix="t"){
  return prefix + "_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

// ===== State =====
const todayKey = iso(new Date());
let selectedDayKey = todayKey;
let selectedWeekKey = getMonday();
store.weekly[selectedWeekKey] ||= { tasks: [] };

let calMonth = new Date();
calMonth.setDate(1);

// charts (optional)
let dailyChart, weeklyChart, typeChart;

// ===== Tabs =====
function setActiveTab(name){
  ["Daily","Weekly","Calendar","Analytics","History"].forEach(x=>{
    const b = document.getElementById("tab"+x);
    if(!b) return;
    b.classList.toggle("active", x.toLowerCase() === name);
  });
}
function show(view){
  const ids = ["daily","weekly","calendar","analytics","history"];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.hidden = (id !== view);
  });
  setActiveTab(view);
  render();
}

// ===== Navigation =====
function shiftDay(delta){ selectedDayKey = addDays(selectedDayKey, delta); render(); }
function goToday(){ selectedDayKey = todayKey; render(); }
function shiftWeek(delta){
  selectedWeekKey = addDays(selectedWeekKey, delta * 7);
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  render();
}
function goThisWeek(){ selectedWeekKey = getMonday(); store.weekly[selectedWeekKey] ||= { tasks: [] }; render(); }
function shiftMonth(delta){ calMonth = addMonths(calMonth, delta); render(); }
function goThisMonth(){ calMonth = new Date(); calMonth.setDate(1); render(); }

// ===== Manual task add =====
function pickType(defaultType="演習"){
  const msg =
    "タイプを選んで番号を入力:\n" +
    TYPES.map((t,i)=>`${i+1}) ${t}`).join("\n") +
    `\n\n(空欄なら ${defaultType})`;
  const raw = prompt(msg, "");
  const n = parseInt(raw, 10);
  if(!raw) return defaultType;
  if(Number.isFinite(n) && n>=1 && n<=TYPES.length) return TYPES[n-1];
  if(TYPES.includes(raw)) return raw;
  return defaultType;
}

function addTask(kind){
  // kind: "daily" | "weekly"
  const text = prompt("タスク内容");
  if(!text) return;

  const taskType = pickType("演習");

  if(kind === "daily"){
    store.daily[selectedDayKey] ||= [];
    store.daily[selectedDayKey].push({ text, done:false, type: taskType });
  } else {
    store.weekly[selectedWeekKey] ||= { tasks: [] };
    store.weekly[selectedWeekKey].tasks.push({ text, done:false, type: taskType });
  }
  save();
}

// ===== Toggle / Delete (manual & auto) =====
function toggleManual(kind, idx){
  if(kind === "daily"){
    const list = store.daily[selectedDayKey] || [];
    if(!list[idx]) return;
    list[idx].done = !list[idx].done;
  } else {
    const list = store.weekly[selectedWeekKey]?.tasks || [];
    if(!list[idx]) return;
    list[idx].done = !list[idx].done;
  }
  save();
}

function deleteManual(kind, idx){
  if(!confirm("このタスクを削除しますか？")) return;
  if(kind === "daily"){
    const list = store.daily[selectedDayKey] || [];
    list.splice(idx, 1);
    store.daily[selectedDayKey] = list;
  } else {
    const list = store.weekly[selectedWeekKey]?.tasks || [];
    list.splice(idx, 1);
    store.weekly[selectedWeekKey].tasks = list;
  }
  save();
}

function clearDone(kind){
  if(!confirm("完了済みを削除しますか？")) return;
  if(kind === "daily"){
    const list = store.daily[selectedDayKey] || [];
    store.daily[selectedDayKey] = list.filter(t=>!t.done);
  } else {
    const list = store.weekly[selectedWeekKey]?.tasks || [];
    store.weekly[selectedWeekKey].tasks = list.filter(t=>!t.done);
  }
  save();
}

function toggleAuto(dayIso, autoId){
  const day = store.plan[dayIso];
  if(!day) return;
  const t = (day.auto || []).find(x=>x.id===autoId);
  if(!t) return;
  t.done = !t.done;

  // マスター側にも反映（全部終わったらdone扱い）
  if(t.masterId){
    const m = store.master.find(x=>x.id===t.masterId);
    if(m){
      // 同一masterIdのautoが全部doneなら master done
      const allAssigned = Object.values(store.plan).flatMap(p=>p.auto||[]).filter(x=>x.masterId===m.id);
      const allDone = allAssigned.length>0 && allAssigned.every(x=>x.done);
      if(allDone){
        m.done = true;
        m.doneAt = iso(new Date());
        // 復習提案（完了日基準）：ログに出すだけ（割当は任意）
      }
    }
  }

  save();
}

function autoTaskMenu(dayIso, autoId){
  const day = store.plan[dayIso];
  if(!day) return;
  const idx = (day.auto||[]).findIndex(x=>x.id===autoId);
  if(idx<0) return;
  const t = day.auto[idx];

  const msg =
`自動割当タスクの操作：
1) 日付を移動（YYYY-MM-DD）
2) 推定時間を変更（分）
3) 分割（例：60分→30+30）
4) 削除
5) 手動タスクに変換（今日の手動に移す）

番号を入力（キャンセルで戻る）`;
  const raw = prompt(msg, "");
  const n = parseInt(raw,10);
  if(!Number.isFinite(n)) return;

  if(n===1){
    const to = prompt("移動先の日付（YYYY-MM-DD）", dayIso);
    if(!to) return;
    store.plan[to] ||= { auto: [] };
    store.plan[to].auto ||= [];
    store.plan[to].auto.push(t);
    day.auto.splice(idx,1);
    save();
    return;
  }
  if(n===2){
    const v = prompt("新しい推定時間（分）", String(t.estMin||0));
    const m = Math.max(0, parseInt(v,10)||0);
    t.estMin = m;
    save();
    return;
  }
  if(n===3){
    const a = Math.max(1, parseInt(prompt("分割後の1つ目（分）", "30"),10)||0);
    const b = Math.max(1, parseInt(prompt("分割後の2つ目（分）", "30"),10)||0);
    const base = {...t};
    base.id = uid("auto");
    base.estMin = a;
    const second = {...t};
    second.id = uid("auto");
    second.estMin = b;
    second.done = false;
    // 元を置換
    day.auto.splice(idx,1, base, second);
    save();
    return;
  }
  if(n===4){
    if(!confirm("本当に削除しますか？")) return;
    day.auto.splice(idx,1);
    save();
    return;
  }
  if(n===5){
    store.daily[dayIso] ||= [];
    store.daily[dayIso].push({ text: t.title, done: t.done, type: t.type || "その他" });
    day.auto.splice(idx,1);
    save();
    return;
  }
}

// ===== Study time (manual) =====
function ensureTimeCard(){
  const dailySec = document.getElementById("daily");
  if(!dailySec) return;

  // 既存HTMLにtimerDisplay等がある前提でもOK（使わない）
  // 「手動入力」UIを追加（なければ差し込む）
  if(document.getElementById("studyTimeCardV3")) return;

  const card = document.createElement("div");
  card.className = "card";
  card.id = "studyTimeCardV3";
  card.innerHTML = `
    <h3>学習時間（手動）</h3>
    <div class="row">
      <span id="studyMinBadge" class="badge"></span>
      <button class="btn tiny secondary" id="addStudyMinBtn">＋分を入力</button>
      <button class="btn tiny danger" id="resetStudyMinBtn">0分にする</button>
    </div>
    <p class="muted">※ストップウォッチは使いません。今日の合計分だけ記録できます。</p>
  `;

  // dailyListの後ろあたりに置く
  const dailyList = document.getElementById("dailyList");
  if(dailyList && dailyList.parentNode){
    dailyList.parentNode.insertBefore(card, dailyList.nextSibling);
  } else {
    dailySec.appendChild(card);
  }

  document.getElementById("addStudyMinBtn").onclick = ()=>{
    const v = prompt("追加する学習時間（分）", "60");
    if(v===null) return;
    const mins = Math.max(0, parseInt(v,10)||0);
    setStudyMin(selectedDayKey, getStudyMin(selectedDayKey) + mins);
    save();
  };
  document.getElementById("resetStudyMinBtn").onclick = ()=>{
    if(!confirm("今日の学習時間を0分にしますか？")) return;
    setStudyMin(selectedDayKey, 0);
    save();
  };
}
function getStudyMin(dayIso){
  return (store.logs?.[dayIso]?.studyMin) ? Number(store.logs[dayIso].studyMin)||0 : 0;
}
function setStudyMin(dayIso, mins){
  store.logs ||= {};
  store.logs[dayIso] ||= { studyMin: 0 };
  store.logs[dayIso].studyMin = Math.max(0, mins|0);
}

// ===== Settings & Master tasks UI injection =====
function ensurePlannerUI(){
  const dailySec = document.getElementById("daily");
  if(!dailySec) return;
  if(document.getElementById("plannerCardV3")) return;

  const card = document.createElement("div");
  card.className = "card";
  card.id = "plannerCardV3";
  card.innerHTML = `
    <h3>自動割当（USCPA向け）</h3>
    <div class="row" style="gap:8px; flex-wrap:wrap;">
      <button class="btn tiny secondary" id="setExamBtn">試験日を設定</button>
      <button class="btn tiny secondary" id="setWeeklyBtn">週の勉強時間を設定</button>
      <button class="btn tiny" id="addMasterBtn">＋ マスタータスク追加</button>
      <button class="btn tiny" id="genPlanBtn">自動割当を生成/更新</button>
      <button class="btn tiny secondary" id="viewMasterBtn">マスター一覧</button>
    </div>
    <p class="muted" id="plannerStatus"></p>
  `;

  // dailyセクションの下に追加
  dailySec.appendChild(card);

  document.getElementById("setExamBtn").onclick = ()=>{
    const cur = store.settings.examDate || "";
    const v = prompt("試験日（YYYY-MM-DD）", cur);
    if(v===null) return;
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(v) || v==="";
    if(!ok){
      alert("形式が違います（例：2026-05-15）");
      return;
    }
    store.settings.examDate = v || null;
    save();
  };

  document.getElementById("setWeeklyBtn").onclick = ()=>{
    const cur = String(store.settings.weeklyHours ?? 12);
    const v = prompt("週に勉強できる時間（時間）", cur);
    if(v===null) return;
    const h = Math.max(0, Number(v) || 0);
    store.settings.weeklyHours = h;
    save();
  };

  document.getElementById("addMasterBtn").onclick = ()=>{
    addMasterTask();
  };

  document.getElementById("genPlanBtn").onclick = ()=>{
    generateAutoPlan();
  };

  document.getElementById("viewMasterBtn").onclick = ()=>{
    showMasterModal();
  };
}

function addMasterTask(){
  const title = prompt("マスタータスク名（例：FAR Unit 3 講義）");
  if(!title) return;
  const type = pickType("講義");
  const estH = prompt("推定時間（時間でもOK：例 2 or 1.5）", "2");
  if(estH===null) return;
  const estMin = Math.max(1, Math.round((Number(estH)||0) * 60));
  const notes = prompt("メモ（任意）", "") || "";

  store.master.push({
    id: uid("m"),
    title,
    type,
    estMin,
    notes,
    createdAt: iso(new Date()),
    done: false,
    doneAt: null
  });
  save();
}

function showMasterModal(){
  // 簡易：promptで編集メニュー
  if(store.master.length===0){
    alert("マスタータスクがまだありません。");
    return;
  }
  const lines = store.master.map((m,i)=>{
    const status = m.done ? "✅" : "⬜";
    return `${i+1}) ${status} [${m.type}] ${m.title} (${Math.ceil(m.estMin/60)}h / ${m.estMin}m)`;
  }).join("\n");

  const msg =
`マスタータスク一覧：
${lines}

操作：
a) 番号を入力 → 編集/削除/完了切替
b) "plan" → このタスクだけ再割当（簡易）
（キャンセルで戻る）`;

  const raw = prompt(msg, "");
  if(raw===null || raw==="") return;

  if(raw.trim().toLowerCase()==="plan"){
    generateAutoPlan();
    return;
  }

  const idx = parseInt(raw,10)-1;
  const m = store.master[idx];
  if(!m) return;

  const op =
`操作を選択：
1) タイトル変更
2) タイプ変更
3) 推定時間変更（分）
4) 完了/未完了切替
5) 削除

番号を入力`;
  const n = parseInt(prompt(op,""),10);
  if(!Number.isFinite(n)) return;

  if(n===1){
    const v = prompt("新しいタイトル", m.title);
    if(!v) return;
    m.title = v;
    save();
    return;
  }
  if(n===2){
    m.type = pickType(m.type || "講義");
    save();
    return;
  }
  if(n===3){
    const v = prompt("推定時間（分）", String(m.estMin||0));
    if(v===null) return;
    m.estMin = Math.max(1, parseInt(v,10)||m.estMin);
    save();
    return;
  }
  if(n===4){
    m.done = !m.done;
    m.doneAt = m.done ? iso(new Date()) : null;
    save();
    return;
  }
  if(n===5){
    if(!confirm("このマスタータスクを削除しますか？（割当済みも残ります）")) return;
    store.master.splice(idx,1);
    save();
    return;
  }
}

// ===== Auto plan generation =====
function generateAutoPlan(){
  const exam = store.settings.examDate;
  if(!exam){
    alert("まず試験日を設定してください（試験日がないと割当できません）。");
    return;
  }

  // 既存autoを保持したい場合：lockedは残す／それ以外は作り直す
  // ここは「運用：自動表示で回す」前提で、lockedだけ残し、それ以外は再生成
  const locked = collectLockedAuto();
  store.plan ||= {};
  // planをリセット
  store.plan = {};
  // locked復元
  Object.entries(locked).forEach(([d, arr])=>{
    store.plan[d] ||= { auto: [] };
    store.plan[d].auto = [...arr];
  });

  // 対象日：今日〜試験日（含む）
  const start = todayKey;
  const end = exam;

  // マスタータスク（未完了）を時間ベースで割当
  const masters = (store.master || []).filter(m=>!m.done);

  const dailyCap = buildDailyCapacityMap(start, end, store.settings.weeklyHours, store.settings.dayWeights);
  // 既にlockedで使ってる分は差し引く
  for(const d of Object.keys(dailyCap)){
    const used = (store.plan[d]?.auto || []).reduce((a,t)=>a+(t.estMin||0),0);
    dailyCap[d] = Math.max(0, dailyCap[d]-used);
  }

  // まず本体タスクを割当（分割しつつ）
  for(const m of masters){
    let remaining = m.estMin;

    // 空きがある日から順に詰める（近い日優先）
    let d = start;
    while(remaining > 0 && d <= end){
      store.plan[d] ||= { auto: [] };
      store.plan[d].auto ||= [];

      const cap = dailyCap[d] || 0;
      if(cap > 0){
        const chunk = Math.min(cap, remaining, store.settings.dailyChunkMin);
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
        dailyCap[d] -= chunk;
      }
      d = addDays(d, 1);
    }

    // 収まりきらない場合：警告
    if(remaining > 0){
      alert(`割当が足りません：\n"${m.title}" が残り ${remaining} 分\n週の勉強時間を増やすか、試験日を見直してください。`);
      break;
    }
  }

  // 復習（簡易）：各master由来タスクの「最初に割り当てられた日」を基準に復習を置く
  // ※日次容量は考慮せず、置くだけ（必要なら手で調整）
  const reviewOffsets = store.settings.reviewOffsets || [1,3,7,14];
  const firstDateByMaster = {};
  Object.keys(store.plan).sort().forEach(d=>{
    (store.plan[d].auto||[]).forEach(t=>{
      if(t.masterId && t.origin==="master" && !firstDateByMaster[t.masterId]){
        firstDateByMaster[t.masterId] = d;
      }
    });
  });

  Object.entries(firstDateByMaster).forEach(([mid, firstDay])=>{
    const m = store.master.find(x=>x.id===mid);
    if(!m) return;
    // 「講義/演習」だけ復習を提案
    if(m.type !== "講義" && m.type !== "演習") return;

    reviewOffsets.forEach((k, idx)=>{
      const rd = addDays(firstDay, k);
      if(rd < start || rd > end) return;
      store.plan[rd] ||= { auto: [] };
      // 既に同名復習があれば重複しない
      const name = `復習: ${m.title}（${k}日後）`;
      const exists = (store.plan[rd].auto||[]).some(x=>x.origin==="review" && x.masterId===mid && x.title===name);
      if(exists) return;

      store.plan[rd].auto.push({
        id: uid("auto"),
        masterId: mid,
        title: name,
        type: "復習",
        estMin: 20 + idx*5, // 20,25,30,35分（目安）
        done: false,
        origin: "review",
        locked: false
      });
    });
  });

  save();
}

function collectLockedAuto(){
  const locked = {};
  const plan = store.plan || {};
  Object.entries(plan).forEach(([d, p])=>{
    const arr = (p.auto||[]).filter(t=>t.locked);
    if(arr.length){
      locked[d] = arr.map(x=>({...x})); // copy
    }
  });
  return locked;
}

function buildDailyCapacityMap(startIso, endIso, weeklyHours, dayWeights){
  const cap = {};
  const totalMinPerWeek = Math.max(0, (Number(weeklyHours)||0) * 60);

  // weights normalize
  const w = (Array.isArray(dayWeights) && dayWeights.length===7) ? dayWeights : DEFAULT_SETTINGS.dayWeights;
  const sumW = w.reduce((a,b)=>a+(Number(b)||0),0) || 1;

  let d = startIso;
  while(d <= endIso){
    const wi = weekdayIndex(d);
    const frac = (Number(w[wi])||0) / sumW;
    cap[d] = Math.round(totalMinPerWeek * frac);
    d = addDays(d, 1);
  }
  return cap;
}

// ===== Streak（達成率>=50%） =====
const STREAK_THRESHOLD = 50;
function calcStreak(){
  let streak = 0;
  let d = todayKey;
  while(true){
    const all = getAllDayTasks(d);
    if(all.length === 0) break;
    const r = rateOfTasks(all);
    if(r === null || r < STREAK_THRESHOLD) break;
    streak += 1;
    d = addDays(d, -1);
  }
  return streak;
}

// ===== Type summary =====
function typeCounts(list){
  const counts = {};
  TYPES.forEach(t=>counts[t]=0);
  counts["その他"] ||= 0;
  (list||[]).forEach(t=>{
    const k = TYPES.includes(t.type) ? t.type : "その他";
    counts[k] += 1;
  });
  return counts;
}
function renderChips(el, counts){
  if(!el) return;
  el.innerHTML = "";
  Object.entries(counts).forEach(([k,v])=>{
    if(v===0) return;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${k}: ${v}`;
    el.appendChild(chip);
  });
  if(el.innerHTML===""){
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "データなし";
    el.appendChild(chip);
  }
}

// ===== Calendar render =====
const WEEKDAYS = ["月","火","水","木","金","土","日"];
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

  for(let i=0; i<42; i++){
    const dayIso = addDays(startIso, i);
    const d = new Date(dayIso + "T12:00:00");
    const inMonth = d.getMonth() === m;

    const list = getAllDayTasks(dayIso);
    const r = rateOfTasks(list);

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
    const done = list.filter(t=>t.done).length;
    bottom.textContent = list.length ? `${done}/${list.length}` : "";

    cell.appendChild(top);
    cell.appendChild(bottom);
    cell.onclick = ()=>{ selectedDayKey = dayIso; show("daily"); };

    grid.appendChild(cell);
  }
}

// ===== Analytics (Chart.js) =====
function buildDailySeries(days=30){
  const keys = listDaysSorted().slice(-days);
  const labels = [];
  const values = [];
  keys.forEach(k=>{
    labels.push(k.slice(5));
    const r = rateOfTasks(getAllDayTasks(k));
    values.push(r===null ? null : r);
  });
  return {labels, values};
}
function buildWeeklySeries(weeks=12){
  const keys = listWeeksSorted();
  const last = keys.slice(-weeks);
  const labels = [];
  const values = [];
  last.forEach(k=>{
    labels.push(k.slice(5));
    const r = rateOfTasks(store.weekly[k]?.tasks || []);
    values.push(r===null ? null : r);
  });
  return {labels, values};
}
function buildTypeSeries(days=30){
  const keys = listDaysSorted().slice(-days);
  const agg = {};
  TYPES.forEach(t=>agg[t]=0);
  agg["その他"] ||= 0;

  keys.forEach(k=>{
    const all = getAllDayTasks(k);
    all.forEach(t=>{
      const key = TYPES.includes(t.type) ? t.type : "その他";
      agg[key] += 1;
    });
  });

  const labels = Object.keys(agg).filter(k=>agg[k]>0);
  const values = labels.map(k=>agg[k]);
  return {labels, values};
}
function ensureCharts(){
  if(!window.Chart) return;

  const dctx = document.getElementById("dailyChart");
  if(dctx && !dailyChart){
    dailyChart = new Chart(dctx, {
      type: "line",
      data: { labels: [], datasets: [{ label:"日次達成率(%)", data: [] }] },
      options: { responsive:true, scales:{ y:{ min:0, max:100 } }, spanGaps:true }
    });
  }
  const wctx = document.getElementById("weeklyChart");
  if(wctx && !weeklyChart){
    weeklyChart = new Chart(wctx, {
      type: "bar",
      data: { labels: [], datasets: [{ label:"週次達成率(%)", data: [] }] },
      options: { responsive:true, scales:{ y:{ min:0, max:100 } } }
    });
  }
  const tctx = document.getElementById("typeChart");
  if(tctx && !typeChart){
    typeChart = new Chart(tctx, {
      type: "doughnut",
      data: { labels: [], datasets: [{ label:"タイプ別", data: [] }] },
      options: { responsive:true }
    });
  }
}
function updateCharts(){
  if(!window.Chart) return;
  ensureCharts();

  if(dailyChart){
    const s = buildDailySeries(30);
    dailyChart.data.labels = s.labels;
    dailyChart.data.datasets[0].data = s.values;
    dailyChart.update();
  }
  if(weeklyChart){
    const s = buildWeeklySeries(12);
    weeklyChart.data.labels = s.labels;
    weeklyChart.data.datasets[0].data = s.values;
    weeklyChart.update();
  }
  if(typeChart){
    const s = buildTypeSeries(30);
    typeChart.data.labels = s.labels;
    typeChart.data.datasets[0].data = s.values;
    typeChart.update();
  }
}

// ===== Helpers: day tasks (auto + manual) =====
function getAutoTasks(dayIso){
  return (store.plan?.[dayIso]?.auto) ? store.plan[dayIso].auto : [];
}
function getManualTasks(dayIso){
  return (store.daily?.[dayIso]) ? store.daily[dayIso] : [];
}
function getAllDayTasks(dayIso){
  return [...getAutoTasks(dayIso), ...getManualTasks(dayIso)];
}

// ===== Weekly view helpers =====
function daysOfWeek(mondayIso){
  return Array.from({length:7}, (_,i)=>addDays(mondayIso, i));
}

// ===== Notifications (kept from old, optional) =====
function setNotifStatus(msg){
  const el = document.getElementById("notifStatus");
  if(el) el.textContent = msg;
}
function nightlyNudge(){
  const hour = new Date().getHours();
  if(hour < 20) return;
  const list = getAllDayTasks(todayKey);
  if(list.length === 0) return;
  const r = rateOfTasks(list);
  if(r === null) return;

  const nudgedKey = "nudged_" + todayKey;
  if(localStorage.getItem(nudgedKey) === "1") return;
  localStorage.setItem(nudgedKey, "1");

  const undone = list.filter(t=>!t.done).length;
  if(undone > 0){
    alert(`今日は ${r}%（未完了 ${undone}）。1つだけ回収しよう。`);
  } else {
    alert(`今日は ${r}%！おつかれ。明日の設計も軽くやる？`);
  }
}
async function requestNotif(){
  if(!("Notification" in window)){
    setNotifStatus("この環境は通知に対応していません。");
    return;
  }
  const p = await Notification.requestPermission();
  setNotifStatus("通知許可: " + p);
}
function testNotif(){
  if(!("Notification" in window)){
    setNotifStatus("この環境は通知に対応していません。");
    return;
  }
  if(Notification.permission !== "granted"){
    setNotifStatus("通知が許可されていません（「通知を許可」を押してください）。");
    return;
  }
  new Notification("Study Log", { body: "通知テスト：今日のタスク確認しよう" });
  setNotifStatus("通知テストを送信しました。");
}

// ===== Render =====
function render(){
  ensurePlannerUI();
  ensureTimeCard();

  // ===== Daily =====
  const dDate = document.getElementById("dailyDate");
  if(dDate) dDate.textContent = selectedDayKey;

  const auto = getAutoTasks(selectedDayKey);
  const manual = getManualTasks(selectedDayKey);
  const all = [...auto, ...manual];

  const dr = rateOfTasks(all);
  const dRate = document.getElementById("dailyRate");
  if(dRate) dRate.textContent = dr===null ? "" : `達成率 ${dr}%`;

  const streak = calcStreak();
  const sb = document.getElementById("streakBadge");
  if(sb) sb.textContent = `🔥 ${streak}日連続`;

  // 学習時間（手動）
  const studyMinBadge = document.getElementById("studyMinBadge");
  if(studyMinBadge) studyMinBadge.textContent = `学習時間 ${getStudyMin(selectedDayKey)}分`;

  // 既存HTMLの todayMinutes があれば、そっちも同期（互換）
  const tmOld = document.getElementById("todayMinutes");
  if(tmOld) tmOld.textContent = `学習時間 ${getStudyMin(selectedDayKey)}分`;
  // timerDisplay があっても使わない（あれば固定表示）
  const timerDisp = document.getElementById("timerDisplay");
  if(timerDisp) timerDisp.textContent = "";

  // Daily list: 自動 / 手動 を分けて表示
  const dailyList = document.getElementById("dailyList");
  if(dailyList){
    dailyList.innerHTML = "";

    // section header helper
    const headerLi = (title, sub) => {
      const li = document.createElement("li");
      li.style.listStyle = "none";
      li.style.padding = "10px 8px";
      li.style.fontWeight = "700";
      li.textContent = sub ? `${title}（${sub}）` : title;
      return li;
    };

    dailyList.appendChild(headerLi("🧠 今日の割り当て（自動）", auto.length ? `${auto.filter(t=>t.done).length}/${auto.length}` : "0"));

    if(auto.length===0){
      const li = document.createElement("li");
      li.textContent = "まだ割当がありません（試験日と週勉強時間を設定して「自動割当」を押す）。";
      li.style.opacity = "0.8";
      dailyList.appendChild(li);
    } else {
      auto.forEach((t)=>{
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = `【${t.type || "その他"}】 ${t.title} (${t.estMin||0}m)`;
        if(t.done) left.className = "done";

        const right = document.createElement("span");
        right.textContent = t.done ? "〇" : "";

        li.appendChild(left);
        li.appendChild(right);

        // 短押し＝完了 / 長押し＝編集（移動等）
        let pressTimer = null;
        let longPressed = false;

        li.addEventListener("pointerdown", ()=>{
          longPressed = false;
          pressTimer = setTimeout(()=>{
            longPressed = true;
            autoTaskMenu(selectedDayKey, t.id);
          }, 600);
        });
        li.addEventListener("pointerup", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
          if(!longPressed) toggleAuto(selectedDayKey, t.id);
        });
        li.addEventListener("pointerleave", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
        });

        dailyList.appendChild(li);
      });
    }

    dailyList.appendChild(headerLi("✍️ 手動タスク（あなたが追加したもの）", manual.length ? `${manual.filter(t=>t.done).length}/${manual.length}` : "0"));

    if(manual.length===0){
      const li = document.createElement("li");
      li.textContent = "手動タスクはまだありません。";
      li.style.opacity = "0.8";
      dailyList.appendChild(li);
    } else {
      manual.forEach((t,i)=>{
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = `【${t.type || "その他"}】 ${t.text}`;
        if(t.done) left.className = "done";

        const right = document.createElement("span");
        right.textContent = t.done ? "〇" : "";

        li.appendChild(left);
        li.appendChild(right);

        let pressTimer = null;
        let longPressed = false;

        li.addEventListener("pointerdown", ()=>{
          longPressed = false;
          pressTimer = setTimeout(()=>{
            longPressed = true;
            deleteManual("daily", i);
          }, 600);
        });
        li.addEventListener("pointerup", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
          if(!longPressed) toggleManual("daily", i);
        });
        li.addEventListener("pointerleave", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
        });

        dailyList.appendChild(li);
      });
    }
  }

  // daily type chips（auto+manual）
  renderChips(document.getElementById("dailyTypeSummary"), typeCounts(all));

  // Planner status
  const ps = document.getElementById("plannerStatus");
  if(ps){
    const exam = store.settings.examDate ? `試験日: ${store.settings.examDate}` : "試験日: 未設定";
    const wh = `週 ${store.settings.weeklyHours}h`;
    const mt = `マスター ${store.master.filter(m=>!m.done).length}件（未完了）`;
    const at = Object.values(store.plan||{}).flatMap(p=>p.auto||[]).filter(t=>!t.done).length;
    ps.textContent = `${exam} / ${wh} / ${mt} / 自動割当 未完了 ${at}件`;
  }

  // ===== Weekly =====
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  const weekLabel = document.getElementById("weekLabel");
  if(weekLabel) weekLabel.textContent = `週: ${weekRangeLabel(selectedWeekKey)}`;

  const weeklyManual = store.weekly[selectedWeekKey].tasks || [];
  const wr = rateOfTasks(weeklyManual);
  const weeklyRate = document.getElementById("weeklyRate");
  if(weeklyRate) weeklyRate.textContent = wr===null ? "" : `達成率 ${wr}%`;

  const weeklyList = document.getElementById("weeklyList");
  if(weeklyList){
    weeklyList.innerHTML = "";

    // 自動割当（週内）を日ごとに表示
    const days = daysOfWeek(selectedWeekKey);
    const autoInWeek = days.map(d=>({ d, tasks:getAutoTasks(d) }));

    const header = document.createElement("li");
    header.style.listStyle = "none";
    header.style.padding = "10px 8px";
    header.style.fontWeight = "700";
    header.textContent = "🗓️ 自動割当（この週）";
    weeklyList.appendChild(header);

    autoInWeek.forEach(({d, tasks})=>{
      const li = document.createElement("li");
      li.style.display = "block";
      const title = document.createElement("div");
      title.style.fontWeight = "700";
      title.style.marginBottom = "6px";
      const done = tasks.filter(t=>t.done).length;
      title.textContent = `${d}  (${done}/${tasks.length})`;
      li.appendChild(title);

      if(tasks.length===0){
        const p = document.createElement("div");
        p.style.opacity = "0.7";
        p.textContent = "—";
        li.appendChild(p);
      } else {
        tasks.forEach(t=>{
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.justifyContent = "space-between";
          row.style.gap = "12px";
          row.style.padding = "6px 0";
          const left = document.createElement("span");
          left.textContent = `【${t.type}】 ${t.title} (${t.estMin||0}m)`;
          if(t.done) left.className = "done";
          const right = document.createElement("span");
          right.textContent = t.done ? "〇" : "";
          row.appendChild(left);
          row.appendChild(right);

          // tap: toggle / long: menu
          let pressTimer = null;
          let longPressed = false;
          row.addEventListener("pointerdown", ()=>{
            longPressed = false;
            pressTimer = setTimeout(()=>{
              longPressed = true;
              autoTaskMenu(d, t.id);
            }, 600);
          });
          row.addEventListener("pointerup", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
            if(!longPressed) toggleAuto(d, t.id);
          });
          row.addEventListener("pointerleave", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
          });

          li.appendChild(row);
        });
      }
      weeklyList.appendChild(li);
    });

    // 手動週次
    const header2 = document.createElement("li");
    header2.style.listStyle = "none";
    header2.style.padding = "10px 8px";
    header2.style.fontWeight = "700";
    header2.textContent = "✍️ 週次タスク（手動）";
    weeklyList.appendChild(header2);

    if(weeklyManual.length===0){
      const li = document.createElement("li");
      li.textContent = "週次タスクはまだありません。";
      li.style.opacity = "0.8";
      weeklyList.appendChild(li);
    } else {
      weeklyManual.forEach((t,i)=>{
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = `【${t.type || "その他"}】 ${t.text}`;
        if(t.done) left.className = "done";
        const right = document.createElement("span");
        right.textContent = t.done ? "〇" : "";
        li.appendChild(left);
        li.appendChild(right);

        let pressTimer = null;
        let longPressed = false;
        li.addEventListener("pointerdown", ()=>{
          longPressed = false;
          pressTimer = setTimeout(()=>{
            longPressed = true;
            deleteManual("weekly", i);
          }, 600);
        });
        li.addEventListener("pointerup", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
          if(!longPressed) toggleManual("weekly", i);
        });
        li.addEventListener("pointerleave", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
        });

        weeklyList.appendChild(li);
      });
    }
  }

  renderChips(document.getElementById("weeklyTypeSummary"), typeCounts(weeklyManual));

  // ===== Calendar =====
  renderCalendar();

  // ===== History (weeks) =====
  const hw = document.getElementById("historyWeeks");
  if(hw){
    hw.innerHTML = "";
    const wkeys = listWeeksSorted().slice().reverse();
    if(wkeys.length===0){
      const li = document.createElement("li");
      li.textContent = "まだ週次データがありません。";
      hw.appendChild(li);
    } else {
      wkeys.forEach(k=>{
        const tasks = store.weekly[k]?.tasks || [];
        const r = rateOfTasks(tasks);
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = weekRangeLabel(k);
        const right = document.createElement("span");
        right.textContent = r===null ? "" : `${r}%`;
        li.appendChild(left);
        li.appendChild(right);
        li.onclick = ()=>{ selectedWeekKey = k; store.weekly[selectedWeekKey] ||= { tasks: [] }; show("weekly"); };
        hw.appendChild(li);
      });
    }
  }

  // ===== History (days) =====
  const hd = document.getElementById("historyDays");
  if(hd){
    hd.innerHTML = "";
    const dkeys = listDaysSorted().slice(-14).reverse();
    if(dkeys.length===0){
      const li = document.createElement("li");
      li.textContent = "まだ日次データがありません。";
      hd.appendChild(li);
    } else {
      dkeys.forEach(k=>{
        const list = getAllDayTasks(k);
        const r = rateOfTasks(list);
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = k;
        const right = document.createElement("span");
        right.textContent = r===null ? "" : `${r}%`;
        li.appendChild(left);
        li.appendChild(right);
        li.onclick = ()=>{ selectedDayKey = k; show("daily"); };
        hd.appendChild(li);
      });
    }
  }

  // ===== Charts =====
  updateCharts();

  // ===== Notification status + shortcut URL =====
  if("Notification" in window){
    setNotifStatus("通知状態: " + Notification.permission);
  } else {
    setNotifStatus("通知状態: 未対応");
  }
  const sEl = document.getElementById("shortcutUrl");
  if(sEl) sEl.textContent = `${location.origin}${location.pathname}?open=daily`;

  // Deep link title (optional)
  const dt = document.getElementById("dailyTitle");
  if(dt){
    const label = selectedDayKey === todayKey ? "今日" : "日次";
    dt.textContent = label;
  }
}

// ===== Deep link =====
(function handleDeepLink(){
  const p = new URLSearchParams(location.search);
  const open = p.get("open");
  if(open === "weekly") show("weekly");
  if(open === "history") show("history");
  if(open === "calendar") show("calendar");
  if(open === "analytics") show("analytics");
  if(open === "daily") show("daily");
})();

// ===== PWA =====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// ===== Expose to HTML =====
window.show = show;
window.addTask = addTask;
window.shiftWeek = shiftWeek;
window.goThisWeek = goThisWeek;
window.shiftDay = shiftDay;
window.goToday = goToday;
window.shiftMonth = shiftMonth;
window.goThisMonth = goThisMonth;
window.clearDone = clearDone;
window.requestNotif = requestNotif;
window.testNotif = testNotif;

// ===== Run =====
render();
nightlyNudge();
