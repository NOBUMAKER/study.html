/* ===============================
   Study Log Pro - Stable Version
   =============================== */

const KEY = "study_log_pro_v1";

const DEFAULT_SETTINGS = {
  examDate: null,
  weeklyMinutes: 600,
  reviewOffsets: [1,3,7,14]
};

const store = loadStore();

function loadStore(){
  const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
  return {
    settings: {...DEFAULT_SETTINGS, ...(raw.settings||{})},
    master: raw.master || [],
    plan: raw.plan || {},
    manual: raw.manual || {},
    logs: raw.logs || {}
  };
}

function save(){
  localStorage.setItem(KEY, JSON.stringify(store));
  render();
}

function iso(d){ return new Date(d).toISOString().slice(0,10); }
function addDays(d,n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return iso(x);
}

let selectedDay = iso(new Date());

/* ===============================
   SETTINGS
   =============================== */

function openSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  m.hidden = false;

  document.getElementById("examDateInput").value =
    store.settings.examDate || "";

  document.getElementById("weeklyCapInput").value =
    store.settings.weeklyMinutes || "";

  document.getElementById("reviewOffsetsInput").value =
    store.settings.reviewOffsets.join(",");
}

function closeSettings(){
  document.getElementById("settingsModal").hidden = true;
}

function saveSettings(){
  const exam = document.getElementById("examDateInput").value;
  const weekly = parseInt(
    document.getElementById("weeklyCapInput").value || "0"
  );
  const offsets = document.getElementById("reviewOffsetsInput").value
    .split(",")
    .map(x=>parseInt(x.trim()))
    .filter(x=>!isNaN(x));

  store.settings.examDate = exam || null;
  store.settings.weeklyMinutes = weekly;
  store.settings.reviewOffsets = offsets.length?offsets:[1,3,7,14];

  save();
  closeSettings();
}

/* ===============================
   MANUAL TASKS
   =============================== */

function addManualTask(){
  const text = prompt("タスク内容");
  if(!text) return;

  store.manual[selectedDay] ||= [];
  store.manual[selectedDay].push({
    id: Date.now(),
    text,
    done:false
  });
  save();
}

function toggleManual(id){
  const list = store.manual[selectedDay]||[];
  const t = list.find(x=>x.id===id);
  if(!t) return;
  t.done = !t.done;
  save();
}

/* ===============================
   STUDY TIME
   =============================== */

function addMinutes(){
  const input = document.getElementById("minsInput");
  const mins = parseInt(input.value||"0");
  if(!mins) return;

  store.logs[selectedDay] ||= {minutes:0};
  store.logs[selectedDay].minutes += mins;
  input.value="";
  save();
}

function resetDayMinutes(){
  store.logs[selectedDay] = {minutes:0};
  save();
}

/* ===============================
   AUTO PLAN (simple version)
   =============================== */

function rebuildAuto(){
  if(!store.settings.examDate){
    alert("試験日を設定してください");
    return;
  }

  store.plan = {};
  const today = iso(new Date());
  const exam = store.settings.examDate;

  let d = today;
  const totalDays =
    (new Date(exam) - new Date(today)) / (1000*60*60*24);

  if(totalDays<=0) return;

  const perDay =
    Math.floor(store.settings.weeklyMinutes/7);

  while(d<=exam){
    store.plan[d] = [{
      id: Date.now()+Math.random(),
      title:"自動割当学習",
      estMin: perDay,
      done:false
    }];
    d = addDays(d,1);
  }

  save();
}

/* ===============================
   RENDER
   =============================== */

function render(){
  document.getElementById("dailyDate").textContent =
    selectedDay;

  // study time
  const mins =
    store.logs[selectedDay]?.minutes || 0;
  document.getElementById("todayMinutes").textContent =
    "学習時間 "+mins+"分";

  // auto
  const autoList = document.getElementById("dailyAutoList");
  autoList.innerHTML="";
  const auto = store.plan[selectedDay]||[];
  auto.forEach(t=>{
    const li = document.createElement("li");
    li.textContent =
      t.title+" ("+t.estMin+"m)";
    if(t.done) li.style.textDecoration="line-through";
    li.onclick=()=>{
      t.done=!t.done;
      save();
    };
    autoList.appendChild(li);
  });

  // manual
  const manList =
    document.getElementById("dailyManualList");
  manList.innerHTML="";
  const manual = store.manual[selectedDay]||[];
  manual.forEach(t=>{
    const li = document.createElement("li");
    li.textContent = t.text;
    if(t.done) li.style.textDecoration="line-through";
    li.onclick=()=>toggleManual(t.id);
    manList.appendChild(li);
  });
}

/* ===============================
   NAVIGATION
   =============================== */

function shiftDay(n){
  selectedDay = addDays(selectedDay,n);
  render();
}
function goToday(){
  selectedDay = iso(new Date());
  render();
}

/* ===============================
   INITIALIZE
   =============================== */

document.addEventListener("DOMContentLoaded",()=>{
  const btn = document.getElementById("btnSettings");
  if(btn) btn.onclick=openSettings;
  render();
});

/* ===============================
   EXPOSE
   =============================== */

window.openSettings=openSettings;
window.closeSettings=closeSettings;
window.saveSettings=saveSettings;
window.addManualTask=addManualTask;
window.addMinutes=addMinutes;
window.resetDayMinutes=resetDayMinutes;
window.rebuildAuto=rebuildAuto;
window.shiftDay=shiftDay;
window.goToday=goToday;
