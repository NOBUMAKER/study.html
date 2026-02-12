// ===== Storage =====
const KEY = "study_pwa_v3";
const TYPES = ["講義","演習","復習","模試","その他"];

const store = JSON.parse(localStorage.getItem(KEY)) || {
  daily: {},      // "YYYY-MM-DD": [{text, done, type}]
  weekly: {},     // "MONDAY_YYYY-MM-DD": { tasks: [{text, done, type}] }
  dailyTime: {},  // "YYYY-MM-DD": minutes（手動）
  plan: {         // ★ 自動割当用
    examDate: null,        // "YYYY-MM-DD"
    weeklyCapacity: 600,   // 週に使える分（デフォ10h=600）
    master: [],            // [{id,text,type,estMins,doneMins,deadline}]
    overrides: {},         // overrides[weekKey] = { items:[{taskId,mins}] } 週の上書き（A運用）
    dayOverrides: {}       // dayOverrides[dayKey] = { items:[{taskId,mins}] } 日の上書き（A運用）
  }
};

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

function rateOf(list){
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

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function sumMins(list){ return (list||[]).reduce((a,x)=>a+(x.mins||0),0); }

// ===== State =====
const todayKey = iso(new Date());
let selectedDayKey = todayKey;

let selectedWeekKey = getMonday();
store.weekly[selectedWeekKey] ||= { tasks: [] };

let calMonth = new Date();
calMonth.setDate(1);

// charts
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
  document.getElementById("daily").hidden = view !== "daily";
  document.getElementById("weekly").hidden = view !== "weekly";
  document.getElementById("calendar").hidden = view !== "calendar";
  document.getElementById("analytics").hidden = view !== "analytics";
  document.getElementById("history").hidden = view !== "history";
  setActiveTab(view);
  render();
}

// ===== Daily navigation =====
function shiftDay(delta){
  selectedDayKey = addDays(selectedDayKey, delta);
  render();
}
function goToday(){
  selectedDayKey = todayKey;
  render();
}

// ===== Weekly navigation =====
function shiftWeek(delta){
  selectedWeekKey = addDays(selectedWeekKey, delta * 7);
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  render();
}
function goThisWeek(){
  selectedWeekKey = getMonday();
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  render();
}

// ===== Calendar navigation =====
function shiftMonth(delta){
  calMonth = addMonths(calMonth, delta);
  render();
}
function goThisMonth(){
  calMonth = new Date();
  calMonth.setDate(1);
  render();
}

// ===== Task types =====
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

function toggle(kind, idx){
  if(kind === "daily"){
    const list = store.daily[selectedDayKey] || [];
    if(!list[idx]) return;
    list[idx].done = !list[idx].done;
  } else {
    const list = (store.weekly[selectedWeekKey]?.tasks) || [];
    if(!list[idx]) return;
    list[idx].done = !list[idx].done;
  }
  save();
}

function clearDone(kind){
  if(!confirm("完了済みを削除しますか？")) return;
  if(kind === "daily"){
    const list = store.daily[selectedDayKey] || [];
    store.daily[selectedDayKey] = list.filter(t => !t.done);
  } else {
    const list = store.weekly[selectedWeekKey]?.tasks || [];
    store.weekly[selectedWeekKey].tasks = list.filter(t => !t.done);
  }
  save();
}

