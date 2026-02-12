/* ==========================================================
   Study Log Pro (app.js) vFinal — 全置き換え版
   - 自動割当なし
   - Master → 今週へ追加（チェック選択）
   - 今週 → 今日以降へ一括振り分け（ボタン）
   - 週タスク 一括削除 / 一括完了（選択があれば選択のみ）
   - 今日：Week由来タスク / 手動タスク を別表示
   - 復習：何回目の復習か表示（1回目/2回目…）
   - データ保持：KEY固定 + 旧KEY取り込み（初回だけ）
   ========================================================== */

const KEY = "study_log_pro_v_final"; // ★変えない（データ保持の要）
const LEGACY_KEYS = ["study_pwa_v2", "study_pwa_v3", "study_log_pro_v4", "study_log_pro"]; // 旧キー吸い上げ
const TYPES = ["講義","演習","復習","模試","その他"];

const DEFAULT_SETTINGS = {
  examDate: null,            // "YYYY-MM-DD"
  weeklyCapMinutes: 900,     // 週の容量（分）表示用
  reviewOffsets: [1,3,7,14], // 復習オフセット（日）
};

const store = loadStore();

/* ---------------- Storage ---------------- */
function loadStore(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch(e){ raw = null; }

  // 新KEYが無ければ、旧KEYから最初に見つかったものを移植
  if(!raw){
    for(const lk of LEGACY_KEYS){
      const v = localStorage.getItem(lk);
      if(!v) continue;
      try{
        const old = JSON.parse(v);
        if(old && typeof old === "object"){
          raw = old;
          break;
        }
      }catch(e){}
    }
  }

  const s = raw && typeof raw === "object" ? raw : {};
  s._v ||= "final";

  s.settings ||= {};
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };

  s.daily ||= {};     // {"YYYY-MM-DD": [{id,text,type,done,origin,createdAt,doneAt,fromWeekId?}]}
  s.weekly ||= {};    // {"YYYY-MM-DD(monday)": {tasks:[{id,text,type,done,selected,createdAt,doneAt,fromMasterId?}]}}
  s.master ||= [];    // [{id,title,type,estMin,done,selected,createdAt}]
  s.logs ||= {};      // {"YYYY-MM-DD": {studyMin:number}}

  // v2の日次時間が残ってたらlogsに移す（あれば）
  if(s.dailyTime && typeof s.dailyTime === "object"){
    for(const [d, mins] of Object.entries(s.dailyTime)){
      s.logs[d] ||= { studyMin: 0 };
      s.logs[d].studyMin = (Number(s.logs[d].studyMin)||0) + (Number(mins)||0);
    }
    delete s.dailyTime;
  }

  return s;
}

function saveStore(){
  localStorage.setItem(KEY, JSON.stringify(store));
}

/* ---------------- Date utils ---------------- */
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

function sameWeek(dayIso, mondayIso){
  return getMonday(new Date(dayIso + "T12:00:00")) === mondayIso;
}

function uid(prefix="t"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/* ---------------- State ---------------- */
const todayKey = iso(new Date());
let selectedDayKey = todayKey;

let selectedWeekKey = getMonday();
store.weekly[selectedWeekKey] ||= { tasks: [] };

let calMonth = new Date();
calMonth.setDate(1);

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);

