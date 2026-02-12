/* ==========================================================
   Study Log Pro (app.js) v4  — 全置き換え版
   ✅ 自動割当なし
   ✅ Master → 今週へ追加（選択して積む）
   ✅ 今週タスク → 今日以降に一括振り分け（ボタン）
   ✅ 週タスク：一括完了 / 一括削除（選択があれば選択だけ、なければ全て）
   ✅ 今日：Week由来タスク と 手動タスク を別表示
   ✅ 復習のタイミング：何回目の復習か表示（1回目/2回目…）
   ✅ データは localStorage に保持（改善しても消えにくい：KEY固定 + マイグレーション）
   ========================================================== */

const KEY = "study_log_pro_v4";        // ★ここは変えない（データ保持の要）
const TYPES = ["講義","演習","復習","模試","その他"];

const DEFAULT_SETTINGS = {
  examDate: null,              // "YYYY-MM-DD"
  weeklyCapMinutes: 900,       // 週の学習可能時間（分）※表示用
  reviewOffsets: [1,3,7,14],   // 復習オフセット（日）
};

const store = loadStore();

// ---------- Storage ----------
function loadStore(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch(e){ raw = null; }
  const s = raw && typeof raw === "object" ? raw : {};
  s._v ||= 4;

  // legacy互換（あなたが以前使ってたKEYから移行したい場合だけ）
  // 旧KEYがあるなら初回だけ取り込む（消さない）
  const legacyKeys = ["study_pwa_v2","study_log_pro"];
  for(const lk of legacyKeys){
    if(!localStorage.getItem(KEY) && localStorage.getItem(lk)){
      try{
        const old = JSON.parse(localStorage.getItem(lk));
        if(old && typeof old === "object"){
          // ざっくり移植
          s.daily ||= old.daily || {};
          s.weekly ||= old.weekly || {};
          s.master ||= old.master || [];
          s.logs ||= old.logs || {};
          s.settings ||= old.settings || {};
        }
      }catch(e){}
    }
  }

  s.settings ||= {};
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };

  s.daily ||= {};   // {"YYYY-MM-DD": [{id,text,type,done,origin,createdAt,doneAt}]}
  s.weekly ||= {};  // {"YYYY-MM-DD(monday)": {tasks:[...]}}
  s.master ||= [];  // [{id,title,type,estMin,done,createdAt}]
  s.logs ||= {};    // {"YYYY-MM-DD": {studyMin:number}}

  return s;
}

function saveStore(){
  localStorage.setItem(KEY, JSON.stringify(store));
}

// ---------- Date utils ----------
const iso = (d) => new Date(d).toISOString().slice(0,10);

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

function addMonths(d, n){
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
}

function weekRangeLabel(mondayIso){
  return `${mondayIso} 〜 ${addDays(mondayIso, 6)}`;
}

function daysOfWeek(mondayIso){
  return Array.from({length:7}, (_,i)=>addDays(mondayIso, i));
}

function uid(prefix="t"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function sameWeek(dayIso, mondayIso){
  return getMonday(new Date(dayIso + "T12:00:00")) === mondayIso;
}

// ---------- State ----------
const todayKey = iso(new Date());
let selectedDayKey = todayKey;
let selectedWeekKey = getMonday();
let calMonth = new Date(); calMonth.setDate(1);

store.weekly[selectedWeekKey] ||= { tasks: [] };

// ---------- Helpers ----------
function getStudyMin(dayIso){
  return Number(store.logs?.[dayIso]?.studyMin || 0) || 0;
}
function setStudyMin(dayIso, mins){
  store.logs ||= {};
  store.logs[dayIso] ||= { studyMin: 0 };
  store.logs[dayIso].studyMin = Math.max(0, mins|0);
}

function getDailyTasks(dayIso){
  store.daily[dayIso] ||= [];
  return store.daily[dayIso];
}

function getWeekTasks(weekKey){
  store.weekly[weekKey] ||= { tasks: [] };
  store.weekly[weekKey].tasks ||= [];
  return store.weekly[weekKey].tasks;
}

function rateOf(list){
  if(!list || list.length === 0) return null;
  const done = list.filter(x=>x.done).length;
  return Math.round(done / list.length * 100);
}

function heatClass(rate){
  if(rate === null) return "r0";
  if(rate === 0) return "r0";
  if(rate < 50) return "r1";
  if(rate < 80) return "r2";
  return "r3";
}

function parseOffsetsInput(v){
  if(!v) return [...DEFAULT_SETTINGS.reviewOffsets];
  return String(v)
    .split(/[,\s]+/)
    .map(x=>parseInt(x,10))
    .filter(n=>Number.isFinite(n) && n>0)
    .slice(0, 20);
}

// ---------- Tabs ----------
function setActiveTab(name){
  // Pro HTMLは tabDaily/tabWeekly/tabMaster/tabCalendar/tabHistory
  ["Daily","Weekly","Master","Calendar","History"].forEach(x=>{
    const b = document.getElementById("tab"+x);
    if(!b) return;
    b.classList.toggle("active", x.toLowerCase() === name);
  });
}

function show(view){
  ["daily","weekly","master","calendar","history"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.hidden = (id !== view);
  });
  setActiveTab(view);
  render();
}

