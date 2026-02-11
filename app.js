// ====== Storage ======
const KEY = "study_pwa_v1";
const store = JSON.parse(localStorage.getItem(KEY)) || {
  daily: {},   // "YYYY-MM-DD": [{text, done}]
  weekly: {}   // "MONDAY_YYYY-MM-DD": { tasks: [{text, done}] }
};

function save() {
  localStorage.setItem(KEY, JSON.stringify(store));
  render();
}

// ====== Date utils ======
const iso = (d) => new Date(d).toISOString().slice(0,10);

function getMonday(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay() || 7; // Sun=7
  if (day !== 1) date.setDate(date.getDate() - (day - 1));
  date.setHours(12,0,0,0); // DST safety
  return iso(date);
}

function addDays(isoDate, n){
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
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

// ====== Current state ======
const todayKey = iso(new Date());
let selectedWeekKey = getMonday(); // for weekly view
store.weekly[selectedWeekKey] ||= { tasks: [] };

// ====== UI helpers ======
function setActiveTab(name){
  ["Daily","Weekly","History"].forEach(x=>{
    const b = document.getElementById("tab"+x);
    if(!b) return;
    b.classList.toggle("active", x.toLowerCase() === name);
  });
}

function show(view){
  document.getElementById("daily").hidden = view !== "daily";
  document.getElementById("weekly").hidden = view !== "weekly";
  document.getElementById("history").hidden = view !== "history";
  setActiveTab(view);
  // render ensures content up to date
  render();
}

// ====== Tasks ======
function addTask(type){
  const text = prompt("タスク内容");
  if(!text) return;

  if(type === "daily"){
    store.daily[todayKey] ||= [];
    store.daily[todayKey].push({ text, done:false });
  } else {
    store.weekly[selectedWeekKey] ||= { tasks: [] };
    store.weekly[selectedWeekKey].tasks.push({ text, done:false });
  }
  save();
}

function toggle(type, idx){
  if(type === "daily"){
    const list = store.daily[todayKey] || [];
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
    const list = store.daily[todayKey] || [];
    store.daily[todayKey] = list.filter(t => !t.done);
  } else {
    const list = store.weekly[selectedWeekKey]?.tasks || [];
    store.weekly[selectedWeekKey].tasks = list.filter(t => !t.done);
  }
  save();
}

// ====== Weekly navigation ======
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

// ====== History ======
function listWeeksSorted(){
  const keys = Object.keys(store.weekly);
  keys.sort(); // ISO date sorts lexicographically
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

// ====== Notifications (practical) ======
// 1) In-app reminder at night (reliable on iOS)
function nightlyNudge(){
  const hour = new Date().getHours();
  if(hour < 20) return; // 20:00-
  const daily = store.daily[todayKey] || [];
  if(daily.length === 0) return; // no tasks => do nothing
  const r = rateOf(daily);
  if(r === null) return;

  // show only once per day
  const nudgedKey = "nudged_" + todayKey;
  if(localStorage.getItem(nudgedKey) === "1") return;

  localStorage.setItem(nudgedKey, "1");
  alert(`今日の達成率は ${r}% です。未完了があれば、今のうちに回収しよう。`);
}

// 2) Notification API (best-effort; iOS has constraints)
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

// Expose to HTML
window.show = show;
window.addTask = addTask;
window.toggle = toggle;
window.shiftWeek = shiftWeek;
window.goThisWeek = goThisWeek;
window.goWeekFromHistory = goWeekFromHistory;
window.clearDone = clearDone;
window.requestNotif = requestNotif;
window.testNotif = testNotif;

// ====== Render ======
function render(){
  // Daily
  const daily = store.daily[todayKey] || [];
  document.getElementById("dailyDate").textContent = todayKey;
  document.getElementById("dailyTitle").textContent = "今日";
  const dr = rateOf(daily);
  document.getElementById("dailyRate").textContent = dr === null ? "" : `達成率 ${dr}%`;

  const dailyList = document.getElementById("dailyList");
  dailyList.innerHTML = "";
  daily.forEach((t, i)=>{
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = t.text;
    if(t.done) left.className = "done";
    const right = document.createElement("span");
    right.textContent = t.done ? "〇" : "";
    li.appendChild(left);
    li.appendChild(right);
    li.onclick = ()=>toggle("daily", i);
    dailyList.appendChild(li);
  });

  // Weekly
  store.weekly[selectedWeekKey] ||= { tasks: [] };
  const weekly = store.weekly[selectedWeekKey].tasks || [];
  document.getElementById("weekLabel").textContent = `週: ${weekRangeLabel(selectedWeekKey)}`;
  const wr = rateOf(weekly);
  document.getElementById("weeklyRate").textContent = wr === null ? "" : `達成率 ${wr}%`;

  const weeklyList = document.getElementById("weeklyList");
  weeklyList.innerHTML = "";
  weekly.forEach((t,i)=>{
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = t.text;
    if(t.done) left.className = "done";
    const right = document.createElement("span");
    right.textContent = t.done ? "〇" : "";
    li.appendChild(left);
    li.appendChild(right);
    li.onclick = ()=>toggle("weekly", i);
    weeklyList.appendChild(li);
  });

  // History - weeks
  const hw = document.getElementById("historyWeeks");
  hw.innerHTML = "";
  const wkeys = listWeeksSorted().slice().reverse(); // newest first
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
      right.textContent = r === null ? "" : `${r}%`;
      li.appendChild(left);
      li.appendChild(right);
      li.onclick = ()=>goWeekFromHistory(k);
      hw.appendChild(li);
    });
  }

  // History - days (last 14 by date)
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
      right.textContent = r === null ? "" : `${r}%`;
      li.appendChild(left);
      li.appendChild(right);
      li.onclick = ()=>{
        alert(`この日(${k})は閲覧のみ（必要なら後で「過去日編集」も追加できる）`);
      };
      hd.appendChild(li);
    });
  }

  // Notification status
  if("Notification" in window){
    setNotifStatus("通知状態: " + Notification.permission);
  } else {
    setNotifStatus("通知状態: 未対応");
  }
}

// ====== PWA ======
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// Run
render();
nightlyNudge();

// ====== Shortcut-friendly deep link ======
// iOSショートカットで「URLを開く」を使うとき：
// https://<あなたのURL>/?open=daily みたいにすると、起動時にそのタブを開く
(function handleDeepLink(){
  const p = new URLSearchParams(location.search);
  const open = p.get("open");
  if(open === "weekly") show("weekly");
  if(open === "history") show("history");
  if(open === "daily") show("daily");
})();