function rateOf(list){
  if(!list || list.length===0) return null;
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

/* ---------------- Data getters ---------------- */
function getDailyTasks(dayIso){
  store.daily[dayIso] ||= [];
  return store.daily[dayIso];
}
function getWeekTasks(weekKey){
  store.weekly[weekKey] ||= { tasks: [] };
  store.weekly[weekKey].tasks ||= [];
  return store.weekly[weekKey].tasks;
}
function getStudyMin(dayIso){
  return Number(store.logs?.[dayIso]?.studyMin || 0) || 0;
}
function setStudyMin(dayIso, mins){
  store.logs ||= {};
  store.logs[dayIso] ||= { studyMin: 0 };
  store.logs[dayIso].studyMin = Math.max(0, mins|0);
}

/* ---------------- Tabs ---------------- */
function setActiveTab(name){
  ["Daily","Weekly","Master","Calendar","History"].forEach(x=>{
    const b = $("tab"+x);
    if(!b) return;
    b.classList.toggle("active", x.toLowerCase() === name);
  });
}

function show(view){
  ["daily","weekly","master","calendar","history"].forEach(id=>{
    const el = $(id);
    if(el) el.hidden = (id !== view);
  });
  setActiveTab(view);
  render();
}

/* ---------------- Navigation ---------------- */
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

/* ---------------- Settings modal ---------------- */
function openSettings(){
  const m = $("settingsModal");
  if(!m) return;
  m.hidden = false;

  const examEl = $("examDateInput");
  const capEl  = $("weeklyCapInput");
  const offEl  = $("reviewOffsetsInput");

  if(examEl) examEl.value = store.settings.examDate || "";
  if(capEl)  capEl.value  = String(store.settings.weeklyCapMinutes ?? DEFAULT_SETTINGS.weeklyCapMinutes);
  if(offEl)  offEl.value  = (store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets).join(",");

  setTimeout(()=>examEl?.focus?.(), 0);
}
function closeSettings(){
  const m = $("settingsModal");
  if(!m) return;
  m.hidden = true;
}
function saveSettings(){
  const examEl = $("examDateInput");
  const capEl  = $("weeklyCapInput");
  const offEl  = $("reviewOffsetsInput");

  const exam = examEl?.value || "";
  const cap  = Math.max(0, parseInt(capEl?.value || "0", 10) || 0);

  const offs = (offEl?.value || "")
    .split(/[,\s]+/)
    .map(x=>parseInt(x,10))
    .filter(n=>Number.isFinite(n) && n>0)
    .slice(0, 20);

  if(exam) store.settings.examDate = exam;
  store.settings.weeklyCapMinutes = cap;
  store.settings.reviewOffsets = offs.length ? offs : [...DEFAULT_SETTINGS.reviewOffsets];

  saveAndRender();
  closeSettings();
}

/* ---------------- Daily actions ---------------- */
function addManualTask(){
  const text = prompt("今日の手動タスク（内容）");
  if(!text) return;
  const type = pickType("演習");

  getDailyTasks(selectedDayKey).push({
    id: uid("d"),
    text: text.trim(),
    type,
    done: false,
    origin: "manual",     // manual / week
    createdAt: iso(new Date()),
    doneAt: null
  });
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

/* ---------------- Minutes ---------------- */
function addMinutes(){
  const input = $("minsInput");
  const v = parseInt(input?.value || "0", 10) || 0;
  if(input) input.value = "";
  if(v<=0) return;

  setStudyMin(selectedDayKey, getStudyMin(selectedDayKey) + v);
  saveAndRender();
}
function resetDayMinutes(){
  if(!confirm("今日の学習時間を0分にしますか？")) return;
  setStudyMin(selectedDayKey, 0);
  saveAndRender();
}

/* ---------------- Weekly actions ---------------- */
function addWeekTask(){
  const text = prompt("今週タスク（内容）");
  if(!text) return;
  const type = pickType("演習");

  getWeekTasks(selectedWeekKey).push({
    id: uid("w"),
    text: text.trim(),
    type,
    done: false,
    selected: false,
    createdAt: iso(new Date()),
    doneAt: null,
    fromMasterId: null,
  });
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

// 一括完了：選択があれば選択のみ、なければ全
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

// 一括削除：選択があれば選択のみ、なければ全
function bulkDeleteWeek(){
  const list = getWeekTasks(selectedWeekKey);
  const hasSel = list.some(x=>x.selected);
  const targetCount = hasSel ? list.filter(x=>x.selected).length : list.length;
  if(targetCount===0) return;
  if(!confirm(`削除しますか？（${targetCount}件）`)) return;

  store.weekly[selectedWeekKey].tasks = hasSel ? list.filter(x=>!x.selected) : [];
  saveAndRender();
}

// 今週タスク（未完了）→ 今日以降へ振り分け（round-robin）
function bulkMoveWeekToToday(){
  const weekTasks = getWeekTasks(selectedWeekKey);
  const pool = weekTasks.filter(t=>!t.done);

  if(pool.length===0){
    alert("未完了の今週タスクがありません。");
    return;
  }

  const start = sameWeek(todayKey, selectedWeekKey) ? todayKey : selectedWeekKey;
  const days = daysOfWeek(selectedWeekKey).filter(d=>d >= start);

  if(days.length===0){
    alert("振り分け先の日がありません。");
    return;
  }

  let i = 0;
  pool.forEach(t=>{
    const day = days[i % days.length];
    getDailyTasks(day).push({
      id: uid("d"),
      text: t.text,
      type: t.type,
      done: false,
      origin: "week",
      createdAt: iso(new Date()),
      doneAt: null,
      fromWeekId: t.id,
      fromMasterId: t.fromMasterId || null
    });
    i++;
  });

  // 今週側は「doneだけ残す」運用（移した未完了は削除）
  store.weekly[selectedWeekKey].tasks = weekTasks.filter(t=>t.done);
  saveAndRender();
  alert(`今週タスクを ${days[0]} 以降へ振り分けました（${pool.length}件）`);
}

/* ---------------- Master actions ---------------- */
function addMasterTask(){
  const title = prompt("Masterタスク名（例：FAR Ch 5 講義）");
  if(!title) return;
  const type = pickType("講義");
  const est = prompt("推定時間（分・任意）", "60");
  const estMin = Math.max(0, parseInt(est||"0",10) || 0);

  store.master.push({
    id: uid("m"),
    title: title.trim(),
    type,
    estMin,
    done: false,
    selected: false,
    createdAt: iso(new Date()),
  });
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
  if(est!==null) m.estMin = Math.max(0, parseInt(est||"0",10) || 0);

  m.type = pickType(m.type || "講義");
  saveAndRender();
}

function deleteMaster(id){
  if(!confirm("Masterタスクを削除しますか？")) return;
  store.master = store.master.filter(x=>x.id!==id);
  saveAndRender();
}

// Masterから今週へ追加（チェック選択 or prompt）
function openWeeklyPickMaster(){
  // 画面チェックがあれば優先
  let pick = store.master.filter(m=>m.selected && !m.done);

  if(pick.length===0){
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
    pick = store.master.filter(m=>m.selected && !m.done);
  }

  const week = getWeekTasks(selectedWeekKey);
  pick.forEach(m=>{
    week.push({
      id: uid("w"),
      text: m.title,
      type: m.type,
      done: false,
      selected: false,
      createdAt: iso(new Date()),
      doneAt: null,
      fromMasterId: m.id
    });
    m.selected = false;
  });

  saveAndRender();
}

/* ---------------- Review timing (today) ---------------- */
function buildTodayReviews(dayIso){
  const offs = store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets;
  const out = [];

  const dayKeys = Object.keys(store.daily).sort();
  for(const d of dayKeys){
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
        });
      });
    }
  }
  return out;
}