// ---------- Navigation ----------
function shiftDay(delta){ selectedDayKey = addDays(selectedDayKey, delta); render(); }
function goToday(){ selectedDayKey = todayKey; render(); }

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

function shiftMonth(delta){ calMonth = addMonths(calMonth, delta); render(); }
function goThisMonth(){ calMonth = new Date(); calMonth.setDate(1); render(); }

// ---------- Daily: add/toggle/delete ----------
function addManualTask(){
  const text = prompt("今日の手動タスク（内容）");
  if(!text) return;
  const type = pickType("演習");
  const t = {
    id: uid("d"),
    text,
    type,
    done: false,
    origin: "manual",         // manual / week
    createdAt: iso(new Date()),
    doneAt: null
  };
  getDailyTasks(selectedDayKey).push(t);
  saveAndRender();
}

function toggleDaily(id){
  const list = getDailyTasks(selectedDayKey);
  const t = list.find(x=>x.id===id);
  if(!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? selectedDayKey : null;
  saveAndRender();
}

function editDaily(id){
  const list = getDailyTasks(selectedDayKey);
  const t = list.find(x=>x.id===id);
  if(!t) return;
  const v = prompt("編集", t.text);
  if(v===null) return;
  t.text = v.trim() || t.text;
  saveAndRender();
}

function deleteDaily(id){
  if(!confirm("削除しますか？")) return;
  store.daily[selectedDayKey] = getDailyTasks(selectedDayKey).filter(x=>x.id!==id);
  saveAndRender();
}

// ---------- Weekly: add/toggle/delete + selection ----------
function addWeekTask(){
  const text = prompt("今週タスク（内容）");
  if(!text) return;
  const type = pickType("演習");
  const t = {
    id: uid("w"),
    text,
    type,
    done: false,
    createdAt: iso(new Date()),
    doneAt: null,
    selected: false,
    fromMasterId: null,
  };
  getWeekTasks(selectedWeekKey).push(t);
  saveAndRender();
}

function toggleWeek(id){
  const list = getWeekTasks(selectedWeekKey);
  const t = list.find(x=>x.id===id);
  if(!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? iso(new Date()) : null;
  saveAndRender();
}

function editWeek(id){
  const list = getWeekTasks(selectedWeekKey);
  const t = list.find(x=>x.id===id);
  if(!t) return;
  const v = prompt("編集", t.text);
  if(v===null) return;
  t.text = v.trim() || t.text;
  saveAndRender();
}

function deleteWeek(id){
  if(!confirm("削除しますか？")) return;
  store.weekly[selectedWeekKey].tasks = getWeekTasks(selectedWeekKey).filter(x=>x.id!==id);
  saveAndRender();
}

function setWeekSelected(id, yes){
  const t = getWeekTasks(selectedWeekKey).find(x=>x.id===id);
  if(!t) return;
  t.selected = !!yes;
  saveAndRender(false);
}

// 一括完了 / 削除（選択があれば選択だけ、なければ全）
function bulkCompleteWeek(){
  const list = getWeekTasks(selectedWeekKey);
  const picked = list.some(x=>x.selected) ? list.filter(x=>x.selected) : list;
  if(picked.length===0) return;
  picked.forEach(t=>{
    t.done = true;
    t.doneAt = iso(new Date());
    t.selected = false;
  });
  saveAndRender();
}

function bulkDeleteWeek(){
  const list = getWeekTasks(selectedWeekKey);
  const hasSel = list.some(x=>x.selected);
  const targetCount = hasSel ? list.filter(x=>x.selected).length : list.length;
  if(targetCount===0) return;
  if(!confirm(`削除しますか？（${targetCount}件）`)) return;

  store.weekly[selectedWeekKey].tasks = hasSel ? list.filter(x=>!x.selected) : [];
  saveAndRender();
}

// 今週タスク → 今日以降に振り分け（未完了だけ）
function bulkMoveWeekToToday(){
  const weekTasks = getWeekTasks(selectedWeekKey);
  const pool = weekTasks.filter(t=>!t.done);

  if(pool.length===0){
    alert("未完了の今週タスクがありません。");
    return;
  }

  // 今日がこの週に含まれるなら今日から、違う週ならその週の月曜から
  const start = sameWeek(todayKey, selectedWeekKey) ? todayKey : selectedWeekKey;

  const days = daysOfWeek(selectedWeekKey).filter(d=>d >= start);
  if(days.length===0){
    alert("振り分け先の日がありません。");
    return;
  }

  // round-robinで日割り
  let i = 0;
  for(const t of pool){
    const day = days[i % days.length];
    const dTask = {
      id: uid("d"),
      text: t.text,
      type: t.type,
      done: false,
      origin: "week",
      createdAt: iso(new Date()),
      doneAt: null,
      fromWeekId: t.id,
      fromMasterId: t.fromMasterId || null
    };
    getDailyTasks(day).push(dTask);
    i++;
  }

  // 今週側は、移したものを削除（※残したいならここを done=true にする運用もOK）
  store.weekly[selectedWeekKey].tasks = weekTasks.filter(t=>t.done);

  saveAndRender();
  alert(`今週タスクを ${days[0]} 以降に振り分けました（${pool.length}件）`);
}

// ---------- Master: add/toggle/delete + pick to week ----------
function addMasterTask(){
  const title = prompt("Masterタスク名（例: FAR Ch 5 講義）");
  if(!title) return;
  const type = pickType("講義");

  const est = prompt("推定時間（分・任意）", "60");
  const estMin = Math.max(0, parseInt(est||"0",10) || 0);

  const m = {
    id: uid("m"),
    title: title.trim(),
    type,
    estMin,
    done: false,
    createdAt: iso(new Date()),
    selected: false
  };
  store.master.push(m);
  saveAndRender();
}

function setMasterSelected(id, yes){
  const m = store.master.find(x=>x.id===id);
  if(!m) return;
  m.selected = !!yes;
  saveAndRender(false);
}

function toggleMasterDone(id){
  const m = store.master.find(x=>x.id===id);
  if(!m) return;
  m.done = !m.done;
  saveAndRender();
}

function editMaster(id){
  const m = store.master.find(x=>x.id===id);
  if(!m) return;

  const v = prompt("タイトル編集", m.title);
  if(v===null) return;
  m.title = v.trim() || m.title;

  const est = prompt("推定時間（分・任意）", String(m.estMin||0));
  if(est!==null){
    m.estMin = Math.max(0, parseInt(est||"0",10) || 0);
  }

  m.type = pickType(m.type || "講義");
  saveAndRender();
}

function deleteMaster(id){
  if(!confirm("Masterタスクを削除しますか？")) return;
  store.master = store.master.filter(x=>x.id!==id);
  saveAndRender();
}

// Masterから今週へ追加（選択UI：画面上のチェックでも、promptでもOK）
function openWeeklyPickMaster(){
  // 1) 画面上チェックがあればそれを優先
  const selected = store.master.filter(m=>m.selected && !m.done);

  if(selected.length===0){
    // 2) promptで番号選択
    const open = store.master.filter(m=>!m.done);
    if(open.length===0){
      alert("未完了のMasterがありません。");
      return;
    }
    const lines = open.map((m,i)=>`${i+1}) [${m.type}] ${m.title}${m.estMin?` (${m.estMin}m)`:``}`).join("\n");
    const raw = prompt(`今週に積むMasterを選択（例: 1,3,5）\n\n${lines}`, "");
    if(!raw) return;
    const idxs = raw.split(/[,\s]+/).map(x=>parseInt(x,10)-1).filter(i=>Number.isFinite(i) && i>=0 && i<open.length);
    if(idxs.length===0) return;
    idxs.forEach(i=>open[i].selected = true);
  }

  const pick = store.master.filter(m=>m.selected && !m.done);
  if(pick.length===0) return;

  const weekTasks = getWeekTasks(selectedWeekKey);
  pick.forEach(m=>{
    weekTasks.push({
      id: uid("w"),
      text: m.title,
      type: m.type,
      done: false,
      createdAt: iso(new Date()),
      doneAt: null,
      selected: false,
      fromMasterId: m.id
    });
    m.selected = false; // 解除
  });

  saveAndRender();
}

// ---------- Study minutes (manual) ----------
function addMinutes(){
  const el = document.getElementById("minsInput");
  const v = parseInt(el?.value || "0", 10) || 0;
  if(el) el.value = "";
  if(v<=0) return;

  setStudyMin(selectedDayKey, getStudyMin(selectedDayKey) + v);
  saveAndRender();
}

function resetDayMinutes(){
  if(!confirm("今日の学習時間を0分にしますか？")) return;
  setStudyMin(selectedDayKey, 0);
  saveAndRender();
}

// ---------- Settings modal ----------
function openSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  m.hidden = false;

  const examEl = document.getElementById("examDateInput");
  const capEl  = document.getElementById("weeklyCapInput");
  const offEl  = document.getElementById("reviewOffsetsInput");

  if(examEl) examEl.value = store.settings.examDate || "";
  if(capEl)  capEl.value  = String(store.settings.weeklyCapMinutes ?? DEFAULT_SETTINGS.weeklyCapMinutes);
  if(offEl)  offEl.value  = (store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets).join(",");

  setTimeout(()=>examEl?.focus?.(), 0);
}

function closeSettings(){
  const m = document.getElementById("settingsModal");
  if(!m) return;
  m.hidden = true;
}

function saveSettings(){
  const examEl = document.getElementById("examDateInput");
  const capEl  = document.getElementById("weeklyCapInput");
  const offEl  = document.getElementById("reviewOffsetsInput");

  const exam = examEl?.value || "";
  const cap  = Math.max(0, parseInt(capEl?.value || "0", 10) || 0);
  const offs = parseOffsetsInput(offEl?.value || "");

  if(exam) store.settings.examDate = exam;
  store.settings.weeklyCapMinutes = cap;
  store.settings.reviewOffsets = offs;

  saveAndRender();
  closeSettings();
}

// ---------- Review timing (表示だけ：今日分) ----------
function buildTodayReviews(dayIso){
  const offs = store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets;
  const out = [];

  // doneAtが入ってる日次タスク（講義/演習）を起点にする
  const allDays = Object.keys(store.daily).sort();
  for(const d of allDays){
    const list = store.daily[d] || [];
    for(const t of list){
      if(!t.done || !t.doneAt) continue;
      if(t.type !== "講義" && t.type !== "演習") continue;

      offs.forEach((k, idx)=>{
        const due = addDays(t.doneAt, k);
        if(due !== dayIso) return;
        out.push({
          id: `${t.id}_r${idx+1}`,
          title: `復習（${idx+1}回目 / ${offs.length}）: ${t.text}`,
          n: idx+1,
          total: offs.length,
          sourceId: t.id
        });
      });
    }
  }
  return out;
}

// ---------- Calendar ----------
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
  const jsDay = first.getDay();     // 0 Sun .. 6 Sat
  const idx = (jsDay + 6) % 7;      // Mon=0..Sun=6
  const startIso = addDays(firstIso, -idx);

  for(let i=0;i<42;i++){
    const dayIso = addDays(startIso, i);
    const d = new Date(dayIso + "T12:00:00");
    const inMonth = d.getMonth() === m;

    const tasks = getDailyTasks(dayIso);
    const r = rateOf(tasks);

    const cell = document.createElement("div");
    cell.className = `calCell ${heatClass(r)} ${inMonth?"":"outMonth"} ${dayIso===todayKey?"todayRing":""}`;

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
    const done = tasks.filter(t=>t.done).length;
    bottom.textContent = tasks.length ? `${done}/${tasks.length}` : "";

    cell.appendChild(top);
    cell.appendChild(bottom);
    cell.onclick = ()=>{ selectedDayKey = dayIso; show("daily"); };

    grid.appendChild(cell);
  }
}

