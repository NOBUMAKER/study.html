/* =========================
   Study Log Pro (app.js) v4
   - Apple-ish task list UI
   - Daily: Auto / Manual separate lists
   - Manual minutes only (no timer)
   - Settings modal works (Save/Close/X)
   - Week tab board renders
   ========================= */

const KEY = "study_pwa_v2";
const TYPES = ["講義","演習","復習","模試","その他"];

const DEFAULT_SETTINGS = {
  examDate: null,              // "YYYY-MM-DD"
  weeklyCapMinutes: 900,       // 週の容量(分) 例: 900=15h
  dayWeights: [1,1,1,1,1,0.7,0.5],
  dailyChunkMin: 60,
  reviewOffsets: [1,3,7,14]
};

const store = loadStore();
function loadStore(){
  let raw=null;
  try{ raw = JSON.parse(localStorage.getItem(KEY)); }catch(e){ raw=null; }
  const s = raw && typeof raw==="object" ? raw : {};
  s.settings = { ...DEFAULT_SETTINGS, ...(s.settings||{}) };

  s.master ||= [];
  s.plan ||= {};    // {day:{auto:[]}}
  s.daily ||= {};   // manual tasks (compat)
  s.weekly ||= {};  // weekly manual (compat)
  s.logs ||= {};    // {day:{studyMin}}

  // v2 dailyTime -> logs
  if(s.dailyTime && typeof s.dailyTime==="object"){
    for(const [d,mins] of Object.entries(s.dailyTime)){
      s.logs[d] ||= { studyMin:0 };
      s.logs[d].studyMin = (s.logs[d].studyMin||0) + (Number(mins)||0);
    }
    delete s.dailyTime;
  }
  return s;
}

function save(){
  localStorage.setItem(KEY, JSON.stringify(store));
  render();
}

// ===== date utils =====
const iso = (d)=> new Date(d).toISOString().slice(0,10);
const todayKey = iso(new Date());