/* ---------------- Calendar ---------------- */
const WEEKDAYS = ["月","火","水","木","金","土","日"];

function renderCalendar(){
  const grid = $("calendarGrid");
  if(!grid) return;

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const lab = $("calMonthLabel");
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
  const jsDay = first.getDay(); // 0 Sun .. 6 Sat
  const idx = (jsDay + 6) % 7;  // Mon=0..Sun=6
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

/* ---------------- Render UI ---------------- */
function renderExamCountdown(){
  const pill = $("examCountdown");
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

function renderDaily(){
  $("dailyDate") && ($("dailyDate").textContent = selectedDayKey);

  const list = getDailyTasks(selectedDayKey);
  const weekOnToday = list.filter(t=>t.origin==="week");
  const manualToday = list.filter(t=>t.origin!=="week");

  const meta = $("dailyMeta");
  if(meta){
    const r = rateOf(list);
    meta.textContent = list.length ? `達成率 ${r}%（${list.filter(t=>t.done).length}/${list.length}）` : "—";
  }

  // auto枠（今週由来）
  const autoUl = $("dailyAutoList");
  if(autoUl){
    autoUl.innerHTML = "";
    if(weekOnToday.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "（今週から振り分けたタスクはまだありません）";
      autoUl.appendChild(li);
    } else {
      weekOnToday.forEach(t=>{
        autoUl.appendChild(makeRowItem({
          text:`【${t.type}】 ${t.text}`,
          done:t.done,
          onToggle:()=>toggleDaily(t.id),
          onEdit:()=>editDaily(t.id),
          onDelete:()=>deleteDaily(t.id),
        }));
      });
    }
  }

  // manual枠
  const manUl = $("dailyManualList");
  if(manUl){
    manUl.innerHTML = "";
    if(manualToday.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "（手動タスクはまだありません）";
      manUl.appendChild(li);
    } else {
      manualToday.forEach(t=>{
        manUl.appendChild(makeRowItem({
          text:`【${t.type}】 ${t.text}`,
          done:t.done,
          onToggle:()=>toggleDaily(t.id),
          onEdit:()=>editDaily(t.id),
          onDelete:()=>deleteDaily(t.id),
        }));
      });
    }
  }

  // minutes
  const tm = $("todayMinutes");
  if(tm) tm.textContent = `学習時間 ${getStudyMin(selectedDayKey)}分`;

  // reviews
  const reviews = buildTodayReviews(selectedDayKey);
  const hint = $("reviewHint");
  if(hint) hint.textContent = reviews.length ? `${reviews.length}件` : "—";

  const rUl = $("todayReviewList");
  if(rUl){
    rUl.innerHTML = "";
    if(reviews.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "今日は復習タスクなし";
      rUl.appendChild(li);
    }else{
      reviews.forEach(r=>{
        const li = document.createElement("li");
        li.textContent = r.title;
        rUl.appendChild(li);
      });
    }
  }
}

function renderWeekly(){
  const weekLabel = $("weekLabel");
  if(weekLabel) weekLabel.textContent = weekRangeLabel(selectedWeekKey);

  const weekMeta = $("weekMeta");
  const tasks = getWeekTasks(selectedWeekKey);
  if(weekMeta){
    const r = rateOf(tasks);
    weekMeta.textContent = tasks.length ? `達成率 ${r}%（${tasks.filter(t=>t.done).length}/${tasks.length}）` : "—";
  }

  // KPI
  const cap = Number(store.settings.weeklyCapMinutes ?? DEFAULT_SETTINGS.weeklyCapMinutes) || 0;
  const assigned = tasks.filter(t=>!t.done).reduce((a,t)=>a + (Number(t.estMin)||0), 0);
  const remain = Math.max(0, cap - assigned);
  $("weeklyCap") && ($("weeklyCap").textContent = `${cap}m`);
  $("weeklyAssigned") && ($("weeklyAssigned").textContent = `${assigned}m`);
  $("weeklyRemain") && ($("weeklyRemain").textContent = `${remain}m`);

  // weeklyAutoBoard を「今週タスク一覧」に利用
  const board = $("weeklyAutoBoard");
  if(board){
    board.innerHTML = "";

    // 操作バー（HTMLにないのでJSで足す）
    const bar = document.createElement("div");
    bar.className = "row gap8";
    bar.style.marginBottom = "12px";
    bar.style.flexWrap = "wrap";

    const b1 = mkBtn("＋今週タスク追加", "btn", addWeekTask);
    const b2 = mkBtn("Masterから今週へ追加", "btn primary", openWeeklyPickMaster);
    const b3 = mkBtn("今週→今日以降へ振り分け", "btn", bulkMoveWeekToToday);
    const b4 = mkBtn("選択/全を一括完了", "btn ghost", bulkCompleteWeek);
    const b5 = mkBtn("選択/全を一括削除", "btn ghost danger", bulkDeleteWeek);

    [b1,b2,b3,b4,b5].forEach(b=>bar.appendChild(b));
    board.appendChild(bar);

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
      ul.appendChild(makeRowItem({
        text:`【${t.type}】 ${t.text}`,
        done:t.done,
        onToggle:()=>toggleWeek(t.id),
        onEdit:()=>editWeek(t.id),
        onDelete:()=>deleteWeek(t.id),
        checkbox:{ checked:!!t.selected },
        onSelect:(yes)=>setWeekSelected(t.id, yes),
      }));
    });
    board.appendChild(ul);
  }
}