function deleteTask(kind, idx){
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

// ===== History helpers =====
function listWeeksSorted(){
  const keys = Object.keys(store.weekly);
  keys.sort();
  return keys;
}
function listDaysSorted(){
  const keys = Object.keys(store.daily);
  keys.sort();
  return keys;
}
function goWeekFromHistory(weekKey){
  selectedWeekKey = weekKey;
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  show("weekly");
}
function goDayFromCalendar(dayKey){
  selectedDayKey = dayKey;
  show("daily");
}

// ===== Streak =====
const STREAK_THRESHOLD = 50;
function calcStreak(){
  let streak = 0;
  let d = todayKey;
  while(true){
    const list = store.daily[d];
    if(!list || list.length === 0) break;
    const r = rateOf(list);
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

// ===== Notifications =====
function nightlyNudge(){
  const hour = new Date().getHours();
  if(hour < 20) return;

  const list = store.daily[todayKey] || [];
  if(list.length === 0) return;

  const r = rateOf(list);
  if(r === null) return;

  const nudgedKey = "nudged_" + todayKey;
  if(localStorage.getItem(nudgedKey) === "1") return;
  localStorage.setItem(nudgedKey, "1");

  const undone = list.filter(t=>!t.done).length;
  if(undone > 0){
    alert(`今日は ${r}%（未完了 ${undone}）。1つだけ回収しよう。`);
  }else{
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

function setNotifStatus(msg){
  const el = document.getElementById("notifStatus");
  if(el) el.textContent = msg;
}

// ===== Manual study time (no timer) =====
function addMinutes(mins){
  const key = selectedDayKey || todayKey;
  store.dailyTime ||= {};
  store.dailyTime[key] = (store.dailyTime[key] || 0) + mins;
  save();
}
function subtractMinutes(mins){
  const key = selectedDayKey || todayKey;
  store.dailyTime ||= {};
  const current = store.dailyTime[key] || 0;
  store.dailyTime[key] = Math.max(0, current - mins);
  save();
}
function resetTodayTime(){
  const key = selectedDayKey || todayKey;
  if(!confirm("この日の学習時間を0分にしますか？")) return;
  store.dailyTime[key] = 0;
  save();
}
window.addMinutes = addMinutes;
window.subtractMinutes = subtractMinutes;
window.resetTodayTime = resetTodayTime;

// ===== Planner =====
function ensurePlan(){
  store.plan ||= { examDate:null, weeklyCapacity:600, master:[], overrides:{}, dayOverrides:{} };
  store.plan.overrides ||= {};
  store.plan.dayOverrides ||= {};
  store.plan.master ||= [];
  if(!store.plan.weeklyCapacity) store.plan.weeklyCapacity = 600;
}

function uid(){
  return "t_" + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-3);
}

function setExamDate(){
  ensurePlan();
  const raw = prompt("試験日を YYYY-MM-DD で入力", store.plan.examDate || "");
  if(raw === null) return;
  if(raw.trim()===""){
    store.plan.examDate = null;
    save();
    return;
  }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)){
    alert("形式は YYYY-MM-DD です");
    return;
  }
  store.plan.examDate = raw;
  save();
}

function setWeeklyCapacity(){
  ensurePlan();
  const raw = prompt("週に確保できる学習時間（分）", String(store.plan.weeklyCapacity || 600));
  if(raw === null) return;
  const n = parseInt(raw, 10);
  if(!Number.isFinite(n) || n <= 0){
    alert("1以上の数字（分）で入力してね");
    return;
  }
  store.plan.weeklyCapacity = n;
  save();
}

function addMasterTask(){
  ensurePlan();
  const text = prompt("マスタータスク内容");
  if(!text) return;
  const type = pickType("演習");
  const estRaw = prompt("推定時間（分）", "60");
  if(estRaw === null) return;
  const est = parseInt(estRaw, 10);
  if(!Number.isFinite(est) || est <= 0){
    alert("1以上の分で入力してね");
    return;
  }
  const deadline = prompt("締切（空欄OK / 例 2026-03-01）", store.plan.examDate || "");
  if(deadline !== null && deadline.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(deadline.trim())){
    alert("締切の形式は YYYY-MM-DD です（空欄OK）");
    return;
  }
  store.plan.master.push({
    id: uid(),
    text: text.trim(),
    type,
    estMins: est,
    doneMins: 0,
    deadline: deadline ? deadline.trim() : ""
  });
  save();
}

function remainingMins(task){
  const r = (task.estMins || 0) - (task.doneMins || 0);
  return Math.max(0, r);
}

function editMasterTask(taskId){
  ensurePlan();
  const t = store.plan.master.find(x=>x.id===taskId);
  if(!t) return;

  const text = prompt("タスク内容", t.text);
  if(text === null) return;
  if(text.trim()==="") return;

  const estRaw = prompt("推定時間（分）", String(t.estMins));
  if(estRaw === null) return;
  const est = parseInt(estRaw, 10);
  if(!Number.isFinite(est) || est <= 0){
    alert("1以上の分で入力してね");
    return;
  }

  const doneRaw = prompt("完了分（分）※進捗", String(t.doneMins || 0));
  if(doneRaw === null) return;
  const done = parseInt(doneRaw, 10);
  if(!Number.isFinite(done) || done < 0){
    alert("0以上の分で入力してね");
    return;
  }

  const deadline = prompt("締切（空欄OK / YYYY-MM-DD）", t.deadline || store.plan.examDate || "");
  if(deadline !== null && deadline.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(deadline.trim())){
    alert("締切の形式は YYYY-MM-DD です（空欄OK）");
    return;
  }

  const type = pickType(t.type || "演習");

  t.text = text.trim();
  t.type = type;
  t.estMins = est;
  t.doneMins = clamp(done, 0, est);
  t.deadline = deadline ? deadline.trim() : "";

  save();
}

function deleteMasterTask(taskId){
  if(!confirm("このマスタータスクを削除しますか？")) return;
  ensurePlan();
  store.plan.master = store.plan.master.filter(x=>x.id!==taskId);

  // 週上書きから除去
  Object.keys(store.plan.overrides||{}).forEach(wk=>{
    const o = store.plan.overrides[wk];
    if(!o || !o.items) return;
    o.items = o.items.filter(it=>it.taskId!==taskId);
  });
  // 日上書きから除去
  Object.keys(store.plan.dayOverrides||{}).forEach(day=>{
    const o = store.plan.dayOverrides[day];
    if(!o || !o.items) return;
    o.items = o.items.filter(it=>it.taskId!==taskId);
  });

  save();
}

function weeksBetween(mondayA, mondayB){
  const a = new Date(mondayA + "T12:00:00");
  const b = new Date(mondayB + "T12:00:00");
  const diffDays = Math.round((b - a) / (1000*60*60*24));
  return Math.floor(diffDays / 7);
}

function listMondaysUntil(examIso){
  const start = getMonday(new Date());
  const endMonday = getMonday(new Date(examIso + "T12:00:00"));
  const n = weeksBetween(start, endMonday);
  const out = [];
  for(let i=0;i<=n;i++){
    out.push(addDays(start, i*7));
  }
  return out;
}

// 優先度：締切が近いほど先。締切なしは最後。
function sortMasterForPlan(list){
  return (list||[]).slice().sort((a,b)=>{
    const ad = a.deadline ? a.deadline : "9999-12-31";
    const bd = b.deadline ? b.deadline : "9999-12-31";
    if(ad < bd) return -1;
    if(ad > bd) return 1;
    return remainingMins(b) - remainingMins(a);
  });
}

// 自動割当（週）
function buildAutoScheduleRaw(){
  ensurePlan();
  const exam = store.plan.examDate;
  const cap = store.plan.weeklyCapacity || 600;
  const byWeek = {};
  const overflow = [];

  if(!exam){
    return { byWeek, overflow, mondays: [] };
  }

  const mondays = listMondaysUntil(exam);
  mondays.forEach(wk=>byWeek[wk]=[]);

  const tasks = sortMasterForPlan(store.plan.master).filter(t=>remainingMins(t)>0);

  const remainingCap = {};
  mondays.forEach(wk=>remainingCap[wk]=cap);

  tasks.forEach(task=>{
    let minsLeft = remainingMins(task);
    const dl = task.deadline ? task.deadline : exam;
    const dlMonday = getMonday(new Date(dl + "T12:00:00"));
    const usableWeeks = mondays.filter(wk => wk <= dlMonday);

    for(const wk of usableWeeks){
      if(minsLeft <= 0) break;
      const room = remainingCap[wk];
      if(room <= 0) continue;

      const put = Math.min(room, minsLeft);
      byWeek[wk].push({ taskId: task.id, mins: put, _auto:true });
      remainingCap[wk] -= put;
      minsLeft -= put;
    }

    if(minsLeft > 0){
      overflow.push({ taskId: task.id, mins: minsLeft });
    }
  });

  return { byWeek, overflow, mondays };
}

// 週の手動上書き（A）：weekKey の overrides を先に置く＋同taskIdの自動を除外
function mergeWithWeekOverrides(autoByWeek){
  ensurePlan();
  const byWeek = structuredClone(autoByWeek || {});
  const ov = store.plan.overrides || {};

  Object.entries(ov).forEach(([weekKey, v])=>{
    const items = (v && v.items) ? v.items : [];
    if(items.length === 0) return;

    byWeek[weekKey] ||= [];
    const manualIds = new Set(items.map(x=>x.taskId));
    const keptAuto = (byWeek[weekKey]||[]).filter(a=>!manualIds.has(a.taskId));

    byWeek[weekKey] = [
      ...items.map(x=>({ taskId:x.taskId, mins:x.mins, _auto:false, _manual:true })),
      ...keptAuto.map(a=>({ ...a, _manual:false }))
    ];
  });

  return byWeek;
}

function buildAutoSchedule(){
  const raw = buildAutoScheduleRaw();
  raw.byWeek = mergeWithWeekOverrides(raw.byWeek);
  return raw;
}

function getTaskObj(taskId){
  ensurePlan();
  return store.plan.master.find(x=>x.id===taskId) || null;
}
function getTaskName(taskId){
  const t = getTaskObj(taskId);
  return t ? `【${t.type||"その他"}】${t.text}` : "(不明タスク)";
}

// 週の割当を日割り（Mon〜Sunへ順番に詰める）
function buildDailyFromWeekly(weekKey){
  const sched = buildAutoSchedule();
  const weekItems = (sched.byWeek[weekKey] || []).map(x=>({ ...x })); // clone

  const days = [];
  for(let i=0;i<7;i++) days.push(addDays(weekKey, i));
  const byDay = {};
  days.forEach(d=>byDay[d]=[]);

  // 順番に日へ詰める（1タスクが複数日に跨ってOK）
  // 日の目安容量（週容量/7）を超えてもOK（手で直せるように）
  const daySoftCap = Math.max(30, Math.round((store.plan.weeklyCapacity || 600) / 7));

  let dayIdx = 0;
  let dayUsed = 0;

  for(const item of weekItems){
    let minsLeft = item.mins || 0;
    while(minsLeft > 0){
      const dayKey = days[dayIdx];
      if(!dayKey) break;

      // その日にまだ詰めたい残り（目安）
      const room = Math.max(15, daySoftCap - dayUsed);
      const put = Math.min(room, minsLeft);

      byDay[dayKey].push({ taskId: item.taskId, mins: put, _auto:true });
      minsLeft -= put;
      dayUsed += put;

      // 目安を超えたら次の日へ
      if(dayUsed >= daySoftCap){
        dayIdx += 1;
        dayUsed = 0;
      }

      // 週の後半にまだ余ってるのに日がなくなったら最後の日に入れる
      if(dayIdx >= days.length && minsLeft > 0){
        const last = days[days.length-1];
        byDay[last].push({ taskId: item.taskId, mins: minsLeft, _auto:true, _spill:true });
        minsLeft = 0;
      }
    }
  }

  return byDay;
}

// 日の手動上書き（A）：その日だけ items を置き換える（完全上書き）
function mergeWithDayOverrides(autoByDay){
  ensurePlan();
  const byDay = structuredClone(autoByDay || {});
  const ov = store.plan.dayOverrides || {};

  Object.entries(ov).forEach(([dayKey, v])=>{
    const items = (v && v.items) ? v.items : null;
    if(!items) return;
    byDay[dayKey] = items.map(x=>({ taskId:x.taskId, mins:x.mins, _auto:false, _manual:true }));
  });

  return byDay;
}

function buildDailyPlanForWeek(weekKey){
  const autoByDay = buildDailyFromWeekly(weekKey);
  return mergeWithDayOverrides(autoByDay);
}

// 週次割当の上書き（分数変更）
function editWeekAssignment(weekKey, taskId){
  ensurePlan();
  store.plan.overrides[weekKey] ||= { items: [] };
  const ov = store.plan.overrides[weekKey];
  ov.items ||= [];

  const sched = buildAutoSchedule();
  const cur = (sched.byWeek[weekKey]||[]).find(x=>x.taskId===taskId);
  const curMins = cur ? cur.mins : 0;

  const raw = prompt(
    `${getTaskName(taskId)}\nこの週に割り当てる分数（0でこの週から外す）`,
    String(curMins)
  );
  if(raw === null) return;
  const mins = parseInt(raw, 10);
  if(!Number.isFinite(mins) || mins < 0){
    alert("0以上の数字（分）で入力してね");
    return;
  }

  const i = ov.items.findIndex(x=>x.taskId===taskId);
  if(mins === 0){
    if(i >= 0) ov.items.splice(i,1);
  }else{
    if(i >= 0) ov.items[i].mins = mins;
    else ov.items.push({ taskId, mins });
  }
  // 日上書きは残す（A運用：今日だけ調整も許す）
  save();
}

// 日割り（その日だけ）上書き：その日の配分を編集（完全上書き）
function editDayPlan(dayKey){
  ensurePlan();
  const weekKey = getMonday(new Date(dayKey + "T12:00:00"));
  const byDay = buildDailyPlanForWeek(weekKey);
  const cur = byDay[dayKey] || [];

  // その日の配分を「マスターから選んで作り直し」できる簡易UI（prompt連打）
  // まず今の表示
  const lines = cur.map((x,i)=>`${i+1}) ${getTaskName(x.taskId)} / ${x.mins}分`).join("\n");
  const msg =
`【${dayKey}】の割当を編集（この日は完全上書き）
今の割当:
${lines || "(なし)"}

操作:
1) 既存を分数変更（番号を入力）
2) 追加（A）
3) 削除（番号を入力して 0分）
4) すべて自動に戻す（reset）

入力例:
- "1" → 1番の分数を変更
- "A" → 追加
- "reset" → 自動に戻す`;

  const sel = prompt(msg, "");
  if(sel === null) return;

  if(sel.trim().toLowerCase() === "reset"){
    delete store.plan.dayOverrides[dayKey];
    save();
    return;
  }

  // 追加
  if(sel.trim().toLowerCase() === "a"){
    const choices = store.plan.master
      .filter(t=>remainingMins(t)>0)
      .slice(0, 50); // 多すぎ防止

    if(choices.length === 0){
      alert("追加できる未完了マスタータスクがありません");
      return;
    }

    const pickMsg =
      "追加するタスク番号を入力:\n" +
      choices.map((t,i)=>`${i+1}) ${t.text}（残${remainingMins(t)}分）`).join("\n");

    const nraw = prompt(pickMsg, "");
    if(nraw === null) return;
    const n = parseInt(nraw, 10);
    if(!Number.isFinite(n) || n<1 || n>choices.length){
      alert("番号が不正です");
      return;
    }

    const task = choices[n-1];
    const mraw = prompt("この日に割り当てる分数", "60");
    if(mraw === null) return;
    const mins = parseInt(mraw, 10);
    if(!Number.isFinite(mins) || mins<=0){
      alert("1分以上で入力してね");
      return;
    }

    const next = cur.map(x=>({ taskId:x.taskId, mins:x.mins }));
    next.push({ taskId: task.id, mins });

    store.plan.dayOverrides[dayKey] = { items: next };
    save();
    return;
  }

  // 既存編集
  const idx = parseInt(sel, 10);
  if(!Number.isFinite(idx) || idx<1 || idx>cur.length){
    alert("入力が不正です（番号 or A or reset）");
    return;
  }

  const item = cur[idx-1];
  const mraw = prompt(`${getTaskName(item.taskId)} の分数（0で削除）`, String(item.mins));
  if(mraw === null) return;
  const mins = parseInt(mraw, 10);
  if(!Number.isFinite(mins) || mins < 0){
    alert("0以上で入力してね");
    return;
  }

  const next = cur.map(x=>({ taskId:x.taskId, mins:x.mins }));
  if(mins === 0){
    next.splice(idx-1,1);
  }else{
    next[idx-1].mins = mins;
  }

  store.plan.dayOverrides[dayKey] = { items: next };
  save();
}

// 今週の週上書きリセット
function clearWeekOverrides(){
  ensurePlan();
  if(!confirm("この週の手動修正（上書き）をリセットしますか？")) return;
  delete store.plan.overrides[selectedWeekKey];
  save();
}

// 今日の上書きリセット
function clearDayOverrides(){
  ensurePlan();
  if(!confirm("この日の手動修正（上書き）をリセットしますか？")) return;
  delete store.plan.dayOverrides[selectedDayKey];
  save();
}

window.setExamDate = setExamDate;
window.setWeeklyCapacity = setWeeklyCapacity;
window.addMasterTask = addMasterTask;
window.editWeekAssignment = editWeekAssignment;
window.editDayPlan = editDayPlan;
window.clearWeekOverrides = clearWeekOverrides;
window.clearDayOverrides = clearDayOverrides;

// ===== Charts =====
function buildDailySeries(days=30){
  const keys = listDaysSorted();
  const last = keys.slice(-days);
  const labels = [];
  const values = [];
  last.forEach(k=>{
    labels.push(k.slice(5));
    const r = rateOf(store.daily[k] || []);
    values.push(r===null ? null : r);
  });
  return {labels, values};
}

function buildWeeklySeries(weeks=10){
  const keys = listWeeksSorted();
  const last = keys.slice(-weeks);
  const labels = [];
  const values = [];
  last.forEach(k=>{
    labels.push(k.slice(5));
    const r = rateOf(store.weekly[k]?.tasks || []);
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
    (store.daily[k] || []).forEach(t=>{
      const key = TYPES.includes(t.type) ? t.type : "その他";
      agg[key] += 1;
    });
  });

  const labels = Object.keys(agg).filter(k=>agg[k]>0);
  const values = labels.map(k=>agg[k]);
  return {labels, values};
}

function ensureCharts(){
  const dctx = document.getElementById("dailyChart");
  if(dctx && !dailyChart && window.Chart){
    dailyChart = new Chart(dctx, {
      type: "line",
      data: { labels: [], datasets: [{ label:"日次達成率(%)", data: [] }] },
      options: { responsive: true, scales: { y: { min:0, max:100 } }, spanGaps: true }
    });
  }
  const wctx = document.getElementById("weeklyChart");
  if(wctx && !weeklyChart && window.Chart){
    weeklyChart = new Chart(wctx, {
      type: "bar",
      data: { labels: [], datasets: [{ label:"週次達成率(%)", data: [] }] },
      options: { responsive:true, scales:{ y:{ min:0, max:100 } } }
    });
  }
  const tctx = document.getElementById("typeChart");
  if(tctx && !typeChart && window.Chart){
    typeChart = new Chart(tctx, {
      type: "doughnut",
      data: { labels: [], datasets: [{ label:"タイプ別", data: [] }] },
      options: { responsive:true }
    });
  }
}

function updateCharts(){
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

// ===== Calendar render =====
const WEEKDAYS = ["月","火","水","木","金","土","日"];

function renderCalendar(){
  const grid = document.getElementById("calendarGrid");
  if(!grid) return;

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();

  document.getElementById("calMonthLabel").textContent = `${y}年 ${m+1}月`;

  grid.innerHTML = "";
  WEEKDAYS.forEach(w=>{
    const h = document.createElement("div");
    h.className = "calHead";
    h.textContent = w;
    grid.appendChild(h);
  });

  const first = new Date(y, m, 1);
  const firstIso = iso(first);

  const jsDay = first.getDay(); // 0 Sun..6 Sat
  const idx = (jsDay + 6) % 7;  // Mon=0
  const startIso = addDays(firstIso, -idx);

  for(let i=0; i<42; i++){
    const dayIso = addDays(startIso, i);
    const d = new Date(dayIso + "T12:00:00");
    const inMonth = d.getMonth() === m;

    const list = store.daily[dayIso] || [];
    const r = rateOf(list);

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
    bottom.textContent = list.length ? `${list.filter(t=>t.done).length}/${list.length}` : "";

    cell.appendChild(top);
    cell.appendChild(bottom);
    cell.onclick = ()=>goDayFromCalendar(dayIso);

    grid.appendChild(cell);
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

// ===== Render =====
function render(){
  ensurePlan();

  // ===== Daily =====
  document.getElementById("dailyDate").textContent = selectedDayKey;

  const daily = store.daily[selectedDayKey] || [];
  const dr = rateOf(daily);
  document.getElementById("dailyRate").textContent = dr===null ? "" : `達成率 ${dr}%`;

  const mins = (store.dailyTime && store.dailyTime[selectedDayKey]) ? store.dailyTime[selectedDayKey] : 0;
  const tm = document.getElementById("todayMinutes");
  if(tm) tm.textContent = `学習時間 ${mins}分`;

  const streak = calcStreak();
  document.getElementById("streakBadge").textContent = streak>0 ? `🔥 ${streak}日連続` : "🔥 0日";

  const dailyList = document.getElementById("dailyList");
  dailyList.innerHTML = "";

  daily.forEach((t,i)=>{
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
        deleteTask("daily", i);
      }, 600);
    });

    li.addEventListener("pointerup", ()=>{
      if(pressTimer) clearTimeout(pressTimer);
      if(!longPressed) toggle("daily", i);
    });

    li.addEventListener("pointerleave", ()=>{
      if(pressTimer) clearTimeout(pressTimer);
    });

    dailyList.appendChild(li);
  });

  renderChips(document.getElementById("dailyTypeSummary"), typeCounts(daily));

  // ===== Daily Auto Plan box =====
  const dayPlanBox = document.getElementById("dayPlanBox");
  if(dayPlanBox){
    dayPlanBox.innerHTML = "";
    const weekKey = getMonday(new Date(selectedDayKey + "T12:00:00"));
    const byDay = buildDailyPlanForWeek(weekKey);
    const items = byDay[selectedDayKey] || [];
    const used = sumMins(items);

    const head = document.createElement("div");
    head.className = "row";

    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = `今日の割当: ${used}分`;
    head.appendChild(b);

    const btn = document.createElement("button");
    btn.className = "btn tiny secondary";
    btn.textContent = "今日の割当を編集";
    btn.onclick = ()=>editDayPlan(selectedDayKey);
    head.appendChild(btn);

    const btn2 = document.createElement("button");
    btn2.className = "btn tiny secondary";
    btn2.textContent = "今日の上書きをリセット";
    btn2.onclick = clearDayOverrides;
    head.appendChild(btn2);

    dayPlanBox.appendChild(head);

    if(!store.plan.examDate){
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "試験日が未設定です（週次の「試験日設定」から）";
      dayPlanBox.appendChild(p);
    } else if(items.length === 0){
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "今日の割当はありません（または全タスク完了）";
      dayPlanBox.appendChild(p);
    } else {
      const ul = document.createElement("ul");
      ul.className = "list";
      items.forEach(x=>{
        const li = document.createElement("li");
        const left = document.createElement("span");
        const tag = x._manual ? "（手動）" : "（自動）";
        left.textContent = `${getTaskName(x.taskId)} / ${x.mins}分 ${tag}`;
        li.appendChild(left);
        li.onclick = ()=>editDayPlan(selectedDayKey);
        ul.appendChild(li);
      });
      dayPlanBox.appendChild(ul);
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "※タップでその日の割当を編集（この日は完全上書き）";
      dayPlanBox.appendChild(p);
    }
  }

  // ===== Weekly =====
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  const weekly = store.weekly[selectedWeekKey].tasks || [];

  document.getElementById("weekLabel").textContent = `週: ${weekRangeLabel(selectedWeekKey)}`;
  const wr = rateOf(weekly);
  document.getElementById("weeklyRate").textContent = wr===null ? "" : `達成率 ${wr}%`;

  const weeklyList = document.getElementById("weeklyList");
  weeklyList.innerHTML = "";

  weekly.forEach((t,i)=>{
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
        deleteTask("weekly", i);
      }, 600);
    });

    li.addEventListener("pointerup", ()=>{
      if(pressTimer) clearTimeout(pressTimer);
      if(!longPressed) toggle("weekly", i);
    });

    li.addEventListener("pointerleave", ()=>{
      if(pressTimer) clearTimeout(pressTimer);
    });

    weeklyList.appendChild(li);
  });

  renderChips(document.getElementById("weeklyTypeSummary"), typeCounts(weekly));

  // ===== Planner UI (weekly) =====
  const examEl = document.getElementById("examDateLabel");
  const capEl  = document.getElementById("weeklyCapLabel");
  if(examEl) examEl.textContent = store.plan.examDate ? `試験日: ${store.plan.examDate}` : "試験日: 未設定";
  if(capEl)  capEl.textContent  = `週の容量: ${store.plan.weeklyCapacity}分`;

  // master list
  const masterEl = document.getElementById("masterList");
  if(masterEl){
    masterEl.innerHTML = "";
    const ms = store.plan.master || [];
    if(ms.length === 0){
      const li = document.createElement("li");
      li.textContent = "まだマスタータスクがありません。";
      masterEl.appendChild(li);
    } else {
      ms.forEach(t=>{
        const li = document.createElement("li");
        const left = document.createElement("span");
        const rem = remainingMins(t);
        const dl = t.deadline ? ` / 締切:${t.deadline}` : "";
        left.textContent = `【${t.type||"その他"}】${t.text} / 推定:${t.estMins}分 / 進捗:${t.doneMins||0}分 / 残:${rem}分${dl}`;
        li.appendChild(left);

        let pressTimer=null, longPressed=false;
        li.addEventListener("pointerdown", ()=>{
          longPressed=false;
          pressTimer=setTimeout(()=>{
            longPressed=true;
            deleteMasterTask(t.id);
          }, 700);
        });
        li.addEventListener("pointerup", ()=>{
          if(pressTimer) clearTimeout(pressTimer);
          if(!longPressed) editMasterTask(t.id);
        });
        li.addEventListener("pointerleave", ()=>{ if(pressTimer) clearTimeout(pressTimer); });

        masterEl.appendChild(li);
      });
    }
  }

  // auto schedule for selected week
  const autoWeekBox = document.getElementById("autoWeekBox");
  if(autoWeekBox){
    autoWeekBox.innerHTML = "";
    const sched = buildAutoSchedule();
    const items = (sched.byWeek[selectedWeekKey] || []);
    const used = sumMins(items);
    const cap = store.plan.weeklyCapacity || 600;

    const head = document.createElement("div");
    head.className = "row";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `週の割当: ${used}/${cap}分`;
    head.appendChild(badge);

    const resetBtn = document.createElement("button");
    resetBtn.className = "btn tiny secondary";
    resetBtn.textContent = "この週の上書きをリセット";
    resetBtn.onclick = clearWeekOverrides;
    head.appendChild(resetBtn);

    autoWeekBox.appendChild(head);

    if(!store.plan.examDate){
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "試験日が未設定です（「試験日設定」を押してね）";
      autoWeekBox.appendChild(p);
    } else if(items.length === 0){
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "この週に割り当てがありません（または全タスク完了）";
      autoWeekBox.appendChild(p);
    } else {
      const ul = document.createElement("ul");
      ul.className = "list";

      items.forEach(a=>{
        const li = document.createElement("li");
        const left = document.createElement("span");
        const tag = a._manual ? "（手動）" : "（自動）";
        left.textContent = `${getTaskName(a.taskId)} / ${a.mins}分 ${tag}`;
        li.appendChild(left);
        li.onclick = ()=>editWeekAssignment(selectedWeekKey, a.taskId);
        ul.appendChild(li);
      });

      autoWeekBox.appendChild(ul);

      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "※タップでこの週の分数を修正（週だけ上書き）";
      autoWeekBox.appendChild(p);
    }
  }

  // week daily preview (Mon-Sun)
  const weekDailyPreview = document.getElementById("weekDailyPreview");
  if(weekDailyPreview){
    weekDailyPreview.innerHTML = "";
    const byDay = buildDailyPlanForWeek(selectedWeekKey);
    const days = [];
    for(let i=0;i<7;i++) days.push(addDays(selectedWeekKey, i));

    days.forEach(dayKey=>{
      const items = byDay[dayKey] || [];
      const used = sumMins(items);

      const row = document.createElement("div");
      row.className = "row";

      const title = document.createElement("span");
      title.className = "badge";
      title.textContent = `${dayKey} / ${used}分`;
      row.appendChild(title);

      const btn = document.createElement("button");
      btn.className = "btn tiny secondary";
      btn.textContent = "編集";
      btn.onclick = ()=>editDayPlan(dayKey);
      row.appendChild(btn);

      weekDailyPreview.appendChild(row);

      if(items.length){
        const ul = document.createElement("ul");
        ul.className = "list";
        items.forEach(x=>{
          const li = document.createElement("li");
          const tag = x._manual ? "（手動）" : "（自動）";
          li.textContent = `${getTaskName(x.taskId)} / ${x.mins}分 ${tag}`;
          li.onclick = ()=>editDayPlan(dayKey);
          ul.appendChild(li);
        });
        weekDailyPreview.appendChild(ul);
      } else {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "割当なし";
        weekDailyPreview.appendChild(p);
      }
    });
  }

  // overflow
  const overflowEl = document.getElementById("overflowBox");
  if(overflowEl){
    overflowEl.innerHTML = "";
    const sched = buildAutoSchedule();
    if(sched.overflow && sched.overflow.length){
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "入り切らない分（締切までに容量不足）:";
      overflowEl.appendChild(p);

      const ul = document.createElement("ul");
      ul.className = "list";
      sched.overflow.forEach(o=>{
        const li = document.createElement("li");
        li.textContent = `${getTaskName(o.taskId)} / 未割当 ${o.mins}分`;
        ul.appendChild(li);
      });
      overflowEl.appendChild(ul);
    }
  }

  // ===== Calendar =====
  renderCalendar();

  // ===== History =====
  const hw = document.getElementById("historyWeeks");
  if(hw){
    hw.innerHTML = "";
    const wkeys = listWeeksSorted().slice().reverse();
    if(wkeys.length === 0){
      const li = document.createElement("li");
      li.textContent = "まだ週次データがありません。";
      hw.appendChild(li);
    } else {
      wkeys.forEach(k=>{
        const tasks = store.weekly[k]?.tasks || [];
        const r = rateOf(tasks);
        const li = document.createElement("li");
        const left = document.createElement("span");
        left.textContent = weekRangeLabel(k);
        const right = document.createElement("span");
        right.textContent = r===null ? "" : `${r}%`;
        li.appendChild(left);
        li.appendChild(right);
        li.onclick = ()=>goWeekFromHistory(k);
        hw.appendChild(li);
      });
    }
  }

  const hd = document.getElementById("historyDays");
  if(hd){
    hd.innerHTML = "";
    const dkeys = listDaysSorted().slice(-14).reverse();
    if(dkeys.length === 0){
      const li = document.createElement("li");
      li.textContent = "まだ日次データがありません。";
      hd.appendChild(li);
    } else {
      dkeys.forEach(k=>{
        const list = store.daily[k] || [];
        const r = rateOf(list);
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
  if(window.Chart) updateCharts();

  // ===== Notification status + shortcut URL =====
  if("Notification" in window){
    setNotifStatus("通知状態: " + Notification.permission);
  } else {
    setNotifStatus("通知状態: 未対応");
  }
  const url = `${location.origin}${location.pathname}?open=daily`;
  const sEl = document.getElementById("shortcutUrl");
  if(sEl) sEl.textContent = url;
}

// ===== Expose to HTML =====
window.show = show;
window.addTask = addTask;
window.toggle = toggle;
window.shiftWeek = shiftWeek;
window.goThisWeek = goThisWeek;
window.shiftDay = shiftDay;
window.goToday = goToday;
window.shiftMonth = shiftMonth;
window.goThisMonth = goThisMonth;
window.goWeekFromHistory = goWeekFromHistory;
window.clearDone = clearDone;
window.requestNotif = requestNotif;
window.testNotif = testNotif;

// ===== Run =====
render();
nightlyNudge();