function addDays(isoDate, n){
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate()+n);
  return iso(d);
}
function getMonday(d=new Date()){
  const date = new Date(d);
  const day = date.getDay() || 7;
  if(day!==1) date.setDate(date.getDate()-(day-1));
  date.setHours(12,0,0,0);
  return iso(date);
}
function addMonths(d, n){
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth()+n);
  return x;
}
function weekdayIndex(isoDate){
  const d = new Date(isoDate + "T12:00:00");
  const js = d.getDay(); // Sun..Sat 0..6
  return (js+6)%7; // Mon=0
}
function weekRangeLabel(mondayIso){
  return `${mondayIso} 〜 ${addDays(mondayIso,6)}`;
}
function daysOfWeek(mondayIso){
  return Array.from({length:7}, (_,i)=>addDays(mondayIso,i));
}
function uid(prefix="x"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

// ===== state =====
let selectedDayKey = todayKey;
let selectedWeekKey = getMonday();
let calMonth = new Date(); calMonth.setDate(1);

// ===== tabs =====
function show(view){
  const views = ["daily","weekly","master","calendar","history"];
  for(const id of views){
    const el = document.getElementById(id);
    if(el) el.hidden = (id!==view);
  }
  // sidebar active
  const tabs = [
    ["tabDaily","daily"],
    ["tabWeekly","weekly"],
    ["tabMaster","master"],
    ["tabCalendar","calendar"],
    ["tabHistory","history"],
  ];
  for(const [btnId, v] of tabs){
    const b = document.getElementById(btnId);
    if(b) b.classList.toggle("active", v===view);
  }
  render();
}

// expose for HTML onclick
window.show = show;

function shiftDay(n){ selectedDayKey = addDays(selectedDayKey,n); render(); }
function goToday(){ selectedDayKey = todayKey; render(); }
function shiftWeek(n){ selectedWeekKey = addDays(selectedWeekKey, n*7); render(); }
function goThisWeek(){ selectedWeekKey = getMonday(); render(); }
function shiftMonth(n){ calMonth = addMonths(calMonth, n); render(); }
function goThisMonth(){ calMonth = new Date(); calMonth.setDate(1); render(); }

window.shiftDay=shiftDay; window.goToday=goToday;
window.shiftWeek=shiftWeek; window.goThisWeek=goThisWeek;
window.shiftMonth=shiftMonth; window.goThisMonth=goThisMonth;

// ===== task helpers =====
function getAuto(day){ return store.plan?.[day]?.auto || []; }
function getManual(day){ return store.daily?.[day] || []; }

function rateOf(list){
  if(!list || list.length===0) return null;
  const done = list.filter(t=>t.done).length;
  return Math.round(done/list.length*100);
}

// ===== Apple-ish row builder =====
function checkSvg(){
  return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.2 14.6 3.9 10.3l1.3-1.3 3 3 6.6-6.6 1.3 1.3z"/></svg>`;
}
function makeSectionHead(title, sub, rightText){
  const head = document.createElement("div");
  head.className = "sectionHead";
  head.innerHTML = `
    <div class="left">
      <div class="title">${title}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ``}
    </div>
    <div class="right">${rightText || ""}</div>
  `;
  return head;
}

function renderTaskList(ul, tasks, opts){
  // opts: { kind:"auto"|"manual", day, onToggle(id or idx), onEdit(id), onDelete(id), showMinutes }
  ul.innerHTML = "";

  if(!tasks || tasks.length===0){
    const empty = document.createElement("li");
    empty.className = "taskRow";
    empty.innerHTML = `<div class="taskMain"><div class="taskTitle" style="opacity:.7">—</div></div>`;
    ul.appendChild(empty);
    return;
  }

  tasks.forEach((t, idx)=>{
    const li = document.createElement("li");
    li.className = "taskRow" + (t.done ? " done" : "");
    li.dataset.id = t.id || String(idx);

    const title = opts.kind==="auto" ? t.title : t.text;
    const type = t.type || "その他";
    const mins = t.estMin ?? null;

    li.innerHTML = `
      <button class="taskCheck" aria-label="toggle">
        ${checkSvg()}
      </button>

      <div class="taskMain">
        <div class="taskTitle">${escapeHtml(title)}</div>
        <div class="taskMeta">
          <span class="badgePill badgeType">${escapeHtml(type)}</span>
          ${opts.showMinutes && mins!=null ? `<span class="badgePill badgeMin">${mins}m</span>` : ``}
        </div>
      </div>

      <div class="taskActions">
        <button class="iconMini" title="Edit">✎</button>
        <button class="iconMini danger" title="Delete">🗑</button>
      </div>
    `;

    const btnToggle = li.querySelector(".taskCheck");
    const btnEdit = li.querySelectorAll(".iconMini")[0];
    const btnDel = li.querySelectorAll(".iconMini")[1];

    btnToggle.addEventListener("click", (e)=>{
      e.stopPropagation();
      opts.onToggle(t, idx);
    });

    // row click also toggles (Remindersっぽい)
    li.addEventListener("click", ()=>{
      opts.onToggle(t, idx);
    });

    btnEdit.addEventListener("click", (e)=>{
      e.stopPropagation();
      opts.onEdit(t, idx);
    });

    btnDel.addEventListener("click", (e)=>{
      e.stopPropagation();
      opts.onDelete(t, idx);
    });

    ul.appendChild(li);
  });
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ===== Manual add (Daily) =====
function addManualTask(){
  const text = prompt("タスク内容");
  if(!text) return;
  const type = pickType("演習");
  store.daily[selectedDayKey] ||= [];
  store.daily[selectedDayKey].push({ text, type, done:false });
  save();
}
window.addManualTask = addManualTask;

function pickType(def="演習"){
  const msg =
    "タイプを選んで番号を入力:\n" +
    TYPES.map((t,i)=>`${i+1}) ${t}`).join("\n") +
    `\n\n(空欄なら ${def})`;
  const raw = prompt(msg, "");
  if(!raw) return def;
  const n = parseInt(raw,10);
  if(Number.isFinite(n) && n>=1 && n<=TYPES.length) return TYPES[n-1];
  if(TYPES.includes(raw)) return raw;
  return def;
}

// ===== Auto plan (minimal: keep your existing behavior) =====
function rebuildAuto(){
  // ここでは「割当再計算」ボタン用に、あなたの既存generateを呼ぶだけの口を用意
  if(typeof generateAutoPlan === "function"){
    generateAutoPlan();
  }else{
    alert("自動割当ロジック（generateAutoPlan）がまだ未実装です。");
  }
}
window.rebuildAuto = rebuildAuto;

// ===== Study minutes =====
function getStudyMin(day){
  return Number(store.logs?.[day]?.studyMin || 0);
}
function addMinutes(){
  const el = document.getElementById("minsInput");
  const v = parseInt(el?.value || "0",10) || 0;
  if(el) el.value = "";
  if(v<=0) return;
  store.logs[selectedDayKey] ||= { studyMin:0 };
  store.logs[selectedDayKey].studyMin += v;
  save();
}
function resetDayMinutes(){
  if(!confirm("この日の学習時間を0分にしますか？")) return;
  store.logs[selectedDayKey] ||= { studyMin:0 };
  store.logs[selectedDayKey].studyMin = 0;
  save();
}
window.addMinutes = addMinutes;
window.resetDayMinutes = resetDayMinutes;

// ===== Settings modal =====
function openSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  m.hidden = false;

  document.getElementById("examDateInput").value = store.settings.examDate || "";
  document.getElementById("weeklyCapInput").value = String(store.settings.weeklyCapMinutes ?? 0);
  document.getElementById("reviewOffsetsInput").value = (store.settings.reviewOffsets || [1,3,7,14]).join(",");
}
function closeSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  m.hidden = true;
}
function saveSettings(){
  const exam = document.getElementById("examDateInput").value || "";
  const cap = parseInt(document.getElementById("weeklyCapInput").value || "0",10) || 0;
  const offsRaw = document.getElementById("reviewOffsetsInput").value || "";
  const offs = offsRaw.split(/[,\s]+/).map(x=>parseInt(x,10)).filter(n=>Number.isFinite(n)&&n>0);

  store.settings.examDate = exam || null;
  store.settings.weeklyCapMinutes = Math.max(0, cap);
  store.settings.reviewOffsets = offs.length ? offs : [1,3,7,14];

  save();
  closeSettings();
}
window.openSettings=openSettings;
window.closeSettings=closeSettings;
window.saveSettings=saveSettings;