function renderMaster(){
  const ul = $("masterList");
  if(!ul) return;

  const q = ($("masterSearch")?.value || "").trim().toLowerCase();
  const f = ($("masterFilter")?.value || "all");

  let list = [...store.master];

  if(q){
    list = list.filter(m =>
      (m.title||"").toLowerCase().includes(q) ||
      (m.type||"").toLowerCase().includes(q)
    );
  }
  if(f==="open") list = list.filter(m=>!m.done);
  if(f==="done") list = list.filter(m=>m.done);

  ul.innerHTML = "";

  // 操作バー（HTMLにないので上に差し込み）
  const bar = document.createElement("li");
  bar.style.listStyle = "none";
  bar.style.padding = "0";
  const wrap = document.createElement("div");
  wrap.className = "row gap8";
  wrap.style.flexWrap = "wrap";
  wrap.style.marginBottom = "10px";

  wrap.appendChild(mkBtn("＋Master追加", "btn primary", addMasterTask));
  wrap.appendChild(mkBtn("選択Master→今週へ追加", "btn", openWeeklyPickMaster));
  bar.appendChild(wrap);
  ul.appendChild(bar);

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
    title.textContent = `【${m.type}】 ${m.title}${m.estMin?` (${m.estMin}m)`:``}`;
    if(m.done) title.classList.add("done");

    left.appendChild(cb);
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "row gap8";

    const doneBtn = mkIconBtn(m.done ? "↩︎" : "✓", m.done ? "未完了に戻す" : "完了", ()=>toggleMasterDone(m.id));
    const editBtn = mkIconBtn("✎", "編集", ()=>editMaster(m.id));
    const delBtn  = mkIconBtn("🗑", "削除", ()=>deleteMaster(m.id));

    right.appendChild(doneBtn);
    right.appendChild(editBtn);
    right.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(right);

    ul.appendChild(li);
  });
}

