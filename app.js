// ===== Storage =====
const KEY = "study_pwa_v2";
const TYPES = ["講義","演習","復習","模試","その他"];

const store = JSON.parse(localStorage.getItem(KEY)) || {
  daily: {},     // "YYYY-MM-DD": [{text, done, type}]
  weekly: {},    // "MONDAY_YYYY-MM-DD": { tasks: [{text, done, type}] }
  dailyTime: {}  // ★ 追加： "YYYY-MM-DD": minutes
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

// ===== State =====
const todayKey = iso(new Date());
let selectedDayKey = todayKey;

let selectedWeekKey = getMonday(); // weekly view
store.weekly[selectedWeekKey] ||= { tasks: [] };

// calendar month state: Date object set to 1st of month
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

// ===== Task add/toggle =====
function pickType(defaultType="演習"){
  const msg =
    "タイプを選んで番号を入力:\n" +
    TYPES.map((t,i)=>`${i+1}) ${t}`).join("\n") +
    `\n\n(空欄なら ${defaultType})`;
  const raw = prompt(msg, "");
  const n = parseInt(raw, 10);
  if(!raw) return defaultType;
  if(Number.isFinite(n) && n>=1 && n<=TYPES.length) return TYPES[n-1];
  // 入力が文字でもOKにする
  if(TYPES.includes(raw)) return raw;
  return defaultType;
}

function addTask(type){
  const text = prompt("タスク内容");
  if(!text) return;

  const taskType = pickType(type==="weekly" ? "演習" : "演習");

  if(type === "daily"){
    store.daily[selectedDayKey] ||= [];
    store.daily[selectedDayKey].push({ text, done:false, type: taskType });
  } else {
    store.weekly[selectedWeekKey] ||= { tasks: [] };
    store.weekly[selectedWeekKey].tasks.push({ text, done:false, type: taskType });
  }
  save();
}

function toggle(type, idx){
  if(type === "daily"){
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

function clearDone(type){
  if(!confirm("完了済みを削除しますか？")) return;
  if(type === "daily"){
    const list = store.daily[selectedDayKey] || [];
    store.daily[selectedDayKey] = list.filter(t => !t.done);
  } else {
    const list = store.weekly[selectedWeekKey]?.tasks || [];
    store.weekly[selectedWeekKey].tasks = list.filter(t => !t.done);
  }
  save();
}
function deleteTask(type, idx){
  if(!confirm("このタスクを削除しますか？")) return;

  if(type === "daily"){
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
// 条件：達成率 >= 50% を「達成」とする（変更したければここ）
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

  // ===== Study Time (daily total) =====
let timerRunning = false;
let timerStartedAt = null;   // performance.now() 기준
let timerAccumMs = 0;        // pause分も含めて積算
let timerIntervalId = null;

function fmtTime(ms){
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2,"0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2,"0");
  const s = String(total % 60).padStart(2,"0");
  return `${h}:${m}:${s}`;
}

function updateTimerUI(){
  const el = document.getElementById("timerDisplay");
  if(!el) return;
  const ms = timerAccumMs + (timerRunning ? (performance.now() - timerStartedAt) : 0);
  el.textContent = fmtTime(ms);
}

function timerStart(){
  if(timerRunning) return;
  timerRunning = true;
  timerStartedAt = performance.now();
  if(timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(updateTimerUI, 250);
  updateTimerUI();
}

function timerPause(){
  if(!timerRunning) return;
  timerAccumMs += (performance.now() - timerStartedAt);
  timerRunning = false;
  timerStartedAt = null;
  updateTimerUI();
}

function timerReset(){
  timerRunning = false;
  timerStartedAt = null;
  timerAccumMs = 0;
  if(timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = null;
  updateTimerUI();
}

function timerStop(){
  if(timerRunning){
    timerAccumMs += (performance.now() - timerStartedAt);
    timerRunning = false;
    timerStartedAt = null;
  }
  const mins = Math.round(timerAccumMs / 60000);
  const key = selectedDayKey || todayKey;

  if(mins > 0){
    store.dailyTime ||= {};
    store.dailyTime[key] = (store.dailyTime[key] || 0) + mins;
  }
  timerReset();
  save();
}

function addMinutes(mins){
  const key = selectedDayKey || todayKey;
  store.dailyTime ||= {};
  store.dailyTime[key] = (store.dailyTime[key] || 0) + mins;
  save();
}

// HTMLから呼べるように
window.timerStart = timerStart;
window.timerPause = timerPause;
window.timerStop = timerStop;
window.timerReset = timerReset;
window.addMinutes = addMinutes;

function subtractMinutes(mins){
  const key = selectedDayKey || todayKey;
  store.dailyTime ||= {};
  const current = store.dailyTime[key] || 0;
  const next = Math.max(0, current - mins);
  store.dailyTime[key] = next;
  save();
}

function resetTodayTime(){
  const key = selectedDayKey || todayKey;
  if(!confirm("今日の学習時間を0分にしますか？")) return;
  store.dailyTime[key] = 0;
  save();
}

window.subtractMinutes = subtractMinutes;
window.resetTodayTime = resetTodayTime;

// ===== Charts =====
function buildDailySeries(days=30){
  const keys = listDaysSorted();
  const last = keys.slice(-days);
  const labels = [];
  const values = [];
  last.forEach(k=>{
    labels.push(k.slice(5)); // MM-DD
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
    labels.push(k.slice(5)); // MM-DD (Monday)
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
  // daily line
  const dctx = document.getElementById("dailyChart");
  if(dctx && !dailyChart){
    dailyChart = new Chart(dctx, {
      type: "line",
      data: { labels: [], datasets: [{ label:"日次達成率(%)", data: [] }] },
      options: {
        responsive: true,
        scales: { y: { min:0, max:100 } },
        spanGaps: true
      }
    });
  }
  // weekly bar
  const wctx = document.getElementById("weeklyChart");
  if(wctx && !weeklyChart){
    weeklyChart = new Chart(wctx, {
      type: "bar",
      data: { labels: [], datasets: [{ label:"週次達成率(%)", data: [] }] },
      options: { responsive:true, scales:{ y:{ min:0, max:100 } } }
    });
  }
  // type donut
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
  const m = calMonth.getMonth(); // 0-based

  document.getElementById("calMonthLabel").textContent = `${y}年 ${m+1}月`;

  grid.innerHTML = "";
  // headers
  WEEKDAYS.forEach(w=>{
    const h = document.createElement("div");
    h.className = "calHead";
    h.textContent = w;
    grid.appendChild(h);
  });

  // first day of month
  const first = new Date(y, m, 1);
  const firstIso = iso(first);

  // weekday index with Monday=0..Sunday=6
  const jsDay = first.getDay(); // 0 Sun..6 Sat
  const idx = (jsDay + 6) % 7;  // convert to Mon=0

  // start date shown on calendar (Monday of the first week)
  const startIso = addDays(firstIso, -idx);

  // 6 weeks grid (42 days)
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

// ===== Render =====
function render(){
  // Daily
  document.getElementById("dailyDate").textContent = selectedDayKey;
  const daily = store.daily[selectedDayKey] || [];
  const dr = rateOf(daily);
  document.getElementById("dailyRate").textContent = dr===null ? "" : `達成率 ${dr}%`;
  // 今日の学習時間（分）表示
const mins = (store.dailyTime && store.dailyTime[selectedDayKey]) ? store.dailyTime[selectedDayKey] : 0;
const tm = document.getElementById("todayMinutes");
if(tm) tm.textContent = `学習時間 ${mins}分`;

  // streak
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

  // daily type chips
  renderChips(document.getElementById("dailyTypeSummary"), typeCounts(daily));

  // Weekly
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
    let pressTimerW = null;
let longPressedW = false;

li.addEventListener("pointerdown", ()=>{
  longPressedW = false;
  pressTimerW = setTimeout(()=>{
    longPressedW = true;
    deleteTask("weekly", i);
  }, 600);
});

li.addEventListener("pointerup", ()=>{
  if(pressTimerW) clearTimeout(pressTimerW);
  if(!longPressedW) toggle("weekly", i);
});

li.addEventListener("pointerleave", ()=>{
  if(pressTimerW) clearTimeout(pressTimerW);
});
    weeklyList.appendChild(li);
  });

  renderChips(document.getElementById("weeklyTypeSummary"), typeCounts(weekly));

  // Calendar
  renderCalendar();

  // History - weeks
  const hw = document.getElementById("historyWeeks");
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

  // History - days
  const hd = document.getElementById("historyDays");
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

  // Charts
  updateCharts();

  // Notification status + shortcut URL
  if("Notification" in window){
    setNotifStatus("通知状態: " + Notification.permission);
  } else {
    setNotifStatus("通知状態: 未対応");
  }
  const url = `${location.origin}${location.pathname}?open=daily`;
  const sEl = document.getElementById("shortcutUrl");
  if(sEl) sEl.textContent = url;
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

// タイマー用（追加）
window.timerStart = timerStart;
window.timerPause = timerPause;
window.timerStop  = timerStop;
window.timerReset = timerReset;
window.addMinutes = addMinutes;

// ===== Run =====
render();
nightlyNudge();
