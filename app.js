// ===============================
// Study Log Pro (USCPA)
// - Master tasks with est minutes
// - Auto allocation by weekly capacity
// - Daily shows Auto vs Manual separately
// - Manual minutes logging (no timer)
// - Spaced repetition reviews (1/3/7/14 days)
// ===============================

const KEY = "study_pwa_pro_v1";
const TYPES = ["講義","演習","復習","模試","その他"];

const DEFAULTS = {
  settings: {
    examDate: "",            // "YYYY-MM-DD"
    weeklyCapacityMins: 900, // 15h
    reviewOffsets: [1,3,7,14],
  },
  master: [],       // [{id,text,type,estMins,done,createdAt,doneAt}]
  daily: {},        // "YYYY-MM-DD": { auto: [taskId], manual: [task], mins: number }
  autoPlan: {},     // "YYYY-MM-DD": [taskId]  // computed cache
};

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// ---- storage ----
function load(){
  const raw = localStorage.getItem(KEY);
  if(raw){
    try { return JSON.parse(raw); } catch(e){}
  }
  // try migrate from your old KEY "study_pwa_v2"
  const old = localStorage.getItem("study_pwa_v2");
  if(old){
    try{
      const o = JSON.parse(old);
      const s = structuredClone(DEFAULTS);

      // migrate minutes
      if(o.dailyTime){
        Object.keys(o.dailyTime).forEach(d=>{
          s.daily[d] ||= { auto:[], manual:[], mins:0 };
          s.daily[d].mins = o.dailyTime[d] || 0;
        });
      }

      // migrate daily tasks into manual (keep type/done)
      if(o.daily){
        Object.keys(o.daily).forEach(d=>{
          s.daily[d] ||= { auto:[], manual:[], mins:0 };
          const list = o.daily[d] || [];
          list.forEach(t=>{
            s.daily[d].manual.push({
              id: uid(),
              text: t.text,
              type: t.type || "その他",
              estMins: null,
              done: !!t.done,
              createdAt: Date.now()
            });
          });
        });
      }

      // (weekly old tasks are ignored in this new model)
      save(s);
      return s;
    }catch(e){}
  }

  const s = structuredClone(DEFAULTS);
  // set exam date default: 90 days later (optional)
  save(s);
  return s;
}

let store = load();

function save(nextStore = store){
  store = nextStore;
  localStorage.setItem(KEY, JSON.stringify(store));
  render();
}

// ---- date utils ----
const iso = (d)=> new Date(d).toISOString().slice(0,10);

function todayKey(){
  return iso(new Date());
}

function addDays(isoDate, n){
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
}

function getMonday(d = new Date()){
  const date = new Date(d);
  const day = date.getDay() || 7; // Sun=7
  if(day !== 1) date.setDate(date.getDate() - (day - 1));
  date.setHours(12,0,0,0);
  return iso(date);
}

function weekRangeLabel(mondayIso){
  return `${mondayIso} 〜 ${addDays(mondayIso, 6)}`;
}

// ---- state ----
let selectedDayKey = todayKey();
let selectedWeekKey = getMonday();
let calMonth = new Date(); calMonth.setDate(1);

// ---- views ----
function setActiveTab(view){
  const map = { daily:"Daily", weekly:"Weekly", master:"Master", calendar:"Calendar", history:"History" };
  Object.values(map).forEach(name=>{
    const el = document.getElementById("tab"+name);
    if(!el) return;
    el.classList.toggle("active", map[view] === name);
  });
}
function show(view){
  ["daily","weekly","master","calendar","history"].forEach(v=>{
    const el = document.getElementById(v);
    if(el) el.hidden = (v !== view);
  });
  setActiveTab(view);
  render();
}
window.show = show;

function shiftDay(delta){
  selectedDayKey = addDays(selectedDayKey, delta);
  render();
}
function goToday(){
  selectedDayKey = todayKey();
  render();
}
window.shiftDay = shiftDay;
window.goToday = goToday;

function shiftWeek(delta){
  selectedWeekKey = addDays(selectedWeekKey, delta*7);
  render();
}
function goThisWeek(){
  selectedWeekKey = getMonday();
  render();
}
window.shiftWeek = shiftWeek;
window.goThisWeek = goThisWeek;