function renderHistory(){
  const hw = $("historyWeeks");
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

  const hd = $("historyDays");
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
        const list = store.daily[k] || [];
        const r = rateOf(list);
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

/* ---------------- UI components ---------------- */
function mkBtn(text, className, fn){
  const b = document.createElement("button");
  b.className = className;
  b.type = "button";
  b.textContent = text;
  b.onclick = fn;
  return b;
}

function mkIconBtn(text, title, fn){
  const b = document.createElement("button");
  b.className = "iconBtn";
  b.type = "button";
  b.textContent = text;
  b.title = title;
  b.onclick = (e)=>{ e.stopPropagation(); fn?.(); };
  return b;
}

function makeRowItem({text, done, onToggle, onEdit, onDelete, checkbox, onSelect}){
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

  right.appendChild(mkIconBtn("✎","編集", onEdit));
  right.appendChild(mkIconBtn("🗑","削除", onDelete));

  li.appendChild(left);
  li.appendChild(right);

  li.addEventListener("click", ()=>onToggle?.());
  return li;
}

/* ---------------- Save & Render ---------------- */
function saveAndRender(doRender=true){
  saveStore();
  if(doRender) render();
}

/* ---------------- Main render ---------------- */
function render(){
  renderExamCountdown();
  renderDaily();
  renderWeekly();
  renderMaster();
  renderCalendar();
  renderHistory();
}

/* ---------------- No-op for old HTML hooks ---------------- */
function rebuildAuto(){ alert("自動割り当てはこの版では使いません。"); }
function seedDemo(){ alert("この版はテンプレ投入は未実装です（必要なら追加します）。"); }
function wipeAll(){
  if(!confirm("全データ削除しますか？（localStorageが空になります）")) return;
  localStorage.removeItem(KEY);
  location.reload();
}

/* ---------------- Wire events ---------------- */
document.addEventListener("DOMContentLoaded", ()=>{
  const btn = $("btnSettings");
  if(btn) btn.addEventListener("click", openSettings);

  // 初期タブ
  show("daily");
});

/* ---------------- Expose for HTML onclick ---------------- */
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

window.addWeekTask = addWeekTask;
window.openWeeklyPickMaster = openWeeklyPickMaster;
window.bulkMoveWeekToToday = bulkMoveWeekToToday;
window.bulkCompleteWeek = bulkCompleteWeek;
window.bulkDeleteWeek = bulkDeleteWeek;

window.addMasterTask = addMasterTask;

window.rebuildAuto = rebuildAuto;
window.seedDemo = seedDemo;
window.wipeAll = wipeAll;

/* ---------------- Run ---------------- */
render();