// header gear
document.addEventListener("DOMContentLoaded", ()=>{
  const btn = document.getElementById("btnSettings");
  if(btn) btn.addEventListener("click", openSettings);
});

// ===== Week auto board =====
function renderWeeklyAutoBoard(){
  const board = document.getElementById("weeklyAutoBoard");
  if(!board) return;

  board.innerHTML = "";
  const days = daysOfWeek(selectedWeekKey);

  days.forEach(day=>{
    const col = document.createElement("div");
    col.className = "boardCol";
    const tasks = getAuto(day);

    const done = tasks.filter(t=>t.done).length;
    const totalMin = tasks.reduce((a,t)=>a+(t.estMin||0),0);

    col.innerHTML = `
      <div class="boardHead">
        <div class="date">${day}</div>
        <div class="meta">${done}/${tasks.length} ・ ${totalMin}m</div>
      </div>
      <ul class="list" id="week_${day}"></ul>
    `;
    board.appendChild(col);

    const ul = col.querySelector("ul");
    renderTaskList(ul, tasks, {
      kind:"auto",
      day,
      showMinutes:true,
      onToggle:(t)=>{ t.done=!t.done; save(); },
      onEdit:(t)=>{
        const v = prompt("タイトル編集", t.title);
        if(v===null || v==="") return;
        t.title = v;
        save();
      },
      onDelete:(t)=>{
        if(!confirm("削除しますか？")) return;
        store.plan[day].auto = store.plan[day].auto.filter(x=>x!==t);
        save();
      }
    });
  });
}