// ---------- UI helpers ----------
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

function el(id){ return document.getElementById(id); }

function renderListItem({text, done, onToggle, onEdit, onDelete, checkbox, onSelect}){
  const li = document.createElement("li");
  li.className = "row between";

  const left = document.createElement("div");
  left.className = "row gap8";
  left.style.alignItems = "center";

  if(checkbox){
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checkbox.checked;
    cb.addEventListener("click", (e)=>{ e.stopPropagation(); onSelect?.(cb.checked); });
    left.appendChild(cb);
  }

  const span = document.createElement("span");
  span.textContent = text;
  if(done) span.classList.add("done");
  left.appendChild(span);

  const right = document.createElement("div");
  right.className = "row gap8";

  const bEdit = document.createElement("button");
  bEdit.className = "iconBtn";
  bEdit.textContent = "✎";
  bEdit.title = "編集";
  bEdit.addEventListener("click", (e)=>{ e.stopPropagation(); onEdit?.(); });

  const bDel = document.createElement("button");
  bDel.className = "iconBtn";
  bDel.textContent = "🗑";
  bDel.title = "削除";
  bDel.addEventListener("click", (e)=>{ e.stopPropagation(); onDelete?.(); });

  right.appendChild(bEdit);
  right.appendChild(bDel);

  li.appendChild(left);
  li.appendChild(right);

  li.addEventListener("click", ()=>onToggle?.());

  return li;
}

