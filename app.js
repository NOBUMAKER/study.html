/* ======================================================
   Study Log Pro (app.js) — Stable Build
   - Tabs work (daily / weekly / master / calendar / history)
   - Settings modal works (save/close/x)
   - Manual tasks + study minutes work
   - Master tasks + simple auto plan generator works
   ====================================================== */

(() => {
  "use strict";

  // ===== Storage =====
  const KEY = "study_pwa_v2"; // keep your existing key
  const TYPES = ["講義", "演習", "復習", "模試", "その他"];

  const DEFAULTS = {
    settings: {
      examDate: null,          // "YYYY-MM-DD"
      weeklyCapMin: 0,         // minutes per week
      reviewOffsets: [1,3,7,14]
    },
    master: [],                // [{id,title,type,estMin,done}]
    plan: {},                  // {"YYYY-MM-DD": { auto:[{id,masterId,title,type,estMin,done,origin}] }}
    daily: {},                 // manual tasks: {"YYYY-MM-DD":[{text,type,done}]}
    logs: {}                   // {"YYYY-MM-DD": {studyMin:number}}
  };

  function loadStore(){
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch(e){ raw = null; }
    const s = (raw && typeof raw === "object") ? raw : {};
    // migrate into stable schema (but keep unknown keys)
    s.settings ||= {};
    s.settings.examDate ??= DEFAULTS.settings.examDate;
    // accept both weeklyMinutes / weeklyCapInput style
    const legacyMin =
      (typeof s.settings.weeklyMinutes === "number" ? s.settings.weeklyMinutes : null) ??
      (typeof s.settings.weeklyCapMinutes === "number" ? s.settings.weeklyCapMinutes : null) ??
      null;

    if(typeof s.settings.weeklyCapMin !== "number"){
      s.settings.weeklyCapMin = (legacyMin !== null ? legacyMin : DEFAULTS.settings.weeklyCapMin);
    }

    // old v2 dailyTime -> logs
    s.logs ||= {};
    if(s.dailyTime && typeof s.dailyTime === "object"){
      for(const [d, mins] of Object.entries(s.dailyTime)){
        s.logs[d] ||= { studyMin: 0 };
        s.logs[d].studyMin = (s.logs[d].studyMin || 0) + (Number(mins) || 0);
      }
      delete s.dailyTime;
    }

    // ensure arrays/objects exist
    s.master ||= DEFAULTS.master;
    s.plan ||= DEFAULTS.plan;
    s.daily ||= DEFAULTS.daily;

    // review offsets
    if(!Array.isArray(s.settings.reviewOffsets) || s.settings.reviewOffsets.length === 0){
      s.settings.reviewOffsets = [...DEFAULTS.settings.reviewOffsets];
    }

    return s;
  }

  const store = loadStore();

  function save(){
    localStorage.setItem(KEY, JSON.stringify(store));
    render();
  }

  // ===== Date utils =====
  const iso = (d) => new Date(d).toISOString().slice(0,10);
  const todayKey = iso(new Date());

  let selectedDayKey = todayKey;

  function addDays(dayIso, n){
    const d = new Date(dayIso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return iso(d);
  }

  function getMonday(d = new Date()){
    const date = new Date(d);
    const day = date.getDay() || 7; // Sun=7
    if (day !== 1) date.setDate(date.getDate() - (day - 1));
    date.setHours(12,0,0,0);
    return iso(date);
  }

  let selectedWeekKey = getMonday();
  let calMonth = new Date();
  calMonth.setDate(1);

  function weekRangeLabel(mondayIso){
    return `${mondayIso} 〜 ${addDays(mondayIso, 6)}`;
  }

  function daysOfWeek(mondayIso){
    return Array.from({length:7}, (_,i)=>addDays(mondayIso, i));
  }

  // ===== Tabs =====
  const VIEWS = ["daily","weekly","master","calendar","history"];

  function setActiveTab(view){
    const map = {
      daily: "tabDaily",
      weekly: "tabWeekly",
      master: "tabMaster",
      calendar: "tabCalendar",
      history: "tabHistory",
    };
    for(const v of Object.keys(map)){
      const el = document.getElementById(map[v]);
      if(!el) continue;
      el.classList.toggle("active", v === view);
    }
  }

  function show(view){
    if(!VIEWS.includes(view)) view = "daily";
    for(const id of VIEWS){
      const sec = document.getElementById(id);
      if(sec) sec.hidden = (id !== view);
    }
    setActiveTab(view);
    render();
  }

  // ===== Navigation (exposed) =====
  function shiftDay(delta){ selectedDayKey = addDays(selectedDayKey, delta); render(); }
  function goToday(){ selectedDayKey = todayKey; render(); }

  function shiftWeek(delta){
    selectedWeekKey = addDays(selectedWeekKey, delta * 7);
    render();
  }
  function goThisWeek(){ selectedWeekKey = getMonday(); render(); }

  function shiftMonth(delta){
    const d = new Date(calMonth);
    d.setMonth(d.getMonth() + delta);
    d.setDate(1);
    calMonth = d;
    render();
  }
  function goThisMonth(){
    const d = new Date();
    d.setDate(1);
    calMonth = d;
    render();
  }

  // ===== Helpers =====
  function uid(prefix="id"){
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function getAuto(dayIso){
    return (store.plan?.[dayIso]?.auto) ? store.plan[dayIso].auto : [];
  }
  function getManual(dayIso){
    return (store.daily?.[dayIso]) ? store.daily[dayIso] : [];
  }
  function getStudyMin(dayIso){
    return (store.logs?.[dayIso]?.studyMin) ? Number(store.logs[dayIso].studyMin)||0 : 0;
  }
  function setStudyMin(dayIso, mins){
    store.logs ||= {};
    store.logs[dayIso] ||= { studyMin: 0 };
    store.logs[dayIso].studyMin = Math.max(0, mins|0);
  }

  function rateOf(list){
    if(!list || list.length === 0) return null;
    const done = list.filter(t=>t.done).length;
    return Math.round(done / list.length * 100);
  }

  // ===== Manual tasks =====
  function pickType(defaultType="演習"){
    const msg = "タイプ番号を入力:\n" + TYPES.map((t,i)=>`${i+1}) ${t}`).join("\n") + `\n\n(空欄なら ${defaultType})`;
    const raw = prompt(msg, "");
    if(raw === null) return null;
    if(raw.trim() === "") return defaultType;
    const n = parseInt(raw, 10);
    if(Number.isFinite(n) && n>=1 && n<=TYPES.length) return TYPES[n-1];
    if(TYPES.includes(raw.trim())) return raw.trim();
    return defaultType;
  }

  function addManualTask(){
    const text = prompt("手動タスク内容");
    if(!text) return;
    const type = pickType("演習");
    if(type === null) return;
    store.daily[selectedDayKey] ||= [];
    store.daily[selectedDayKey].push({ text, type, done:false });
    save();
  }

  function toggleManual(idx){
    const list = store.daily[selectedDayKey] || [];
    if(!list[idx]) return;
    list[idx].done = !list[idx].done;
    save();
  }

  function deleteManual(idx){
    const list = store.daily[selectedDayKey] || [];
    if(!list[idx]) return;
    if(!confirm("削除しますか？")) return;
    list.splice(idx, 1);
    save();
  }

  // ===== Study minutes =====
  function addMinutes(){
    const input = document.getElementById("minsInput");
    const v = parseInt(input?.value || "0", 10) || 0;
    if(input) input.value = "";
    if(v <= 0) return;
    setStudyMin(selectedDayKey, getStudyMin(selectedDayKey) + v);
    save();
  }

  function resetDayMinutes(){
    if(!confirm("学習時間を0にしますか？")) return;
    setStudyMin(selectedDayKey, 0);
    save();
  }

  // ===== Master =====
  function addMasterTask(){
    const title = prompt("マスタータスク名（例：FAR Unit 3 講義）");
    if(!title) return;
    const type = pickType("講義");
    if(type === null) return;
    const estMin = Math.max(1, parseInt(prompt("推定時間（分）", "120") || "0", 10) || 0);
    store.master.push({ id: uid("m"), title, type, estMin, done:false });
    save();
  }

  function toggleMaster(id){
    const m = store.master.find(x=>x.id===id);
    if(!m) return;
    m.done = !m.done;
    save();
  }

  function editMaster(id){
    const m = store.master.find(x=>x.id===id);
    if(!m) return;
    const title = prompt("タイトル", m.title);
    if(!title) return;
    const type = pickType(m.type || "講義");
    if(type === null) return;
    const estMin = Math.max(1, parseInt(prompt("推定時間（分）", String(m.estMin||0)) || "0", 10) || m.estMin);
    m.title = title;
    m.type = type;
    m.estMin = estMin;
    save();
  }

  function deleteMaster(id){
    if(!confirm("マスタータスクを削除しますか？")) return;
    store.master = store.master.filter(x=>x.id!==id);
    save();
  }

  // ===== Settings modal =====
  function openSettings(){
    const modal = document.getElementById("settingsModal");
    if(!modal) return;
    modal.hidden = false;

    const examEl = document.getElementById("examDateInput");
    const weekEl = document.getElementById("weeklyCapInput");
    const offEl  = document.getElementById("reviewOffsetsInput");

    if(examEl) examEl.value = store.settings.examDate || "";
    if(weekEl) weekEl.value = store.settings.weeklyCapMin ? String(store.settings.weeklyCapMin) : "";
    if(offEl)  offEl.value  = (store.settings.reviewOffsets || [1,3,7,14]).join(",");

    setTimeout(()=>examEl?.focus?.(), 0);
  }

  function closeSettings(){
    const modal = document.getElementById("settingsModal");
    if(!modal) return;
    modal.hidden = true;
  }

  function parseOffsets(v){
    return String(v || "")
      .split(/[,\s]+/)
      .map(x=>parseInt(x,10))
      .filter(n=>Number.isFinite(n) && n>0)
      .slice(0, 20);
  }

  function saveSettings(){
    const examEl = document.getElementById("examDateInput");
    const weekEl = document.getElementById("weeklyCapInput");
    const offEl  = document.getElementById("reviewOffsetsInput");

    const exam = (examEl?.value || "").trim() || null;
    const weeklyCapMin = Math.max(0, parseInt((weekEl?.value || "0"), 10) || 0);
    const offsets = parseOffsets(offEl?.value);
    store.settings.examDate = exam;
    store.settings.weeklyCapMin = weeklyCapMin;
    store.settings.reviewOffsets = offsets.length ? offsets : [1,3,7,14];

    save();
    closeSettings();
    // optional: regenerate plan
    generateAutoPlan();
  }

  // ===== Auto plan (simple + stable) =====
  function generateAutoPlan(){
    const exam = store.settings.examDate;
    const capWeek = Number(store.settings.weeklyCapMin) || 0;
    if(!exam || capWeek <= 0) {
      // no hard error; just keep existing
      return;
    }

    // rebuild plan fresh (simple)
    store.plan ||= {};
    store.plan = {};

    const start = todayKey;
    const end = exam;
    if(end < start) return;

    // capacity per day: distribute equally 7 days
    const capPerDay = Math.floor(capWeek / 7);

    // queue remaining minutes for open masters
    const queue = store.master.filter(m=>!m.done).map(m=>({
      masterId: m.id,
      title: m.title,
      type: m.type || "その他",
      remaining: Number(m.estMin)||0
    }));

    let d = start;
    while(d <= end && queue.length){
      store.plan[d] ||= { auto: [] };
      let cap = capPerDay;

      while(cap > 0 && queue.length){
        const cur = queue[0];
        const chunk = Math.min(cap, cur.remaining);
        store.plan[d].auto.push({
          id: uid("a"),
          masterId: cur.masterId,
          title: cur.title,
          type: cur.type,
          estMin: chunk,
          done: false,
          origin: "master"
        });
        cur.remaining -= chunk;
        cap -= chunk;
        if(cur.remaining <= 0) queue.shift();
      }
      d = addDays(d, 1);
    }

    // add review suggestions (lightweight, not capacity-aware)
    const offsets = store.settings.reviewOffsets || [1,3,7,14];
    const firstByMaster = new Map();
    for(const day of Object.keys(store.plan).sort()){
      for(const t of (store.plan[day].auto||[])){
        if(t.masterId && !firstByMaster.has(t.masterId)){
          firstByMaster.set(t.masterId, day);
        }
      }
    }
    for(const [mid, firstDay] of firstByMaster.entries()){
      const m = store.master.find(x=>x.id===mid);
      if(!m) continue;
      if(m.type !== "講義" && m.type !== "演習") continue;

      offsets.forEach((k, idx)=>{
        const rd = addDays(firstDay, k);
        if(rd < start || rd > end) return;
        store.plan[rd] ||= { auto: [] };
        store.plan[rd].auto.push({
          id: uid("r"),
          masterId: mid,
          title: `復習: ${m.title}（${k}日後）`,
          type: "復習",
          estMin: 20 + idx*5,
          done: false,
          origin: "review"
        });
      });
    }

    save();
  }

  function rebuildAuto(){
    generateAutoPlan();
  }

  // ===== Calendar render (simple) =====
  const WEEKDAYS = ["月","火","水","木","金","土","日"];
  function renderCalendar(){
    const grid = document.getElementById("calendarGrid");
    const label = document.getElementById("calMonthLabel");
    if(!grid || !label) return;

    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    label.textContent = `${y}年 ${m+1}月`;

    grid.innerHTML = "";
    WEEKDAYS.forEach(w=>{
      const h = document.createElement("div");
      h.className = "calHead";
      h.textContent = w;
      grid.appendChild(h);
    });

    const first = new Date(y, m, 1);
    const firstIso = iso(first);
    const jsDay = first.getDay(); // Sun..Sat
    const idx = (jsDay + 6) % 7;  // Mon=0
    const startIso = addDays(firstIso, -idx);

    for(let i=0;i<42;i++){
      const dayIso = addDays(startIso, i);
      const d = new Date(dayIso+"T12:00:00");
      const inMonth = d.getMonth() === m;

      const all = [...getAuto(dayIso), ...getManual(dayIso)];
      const r = rateOf(all);

      const cell = document.createElement("div");
      cell.className = `calCell ${inMonth ? "" : "outMonth"}`;
      cell.innerHTML = `
        <div class="calTop">
          <span class="calDay">${d.getDate()}</span>
          <span class="calRate">${r===null ? "" : r+"%"}</span>
        </div>
        <div class="calRate">${all.length ? (all.filter(t=>t.done).length + "/" + all.length) : ""}</div>
      `;
      cell.onclick = ()=>{ selectedDayKey = dayIso; show("daily"); };
      grid.appendChild(cell);
    }
  }

  // ===== Render =====
  function render(){
    // Top: countdown pill (optional)
    const countdown = document.getElementById("examCountdown");
    if(countdown){
      const exam = store.settings.examDate;
      if(!exam) countdown.textContent = "試験日 未設定";
      else{
        const diff = Math.ceil((new Date(exam+"T00:00:00") - new Date(todayKey+"T00:00:00")) / (1000*60*60*24));
        countdown.textContent = diff >= 0 ? `試験まで ${diff}日` : "試験日を過ぎています";
      }
    }

    // ===== DAILY =====
    const dDate = document.getElementById("dailyDate");
    const dMeta = document.getElementById("dailyMeta");
    if(dDate) dDate.textContent = selectedDayKey;
    if(dMeta){
      const all = [...getAuto(selectedDayKey), ...getManual(selectedDayKey)];
      const r = rateOf(all);
      dMeta.textContent = r===null ? "—" : `達成率 ${r}%`;
    }

    // Daily auto list
    const autoList = document.getElementById("dailyAutoList");
    if(autoList){
      const auto = getAuto(selectedDayKey);
      autoList.innerHTML = "";
      if(auto.length===0){
        const li = document.createElement("li");
        li.textContent = "割当なし（Masterと週容量を設定→再計算）";
        li.style.opacity = "0.7";
        autoList.appendChild(li);
      }else{
        auto.forEach(t=>{
          const li = document.createElement("li");
          li.innerHTML = `<span>${t.done ? "✅ " : ""}【${t.type}】 ${t.title} (${t.estMin}m)</span><span>${t.done ? "〇" : ""}</span>`;
          li.style.cursor = "pointer";
          li.onclick = ()=>{
            t.done = !t.done;
            save();
          };
          autoList.appendChild(li);
        });
      }
    }

    // Daily manual list
    const manualList = document.getElementById("dailyManualList");
    if(manualList){
      const manual = getManual(selectedDayKey);
      manualList.innerHTML = "";
      if(manual.length===0){
        const li = document.createElement("li");
        li.textContent = "手動タスクなし";
        li.style.opacity = "0.7";
        manualList.appendChild(li);
      }else{
        manual.forEach((t, i)=>{
          const li = document.createElement("li");
          li.innerHTML = `<span>${t.done ? "✅ " : ""}【${t.type}】 ${t.text}</span><span>${t.done ? "〇" : ""}</span>`;
          li.style.cursor = "pointer";
          li.onclick = ()=>toggleManual(i);
          li.oncontextmenu = (e)=>{ e.preventDefault(); deleteManual(i); };
          manualList.appendChild(li);
        });
      }
    }

    // Study minutes UI
    const todayMinEl = document.getElementById("todayMinutes");
    if(todayMinEl) todayMinEl.textContent = `学習時間 ${getStudyMin(selectedDayKey)}分`;

    // Review list (show only review tasks for today)
    const reviewList = document.getElementById("todayReviewList");
    const reviewHint = document.getElementById("reviewHint");
    if(reviewList){
      const reviews = getAuto(selectedDayKey).filter(t=>t.origin==="review");
      reviewList.innerHTML = "";
      if(reviewHint) reviewHint.textContent = reviews.length ? `${reviews.length}件` : "—";
      if(reviews.length===0){
        const li = document.createElement("li");
        li.textContent = "—";
        li.style.opacity = "0.7";
        reviewList.appendChild(li);
      }else{
        reviews.forEach(t=>{
          const li = document.createElement("li");
          li.innerHTML = `<span>${t.done ? "✅ " : ""}${t.title} (${t.estMin}m)</span><span>${t.done ? "〇" : ""}</span>`;
          li.style.cursor = "pointer";
          li.onclick = ()=>{ t.done = !t.done; save(); };
          reviewList.appendChild(li);
        });
      }
    }

    // ===== WEEKLY =====
    const weekLabel = document.getElementById("weekLabel");
    const weekMeta = document.getElementById("weekMeta");
    if(weekLabel) weekLabel.textContent = weekRangeLabel(selectedWeekKey);
    if(weekMeta){
      const cap = Number(store.settings.weeklyCapMin)||0;
      weekMeta.textContent = cap ? `週容量 ${cap}分` : "週容量 未設定";
    }

    // Weekly board
    const board = document.getElementById("weeklyAutoBoard");
    if(board){
      board.innerHTML = "";
      const days = daysOfWeek(selectedWeekKey);
      days.forEach(dayIso=>{
        const col = document.createElement("div");
        col.className = "card";
        col.style.padding = "10px";
        col.innerHTML = `<div class="h2">${dayIso.slice(5)}</div><div class="muted" style="margin-bottom:8px">${dayIso}</div>`;
        const ul = document.createElement("ul");
        ul.className = "list compact";
        const tasks = getAuto(dayIso);
        if(tasks.length===0){
          const li = document.createElement("li");
          li.textContent = "—";
          li.style.opacity = "0.7";
          ul.appendChild(li);
        }else{
          tasks.forEach(t=>{
            const li = document.createElement("li");
            li.innerHTML = `<span>${t.done ? "✅ " : ""}${t.title} (${t.estMin}m)</span><span>${t.done ? "〇" : ""}</span>`;
            li.style.cursor = "pointer";
            li.onclick = ()=>{ t.done = !t.done; save(); };
            ul.appendChild(li);
          });
        }
        col.appendChild(ul);
        board.appendChild(col);
      });
    }

    // Weekly KPI
    const capEl = document.getElementById("weeklyCap");
    const assignedEl = document.getElementById("weeklyAssigned");
    const remainEl = document.getElementById("weeklyRemain");
    if(capEl || assignedEl || remainEl){
      const cap = Number(store.settings.weeklyCapMin)||0;
      const days = daysOfWeek(selectedWeekKey);
      const assigned = days.reduce((sum,d)=> sum + getAuto(d).reduce((a,t)=>a+(t.estMin||0),0), 0);
      const remain = Math.max(0, cap - assigned);
      if(capEl) capEl.textContent = cap ? `${cap}分` : "—";
      if(assignedEl) assignedEl.textContent = `${assigned}分`;
      if(remainEl) remainEl.textContent = `${remain}分`;
    }

    // ===== MASTER =====
    const masterList = document.getElementById("masterList");
    if(masterList){
      const q = (document.getElementById("masterSearch")?.value || "").trim().toLowerCase();
      const filter = document.getElementById("masterFilter")?.value || "all";

      let list = store.master.slice();
      if(q) list = list.filter(m => (m.title||"").toLowerCase().includes(q));
      if(filter === "open") list = list.filter(m=>!m.done);
      if(filter === "done") list = list.filter(m=>m.done);

      masterList.innerHTML = "";
      if(list.length===0){
        const li = document.createElement("li");
        li.textContent = "マスタータスクなし";
        li.style.opacity = "0.7";
        masterList.appendChild(li);
      }else{
        list.forEach(m=>{
          const li = document.createElement("li");
          li.innerHTML = `<span>${m.done ? "✅ " : ""}【${m.type}】 ${m.title} (${m.estMin}m)</span><span>…</span>`;
          li.style.cursor = "pointer";
          li.onclick = ()=>{
            const op = prompt(
              `操作:\n1) 完了切替\n2) 編集\n3) 削除\n\n番号を入力`,
              "1"
            );
            const n = parseInt(op||"",10);
            if(n===1) toggleMaster(m.id);
            if(n===2) editMaster(m.id);
            if(n===3) deleteMaster(m.id);
          };
          masterList.appendChild(li);
        });
      }
    }

    // ===== CALENDAR =====
    renderCalendar();

    // ===== HISTORY =====
    const hw = document.getElementById("historyWeeks");
    if(hw){
      hw.innerHTML = "";
      // last 12 weeks
      const nowMon = getMonday();
      const weeks = Array.from({length:12}, (_,i)=>addDays(nowMon, -7*i));
      weeks.forEach(w=>{
        const li = document.createElement("li");
        li.textContent = weekRangeLabel(w);
        li.style.cursor = "pointer";
        li.onclick = ()=>{ selectedWeekKey = w; show("weekly"); };
        hw.appendChild(li);
      });
    }

    const hd = document.getElementById("historyDays");
    if(hd){
      hd.innerHTML = "";
      const days = Array.from({length:14}, (_,i)=>addDays(todayKey, -i));
      days.forEach(d=>{
        const all = [...getAuto(d), ...getManual(d)];
        const r = rateOf(all);
        const li = document.createElement("li");
        li.innerHTML = `<span>${d}</span><span>${r===null ? "" : r+"%"}</span>`;
        li.style.cursor = "pointer";
        li.onclick = ()=>{ selectedDayKey = d; show("daily"); };
        hd.appendChild(li);
      });
    }
  }

  // ===== Optional helper buttons =====
  function seedDemo(){
    if(!confirm("USCPAテンプレ（サンプル）を投入しますか？")) return;
    store.master ||= [];
    store.master.push(
      {id:uid("m"), title:"FAR Unit 1 講義", type:"講義", estMin:180, done:false},
      {id:uid("m"), title:"FAR Unit 1 MCQ 100問", type:"演習", estMin:120, done:false},
      {id:uid("m"), title:"AUD Unit 2 講義", type:"講義", estMin:150, done:false},
      {id:uid("m"), title:"AUD Unit 2 SIM", type:"演習", estMin:90, done:false},
    );
    save();
    generateAutoPlan();
  }

  function wipeAll(){
    if(!confirm("全データ削除しますか？（元に戻せません）")) return;
    localStorage.removeItem(KEY);
    location.reload();
  }

  // ===== Wire header settings button =====
  document.addEventListener("DOMContentLoaded", () => {
    // make sure tabs always work even if inline onclick is missing
    document.getElementById("btnSettings")?.addEventListener("click", openSettings);
    // initial render
    render();
  });

  // ===== Expose functions for inline onclick =====
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

  window.rebuildAuto = rebuildAuto;
  window.seedDemo = seedDemo;
  window.wipeAll = wipeAll;

  // start on daily
  show("daily");
})();
