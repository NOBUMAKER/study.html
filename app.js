/* =========================================
   Study Log Pro (app.js) FULL REPLACE
   - Pro HTML 専用（Today/Week/Master/Calendar/History）
   - Settings modal（保存/閉じる/×）確実に動作
   - 手動タスク / 自動割当（マスター→試験日まで割当）
   - 学習時間は手動入力のみ（分を加算/0にする）
   - 復習（1,3,7,14日後）を自動表示（提案）
   - 編集：タスクはタップで完了、長押し/メニューで編集
   ========================================= */

(() => {
  "use strict";

  // ===== Storage =====
  const KEY = "study_pwa_v3_pro";
  const TYPES = ["講義", "演習", "復習", "模試", "その他"];

  const DEFAULT_SETTINGS = {
    examDate: null,              // "YYYY-MM-DD"
    weeklyCapMin: 900,           // 週の学習可能時間（分）
    reviewOffsets: [1, 3, 7, 14], // 復習日
    dayWeights: [1,1,1,1,1,0.7,0.5], // 月..日
    dailyChunkMin: 60,           // 自動割当の1チャンク最大（分）
  };

  const store = loadStore();
  function loadStore() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch(e) {}
    const s = (raw && typeof raw === "object") ? raw : {};
    s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    s.master ||= [];         // [{id,title,type,estMin,notes,done,doneAt,createdAt}]
    s.plan ||= {};           // {"YYYY-MM-DD": {auto:[{id,masterId,title,type,estMin,done,origin,locked}]}}
    s.manual ||= {};         // {"YYYY-MM-DD": [{id,text,type,done,createdAt}]}
    s.logs ||= {};           // {"YYYY-MM-DD": {studyMin:number}}
    s.weekNotes ||= {};      // optional future
    return s;
  }
  function save(noRender=false){
    localStorage.setItem(KEY, JSON.stringify(store));
    if(!noRender) render();
  }

  // ===== Date utils =====
  const iso = (d) => new Date(d).toISOString().slice(0,10);
  const todayKey = iso(new Date());
  let selectedDayKey = todayKey;
  let selectedWeekKey = getMonday(new Date());
  let calMonth = (()=>{ const d=new Date(); d.setDate(1); return d; })();

  function getMonday(d=new Date()){
    const date = new Date(d);
    const day = date.getDay() || 7;
    if(day !== 1) date.setDate(date.getDate() - (day - 1));
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
  function weekdayIndex(isoDate){
    const d = new Date(isoDate + "T12:00:00");
    const js = d.getDay(); // 0 Sun..6 Sat
    return (js + 6) % 7;   // 0 Mon..6 Sun
  }
  function weekRangeLabel(mondayIso){
    const sunIso = addDays(mondayIso, 6);
    return `${mondayIso} 〜 ${sunIso}`;
  }
  function daysOfWeek(mondayIso){
    return Array.from({length:7}, (_,i)=>addDays(mondayIso, i));
  }

  // ===== Helpers =====
  function uid(prefix="id"){
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
  function clampInt(v, min=0, max=Number.MAX_SAFE_INTEGER){
    const n = parseInt(v, 10);
    if(!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }
  function rateOf(list){
    if(!list || list.length===0) return null;
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

  function getAuto(day){ return (store.plan?.[day]?.auto) ? store.plan[day].auto : []; }
  function getManual(day){ return store.manual?.[day] ? store.manual[day] : []; }
  function getAllDay(day){ return [...getAuto(day), ...getManual(day)]; }

  function getStudyMin(day){
    return (store.logs?.[day]?.studyMin) ? (Number(store.logs[day].studyMin)||0) : 0;
  }
  function addStudyMin(day, mins){
    store.logs ||= {};
    store.logs[day] ||= { studyMin: 0 };
    store.logs[day].studyMin = Math.max(0, (store.logs[day].studyMin||0) + mins);
  }
  function setStudyMin(day, mins){
    store.logs ||= {};
    store.logs[day] ||= { studyMin: 0 };
    store.logs[day].studyMin = Math.max(0, mins|0);
  }

  // ===== View switch =====
  const VIEW_IDS = ["daily","weekly","master","calendar","history"];
  function setActiveTab(view){
    const map = { daily:"Daily", weekly:"Weekly", master:"Master", calendar:"Calendar", history:"History" };
    Object.entries(map).forEach(([k, suf])=>{
      const b = document.getElementById("tab"+suf);
      if(b) b.classList.toggle("active", k === view);
    });
  }
  function show(view){
    VIEW_IDS.forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.hidden = (id !== view);
    });
    setActiveTab(view);
    render();
  }

  // ===== Settings modal (Pro HTML id fixed) =====
  function openSettings(){
    const m = document.getElementById("settingsModal");
    if(!m) return;

    // hidden解除 + display保険（CSSがdisplay:noneにしてても復活）
    m.hidden = false;
    m.style.display = "flex";
    m.style.pointerEvents = "auto";

    // 値反映
    const examEl = document.getElementById("examDateInput");
    const capEl  = document.getElementById("weeklyCapInput");
    const offEl  = document.getElementById("reviewOffsetsInput");

    if(examEl) examEl.value = store.settings.examDate || "";
    if(capEl) capEl.value = String(store.settings.weeklyCapMin ?? 0);
    if(offEl) offEl.value = (store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets).join(",");

    if(examEl) setTimeout(()=>examEl.focus(), 0);
  }
  function closeSettings(){
    const m = document.getElementById("settingsModal");
    if(!m) return;
    m.hidden = true;
    m.style.display = "none";
  }
  function parseOffsetsInput(v){
    if(!v) return DEFAULT_SETTINGS.reviewOffsets.slice();
    const arr = String(v).split(/[,\s]+/)
      .map(x=>parseInt(x,10))
      .filter(n=>Number.isFinite(n) && n>0);
    return arr.length ? arr.slice(0, 20) : DEFAULT_SETTINGS.reviewOffsets.slice();
  }
  function saveSettings(){
    const examEl = document.getElementById("examDateInput");
    const capEl  = document.getElementById("weeklyCapInput");
    const offEl  = document.getElementById("reviewOffsetsInput");

    const exam = (examEl?.value || "").trim();
    const capMin = clampInt(capEl?.value || "0", 0, 200000);
    const offsets = parseOffsetsInput(offEl?.value || "");

    if(exam) store.settings.examDate = exam; // YYYY-MM-DD (type=date)
    store.settings.weeklyCapMin = capMin;
    store.settings.reviewOffsets = offsets;

    save();
    closeSettings();
  }

  // ===== Manual tasks =====
  function pickType(defaultType="演習"){
    const msg =
      "タイプ番号を入力:\n" +
      TYPES.map((t,i)=>`${i+1}) ${t}`).join("\n") +
      `\n\n空欄なら ${defaultType}`;
    const raw = prompt(msg, "");
    if(raw === null) return null;
    if(raw.trim()==="") return defaultType;
    const n = parseInt(raw,10);
    if(Number.isFinite(n) && n>=1 && n<=TYPES.length) return TYPES[n-1];
    if(TYPES.includes(raw.trim())) return raw.trim();
    return defaultType;
  }

  // Pro HTML: Today の「＋追加」用
  function addManualTask(){
    const text = prompt("タスク内容");
    if(!text) return;
    const type = pickType("演習");
    if(type===null) return;

    store.manual[selectedDayKey] ||= [];
    store.manual[selectedDayKey].push({
      id: uid("man"),
      text,
      type,
      done:false,
      createdAt: iso(new Date())
    });
    save();
  }

  function toggleManual(day, id){
    const list = store.manual?.[day] || [];
    const t = list.find(x=>x.id===id);
    if(!t) return;
    t.done = !t.done;
    save();
  }
  function editManual(day, id){
    const list = store.manual?.[day] || [];
    const t = list.find(x=>x.id===id);
    if(!t) return;

    const v = prompt("タスク内容を編集", t.text);
    if(v===null) return;
    const nt = v.trim();
    if(!nt) return;

    t.text = nt;
    save();
  }
  function deleteManual(day, id){
    if(!confirm("このタスクを削除しますか？")) return;
    const list = store.manual?.[day] || [];
    const idx = list.findIndex(x=>x.id===id);
    if(idx<0) return;
    list.splice(idx,1);
    store.manual[day] = list;
    save();
  }

  // ===== Master tasks =====
  function addMasterTask(){
    const title = prompt("マスタータスク名（例：FAR Unit 3 講義）");
    if(!title) return;
    const type = pickType("講義");
    if(type===null) return;

    const est = prompt("推定時間（分）例：120", "120");
    if(est===null) return;
    const estMin = Math.max(1, clampInt(est, 1, 200000));

    const notes = prompt("メモ（任意）", "") || "";

    store.master.push({
      id: uid("m"),
      title: title.trim(),
      type,
      estMin,
      notes,
      done: false,
      doneAt: null,
      createdAt: iso(new Date())
    });
    save();
  }

  function toggleMaster(id){
    const m = store.master.find(x=>x.id===id);
    if(!m) return;
    m.done = !m.done;
    m.doneAt = m.done ? iso(new Date()) : null;
    save();
  }

  function editMaster(id){
    const m = store.master.find(x=>x.id===id);
    if(!m) return;

    const op = prompt(
`編集：
1) タイトル
2) タイプ
3) 推定時間（分）
4) メモ
5) 削除`,
      "1"
    );
    if(op===null) return;
    const n = parseInt(op,10);
    if(!Number.isFinite(n)) return;

    if(n===1){
      const v = prompt("タイトル", m.title);
      if(v===null) return;
      if(v.trim()) m.title = v.trim();
    }
    if(n===2){
      const t = pickType(m.type || "講義");
      if(t===null) return;
      m.type = t;
    }
    if(n===3){
      const v = prompt("推定時間（分）", String(m.estMin));
      if(v===null) return;
      m.estMin = Math.max(1, clampInt(v, 1, 200000));
    }
    if(n===4){
      const v = prompt("メモ", m.notes || "");
      if(v===null) return;
      m.notes = v;
    }
    if(n===5){
      if(confirm("このマスタータスクを削除しますか？")){
        store.master = store.master.filter(x=>x.id!==id);
      }
    }
    save();
  }

  // ===== Auto plan generation =====
  function collectLockedAuto(){
    const locked = {};
    Object.entries(store.plan || {}).forEach(([d,p])=>{
      const arr = (p.auto||[]).filter(t=>t.locked);
      if(arr.length) locked[d] = arr.map(x=>({...x}));
    });
    return locked;
  }

  function buildDailyCapacityMap(startIso, endIso){
    const cap = {};
    const totalMinPerWeek = Math.max(0, Number(store.settings.weeklyCapMin||0));
    const w = (Array.isArray(store.settings.dayWeights) && store.settings.dayWeights.length===7)
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

  function rebuildAuto(){
    const exam = store.settings.examDate;
    if(!exam){
      alert("Settingsで試験日を設定してください。");
      openSettings();
      return;
    }

    const start = todayKey;
    const end = exam;

    // lockedだけ残して再生成
    const locked = collectLockedAuto();
    store.plan = {};
    Object.entries(locked).forEach(([d,arr])=>{
      store.plan[d] ||= { auto: [] };
      store.plan[d].auto = arr;
    });

    // daily capacity
    const cap = buildDailyCapacityMap(start, end);
    // locked分を差し引き
    for(const d of Object.keys(cap)){
      const used = (store.plan[d]?.auto||[]).reduce((a,t)=>a+(t.estMin||0),0);
      cap[d] = Math.max(0, cap[d]-used);
    }

    // 未完了masterを順に詰める
    const masters = (store.master||[]).filter(m=>!m.done);

    for(const m of masters){
      let remaining = m.estMin;

      let d = start;
      while(remaining > 0 && d <= end){
        store.plan[d] ||= { auto: [] };
        store.plan[d].auto ||= [];

        const c = cap[d] || 0;
        if(c > 0){
          const chunk = Math.min(c, remaining, store.settings.dailyChunkMin || DEFAULT_SETTINGS.dailyChunkMin);
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
        alert(`割当が足りません：\n"${m.title}" が残り ${remaining} 分\n週の容量を増やすか、試験日を延ばしてください。`);
        break;
      }
    }

    // 復習（提案としてplanに追加）
    const offsets = store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets;
    const firstDateByMaster = {};

    Object.keys(store.plan).sort().forEach(d=>{
      (store.plan[d].auto||[]).forEach(t=>{
        if(t.masterId && t.origin==="master" && !firstDateByMaster[t.masterId]){
          firstDateByMaster[t.masterId] = d;
        }
      });
    });

    Object.entries(firstDateByMaster).forEach(([mid, firstDay])=>{
      const m = store.master.find(x=>x.id===mid);
      if(!m) return;
      if(m.type !== "講義" && m.type !== "演習") return;

      offsets.forEach((k, idx)=>{
        const rd = addDays(firstDay, k);
        if(rd < start || rd > end) return;
        store.plan[rd] ||= { auto: [] };
        const name = `復習: ${m.title}（${k}日後）`;
        const exists = (store.plan[rd].auto||[]).some(x=>x.origin==="review" && x.masterId===mid && x.title===name);
        if(exists) return;

        store.plan[rd].auto.push({
          id: uid("auto"),
          masterId: mid,
          title: name,
          type: "復習",
          estMin: 20 + idx*5,
          done: false,
          origin: "review",
          locked: false
        });
      });
    });

    save();
  }

  function toggleAuto(day, id){
    const list = store.plan?.[day]?.auto || [];
    const t = list.find(x=>x.id===id);
    if(!t) return;
    t.done = !t.done;
    save();
  }

  function autoMenu(day, id){
    const list = store.plan?.[day]?.auto || [];
    const idx = list.findIndex(x=>x.id===id);
    if(idx<0) return;
    const t = list[idx];

    const raw = prompt(
`自動タスク操作：
1) 日付移動（YYYY-MM-DD）
2) 推定時間変更（分）
3) 分割（例: 30 + 30）
4) 削除
5) 手動へ移す（同日手動）

番号を入力`,
      "2"
    );
    if(raw===null) return;
    const n = parseInt(raw,10);
    if(!Number.isFinite(n)) return;

    if(n===1){
      const to = prompt("移動先（YYYY-MM-DD）", day);
      if(!to) return;
      store.plan[to] ||= { auto: [] };
      store.plan[to].auto ||= [];
      store.plan[to].auto.push(t);
      list.splice(idx,1);
      save();
      return;
    }
    if(n===2){
      const v = prompt("推定時間（分）", String(t.estMin||0));
      if(v===null) return;
      t.estMin = Math.max(1, clampInt(v, 1, 200000));
      save();
      return;
    }
    if(n===3){
      const a = clampInt(prompt("分割後1つ目（分）","30") ?? "0", 1, 200000);
      const b = clampInt(prompt("分割後2つ目（分）","30") ?? "0", 1, 200000);
      const first = {...t, id: uid("auto"), estMin: a, done:false};
      const second= {...t, id: uid("auto"), estMin: b, done:false};
      list.splice(idx,1, first, second);
      save();
      return;
    }
    if(n===4){
      if(!confirm("削除しますか？")) return;
      list.splice(idx,1);
      save();
      return;
    }
    if(n===5){
      store.manual[day] ||= [];
      store.manual[day].push({ id: uid("man"), text: t.title, type: t.type||"その他", done:t.done, createdAt: iso(new Date()) });
      list.splice(idx,1);
      save();
      return;
    }
  }

  // ===== UI renderers =====
  function el(id){ return document.getElementById(id); }
  function clear(node){ if(node) node.innerHTML = ""; }

  function renderDaily(){
    el("dailyDate").textContent = selectedDayKey;

    // meta
    const all = getAllDay(selectedDayKey);
    const r = rateOf(all);
    el("dailyMeta").textContent = [
      r===null ? "—" : `達成率 ${r}%`,
      `学習時間 ${getStudyMin(selectedDayKey)}分`,
      store.settings.examDate ? `試験日 ${store.settings.examDate}` : "試験日 未設定"
    ].join(" / ");

    // countdown pill
    const cd = el("examCountdown");
    if(cd){
      if(!store.settings.examDate){
        cd.textContent = "Exam: —";
      } else {
        const days = Math.ceil((new Date(store.settings.examDate+"T00:00:00") - new Date(todayKey+"T00:00:00")) / 86400000);
        cd.textContent = days>=0 ? `Exam in ${days}d` : `Exam passed`;
      }
    }

    // auto list
    const auto = getAuto(selectedDayKey);
    const autoUl = el("dailyAutoList");
    clear(autoUl);
    if(auto.length===0){
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "まだ割当がありません。Masterにタスクを入れて「再計算」してください。";
      autoUl.appendChild(li);
    } else {
      auto.forEach(t=>{
        const li = document.createElement("li");
        li.className = "rowItem";
        li.innerHTML = `
          <div class="left ${t.done ? "done":""}">
            <div class="title">【${t.type}】 ${escapeHtml(t.title)}</div>
            <div class="sub muted">${t.origin === "review" ? "復習" : "自動"} / ${t.estMin||0}分</div>
          </div>
          <div class="right">
            <button class="miniBtn" data-act="edit">✎</button>
          </div>
        `;
        li.addEventListener("click", (e)=>{
          const btn = e.target.closest("button");
          if(btn){
            if(btn.dataset.act==="edit") autoMenu(selectedDayKey, t.id);
            return;
          }
          toggleAuto(selectedDayKey, t.id);
        });
        autoUl.appendChild(li);
      });
    }

    // manual list
    const manual = getManual(selectedDayKey);
    const manUl = el("dailyManualList");
    clear(manUl);
    if(manual.length===0){
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "手動タスクはまだありません。";
      manUl.appendChild(li);
    } else {
      manual.forEach(t=>{
        const li = document.createElement("li");
        li.className = "rowItem";
        li.innerHTML = `
          <div class="left ${t.done ? "done":""}">
            <div class="title">【${t.type}】 ${escapeHtml(t.text)}</div>
            <div class="sub muted">手動</div>
          </div>
          <div class="right">
            <button class="miniBtn" data-act="edit">✎</button>
            <button class="miniBtn danger" data-act="del">🗑</button>
          </div>
        `;
        li.addEventListener("click", (e)=>{
          const btn = e.target.closest("button");
          if(btn){
            if(btn.dataset.act==="edit") editManual(selectedDayKey, t.id);
            if(btn.dataset.act==="del") deleteManual(selectedDayKey, t.id);
            return;
          }
          toggleManual(selectedDayKey, t.id);
        });
        manUl.appendChild(li);
      });
    }

    // minutes pill
    const minsPill = el("todayMinutes");
    if(minsPill) minsPill.textContent = `学習時間 ${getStudyMin(selectedDayKey)}分`;

    // review list (today)
    const reviewUl = el("todayReviewList");
    const offsets = store.settings.reviewOffsets || DEFAULT_SETTINGS.reviewOffsets;
    const reviews = getAuto(selectedDayKey).filter(t=>t.origin==="review");
    clear(reviewUl);
    if(reviews.length===0){
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "—";
      reviewUl.appendChild(li);
    } else {
      reviews.forEach(t=>{
        const li = document.createElement("li");
        li.className = "rowItem compact";
        li.innerHTML = `
          <div class="left ${t.done ? "done":""}">
            <div class="title">🧠 ${escapeHtml(t.title)}</div>
            <div class="sub muted">${t.estMin||0}分</div>
          </div>
        `;
        li.addEventListener("click", ()=>toggleAuto(selectedDayKey, t.id));
        reviewUl.appendChild(li);
      });
    }
    const hint = el("reviewHint");
    if(hint) hint.textContent = `Offsets: ${offsets.join(",")}`;

    // wire Today minutes buttons (HTML onclick also exists, but保険)
    // (nothing here)
  }

  function renderWeekly(){
    el("weekLabel").textContent = `週: ${weekRangeLabel(selectedWeekKey)}`;

    const days = daysOfWeek(selectedWeekKey);
    const totalAssigned = days.reduce((a,d)=>a + getAuto(d).reduce((x,t)=>x+(t.estMin||0),0), 0);
    const cap = Number(store.settings.weeklyCapMin||0);
    el("weeklyCap").textContent = `${cap} min`;
    el("weeklyAssigned").textContent = `${totalAssigned} min`;
    el("weeklyRemain").textContent = `${Math.max(0, cap-totalAssigned)} min`;

    const board = el("weeklyAutoBoard");
    clear(board);

    days.forEach(d=>{
      const col = document.createElement("div");
      col.className = "boardCol";
      const list = getAuto(d);
      const done = list.filter(x=>x.done).length;

      col.innerHTML = `
        <div class="boardHead">
          <div class="bTitle">${d}</div>
          <div class="bSub muted">${done}/${list.length}</div>
        </div>
        <div class="boardBody"></div>
      `;
      const body = col.querySelector(".boardBody");
      if(list.length===0){
        const p = document.createElement("div");
        p.className = "empty";
        p.textContent = "—";
        body.appendChild(p);
      } else {
        list.forEach(t=>{
          const card = document.createElement("div");
          card.className = "taskCard";
          card.innerHTML = `
            <div class="${t.done ? "done":""}">【${t.type}】 ${escapeHtml(t.title)}</div>
            <div class="muted">${t.estMin||0}分</div>
          `;
          card.addEventListener("click", (e)=>{
            if(e.altKey) autoMenu(d, t.id); // PC用裏技
            else toggleAuto(d, t.id);
          });
          card.addEventListener("contextmenu", (e)=>{ e.preventDefault(); autoMenu(d, t.id); });
          body.appendChild(card);
        });
      }
      board.appendChild(col);
    });
  }

  function renderMaster(){
    const ul = el("masterList");
    clear(ul);

    const q = (el("masterSearch")?.value || "").trim().toLowerCase();
    const filter = el("masterFilter")?.value || "all";

    let list = store.master.slice();
    if(q){
      list = list.filter(m =>
        (m.title||"").toLowerCase().includes(q) ||
        (m.type||"").toLowerCase().includes(q) ||
        (m.notes||"").toLowerCase().includes(q)
      );
    }
    if(filter==="open") list = list.filter(m=>!m.done);
    if(filter==="done") list = list.filter(m=>m.done);

    if(list.length===0){
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "マスタータスクがありません。＋追加で作ってください。";
      ul.appendChild(li);
      return;
    }

    list.forEach(m=>{
      const li = document.createElement("li");
      li.className = "rowItem";
      li.innerHTML = `
        <div class="left ${m.done ? "done":""}">
          <div class="title">【${m.type}】 ${escapeHtml(m.title)}</div>
          <div class="sub muted">${m.estMin}分 ${m.notes ? " / " + escapeHtml(m.notes) : ""}</div>
        </div>
        <div class="right">
          <button class="miniBtn" data-act="toggle">${m.done ? "↩︎" : "✓"}</button>
          <button class="miniBtn" data-act="edit">✎</button>
        </div>
      `;
      li.addEventListener("click", (e)=>{
        const btn = e.target.closest("button");
        if(!btn) return;
        if(btn.dataset.act==="toggle") toggleMaster(m.id);
        if(btn.dataset.act==="edit") editMaster(m.id);
      });
      ul.appendChild(li);
    });
  }

  function renderCalendar(){
    const grid = el("calendarGrid");
    if(!grid) return;

    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    el("calMonthLabel").textContent = `${y}年 ${m+1}月`;

    grid.innerHTML = "";
    const WEEKDAYS = ["月","火","水","木","金","土","日"];
    WEEKDAYS.forEach(w=>{
      const h = document.createElement("div");
      h.className = "calHead";
      h.textContent = w;
      grid.appendChild(h);
    });

    const first = new Date(y, m, 1);
    const firstIso = iso(first);
    const jsDay = first.getDay();
    const idx = (jsDay + 6) % 7;
    const startIso = addDays(firstIso, -idx);

    for(let i=0;i<42;i++){
      const dayIso = addDays(startIso, i);
      const d = new Date(dayIso + "T12:00:00");
      const inMonth = d.getMonth() === m;

      const list = getAllDay(dayIso);
      const r = rateOf(list);

      const cell = document.createElement("div");
      cell.className = `calCell ${heatClass(r)} ${inMonth ? "" : "outMonth"} ${dayIso===todayKey ? "todayRing":""}`;
      cell.innerHTML = `
        <div class="calTop">
          <span class="calDay">${d.getDate()}</span>
          <span class="calRate">${r===null ? "" : r+"%"}</span>
        </div>
        <div class="calRate">${list.length ? `${list.filter(t=>t.done).length}/${list.length}` : ""}</div>
      `;
      cell.addEventListener("click", ()=>{
        selectedDayKey = dayIso;
        show("daily");
      });
      grid.appendChild(cell);
    }
  }

  function renderHistory(){
    const weeksUl = el("historyWeeks");
    const daysUl  = el("historyDays");
    if(weeksUl){
      clear(weeksUl);
      // week keys = mondays between oldest and now (based on plan/manual)
      const keys = new Set();
      Object.keys(store.plan||{}).forEach(d=>keys.add(getMonday(new Date(d+"T12:00:00"))));
      Object.keys(store.manual||{}).forEach(d=>keys.add(getMonday(new Date(d+"T12:00:00"))));
      const list = [...keys].sort().reverse().slice(0, 20);

      if(list.length===0){
        const li=document.createElement("li"); li.className="empty"; li.textContent="まだデータがありません。";
        weeksUl.appendChild(li);
      } else {
        list.forEach(k=>{
          const days = daysOfWeek(k);
          const tasks = days.flatMap(d=>getAllDay(d));
          const r = rateOf(tasks);
          const li=document.createElement("li");
          li.className="rowItem compact";
          li.innerHTML = `
            <div class="left">
              <div class="title">${weekRangeLabel(k)}</div>
            </div>
            <div class="right muted">${r===null ? "" : r+"%"}</div>
          `;
          li.addEventListener("click", ()=>{ selectedWeekKey = k; show("weekly"); });
          weeksUl.appendChild(li);
        });
      }
    }

    if(daysUl){
      clear(daysUl);
      const keys = new Set([
        ...Object.keys(store.plan||{}),
        ...Object.keys(store.manual||{}),
        ...Object.keys(store.logs||{})
      ]);
      const list = [...keys].sort().reverse().slice(0, 14);
      if(list.length===0){
        const li=document.createElement("li"); li.className="empty"; li.textContent="まだ日次データがありません。";
        daysUl.appendChild(li);
      } else {
        list.forEach(d=>{
          const tasks = getAllDay(d);
          const r = rateOf(tasks);
          const li=document.createElement("li");
          li.className="rowItem compact";
          li.innerHTML = `
            <div class="left">
              <div class="title">${d}</div>
            </div>
            <div class="right muted">${r===null ? "" : r+"%"}</div>
          `;
          li.addEventListener("click", ()=>{ selectedDayKey = d; show("daily"); });
          daysUl.appendChild(li);
        });
      }
    }
  }

  function render(){
    // view-specific
    if(!el("daily")) return; // HTML未読込保険

    // tab view
    if(!el("daily").hidden) renderDaily();
    if(!el("weekly").hidden) renderWeekly();
    if(!el("master").hidden) renderMaster();
    if(!el("calendar").hidden) renderCalendar();
    if(!el("history").hidden) renderHistory();

    // settings gear button
    // (HTML側で onclick してなくても動くように)
  }

  // ===== HTML actions: minutes =====
  function addMinutes(){
    const input = el("minsInput");
    const v = (input?.value || "").trim();
    const mins = clampInt(v || "0", 0, 100000);
    if(input) input.value = "";
    if(mins<=0) return;
    addStudyMin(selectedDayKey, mins);
    save();
  }
  function resetDayMinutes(){
    if(!confirm("学習時間を0分にしますか？")) return;
    setStudyMin(selectedDayKey, 0);
    save();
  }

  // ===== Navigation functions =====
  function shiftDay(delta){ selectedDayKey = addDays(selectedDayKey, delta); render(); }
  function goToday(){ selectedDayKey = todayKey; render(); }
  function shiftWeek(delta){ selectedWeekKey = addDays(selectedWeekKey, delta*7); render(); }
  function goThisWeek(){ selectedWeekKey = getMonday(new Date()); render(); }
  function shiftMonth(delta){ calMonth = addMonths(calMonth, delta); render(); }
  function goThisMonth(){ const d=new Date(); d.setDate(1); calMonth=d; render(); }

  // ===== Danger zone =====
  function wipeAll(){
    if(!confirm("全データ削除しますか？（元に戻せません）")) return;
    localStorage.removeItem(KEY);
    location.reload();
  }

  // Demo seed (optional)
  function seedDemo(){
    if(!confirm("USCPAテンプレを入れますか？（既存は残ります）")) return;
    const templates = [
      ["FAR Unit 1 講義", "講義", 180],
      ["FAR Unit 1 演習", "演習", 120],
      ["FAR Unit 2 講義", "講義", 180],
      ["FAR Unit 2 演習", "演習", 120],
      ["AUD Unit 1 講義", "講義", 150],
      ["AUD Unit 1 演習", "演習", 120],
    ];
    templates.forEach(([title,type,estMin])=>{
      store.master.push({
        id: uid("m"),
        title, type, estMin,
        notes:"",
        done:false, doneAt:null,
        createdAt: iso(new Date())
      });
    });
    save();
  }

  // ===== Escape =====
  function escapeHtml(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // ===== Wire global (onclick from HTML) =====
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

  window.addMinutes = addMinutes;
  window.resetDayMinutes = resetDayMinutes;

  window.rebuildAuto = rebuildAuto;

  window.addManualTask = addManualTask;
  window.addMasterTask = addMasterTask;

  window.seedDemo = seedDemo;
  window.wipeAll = wipeAll;

  // ===== DOMContentLoaded wiring =====
  document.addEventListener("DOMContentLoaded", () => {
    // Gear button
    const btn = el("btnSettings");
    if(btn) btn.addEventListener("click", openSettings);

    // Modal overlay click to close (optional)
    const modal = el("settingsModal");
    if(modal){
      // クリック透過バグの最大原因を潰す（JSでも保険）
      modal.style.pointerEvents = "auto";
      const card = modal.querySelector(".modalCard");
      if(card) card.style.pointerEvents = "auto";

      modal.addEventListener("click", (e)=>{
        // 背景クリックで閉じる
        if(e.target === modal) closeSettings();
      });
    }

    // Deep link
    const p = new URLSearchParams(location.search);
    const open = p.get("open");
    if(open && VIEW_IDS.includes(open)) show(open);

    render();
  });

  // initial
  render();

})();