// ---------- Render ----------
function render(){
  // header countdown
  renderExamCountdown();

  // DAILY
  el("dailyDate") && (el("dailyDate").textContent = selectedDayKey);

  const list = getDailyTasks(selectedDayKey);
  const weekOnToday = list.filter(t=>t.origin==="week");
  const manualToday = list.filter(t=>t.origin!=="week");

  renderDailyLists(weekOnToday, manualToday);
  renderTodayMinutes();

  // reviews
  renderTodayReview();

  // WEEKLY
  renderWeekly();

  // MASTER
  renderMaster();

  // CALENDAR
  renderCalendar();

  // HISTORY
  renderHistory();
}

function renderExamCountdown(){
  const pill = el("examCountdown");
  if(!pill) return;

  const ex = store.settings.examDate;
  if(!ex){
    pill.textContent = "Exam: —";
    return;
  }
  const now = new Date(todayKey + "T00:00:00");
  const exam = new Date(ex + "T00:00:00");
  const diff = Math.ceil((exam - now) / (1000*60*60*24));
  pill.textContent = diff >= 0 ? `Exam: ${diff} days` : `Exam: passed`;
}

function renderDailyLists(weekTasks, manualTasks){
  const autoUl = el("dailyAutoList");
  const manUl  = el("dailyManualList");

  if(autoUl){
    autoUl.innerHTML = "";
    if(weekTasks.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "（今週から振り分けたタスクはまだありません）";
      autoUl.appendChild(li);
    }else{
      weekTasks.forEach(t=>{
        autoUl.appendChild(renderListItem({
          text:`【${t.type}】 ${t.text}`,
          done:t.done,
          onToggle:()=>toggleDaily(t.id),
          onEdit:()=>editDaily(t.id),
          onDelete:()=>deleteDaily(t.id),
        }));
      });
    }
  }

  if(manUl){
    manUl.innerHTML = "";
    if(manualTasks.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "（手動タスクはまだありません）";
      manUl.appendChild(li);
    }else{
      manualTasks.forEach(t=>{
        manUl.appendChild(renderListItem({
          text:`【${t.type}】 ${t.text}`,
          done:t.done,
          onToggle:()=>toggleDaily(t.id),
          onEdit:()=>editDaily(t.id),
          onDelete:()=>deleteDaily(t.id),
        }));
      });
    }
  }

  const meta = el("dailyMeta");
  if(meta){
    const r = rateOf(listAllForMeta(selectedDayKey));
    const done = listAllForMeta(selectedDayKey).filter(t=>t.done).length;
    const total = listAllForMeta(selectedDayKey).length;
    meta.textContent = total ? `達成率 ${r}%（${done}/${total}）` : "—";
  }
}