function shiftMonth(delta){
  const x = new Date(calMonth);
  x.setDate(1);
  x.setMonth(x.getMonth() + delta);
  calMonth = x;
  render();
}
function goThisMonth(){
  calMonth = new Date(); calMonth.setDate(1);
  render();
}
window.shiftMonth = shiftMonth;
window.goThisMonth = goThisMonth;

// ---- task helpers ----
function ensureDay(d){
  store.daily[d] ||= { auto:[], manual:[], mins:0 };
  return store.daily[d];
}

function rateOfTasks(tasks){
  if(!tasks || tasks.length === 0) return null;
  const done = tasks.filter(t=>t.done).length;
  return Math.round(done / tasks.length * 100);
}

function heatClass(rate){
  if(rate === null) return "r0";
  if(rate === 0) return "r0";
  if(rate < 50) return "r1";
  if(rate < 80) return "r2";
  return "r3";
}

// ---- settings ----
function openSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  document.getElementById("examDateInput").value = store.settings.examDate || "";
  document.getElementById("weeklyCapInput").value = String(store.settings.weeklyCapacityMins || 0);
  document.getElementById("reviewOffsetsInput").value = (store.settings.reviewOffsets || [1,3,7,14]).join(",");
  m.hidden = false;
}
function closeSettings(){
  const m = document.getElementById("settingsModal");
  if(m) m.hidden = true;
}
function saveSettings(){
  const examDate = (document.getElementById("examDateInput").value || "").trim();
  const cap = parseInt(document.getElementById("weeklyCapInput").value, 10);
  const offs = (document.getElementById("reviewOffsetsInput").value || "1,3,7,14")
    .split(",")
    .map(s=>parseInt(s.trim(),10))
    .filter(n=>Number.isFinite(n) && n>0);

  store.settings.examDate = examDate;
  store.settings.weeklyCapacityMins = Number.isFinite(cap) ? cap : store.settings.weeklyCapacityMins;
  store.settings.reviewOffsets = offs.length ? offs : [1,3,7,14];

  closeSettings();
  rebuildAuto(true);
}
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;

// header settings btn
document.addEventListener("click", (e)=>{
  if(e.target && e.target.id === "btnSettings") openSettings();
});

// ---- minutes (manual) ----
function addMinutes(){
  const inp = document.getElementById("minsInput");
  const v = parseInt((inp?.value||"").trim(), 10);
  if(!Number.isFinite(v) || v<=0) return alert("分数を正しく入力してね（例: 90）");
  const day = ensureDay(selectedDayKey);
  day.mins = (day.mins || 0) + v;
  if(inp) inp.value = "";
  save();
}
function resetDayMinutes(){
  if(!confirm("この日の学習時間を0分にしますか？")) return;
  const day = ensureDay(selectedDayKey);
  day.mins = 0;
  save();
}
window.addMinutes = addMinutes;
window.resetDayMinutes = resetDayMinutes;

// ---- master tasks ----
function addMasterTask(){
  const text = prompt("マスタータスク（例: FAR Unit 3 MCQ 1周）");
  if(!text) return;

  const type = pickType("演習");
  const est = parseInt(prompt("推定時間（分） 例: 120"), 10);
  const estMins = Number.isFinite(est) && est>0 ? est : 60;

  store.master.push({
    id: uid(),
    text,
    type,
    estMins,
    done:false,
    createdAt: Date.now(),
    doneAt: null
  });
  save();
  rebuildAuto(true);
}
window.addMasterTask = addMasterTask;

function pickType(defaultType="演習"){
  const msg =
    "タイプ番号を入力:\n" +
    TYPES.map((t,i)=>`${i+1}) ${t}`).join("\n") +
    `\n\n(空欄なら ${defaultType})`;
  const raw = prompt(msg, "");
  const n = parseInt(raw, 10);
  if(!raw) return defaultType;
  if(Number.isFinite(n) && n>=1 && n<=TYPES.length) return TYPES[n-1];
  if(TYPES.includes(raw)) return raw;
  return defaultType;
}