// ===== Calendar (basic) =====
function renderCalendar(){
  const grid = document.getElementById("calendarGrid");
  const lab = document.getElementById("calMonthLabel");
  if(!grid || !lab) return;

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  lab.textContent = `${y}年 ${m+1}月`;

  grid.innerHTML = "";
  const WEEKDAYS = ["月","火","水","木","金","土","日"];
  WEEKDAYS.forEach(w=>{
    const h = document.createElement("div");
    h.className = "calHead";
    h.textContent = w;
    grid.appendChild(h);
  });

  const first = new Date(y,m,1);
  const firstIso = iso(first);
  const jsDay = first.getDay();
  const idx = (jsDay+6)%7;
  const startIso = addDays(firstIso, -idx);

  for(let i=0;i<42;i++){
    const day = addDays(startIso,i);
    const d = new Date(day+"T12:00:00");
    const inMonth = d.getMonth()===m;

    const all = [...getAuto(day), ...getManual(day)];
    const r = rateOf(all);

    const cell = document.createElement("div");
    cell.className = `calCell ${inMonth?"":"outMonth"} ${day===todayKey?"todayRing":""}`;
    cell.style.opacity = inMonth ? "1" : ".45";
    cell.innerHTML = `
      <div class="calTop">
        <span class="calDay">${d.getDate()}</span>
        <span class="calRate">${r==null?"":(r+"%")}</span>
      </div>
      <div class="calRate">${all.length ? `${all.filter(t=>t.done).length}/${all.length}` : ""}</div>
    `;
    cell.addEventListener("click", ()=>{
      selectedDayKey = day;
      show("daily");
    });
    grid.appendChild(cell);
  }
}

// ===== History =====
function renderHistory(){
  const hw = document.getElementById("historyWeeks");
  const hd = document.getElementById("historyDays");
  if(hw){
    hw.innerHTML = "";
    const keys = Object.keys(store.weekly||{}).sort().reverse();
    if(keys.length===0){
      const li = document.createElement("li"); li.textContent="—";
      hw.appendChild(li);
    }else{
      keys.slice(0,20).forEach(k=>{
        const li = document.createElement("li");
        li.className = "taskRow";
        li.innerHTML = `<div class="taskMain"><div class="taskTitle">${weekRangeLabel(k)}</div></div>`;
        li.addEventListener("click", ()=>{ selectedWeekKey=k; show("weekly"); });
        hw.appendChild(li);
      });
    }
  }
  if(hd){
    hd.innerHTML = "";
    const days = new Set([
      ...Object.keys(store.daily||{}),
      ...Object.keys(store.plan||{}),
      ...Object.keys(store.logs||{})
    ]);
    const keys = [...days].sort().reverse().slice(0,14);
    if(keys.length===0){
      const li = document.createElement("li"); li.textContent="—";
      hd.appendChild(li);
    }else{
      keys.forEach(day=>{
        const all = [...getAuto(day), ...getManual(day)];
        const r = rateOf(all);
        const li = document.createElement("li");
        li.className = "taskRow";
        li.innerHTML = `
          <div class="taskMain">
            <div class="taskTitle">${day}</div>
            <div class="taskMeta">${r==null?"":(`達成率 ${r}%`)}</div>
          </div>
          <span class="badgePill">${getStudyMin(day)}m</span>
        `;
        li.addEventListener("click", ()=>{ selectedDayKey=day; show("daily"); });
        hd.appendChild(li);
      });
    }
  }
}