function listAllForMeta(dayIso){
  return getDailyTasks(dayIso);
}

function renderTodayMinutes(){
  const tm = el("todayMinutes");
  if(tm) tm.textContent = `学習時間 ${getStudyMin(selectedDayKey)}分`;
}

function renderTodayReview(){
  const ul = el("todayReviewList");
  const hint = el("reviewHint");
  if(!ul) return;

  const reviews = buildTodayReviews(selectedDayKey);
  ul.innerHTML = "";

  if(reviews.length===0){
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "今日は復習タスクなし";
    ul.appendChild(li);
    if(hint) hint.textContent = "—";
    return;
  }

  reviews.forEach(r=>{
    const li = document.createElement("li");
    li.textContent = r.title;
    ul.appendChild(li);
  });

  if(hint) hint.textContent = `${reviews.length}件`;
}

function renderWeekly(){
  const weekLabel = el("weekLabel");
  const weekMeta  = el("weekMeta");
  if(weekLabel) weekLabel.textContent = weekRangeLabel(selectedWeekKey);

  const tasks = getWeekTasks(selectedWeekKey);

  if(weekMeta){
    const r = rateOf(tasks);
    const done = tasks.filter(t=>t.done).length;
    const total = tasks.length;
    weekMeta.textContent = total ? `達成率 ${r}%（${done}/${total}）` : "—";
  }

  // board (weeklyAutoBoard) は「日別割当」の代わりに今週タスク表示に使う
  const board = el("weeklyAutoBoard");
  if(board){
    board.innerHTML = "";

    // 上部に「＋追加」簡易ボタンを差し込み（HTMLに無くても動く）
    const top = document.createElement("div");
    top.className = "row gap8";
    top.style.marginBottom = "10px";

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn";
    btnAdd.textContent = "＋今週タスク追加";
    btnAdd.onclick = addWeekTask;

    top.appendChild(btnAdd);
    board.appendChild(top);

    if(tasks.length===0){
      const p = document.createElement("div");
      p.className = "muted";
      p.textContent = "今週タスクがありません。Masterから積むか、追加してください。";
      board.appendChild(p);
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "list";

    tasks.forEach(t=>{
      ul.appendChild(renderListItem({
        text:`【${t.type}】 ${t.text}`,
        done:t.done,
        onToggle:()=>toggleWeek(t.id),
        onEdit:()=>editWeek(t.id),
        onDelete:()=>deleteWeek(t.id),
        checkbox:{checked:!!t.selected},
        onSelect:(yes)=>setWeekSelected(t.id, yes),
      }));
    });

    board.appendChild(ul);
  }

  // KPI
  const capEl = el("weeklyCap");
  const asgEl = el("weeklyAssigned");
  const remEl = el("weeklyRemain");

  if(capEl || asgEl || remEl){
    const cap = Number(store.settings.weeklyCapMinutes ?? DEFAULT_SETTINGS.weeklyCapMinutes) || 0;
    const assigned = tasks.filter(t=>!t.done).reduce((a,t)=>a + (Number(t.estMin)||0), 0);
    const remain = Math.max(0, cap - assigned);
    if(capEl) capEl.textContent = `${cap}m`;
    if(asgEl) asgEl.textContent = `${assigned}m`;
    if(remEl) remEl.textContent = `${remain}m`;
  }
}

function renderMaster(){
  const ul = el("masterList");
  if(!ul) return;

  const q = (el("masterSearch")?.value || "").trim().toLowerCase();
  const filt = (el("masterFilter")?.value || "all");

  let list = [...store.master];

  if(q){
    list = list.filter(m =>
      (m.title||"").toLowerCase().includes(q) ||
      (m.type||"").toLowerCase().includes(q)
    );
  }
  if(filt==="open") list = list.filter(m=>!m.done);
  if(filt==="done") list = list.filter(m=>m.done);

  ul.innerHTML = "";

  if(list.length===0){
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "マスタータスクはまだありません。";
    ul.appendChild(li);
    return;
  }

  list.forEach(m=>{
    const li = document.createElement("li");
    li.className = "row between";

    const left = document.createElement("div");
    left.className = "row gap8";
    left.style.alignItems = "center";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!m.selected;
    cb.addEventListener("click", (e)=>{ e.stopPropagation(); setMasterSelected(m.id, cb.checked); });

    const title = document.createElement("span");
    title.textContent = `【${m.type}】 ${m.title}${m.estMin?` (${m.estMin}m)`:""}`;
    if(m.done) title.classList.add("done");

    left.appendChild(cb);
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "row gap8";

    const doneBtn = document.createElement("button");
    doneBtn.className = "iconBtn";
    doneBtn.textContent = m.done ? "↩︎" : "✓";
    doneBtn.title = m.done ? "未完了に戻す" : "完了";
    doneBtn.addEventListener("click", (e)=>{ e.stopPropagation(); toggleMasterDone(m.id); });

    const editBtn = document.createElement("button");
    editBtn.className = "iconBtn";
    editBtn.textContent = "✎";
    editBtn.title = "編集";
    editBtn.addEventListener("click", (e)=>{ e.stopPropagation(); editMaster(m.id); });

    const delBtn = document.createElement("button");
    delBtn.className = "iconBtn";
    delBtn.textContent = "🗑";
    delBtn.title = "削除";
    delBtn.addEventListener("click", (e)=>{ e.stopPropagation(); deleteMaster(m.id); });

    right.appendChild(doneBtn);
    right.appendChild(editBtn);
    right.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(right);

    ul.appendChild(li);
  });
}

function renderHistory(){
  // weeks
  const hw = el("historyWeeks");
  if(hw){
    const keys = Object.keys(store.weekly).sort().reverse();
    hw.innerHTML = "";
    if(keys.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "まだ週データがありません。";
      hw.appendChild(li);
    }else{
      keys.forEach(k=>{
        const tasks = store.weekly[k]?.tasks || [];
        const r = rateOf(tasks);
        const li = document.createElement("li");
        li.className = "row between";
        const l = document.createElement("span");
        l.textContent = weekRangeLabel(k);
        const rr = document.createElement("span");
        rr.textContent = r===null ? "" : `${r}%`;
        li.appendChild(l);
        li.appendChild(rr);
        li.onclick = ()=>{ selectedWeekKey = k; show("weekly"); };
        hw.appendChild(li);
      });
    }
  }

  // days
  const hd = el("historyDays");
  if(hd){
    const keys = Object.keys(store.daily).sort().slice(-14).reverse();
    hd.innerHTML = "";
    if(keys.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "まだ日次データがありません。";
      hd.appendChild(li);
    }else{
      keys.forEach(k=>{
        const tasks = store.daily[k] || [];
        const r = rateOf(tasks);
        const li = document.createElement("li");
        li.className = "row between";
        const l = document.createElement("span");
        l.textContent = k;
        const rr = document.createElement("span");
        rr.textContent = r===null ? "" : `${r}%`;
        li.appendChild(l);
        li.appendChild(rr);
        li.onclick = ()=>{ selectedDayKey = k; show("daily"); };
        hd.appendChild(li);
      });
    }
  }
}

// ---------- Save & Render ----------
function saveAndRender(needRender=true){
  saveStore();
  if(needRender) render();
}

// ---------- No-op (HTMLに残ってても壊れないように) ----------
function rebuildAuto(){
  alert("自動割当はオフにしました（この版では未使用）");
}
function seedDemo(){
  alert("この版は自動割当なしのため、テンプレ投入は未実装です（必要なら作る）");
}
function wipeAll(){
  if(!confirm("全データ削除しますか？（localStorageが空になります）")) return;
  localStorage.removeItem(KEY);
  location.reload();
}

// ---------- Wire header settings ----------
document.addEventListener("DOMContentLoaded", ()=>{
  const btn = el("btnSettings");
  if(btn) btn.addEventListener("click", openSettings);

  // 初期表示：Daily
  show("daily");
});

// ---------- Expose to HTML (onclick用) ----------
window.show = show;

window.shiftDay = shiftDay;
window.goToday = goToday;

window.shiftWeek = shiftWeek;
window.goThisWeek = goThisWeek;

window.shiftMonth = shiftMonth;
window.goThisMonth = goThisMonth;

window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;

window.addManualTask = addManualTask;
window.addMinutes = addMinutes;
window.resetDayMinutes = resetDayMinutes;

window.addMasterTask = addMasterTask;

window.openWeeklyPickMaster = openWeeklyPickMaster;
window.bulkMoveWeekToToday = bulkMoveWeekToToday;
window.bulkCompleteWeek = bulkCompleteWeek;
window.bulkDeleteWeek = bulkDeleteWeek;

window.rebuildAuto = rebuildAuto;
window.seedDemo = seedDemo;
window.wipeAll = wipeAll;

// ---------- First render ----------
render();
