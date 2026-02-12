/* =========================
   Study Log Pro (app.js) v4 - FULL REPLACE
   For your "Pro HTML" (Today/Week/Master/Calendar/History + Settings modal)
   - Stable storage (no data loss on updates)
   - Auto plan from Master tasks until Exam date
   - Manual tasks separate from Auto tasks
   - Review auto tasks with "復習n回目" display
   - Bulk select actions (complete / delete / move)
   - Calendar renders properly
   ========================= */

(() => {
  // ===== Storage =====
  const KEY = "study_pwa_v2";
  const TYPES = ["講義", "演習", "復習", "模試", "その他"];

  const DEFAULT_SETTINGS = {
    examDate: null,              // "YYYY-MM-DD"
    weeklyCapMinutes: 900,       // weekly capacity in minutes (15h default)
    dayWeights: [1,1,1,1,1,0.7,0.5], // Mon..Sun
    dailyChunkMin: 60,           // split chunk
    reviewOffsets: [1,3,7,14],   // days after first assignment
    reviewMinutes: [20,25,30,35] // per review # (1..)
  };

  function safeParseJSON(x){
    try { return JSON.parse(x); } catch { return null; }
  }

  function loadStore(){
    const raw = safeParseJSON(localStorage.getItem(KEY));
    const s = (raw && typeof raw === "object") ? raw : {};

    // v2 legacy containers
    s.daily ||= {};   // manual daily tasks: { "YYYY-MM-DD": [{text, done, type}] }
    s.weekly ||= {};  // legacy weekly manual tasks (kept)

    // v3+ containers
    s.settings ||= {};
    s.settings = { ...DEFAULT_SETTINGS, ...s.settings };

    // accept older keys
    if (s.settings.weeklyMinutes != null && s.settings.weeklyCapMinutes == null){
      s.settings.weeklyCapMinutes = Number(s.settings.weeklyMinutes) || DEFAULT_SETTINGS.weeklyCapMinutes;
    }

    s.master ||= [];  // [{id,title,type,estMin,notes,createdAt,done,doneAt}]
    s.plan ||= {};    // {"YYYY-MM-DD": { auto:[{...}] }}
    s.logs ||= {};    // {"YYYY-MM-DD": { studyMin:number }}

    // migrate old dailyTime to logs (if existed)
    if (s.dailyTime && typeof s.dailyTime === "object"){
      Object.entries(s.dailyTime).forEach(([d, mins])=>{
        s.logs[d] ||= { studyMin: 0 };
        s.logs[d].studyMin = (Number(s.logs[d].studyMin)||0) + (Number(mins)||0);
      });
      delete s.dailyTime;
    }

    s._v ||= 4;
    return s;
  }

  const store = loadStore();

  function save(){
    localStorage.setItem(KEY, JSON.stringify(store));
    render();
  }

  // ===== Date utils =====
  const iso = (d) => new Date(d).toISOString().slice(0,10);

  function addDays(isoDate, n){
    const d = new Date(isoDate + "T12:00:00");
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  function addMonths(dateObj, n){
    const x = new Date(dateObj);
    x.setDate(1);
    x.setMonth(x.getMonth() + n);
    return x;
  }

  function getMonday(d = new Date()){
    const date = new Date(d);
    const day = date.getDay() || 7; // Sun=7
    if (day !== 1) date.setDate(date.getDate() - (day - 1));
    date.setHours(12,0,0,0);
    return iso(date);
  }

  function weekdayIndex(isoDate){
    const d = new Date(isoDate + "T12:00:00");
    const js = d.getDay(); // 0..6 (Sun..Sat)
    return (js + 6) % 7;   // Mon=0..Sun=6
  }

  function weekRangeLabel(mondayIso){
    const sunIso = addDays(mondayIso, 6);
    return `${mondayIso} 〜 ${sunIso}`;
  }

  function daysOfWeek(mondayIso){
    return Array.from({length:7}, (_,i)=>addDays(mondayIso, i));
  }

  // ===== UI state =====
  const todayKey = iso(new Date());
  let selectedDayKey = todayKey;
  let selectedWeekKey = getMonday();
  let calMonth = new Date(); calMonth.setDate(1);

  // bulk selection
  // key: "auto|YYYY-MM-DD|autoId" or "manual|YYYY-MM-DD|index"
  let bulkSelection = new Set();

  // ===== Helpers =====
  function uid(prefix="id"){
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function clampInt(x, min=0){
    const n = parseInt(String(x ?? "0"), 10);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, n);
  }

  function rateOf(list){
    if (!list || list.length === 0) return null;
    const done = list.filter(t=>t.done).length;
    return Math.round(done / list.length * 100);
  }

  function heatClass(rate){
    if(rate === null) return "r0";
    if(rate === 0) return "r0";
    if(rate < 50) return "r1";
    if(rate < 80) return "r2";
    return "r3";
  }

  function getAutoTasks(dayIso){
    return store.plan?.[dayIso]?.auto ? store.plan[dayIso].auto : [];
  }

  function getManualTasks(dayIso){
    return store.daily?.[dayIso] ? store.daily[dayIso] : [];
  }

  function getAllDayTasks(dayIso){
    return [...getAutoTasks(dayIso), ...getManualTasks(dayIso)];
  }

  function getStudyMin(dayIso){
    return Number(store.logs?.[dayIso]?.studyMin || 0) || 0;
  }

  function setStudyMin(dayIso, mins){
    store.logs ||= {};
    store.logs[dayIso] ||= { studyMin: 0 };
    store.logs[dayIso].studyMin = Math.max(0, mins|0);
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

  // ===== Tabs (IMPORTANT: includes Master) =====
  function setActiveTab(view){
    const map = {
      daily: "tabDaily",
      weekly: "tabWeekly",
      master: "tabMaster",
      calendar: "tabCalendar",
      history: "tabHistory",
    };
    Object.values(map).forEach(id=>{
      const b = document.getElementById(id);
      if(b) b.classList.remove("active");
    });
    const activeId = map[view];
    const btn = document.getElementById(activeId);
    if(btn) btn.classList.add("active");
  }

  function show(view){
    const ids = ["daily","weekly","master","calendar","history"];
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
    render();
  }
  function goThisWeek(){ selectedWeekKey = getMonday(); render(); }

  function shiftMonth(delta){
    calMonth = addMonths(calMonth, delta);
    render();
  }
  function goThisMonth(){
    calMonth = new Date(); calMonth.setDate(1);
    render();
  }

  // ===== Settings modal =====
  function openSettings(){
    const m = document.getElementById("settingsModal");
    if(!m) return;
    m.hidden = false;

    const examEl = document.getElementById("examDateInput");
    const weekEl = document.getElementById("weeklyCapInput");
    const offEl  = document.getElementById("reviewOffsetsInput");

    if(examEl) examEl.value = store.settings.examDate || "";
    if(weekEl) weekEl.value = String(store.settings.weeklyCapMinutes ?? DEFAULT_SETTINGS.weeklyCapMinutes);
    if(offEl)  offEl.value  = (store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets).join(",");

    setTimeout(()=>examEl?.focus?.(), 0);
  }

  function closeSettings(){
    const m = document.getElementById("settingsModal");
    if(!m) return;
    m.hidden = true;
  }

  function parseOffsets(v){
    if(!v) return DEFAULT_SETTINGS.reviewOffsets.slice();
    const arr = String(v)
      .split(/[,\s]+/)
      .map(x=>parseInt(x,10))
      .filter(n=>Number.isFinite(n) && n>0)
      .slice(0, 20);
    return arr.length ? arr : DEFAULT_SETTINGS.reviewOffsets.slice();
  }

  function saveSettings(){
    const examEl = document.getElementById("examDateInput");
    const weekEl = document.getElementById("weeklyCapInput");
    const offEl  = document.getElementById("reviewOffsetsInput");

    const exam = (examEl?.value || "").trim();
    const weeklyMin = clampInt(weekEl?.value, 0);
    const offsets = parseOffsets(offEl?.value || "");

    if(exam) store.settings.examDate = exam;
    store.settings.weeklyCapMinutes = weeklyMin;
    store.settings.reviewOffsets = offsets;

    save();
    closeSettings();
  }

  // ===== Daily actions =====
  function addManualTask(){
    const text = prompt("手動タスク内容");
    if(!text) return;
    const type = pickType("演習");
    store.daily[selectedDayKey] ||= [];
    store.daily[selectedDayKey].push({ text, done:false, type });
    save();
  }

  function toggleManual(dayIso, idx){
    const list = store.daily[dayIso] || [];
    if(!list[idx]) return;
    list[idx].done = !list[idx].done;
    save();
  }

  function deleteManual(dayIso, idx){
    if(!confirm("この手動タスクを削除しますか？")) return;
    const list = store.daily[dayIso] || [];
    list.splice(idx, 1);
    store.daily[dayIso] = list;
    save();
  }

  function addMinutes(){
    const el = document.getElementById("minsInput");
    const add = clampInt(el?.value, 0);
    if(el) el.value = "";
    if(add <= 0) return;
    setStudyMin(selectedDayKey, getStudyMin(selectedDayKey) + add);
    save();
  }

  function resetDayMinutes(){
    if(!confirm("学習時間を0にしますか？")) return;
    setStudyMin(selectedDayKey, 0);
    save();
  }

  // ===== Master tasks =====
  function addMasterTask(){
    const title = prompt("マスタータスク名（例：FAR Ch3 講義）");
    if(!title) return;
    const type = pickType("講義");
    const estH = prompt("推定時間（時間 / 例: 2 or 1.5）", "2");
    if(estH === null) return;
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

  function editMasterTask(masterId){
    const m = store.master.find(x=>x.id===masterId);
    if(!m) return;

    const op = prompt(
`操作:
1) タイトル変更
2) タイプ変更
3) 推定時間変更（分）
4) 完了/未完了切替
5) 削除

番号を入力`, ""
    );
    const n = parseInt(op,10);
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
      if(!confirm("このマスタータスクを削除しますか？")) return;
      store.master = store.master.filter(x=>x.id!==m.id);
      save();
      return;
    }
  }

  function seedDemo(){
    // Simple FAR demo: Ch1..Ch23 (講義+演習) quickly injected
    if(!confirm("FARテンプレ（Ch1〜23）を投入しますか？（既存は残ります）")) return;

    for(let i=1;i<=23;i++){
      store.master.push({
        id: uid("m"),
        title: `FAR Ch${i} 講義`,
        type: "講義",
        estMin: 90,
        notes: "テンプレ",
        createdAt: iso(new Date()),
        done: false,
        doneAt: null
      });
      store.master.push({
        id: uid("m"),
        title: `FAR Ch${i} 演習`,
        type: "演習",
        estMin: 60,
        notes: "テンプレ",
        createdAt: iso(new Date()),
        done: false,
        doneAt: null
      });
    }
    save();
  }

  function wipeAll(){
    if(!confirm("本当に全データ削除しますか？（元に戻せません）")) return;
    localStorage.removeItem(KEY);
    location.reload();
  }

  // ===== Auto plan generation =====
  function rebuildAuto(){
    generateAutoPlan();
  }

  function collectLockedAuto(plan){
    const locked = {};
    Object.entries(plan || {}).forEach(([d, p])=>{
      const arr = (p.auto||[]).filter(t=>t.locked);
      if(arr.length){
        locked[d] = arr.map(x=>({...x}));
      }
    });
    return locked;
  }

  function buildDailyCapacityMap(startIso, endIso){
    const cap = {};
    const totalMinPerWeek = Math.max(0, Number(store.settings.weeklyCapMinutes||0));
    const w = Array.isArray(store.settings.dayWeights) && store.settings.dayWeights.length===7
      ? store.settings.dayWeights
      : DEFAULT_SETTINGS.dayWeights;
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

  function generateAutoPlan(){
    const exam = store.settings.examDate;
    if(!exam){
      alert("Settingsで試験日を設定してください。");
      return;
    }

    // Keep locked auto tasks, rebuild others
    const locked = collectLockedAuto(store.plan || {});
    store.plan = {};
    Object.entries(locked).forEach(([d, arr])=>{
      store.plan[d] ||= { auto: [] };
      store.plan[d].auto = [...arr];
    });

    const start = todayKey;
    const end = exam;

    // Prepare daily capacity map and subtract locked usage
    const cap = buildDailyCapacityMap(start, end);
    Object.keys(cap).forEach(d=>{
      const used = (store.plan[d]?.auto||[]).reduce((a,t)=>a+(t.estMin||0),0);
      cap[d] = Math.max(0, cap[d] - used);
    });

    // Assign from masters (not done)
    const masters = (store.master || []).filter(m=>!m.done);

    for(const m of masters){
      let remaining = m.estMin;

      let d = start;
      while(remaining > 0 && d <= end){
        store.plan[d] ||= { auto: [] };
        store.plan[d].auto ||= [];

        const can = cap[d] || 0;
        if(can > 0){
          const chunk = Math.min(can, remaining, store.settings.dailyChunkMin || DEFAULT_SETTINGS.dailyChunkMin);
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
        d = addDays(d, 1);
      }

      if(remaining > 0){
        alert(`割当が足りません：\n"${m.title}" が残り ${remaining} 分\n週の容量を増やすか試験日を延ばしてください。`);
        break;
      }
    }

    // Review tasks: based on FIRST assigned date per master
    const reviewOffsets = store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets;
    const reviewMinutes = store.settings.reviewMinutes || DEFAULT_SETTINGS.reviewMinutes;

    const firstAssigned = {};
    Object.keys(store.plan).sort().forEach(d=>{
      (store.plan[d].auto||[]).forEach(t=>{
        if(t.masterId && t.origin==="master" && !firstAssigned[t.masterId]){
          firstAssigned[t.masterId] = d;
        }
      });
    });

    Object.entries(firstAssigned).forEach(([mid, firstDay])=>{
      const m = store.master.find(x=>x.id===mid);
      if(!m) return;
      if(m.type !== "講義" && m.type !== "演習") return;

      reviewOffsets.forEach((k, idx)=>{
        const rd = addDays(firstDay, k);
        if(rd < start || rd > end) return;

        store.plan[rd] ||= { auto: [] };
        const reviewNo = idx + 1; // 1..n
        const name = `復習${reviewNo}回目: ${m.title}（${k}日後）`;

        const exists = (store.plan[rd].auto||[]).some(x =>
          x.origin==="review" && x.masterId===mid && x.reviewNo===reviewNo
        );
        if(exists) return;

        store.plan[rd].auto.push({
          id: uid("auto"),
          masterId: mid,
          title: name,
          type: "復習",
          estMin: reviewMinutes[idx] ?? (20 + idx*5),
          done: false,
          origin: "review",
          reviewNo,
          locked: false
        });
      });
    });

    save();
  }

  function toggleAuto(dayIso, autoId){
    const day = store.plan[dayIso];
    if(!day) return;
    const t = (day.auto||[]).find(x=>x.id===autoId);
    if(!t) return;
    t.done = !t.done;
    save();
  }

  function autoTaskMenu(dayIso, autoId){
    const day = store.plan[dayIso];
    if(!day) return;
    const idx = (day.auto||[]).findIndex(x=>x.id===autoId);
    if(idx < 0) return;
    const t = day.auto[idx];

    const raw = prompt(
`自動タスク操作:
1) 日付を移動（YYYY-MM-DD）
2) 推定時間を変更（分）
3) 分割（例: 60→30+30）
4) 削除
5) 手動タスクに変換（同日・手動へ）
6) 固定（locked切替）

番号を入力`, ""
    );
    const n = parseInt(raw,10);
    if(!Number.isFinite(n)) return;

    if(n===1){
      const to = prompt("移動先（YYYY-MM-DD）", dayIso);
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
      if(v===null) return;
      t.estMin = clampInt(v, 0);
      save();
      return;
    }
    if(n===3){
      const a = clampInt(prompt("1つ目（分）","30"), 1);
      const b = clampInt(prompt("2つ目（分）","30"), 1);
      const base = {...t, id: uid("auto"), estMin: a};
      const second = {...t, id: uid("auto"), estMin: b, done:false};
      day.auto.splice(idx,1, base, second);
      save();
      return;
    }
    if(n===4){
      if(!confirm("削除しますか？")) return;
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
    if(n===6){
      t.locked = !t.locked;
      save();
      return;
    }
  }

  // ===== Bulk actions =====
  function bulkComplete(){
    if(bulkSelection.size === 0) return;
    bulkSelection.forEach(key=>{
      const [kind, day, id] = key.split("|");
      if(kind==="auto"){
        const t = (store.plan?.[day]?.auto||[]).find(x=>x.id===id);
        if(t) t.done = true;
      } else if(kind==="manual"){
        const list = store.daily?.[day] || [];
        const idx = parseInt(id,10);
        if(list[idx]) list[idx].done = true;
      }
    });
    bulkSelection.clear();
    save();
  }

  function bulkDelete(){
    if(bulkSelection.size === 0) return;
    if(!confirm("選択したタスクを削除しますか？")) return;

    // delete manual carefully: descending indices per day
    const manualByDay = {};
    const autoByDay = {};

    bulkSelection.forEach(key=>{
      const [kind, day, id] = key.split("|");
      if(kind==="manual"){
        manualByDay[day] ||= [];
        manualByDay[day].push(parseInt(id,10));
      } else if(kind==="auto"){
        autoByDay[day] ||= [];
        autoByDay[day].push(id);
      }
    });

    Object.entries(autoByDay).forEach(([day, ids])=>{
      const list = store.plan?.[day]?.auto || [];
      store.plan[day].auto = list.filter(t=>!ids.includes(t.id));
    });

    Object.entries(manualByDay).forEach(([day, idxs])=>{
      const list = store.daily?.[day] || [];
      const set = new Set(idxs);
      store.daily[day] = list.filter((_,i)=>!set.has(i));
    });

    bulkSelection.clear();
    save();
  }

  function bulkMoveTomorrow(){
    if(bulkSelection.size === 0) return;
    const tomorrow = addDays(selectedDayKey, 1);

    // Move ONLY auto tasks for now (manual stays manual)
    bulkSelection.forEach(key=>{
      const [kind, day, id] = key.split("|");
      if(kind !== "auto") return;

      const list = store.plan?.[day]?.auto || [];
      const t = list.find(x=>x.id===id);
      if(!t) return;

      store.plan[tomorrow] ||= { auto: [] };
      store.plan[tomorrow].auto ||= [];
      store.plan[tomorrow].auto.push(t);
      store.plan[day].auto = list.filter(x=>x.id!==id);
    });

    bulkSelection.clear();
    save();
  }

  function toggleBulkKey(k, checked){
    if(checked) bulkSelection.add(k);
    else bulkSelection.delete(k);
    renderBulkBar();
  }

  // ===== Calendar render =====
  const WEEKDAYS = ["月","火","水","木","金","土","日"];

  function renderCalendar(){
    const grid = document.getElementById("calendarGrid");
    const label = document.getElementById("calMonthLabel");
    if(!grid || !label) return;

    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    label.textContent = `${y}年 ${m+1}月`;

    grid.innerHTML = "";

    // headers
    WEEKDAYS.forEach(w=>{
      const h = document.createElement("div");
      h.className = "calHead";
      h.textContent = w;
      grid.appendChild(h);
    });

    const first = new Date(y, m, 1);
    const firstIso = iso(first);

    const jsDay = first.getDay();       // 0 Sun..6 Sat
    const idx = (jsDay + 6) % 7;        // Mon=0
    const startIso = addDays(firstIso, -idx);

    for(let i=0;i<42;i++){
      const dayIso = addDays(startIso, i);
      const d = new Date(dayIso + "T12:00:00");
      const inMonth = d.getMonth() === m;

      const list = getAllDayTasks(dayIso);
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
      const done = list.filter(t=>t.done).length;
      bottom.textContent = list.length ? `${done}/${list.length}` : "";

      cell.appendChild(top);
      cell.appendChild(bottom);

      cell.onclick = ()=>{
        selectedDayKey = dayIso;
        show("daily");
      };

      grid.appendChild(cell);
    }
  }

  // ===== Weekly auto board =====
  function renderWeeklyBoard(){
    const board = document.getElementById("weeklyAutoBoard");
    if(!board) return;

    board.innerHTML = "";
    const days = daysOfWeek(selectedWeekKey);

    days.forEach(d=>{
      const col = document.createElement("div");
      col.className = "boardCol";

      const head = document.createElement("div");
      head.className = "boardHead";
      head.textContent = d;

      const list = document.createElement("div");
      list.className = "boardList";

      const tasks = getAutoTasks(d);
      if(tasks.length===0){
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.style.padding = "8px";
        empty.textContent = "—";
        list.appendChild(empty);
      } else {
        tasks.forEach(t=>{
          const item = document.createElement("div");
          item.className = "boardItem";

          const left = document.createElement("div");
          left.className = t.done ? "done" : "";
          left.textContent = `【${t.type}】 ${t.title} (${t.estMin}m)`;

          const right = document.createElement("div");
          right.className = "muted";
          right.textContent = t.done ? "〇" : "";

          item.appendChild(left);
          item.appendChild(right);

          // tap toggle, long press menu
          let pressTimer = null;
          let longPressed = false;

          item.addEventListener("pointerdown", ()=>{
            longPressed = false;
            pressTimer = setTimeout(()=>{
              longPressed = true;
              autoTaskMenu(d, t.id);
            }, 600);
          });
          item.addEventListener("pointerup", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
            if(!longPressed) toggleAuto(d, t.id);
          });
          item.addEventListener("pointerleave", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
          });

          list.appendChild(item);
        });
      }

      col.appendChild(head);
      col.appendChild(list);
      board.appendChild(col);
    });
  }

  // ===== Review today list =====
  function renderReviewToday(){
    const ul = document.getElementById("todayReviewList");
    const hint = document.getElementById("reviewHint");
    if(!ul || !hint) return;

    ul.innerHTML = "";

    const tasks = getAutoTasks(selectedDayKey).filter(t=>t.origin==="review");
    const done = tasks.filter(t=>t.done).length;

    hint.textContent = tasks.length ? `${done}/${tasks.length}` : "—";

    if(tasks.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "今日は復習タスクなし";
      ul.appendChild(li);
      return;
    }

    tasks.forEach(t=>{
      const li = document.createElement("li");
      const checkKey = `auto|${selectedDayKey}|${t.id}`;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = bulkSelection.has(checkKey);
      cb.onchange = ()=>toggleBulkKey(checkKey, cb.checked);

      const text = document.createElement("span");
      text.textContent = t.title; // already contains "復習n回目"
      if(t.done) text.className = "done";

      const meta = document.createElement("span");
      meta.className = "muted";
      meta.textContent = t.done ? "〇" : "";

      li.appendChild(cb);
      li.appendChild(text);
      li.appendChild(meta);

      // tap toggle (on text), long menu
      text.style.cursor = "pointer";
      text.onclick = ()=>toggleAuto(selectedDayKey, t.id);

      ul.appendChild(li);
    });
  }

  // ===== Bulk bar (in Daily view) =====
  function ensureBulkBar(){
    const daily = document.getElementById("daily");
    if(!daily) return;
    if(document.getElementById("bulkBar")) return;

    const bar = document.createElement("div");
    bar.id = "bulkBar";
    bar.className = "bulkBar";
    bar.style.display = "none";
    bar.innerHTML = `
      <div class="pill" id="bulkCount">0</div>
      <div class="row gap8">
        <button class="btn ghost" id="bulkCompleteBtn">✓ 一括完了</button>
        <button class="btn ghost" id="bulkMoveBtn">→ 明日に移動</button>
        <button class="btn ghost danger" id="bulkDeleteBtn">🗑 一括削除</button>
        <button class="btn ghost" id="bulkClearBtn">解除</button>
      </div>
    `;
    daily.appendChild(bar);

    document.getElementById("bulkCompleteBtn").onclick = bulkComplete;
    document.getElementById("bulkMoveBtn").onclick = bulkMoveTomorrow;
    document.getElementById("bulkDeleteBtn").onclick = bulkDelete;
    document.getElementById("bulkClearBtn").onclick = ()=>{
      bulkSelection.clear();
      render();
    };
  }

  function renderBulkBar(){
    const bar = document.getElementById("bulkBar");
    const cnt = document.getElementById("bulkCount");
    if(!bar || !cnt) return;

    const n = bulkSelection.size;
    cnt.textContent = `${n}件選択`;

    bar.style.display = n>0 ? "flex" : "none";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "space-between";
    bar.style.gap = "12px";
    bar.style.marginTop = "12px";
  }

  // ===== Render: Daily lists =====
  function renderDaily(){
    // date + meta
    const dDate = document.getElementById("dailyDate");
    const dMeta = document.getElementById("dailyMeta");
    if(dDate) dDate.textContent = selectedDayKey;

    const auto = getAutoTasks(selectedDayKey);
    const manual = getManualTasks(selectedDayKey);

    const all = [...auto, ...manual];
    const r = rateOf(all);
    if(dMeta){
      const aDone = auto.filter(t=>t.done).length;
      const mDone = manual.filter(t=>t.done).length;
      dMeta.textContent = `達成率 ${r===null?"—":r+"%"} / 自動 ${aDone}/${auto.length} / 手動 ${mDone}/${manual.length}`;
    }

    // countdown
    renderCountdown();

    // Today minutes pill
    const todayMin = document.getElementById("todayMinutes");
    if(todayMin) todayMin.textContent = `${getStudyMin(selectedDayKey)}分`;

    // auto list
    const autoUl = document.getElementById("dailyAutoList");
    if(autoUl){
      autoUl.innerHTML = "";

      if(auto.length===0){
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "まだ割当がありません（Settings→試験日/週容量→再計算）";
        autoUl.appendChild(li);
      } else {
        auto.forEach(t=>{
          const li = document.createElement("li");
          const checkKey = `auto|${selectedDayKey}|${t.id}`;

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = bulkSelection.has(checkKey);
          cb.onchange = ()=>toggleBulkKey(checkKey, cb.checked);

          const text = document.createElement("span");
          text.textContent = `【${t.type}】 ${t.title} (${t.estMin}m)`;
          if(t.done) text.className = "done";

          const right = document.createElement("span");
          right.className = "muted";
          right.textContent = t.done ? "〇" : "…";

          li.appendChild(cb);
          li.appendChild(text);
          li.appendChild(right);

          // tap toggle (on text), long menu
          let pressTimer=null; let longPressed=false;
          text.style.cursor = "pointer";

          text.addEventListener("pointerdown", ()=>{
            longPressed = false;
            pressTimer = setTimeout(()=>{
              longPressed = true;
              autoTaskMenu(selectedDayKey, t.id);
            }, 650);
          });
          text.addEventListener("pointerup", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
            if(!longPressed) toggleAuto(selectedDayKey, t.id);
          });
          text.addEventListener("pointerleave", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
          });

          autoUl.appendChild(li);
        });
      }
    }

    // manual list
    const manUl = document.getElementById("dailyManualList");
    if(manUl){
      manUl.innerHTML = "";
      const list = manual;

      if(list.length===0){
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "手動タスクはまだありません。";
        manUl.appendChild(li);
      } else {
        list.forEach((t, idx)=>{
          const li = document.createElement("li");
          const checkKey = `manual|${selectedDayKey}|${idx}`;

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = bulkSelection.has(checkKey);
          cb.onchange = ()=>toggleBulkKey(checkKey, cb.checked);

          const text = document.createElement("span");
          text.textContent = `【${t.type||"その他"}】 ${t.text}`;
          if(t.done) text.className = "done";

          const right = document.createElement("span");
          right.className = "muted";
          right.textContent = t.done ? "〇" : "🗑";

          li.appendChild(cb);
          li.appendChild(text);
          li.appendChild(right);

          // tap toggle, long delete
          let pressTimer=null; let longPressed=false;
          text.style.cursor = "pointer";

          text.addEventListener("pointerdown", ()=>{
            longPressed = false;
            pressTimer = setTimeout(()=>{
              longPressed = true;
              deleteManual(selectedDayKey, idx);
            }, 650);
          });
          text.addEventListener("pointerup", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
            if(!longPressed) toggleManual(selectedDayKey, idx);
          });
          text.addEventListener("pointerleave", ()=>{
            if(pressTimer) clearTimeout(pressTimer);
          });

          manUl.appendChild(li);
        });
      }
    }

    renderReviewToday();
    ensureBulkBar();
    renderBulkBar();
  }

  // ===== Render: Weekly =====
  function renderWeekly(){
    const weekLabel = document.getElementById("weekLabel");
    const weekMeta  = document.getElementById("weekMeta");
    if(weekLabel) weekLabel.textContent = weekRangeLabel(selectedWeekKey);

    const days = daysOfWeek(selectedWeekKey);
    const allAuto = days.flatMap(d=>getAutoTasks(d));
    const assigned = allAuto.reduce((a,t)=>a+(t.estMin||0),0);
    const cap = Number(store.settings.weeklyCapMinutes || 0) || 0;

    const weeklyCap = document.getElementById("weeklyCap");
    const weeklyAssigned = document.getElementById("weeklyAssigned");
    const weeklyRemain = document.getElementById("weeklyRemain");
    if(weeklyCap) weeklyCap.textContent = `${cap}m`;
    if(weeklyAssigned) weeklyAssigned.textContent = `${assigned}m`;
    if(weeklyRemain) weeklyRemain.textContent = `${Math.max(0, cap-assigned)}m`;

    if(weekMeta){
      const done = allAuto.filter(t=>t.done).length;
      weekMeta.textContent = `自動 ${done}/${allAuto.length} 完了`;
    }

    renderWeeklyBoard();
  }

  // ===== Render: Master =====
  function renderMaster(){
    const ul = document.getElementById("masterList");
    if(!ul) return;

    const q = (document.getElementById("masterSearch")?.value || "").trim().toLowerCase();
    const f = (document.getElementById("masterFilter")?.value || "all");

    let list = store.master.slice();

    if(f==="open") list = list.filter(x=>!x.done);
    if(f==="done") list = list.filter(x=>x.done);

    if(q){
      list = list.filter(x =>
        (x.title||"").toLowerCase().includes(q) ||
        (x.type||"").toLowerCase().includes(q) ||
        (x.notes||"").toLowerCase().includes(q)
      );
    }

    ul.innerHTML = "";

    if(list.length===0){
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "マスタータスクがありません。＋追加 か USCPAテンプレ投入 を使ってください。";
      ul.appendChild(li);
      return;
    }

    list.forEach(m=>{
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.textContent = `${m.done ? "✅" : "⬜"} 【${m.type}】 ${m.title} (${m.estMin}m)`;
      if(m.done) left.className = "done";

      const right = document.createElement("span");
      right.className = "muted";
      right.textContent = "✎";

      li.appendChild(left);
      li.appendChild(right);

      // tap = toggle done, long = edit menu
      let pressTimer=null; let longPressed=false;
      li.addEventListener("pointerdown", ()=>{
        longPressed = false;
        pressTimer = setTimeout(()=>{
          longPressed = true;
          editMasterTask(m.id);
        }, 650);
      });
      li.addEventListener("pointerup", ()=>{
        if(pressTimer) clearTimeout(pressTimer);
        if(!longPressed){
          m.done = !m.done;
          m.doneAt = m.done ? iso(new Date()) : null;
          save();
        }
      });
      li.addEventListener("pointerleave", ()=>{
        if(pressTimer) clearTimeout(pressTimer);
      });

      ul.appendChild(li);
    });
  }

  // ===== Render: History =====
  function renderHistory(){
    // weeks
    const hw = document.getElementById("historyWeeks");
    if(hw){
      hw.innerHTML = "";
      const keys = Object.keys(store.plan || {}).sort(); // based on plan
      const weekKeys = new Set(keys.map(k => getMonday(new Date(k + "T12:00:00"))));
      const sortedWeeks = [...weekKeys].sort().reverse().slice(0, 24);

      if(sortedWeeks.length===0){
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "履歴がまだありません。";
        hw.appendChild(li);
      } else {
        sortedWeeks.forEach(wk=>{
          const days = daysOfWeek(wk);
          const tasks = days.flatMap(d=>getAllDayTasks(d));
          const r = rateOf(tasks);

          const li = document.createElement("li");
          const left = document.createElement("span");
          left.textContent = weekRangeLabel(wk);
          const right = document.createElement("span");
          right.className = "muted";
          right.textContent = r===null ? "" : `${r}%`;

          li.appendChild(left);
          li.appendChild(right);

          li.onclick = ()=>{
            selectedWeekKey = wk;
            show("weekly");
          };

          hw.appendChild(li);
        });
      }
    }

    // days (last 14)
    const hd = document.getElementById("historyDays");
    if(hd){
      hd.innerHTML = "";
      const set = new Set([
        ...Object.keys(store.plan||{}),
        ...Object.keys(store.daily||{}),
        ...Object.keys(store.logs||{})
      ]);
      const keys = [...set].sort().slice(-14).reverse();

      if(keys.length===0){
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "履歴がまだありません。";
        hd.appendChild(li);
      } else {
        keys.forEach(d=>{
          const tasks = getAllDayTasks(d);
          const r = rateOf(tasks);

          const li = document.createElement("li");
          const left = document.createElement("span");
          left.textContent = d;
          const right = document.createElement("span");
          right.className = "muted";
          right.textContent = r===null ? "" : `${r}%`;

          li.appendChild(left);
          li.appendChild(right);

          li.onclick = ()=>{
            selectedDayKey = d;
            show("daily");
          };

          hd.appendChild(li);
        });
      }
    }
  }

  // ===== Countdown =====
  function renderCountdown(){
    const el = document.getElementById("examCountdown");
    if(!el) return;

    const exam = store.settings.examDate;
    if(!exam){
      el.textContent = "Exam: 未設定";
      return;
    }
    const now = new Date(todayKey + "T00:00:00");
    const ex  = new Date(exam + "T00:00:00");
    const diff = Math.ceil((ex - now) / (1000*60*60*24));
    el.textContent = diff >= 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
  }

  // ===== Main render =====
  function render(){
    // ensure tab view visible
    // (default to daily if none visible)
    const views = ["daily","weekly","master","calendar","history"];
    const anyVisible = views.some(id=>{
      const el = document.getElementById(id);
      return el && el.hidden === false;
    });
    if(!anyVisible){
      show("daily");
      return;
    }

    // render sections
    renderDaily();
    renderWeekly();
    renderMaster();
    renderCalendar();
    renderHistory();

    // settings button wiring
    const btnSettings = document.getElementById("btnSettings");
    if(btnSettings && !btnSettings.__wired){
      btnSettings.__wired = true;
      btnSettings.addEventListener("click", openSettings);
    }
  }

  // ===== Deep link =====
  function handleDeepLink(){
    const p = new URLSearchParams(location.search);
    const open = p.get("open");
    if(open === "weekly") show("weekly");
    else if(open === "history") show("history");
    else if(open === "calendar") show("calendar");
    else if(open === "master") show("master");
    else show("daily");
  }

  // ===== Expose to HTML =====
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
  window.addMasterTask = addMasterTask;

  window.addMinutes = addMinutes;
  window.resetDayMinutes = resetDayMinutes;

  window.rebuildAuto = rebuildAuto;
  window.seedDemo = seedDemo;
  window.wipeAll = wipeAll;

  // ===== init =====
  document.addEventListener("DOMContentLoaded", () => {
    handleDeepLink();
    render();
  });

})();