// ===== Render main =====
function render(){
  // countdown
  const cd = document.getElementById("examCountdown");
  if(cd){
    const exam = store.settings.examDate;
    if(!exam){ cd.textContent = "試験日 未設定"; }
    else{
      const diff = Math.ceil((new Date(exam+"T00:00:00").getTime() - new Date(todayKey+"T00:00:00").getTime())/86400000);
      cd.textContent = diff>=0 ? `試験まであと ${diff}日` : `試験日を過ぎています`;
    }
  }

  // daily header
  const dH = document.getElementById("dailyDate");
  if(dH) dH.textContent = selectedDayKey;

  const auto = getAuto(selectedDayKey);
  const manual = getManual(selectedDayKey);

  // daily meta
  const meta = document.getElementById("dailyMeta");
  if(meta){
    const aMin = auto.reduce((a,t)=>a+(t.estMin||0),0);
    const mCnt = manual.length;
    meta.textContent = `自動 ${auto.length}件 / ${aMin}分 ・ 手動 ${mCnt}件 ・ 記録 ${getStudyMin(selectedDayKey)}分`;
  }

  // daily lists (Pro HTML)
  const autoUl = document.getElementById("dailyAutoList");
  const manualUl = document.getElementById("dailyManualList");

  if(autoUl){
    autoUl.parentElement?.querySelector(".sectionHead")?.remove();
    autoUl.parentElement?.insertBefore(
      makeSectionHead("今日の割当（自動）","タップで完了・✎で編集・🗑で削除", `${auto.filter(t=>t.done).length}/${auto.length}`),
      autoUl
    );

    renderTaskList(autoUl, auto, {
      kind:"auto",
      day: selectedDayKey,
      showMinutes:true,
      onToggle:(t)=>{ t.done=!t.done; save(); },
      onEdit:(t)=>{
        const v = prompt("タイトル編集", t.title);
        if(v===null || v==="") return;
        t.title = v;
        save();
      },
      onDelete:(t)=>{
        if(!confirm("削除しますか？")) return;
        store.plan[selectedDayKey].auto = store.plan[selectedDayKey].auto.filter(x=>x!==t);
        save();
      }
    });
  }

  if(manualUl){
    manualUl.parentElement?.querySelectorAll(".sectionHead")[1]?.remove?.();
    // 手動側は上にヘッダ固定がない場合があるので簡易
    renderTaskList(manualUl, manual, {
      kind:"manual",
      day: selectedDayKey,
      showMinutes:false,
      onToggle:(t)=>{ t.done=!t.done; save(); },
      onEdit:(t)=>{
        const v = prompt("内容編集", t.text);
        if(v===null || v==="") return;
        t.text = v;
        // typeも変えたいならここで追加
        save();
      },
      onDelete:(_, idx)=>{
        if(!confirm("削除しますか？")) return;
        store.daily[selectedDayKey].splice(idx,1);
        save();
      }
    });
  }

  // study minutes pill
  const pill = document.getElementById("todayMinutes");
  if(pill) pill.textContent = `${getStudyMin(selectedDayKey)}分`;

  // weekly header
  const wLab = document.getElementById("weekLabel");
  if(wLab) wLab.textContent = weekRangeLabel(selectedWeekKey);

  // weekly KPIs
  const capEl = document.getElementById("weeklyCap");
  const assignedEl = document.getElementById("weeklyAssigned");
  const remainEl = document.getElementById("weeklyRemain");
  if(capEl && assignedEl && remainEl){
    const cap = Number(store.settings.weeklyCapMinutes||0);
    const weekDays = daysOfWeek(selectedWeekKey);
    const assigned = weekDays.reduce((a,d)=>a+getAuto(d).reduce((x,t)=>x+(t.estMin||0),0),0);
    capEl.textContent = `${cap}m`;
    assignedEl.textContent = `${assigned}m`;
    remainEl.textContent = `${Math.max(0, cap-assigned)}m`;
  }

  renderWeeklyAutoBoard();
  renderCalendar();
  renderHistory();
}

// ===== minimal demo / wipe hooks (if your HTML calls them) =====
window.seedDemo = ()=>{
  alert("seedDemoはまだ未実装。必要ならUSCPAテンプレを入れます。");
};
window.wipeAll = ()=>{
  if(!confirm("全データを削除しますか？")) return;
  localStorage.removeItem(KEY);
  location.reload();
};

// ===== run =====
document.addEventListener("DOMContentLoaded", ()=>{
  // ensure default view
  show("daily");
  render();
});