function editMasterTask(id){
  const t = store.master.find(x=>x.id===id);
  if(!t) return;
  const text = prompt("タスク名", t.text);
  if(!text) return;
  const est = parseInt(prompt("推定時間（分）", String(t.estMins||60)), 10);
  const type = pickType(t.type || "演習");

  t.text = text;
  t.type = type;
  t.estMins = Number.isFinite(est) && est>0 ? est : (t.estMins||60);

  save();
  rebuildAuto(true);
}

function deleteMasterTask(id){
  if(!confirm("このマスタータスクを削除しますか？")) return;
  store.master = store.master.filter(x=>x.id!==id);
  // remove from plans
  Object.keys(store.autoPlan||{}).forEach(d=>{
    store.autoPlan[d] = (store.autoPlan[d]||[]).filter(tid=>tid!==id);
  });
  Object.keys(store.daily||{}).forEach(d=>{
    store.daily[d].auto = (store.daily[d].auto||[]).filter(tid=>tid!==id);
  });
  save();
  rebuildAuto(true);
}

function toggleMasterDone(id){
  const t = store.master.find(x=>x.id===id);
  if(!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;

  // when completing non-review task, schedule reviews automatically
  if(t.done && t.type !== "復習"){
    createReviewTasksFrom(t, selectedDayKey);
  }
  save();
  rebuildAuto(true);
}

// ---- daily manual tasks ----
function addManualTask(){
  const text = prompt("今日の手動タスク");
  if(!text) return;
  const type = pickType("その他");
  const est = parseInt(prompt("推定時間（分） 任意（空欄OK）"), 10);
  const estMins = Number.isFinite(est) && est>0 ? est : null;

  const day = ensureDay(selectedDayKey);
  day.manual.push({
    id: uid(),
    text, type, estMins,
    done:false,
    createdAt: Date.now()
  });
  save();
}
window.addManualTask = addManualTask;

function toggleManualTask(dayKey, id){
  const day = ensureDay(dayKey);
  const t = day.manual.find(x=>x.id===id);
  if(!t) return;
  t.done = !t.done;

  // if manual task is learning, schedule reviews
  if(t.done && t.type !== "復習"){
    createReviewTasksFrom({ text:t.text, type:t.type }, dayKey);
  }
  save();
  rebuildAuto(true);
}

function editManualTask(dayKey, id){
  const day = ensureDay(dayKey);
  const t = day.manual.find(x=>x.id===id);
  if(!t) return;
  const text = prompt("内容", t.text);
  if(!text) return;
  const type = pickType(t.type||"その他");
  const est = prompt("推定時間（分） 空欄で未設定", t.estMins==null ? "" : String(t.estMins));
  const n = parseInt((est||"").trim(), 10);

  t.text = text;
  t.type = type;
  t.estMins = Number.isFinite(n) && n>0 ? n : null;
  save();
}

function deleteManualTask(dayKey, id){
  if(!confirm("この手動タスクを削除しますか？")) return;
  const day = ensureDay(dayKey);
  day.manual = day.manual.filter(x=>x.id!==id);
  save();
}

// ---- reviews (spaced repetition) ----
function createReviewTasksFrom(sourceTask, baseDayKey){
  const offsets = store.settings.reviewOffsets || [1,3,7,14];
  offsets.forEach(off=>{
    const dayKey = addDays(baseDayKey, off);
    const day = ensureDay(dayKey);
    // add as auto review "manual" (so user can edit)
    day.manual.push({
      id: uid(),
      text: `復習: ${sourceTask.text}`,
      type: "復習",
      estMins: 15,
      done:false,
      createdAt: Date.now(),
      _reviewOf: sourceTask.id || null,
      _reviewOffset: off
    });
  });
}

// ---- auto allocation engine ----
// Strategy:
// - take all master tasks not done
// - allocate by weeklyCapacity across days starting from this week Monday
// - fill each day with tasks until daily cap (weekly/7)
// - store.autoPlan[day] = [taskId...]
// - user can delete/edit per day by editing master or removing from day's auto list
function rebuildAuto(silent=false){
 
