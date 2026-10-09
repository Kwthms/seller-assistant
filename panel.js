const TZ="Europe/Istanbul";
const STORES={CA:"Kanada",MX:"Meksika",ALL:"Ortak"};
const PRI=["Kritik","Yüksek","Normal"];
const STATUS={done:"Tamamlandı",checked:"Kontrol edildi, işlem yok",waiting:"Beklemede",postponed:"Ertelendi",na:"Bugün uygulanmıyor"};
const CLOSED=new Set(["done","checked","na"]);
const VIEWS=[["open","Açık görevler"],["closed","Tamamlananlar"],["issues","Açık işler"],["health","Hesap sağlığı"],["report","Rapor"],["history","Geçmiş"],["tasks","Görevler"],["settings","Ayarlar"]];
const DOW=["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"];
/* Amazon limits and suggested internal targets (about half the limit) */
const METRICS=[
  {k:"odr",n:"Sipariş kusur oranı (ODR)",dir:"max",lim:1,tgt:0.5,u:"%"},
  {k:"cancel",n:"Gönderim öncesi iptal oranı",dir:"max",lim:2.5,tgt:1,u:"%"},
  {k:"lsr",n:"Geç gönderim oranı",dir:"max",lim:4,tgt:2,u:"%"},
  {k:"vtr",n:"Geçerli takip oranı",dir:"min",lim:95,tgt:99,u:"%"},
  {k:"otdr",n:"Zamanında teslimat oranı",dir:"min",lim:90,tgt:95,u:"%"},
  {k:"resp",n:"24 saat içinde yanıtlanan mesaj",dir:"min",lim:90,tgt:95,u:"%"}];
const DEFAULT_BASE={CA:"https://sellercentral.amazon.ca",MX:"https://sellercentral.amazon.com.mx"};

let db=null,ui={store:"ALLV",view:"open",open:new Set(),showResolved:false,editTask:null,newIssue:false,histOpen:new Set()};
let tasks=[],items={},issues=[],config={},lastNotif=null,history=null,metrics=[],toastT=null,day=todayKey(),unsubItems=null,pending=false;
const $=id=>document.getElementById(id);
const el=(tag,attrs,...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==="class")e.className=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v)}for(const c of kids.flat()){if(c==null||c===false)continue;e.append(c.nodeType?c:document.createTextNode(c))}return e};

function todayKey(d=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
function hm(iso){return new Intl.DateTimeFormat("tr-TR",{timeZone:TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(iso)).replace(":",".")}
function dm(iso){return new Intl.DateTimeFormat("tr-TR",{timeZone:TZ,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(iso)).replace(":",".")}
function nowHM(){const p=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());return p}
function isoDow(d){const g=new Date(d+"T12:00:00Z").getUTCDay();return g===0?7:g}
function runsOn(t,d){return !t.days||!t.days.length||t.days.includes(isoDow(d))}
function weekday(){return new Intl.DateTimeFormat("en-US",{timeZone:TZ,weekday:"short"}).format(new Date())}
function setMsg(t,err){$("msg").textContent=t;$("msg").className="msg"+(err?" err":"")}

/* Today's checklist: every enabled task x store (x sabah/akşam when split) */
function instances(d=day,m=items){
  const out=[];
  for(const t of tasks){
    if(!t.enabled||!runsOn(t,d))continue;
    for(const s of (t.stores&&t.stores.length?t.stores:["ALL"])){
      const slots=t.split?["am","pm"]:[""];
      for(const sl of slots){
        const key=[t.id,s,sl].filter(Boolean).join("~");
        out.push({key,task:t,store:s,slot:sl,item:m[key]||null});
      }
    }
  }
  const pr=p=>PRI.indexOf(p)<0?2:PRI.indexOf(p);
  return out.sort((a,b)=>pr(a.task.priority)-pr(b.task.priority)||(a.task.order||0)-(b.task.order||0)||a.store.localeCompare(b.store)||a.slot.localeCompare(b.slot));
}
function isClosed(i){return i.item&&CLOSED.has(i.item.status)}
function storeMatch(s){return ui.store==="ALLV"||s===ui.store||s==="ALL"}

function link(t,store){
  if(t.url)return t.url;
  if(!t.path)return null;
  const base=(config.stores&&config.stores[store])||DEFAULT_BASE[store];
  return base?base+t.path:null;
}

async function writeItem(inst,patch){
  const now=new Date().toISOString();
  const prev=inst.item||{};
  const next=Object.assign({task:inst.task.id,store:inst.store,slot:inst.slot,date:day,status:"open",note:"",until:null,at:null,hist:[]},prev,patch);
  if(patch.status&&patch.status!==prev.status){next.at=now;next.hist=(prev.hist||[]).concat([{t:now,s:patch.status}]).slice(-30)}
  items[inst.key]=next;render();
  try{await db.collection("days/"+day+"/items").doc(inst.key).set(next)}catch(e){setMsg("Kaydedilemedi: "+(e.code||e.message),true)}
  return prev;
}
function toast(text,undo){
  document.querySelectorAll(".toast").forEach(x=>x.remove());clearTimeout(toastT);
  const t=el("div",{class:"toast",role:"status"},text,undo?el("button",{onclick:()=>{t.remove();undo()}},"Geri al"):null);
  document.body.append(t);toastT=setTimeout(()=>t.remove(),6000);
}
async function setWithUndo(inst,patch,label){
  const before=inst.item?Object.assign({},inst.item):null;
  await writeItem(inst,patch);
  toast(label,()=>{const cur=instances().find(x=>x.key===inst.key);writeItem(cur,{status:before?before.status:"open",until:before?before.until:null})});
}
function dlBadge(dl){
  if(!dl)return null;
  const diff=Math.round((new Date(dl+"T12:00:00Z")-new Date(day+"T12:00:00Z"))/864e5);
  if(diff<0)return el("span",{class:"dl over"},"Süresi geçti");
  if(diff===0)return el("span",{class:"dl today"},"Bugün son gün");
  if(diff<=2)return el("span",{class:"dl soon"},diff+" gün kaldı");
  return null;
}

function summary(list){
  const vis=list.filter(i=>storeMatch(i.store));
  const done=vis.filter(isClosed).length;
  const open=vis.filter(i=>!isClosed(i));
  const crit=open.filter(i=>i.task.priority==="Kritik").length;
  return {total:vis.length,done,left:open.length,crit,vis};
}
function nextReminder(left){
  if(!left)return "Yok, bugünkü görevler tamam";
  const n=nowHM();
  if(n<"10:15")return "10.15";
  if(n<"23:00")return "23.00";
  return "yarın 10.15";
}

function render(){
  if(pending)return;
  const a=document.activeElement;
  if(a&&$("app").contains(a)&&/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)&&a.type!=="checkbox"){pending=true;a.addEventListener("blur",()=>{pending=false;setTimeout(render,50)},{once:true});return}
  $("date").textContent=new Intl.DateTimeFormat("tr-TR",{timeZone:TZ,weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());
  const ss=$("stores");ss.textContent="";
  for(const[k,v]of[["ALLV","Tümü"],["CA","Kanada"],["MX","Meksika"]])ss.append(el("button",{class:ui.store===k?"on":"",onclick:()=>{ui.store=k;render()}},v));
  const vs=$("views");vs.textContent="";
  for(const[k,v]of VIEWS)vs.append(el("button",{class:ui.view===k?"on":"",onclick:()=>{ui.view=k;if(k==="history"||k==="report")loadHistory();render()}},v));
  const app=$("app");app.textContent="";
  const all=instances();
  if(ui.view==="open"||ui.view==="closed"){
    const s=summary(all);
    app.append(el("div",{class:"stats"},
      el("div",{class:"stat"},el("b",{},String(s.total)),el("span",{},"Bugün görev")),
      el("div",{class:"stat"},el("b",{},String(s.done)),el("span",{},"Tamamlanan")),
      el("div",{class:"stat"},el("b",{},String(s.left)),el("span",{},"Kalan")),
      el("div",{class:"stat"},el("b",{},String(s.crit)),el("span",{},"Kritik"))));
    app.append(el("div",{class:"bar"},el("i",{style:"width:"+(s.total?Math.round(s.done/s.total*100):0)+"%"})));
    app.append(el("div",{class:"next"},"Sonraki rutin hatırlatma: "+nextReminder(summary(all).left)+(config.streak?" · "+config.streak+" gün üst üste hepsi tamam":"")));
    if(!pushSub)app.append(el("div",{class:"card"},isStandalone()?"Bildirimler henüz açık değil. ":"Bildirimler için uygulamayı ana ekrana ekle (Paylaş → Ana Ekrana Ekle). ",el("a",{href:"#",onclick:e=>{e.preventDefault();ui.view="settings";render()}},"Ayarlar")));
    if(lastNotif)app.append(el("div",{class:"notif"},"Son bildirim: "+dm(lastNotif.at)+" · "+notifText(lastNotif)));
    const rows=s.vis.filter(i=>ui.view==="open"?!isClosed(i):isClosed(i));
    if(ui.view==="open"&&!rows.length&&s.total)app.append(el("div",{class:"ok"},"Bugünkü bütün görevleri bitirdin."));
    if(!s.total)app.append(el("div",{class:"card"},"Etkin görev yok. ",el("a",{href:"#",onclick:e=>{e.preventDefault();ui.view="tasks";render()}},"Görevler"), " sekmesinden görev aç."));
    else if(rows.length){const L=el("div",{class:"list"});rows.forEach(i=>L.append(row(i)));app.append(L);
      if(ui.view==="open")app.append(el("div",{class:"btns"},el("button",{class:"btn",onclick:async()=>{
        if(!confirm(rows.length+" açık görev “Kontrol edildi, işlem yok” olarak işaretlensin mi? Bu, işlem yapıldı anlamına gelmez."))return;
        for(const i of rows)await writeItem(i,{status:"checked",until:null});
        toast(rows.length+" görev “işlem yok” olarak işaretlendi.")}},"Kalanların hepsine baktım, işlem yok")));}
    else if(ui.view==="closed")app.append(el("div",{class:"empty"},"Henüz tamamlanan görev yok."));
    const iss=issues.filter(x=>x.status!=="resolved"&&storeMatch(x.store));
    const urgent=iss.filter(x=>{const b=dlBadge(x.deadline);return b&&!b.classList.contains("soon")});
    if(ui.view==="open"&&urgent.length)app.append(el("div",{class:"card"},el("b",{},"Son tarihi gelen takip işleri"),urgent.map(x=>el("div",{class:"small"},el("span",{class:"store"},x.store==="ALL"?"ORTAK":x.store),x.title,dlBadge(x.deadline)))));
    if(ui.view==="open"&&iss.length)app.append(el("p",{class:"small"},iss.length+" açık takip işi var. ",el("a",{href:"#",onclick:e=>{e.preventDefault();ui.view="issues";render()}},"Açık işlere git")));
  }
  else if(ui.view==="issues")renderIssues(app);
  else if(ui.view==="history")renderHistory(app,all);
  else if(ui.view==="report")renderReport(app);
  else if(ui.view==="health")renderHealth(app);
  else if(ui.view==="settings")app.append(notifCard(),backupCard());
  else renderTasks(app);
}

function notifText(n){return n.text||""}

function row(i){
  const t=i.task,it=i.item,closed=isClosed(i);
  const r=el("div",{class:"row"+(closed?" done":"")});
  const ck=el("input",{type:"checkbox",class:"ck","aria-label":t.name,onchange:e=>setWithUndo(i,{status:e.target.checked?"done":"open",until:null},e.target.checked?"“"+t.name+"” tamamlandı.":"“"+t.name+"” yeniden açıldı.")});
  ck.checked=closed;
  const sub=[];
  if(t.id==="payout"&&weekday()==="Thu")sub.push("Bugün perşembe: haber gelmesini bekle");
  let st="";
  if(it&&it.status==="done")st=hm(it.at)+"’te tamamlandı";
  else if(it&&it.status&&it.status!=="open")st=STATUS[it.status]+(it.until?" · "+dm(it.until):"");
  r.append(el("div",{class:"rh"},ck,
    el("div",{class:"t",onclick:()=>{ui.open.has(i.key)?ui.open.delete(i.key):ui.open.add(i.key);render()}},
      el("div",{class:"n"},el("span",{class:"store"},i.store==="ALL"?"ORTAK":i.store),t.name+(i.slot?(i.slot==="am"?" — sabah":" — akşam"):"")),
      sub.length?el("div",{class:"s"},sub.join(" · ")):null),
    st?el("div",{class:"st "+(it&&it.status)},st):null,
    el("span",{class:"pri p-"+(t.priority||"Normal")},t.priority||"Normal")));
  if(ui.open.has(i.key))r.append(detail(i));
  return r;
}

function detail(i){
  const t=i.task,it=i.item||{};
  const d=el("div",{class:"det"});
  if(t.desc)d.append(el("p",{},t.desc));
  if(t.done)d.append(el("p",{class:"small"},"Ne zaman tiklenir: "+t.done));
  if(t.steps&&t.steps.length)d.append(el("ol",{},t.steps.map(s=>el("li",{},s))));
  d.append(el("p",{class:"small"},"Mağaza: "+STORES[i.store]));
  const u=link(t,i.store);
  const b=el("div",{class:"btns"});
  if(u)b.append(el("a",{class:"btn pri1",href:u,target:"_blank",rel:"noopener"},"İlgili sayfayı aç"));
  d.append(b);
  d.append(el("div",{class:"lbl"},"Durum"));
  const sb=el("div",{class:"btns"});
  sb.append(el("button",{class:"btn"+(!it.status||it.status==="open"?" on":""),onclick:()=>writeItem(i,{status:"open",until:null})},"Açık"));
  for(const k of ["done","checked","na"])sb.append(el("button",{class:"btn"+(it.status===k?" on":""),onclick:()=>writeItem(i,{status:k,until:null})},STATUS[k]));
  d.append(sb);
  const untilIn=el("input",{type:"datetime-local",value:it.until?toLocalInput(it.until):""});
  d.append(el("div",{class:"grid2"},
    el("div",{},el("div",{class:"small"},"Beklemede / ertele: sonraki takip zamanı"),untilIn),
    el("div",{class:"btns",style:"align-items:end"},
      el("button",{class:"btn"+(it.status==="waiting"?" on":""),onclick:()=>{const v=fromLocalInput(untilIn.value);if(!v){setMsg("Önce sonraki takip zamanını seç.",true);return}writeItem(i,{status:"waiting",until:v})}},"Beklemede"),
      el("button",{class:"btn"+(it.status==="postponed"?" on":""),onclick:()=>{const v=fromLocalInput(untilIn.value);if(!v){setMsg("Önce erteleme zamanını seç.",true);return}writeItem(i,{status:"postponed",until:v})}},"Ertele"))));
  d.append(el("p",{class:"small"},"Ertelemek yalnızca hatırlatmayı taşır, işin gerçek son tarihini değiştirmez."));
  d.append(el("div",{class:"lbl"},"Not"));
  const ta=el("textarea",{},it.note||"");
  d.append(ta,el("div",{class:"btns"},el("button",{class:"btn",onclick:()=>writeItem(i,{note:ta.value})},"Notu kaydet"),
    el("button",{class:"btn",onclick:()=>{ui.view="issues";ui.newIssue={title:t.name,store:i.store};render()}},"Takip işi aç"),
    el("button",{class:"btn danger",onclick:()=>disableTask(t)},"Bu görevi devre dışı bırak")));
  if(it.hist&&it.hist.length)d.append(el("div",{class:"hist"},"Geçmiş: "+it.hist.map(h=>hm(h.t)+" "+(STATUS[h.s]||"Yeniden açıldı")).join(" · ")));
  return d;
}
function toLocalInput(iso){const d=new Date(iso);const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);const g=k=>p.find(x=>x.type===k).value;return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`}
function fromLocalInput(v){if(!v)return null;return new Date(v+":00+03:00").toISOString()}

async function disableTask(t){
  if(!confirm("“"+t.name+"” her gün tekrarlanmasın mı? Görevler sekmesinden yeniden açabilirsin."))return;
  const nt=Object.assign({},t,{enabled:false});delete nt.id;
  try{await db.collection("tasks").doc(t.id).set(nt)}catch(e){setMsg("Kaydedilemedi: "+(e.code||e.message),true)}
}

/* Open issues: carried over until resolved */
function renderIssues(app){
  app.append(el("p",{class:"small"},"Sonuçlanana kadar açık kalan işler. Her gün sıfırlanmaz, aynı kayıt devam eder."));
  if(!ui.newIssue)app.append(el("div",{class:"btns"},el("button",{class:"btn pri1",onclick:()=>{ui.newIssue={};render()}},"Yeni takip işi")));
  else app.append(issueForm(ui.newIssue));
  const list=issues.filter(x=>storeMatch(x.store)&&(ui.showResolved||x.status!=="resolved"))
    .sort((a,b)=>(a.status==="resolved")-(b.status==="resolved")||PRI.indexOf(a.priority)-PRI.indexOf(b.priority)||(a.deadline||"9").localeCompare(b.deadline||"9"));
  if(!list.length)app.append(el("div",{class:"empty"},"Açık takip işi yok."));
  for(const x of list)app.append(issueCard(x));
  app.append(el("label",{class:"inl"},el("input",{type:"checkbox",checked:ui.showResolved,onchange:e=>{ui.showResolved=e.target.checked;render()}}),"Çözülenleri de göster"));
}
function issueForm(seed){
  const f={title:el("input",{type:"text",value:seed.title||"",placeholder:"Örn. Kayıp paket durumunu çöz"}),
    store:el("select",{},Object.entries(STORES).map(([k,v])=>{const o=el("option",{value:k},v);if(k===(seed.store||"CA"))o.selected=true;return o})),
    ref:el("input",{type:"text",placeholder:"Sipariş / ASIN / talep no"}),
    deadline:el("input",{type:"date"}),
    priority:el("select",{},PRI.map(p=>{const o=el("option",{},p);if(p==="Normal")o.selected=true;return o})),
    note:el("textarea",{placeholder:"Not"})};
  return el("div",{class:"card"},el("h3",{},"Yeni takip işi"),f.title,
    el("div",{class:"grid2",style:"margin-top:8px"},el("div",{},el("div",{class:"small"},"Mağaza"),f.store),el("div",{},el("div",{class:"small"},"Öncelik"),f.priority),
      el("div",{},el("div",{class:"small"},"Referans no"),f.ref),el("div",{},el("div",{class:"small"},"Gerçek son tarih (mağazada görünen)"),f.deadline)),
    el("div",{style:"margin-top:8px"},f.note),
    el("div",{class:"btns"},el("button",{class:"btn pri1",onclick:async()=>{
      if(!f.title.value.trim()){setMsg("Başlık gerekli.",true);return}
      const now=new Date().toISOString();
      const doc={title:f.title.value.trim(),store:f.store.value,ref:f.ref.value.trim(),deadline:f.deadline.value||null,priority:f.priority.value,note:f.note.value,status:"open",next:null,createdAt:now,resolvedAt:null,hist:[{t:now,s:"open"}]};
      try{await db.collection("issues").add(doc);ui.newIssue=false;render()}catch(e){setMsg("Kaydedilemedi: "+(e.code||e.message),true)}
    }},"Kaydet"),el("button",{class:"btn",onclick:()=>{ui.newIssue=false;render()}},"Vazgeç")));
}
function issueCard(x){
  const nextIn=el("input",{type:"datetime-local",value:x.next?toLocalInput(x.next):""});
  const ta=el("textarea",{},x.note||"");
  const save=async patch=>{const now=new Date().toISOString();const nx=Object.assign({},x,patch);delete nx.id;
    if(patch.status&&patch.status!==x.status){nx.hist=(x.hist||[]).concat([{t:now,s:patch.status}]).slice(-40);if(patch.status==="resolved")nx.resolvedAt=now}
    try{await db.collection("issues").doc(x.id).set(nx)}catch(e){setMsg("Kaydedilemedi: "+(e.code||e.message),true)}};
  const lbl={open:"Açık",waiting:"Beklemede",resolved:"Çözüldü"};
  return el("div",{class:"card"},
    el("h3",{},el("span",{class:"store"},x.store==="ALL"?"ORTAK":x.store),x.title,el("span",{class:"tag "+(x.status==="waiting"?"wait":"off")},lbl[x.status]||x.status),x.status!=="resolved"?dlBadge(x.deadline):null),
    el("div",{class:"small"},[x.ref?"Ref: "+x.ref:null,x.deadline?"Son tarih: "+x.deadline:null,"Öncelik: "+x.priority,"Açıldı: "+dm(x.createdAt)].filter(Boolean).join(" · ")),
    x.status!=="resolved"?el("div",{},
      el("div",{class:"grid2",style:"margin-top:8px"},el("div",{},el("div",{class:"small"},"Sonraki takip zamanı"),nextIn),
        el("div",{class:"btns",style:"align-items:end"},
          el("button",{class:"btn",onclick:()=>{const v=fromLocalInput(nextIn.value);if(!v){setMsg("Önce takip zamanını seç.",true);return}save({status:"waiting",next:v})}},"Beklemede"),
          el("button",{class:"btn",onclick:()=>save({status:"open",next:null})},"Açık"),
          el("button",{class:"btn pri1",onclick:()=>save({status:"resolved"})},"Çözüldü"))),
      el("div",{style:"margin-top:8px"},ta),
      el("div",{class:"btns"},el("button",{class:"btn",onclick:()=>save({note:ta.value})},"Notu kaydet"))):el("div",{class:"small"},"Çözüldü: "+dm(x.resolvedAt)),
    x.hist&&x.hist.length?el("div",{class:"hist"},"Geçmiş: "+x.hist.map(h=>dm(h.t)+" "+(lbl[h.s]||h.s)).join(" · ")):null);
}

/* History: last 14 days, read once */
async function loadHistory(){
  history=null;render();
  const start=config.startDate||day,out=[];
  for(let k=1;k<=30;k++){
    const d=todayKey(new Date(Date.now()-k*864e5));
    if(d<start)break;
    try{const s=await db.collection("days/"+d+"/items").get();const m={};s.docs.forEach(x=>m[x.id]=x.data());out.push({d,m})}catch(e){}
  }
  history=out;computeStreak();render();
}
function dayRows(h){
  const rows=instances(h.d,h.m).filter(i=>storeMatch(i.store)).map(i=>({i,it:h.m[i.key]}));
  for(const [k,v] of Object.entries(h.m))if(!rows.find(r=>r.i.key===k)&&storeMatch(v.store))rows.push({i:{key:k,store:v.store,slot:v.slot,task:tasks.find(t=>t.id===v.task)||{name:v.task,id:v.task}},it:v});
  return rows;
}
async function computeStreak(){
  let n=0;
  for(const h of history){const rows=instances(h.d,h.m);if(rows.length&&rows.every(i=>i.item&&CLOSED.has(i.item.status)))n++;else break}
  if(n!==(config.streak||0)&&db){try{await db.doc("config/main").set(Object.assign({},config,{streak:n}))}catch(e){}}
}
async function exportCsv(){
  const dl=localDownloads;
  const lines=[["Tarih","Mağaza","Görev","Kontrol","Durum","Saat","Not"]];
  const today={d:day,m:items};
  for(const h of [today].concat(history||[]))for(const r of dayRows(h)){const it=r.it||{};lines.push([h.d,r.i.store,r.i.task.name,r.i.slot==="am"?"sabah":r.i.slot==="pm"?"akşam":"",it.status&&it.status!=="open"?STATUS[it.status]:"Yapılmadı",it.at?hm(it.at):"",it.note||""])}
  const csv="\ufeff"+lines.map(l=>l.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(";")).join("\r\n");
  try{await dl.save({filename:"amazon-gorev-gecmisi-"+day+".csv",data:csv})}catch(e){if(e.code!=="declined")setMsg("İndirilemedi: "+(e.code||e.message),true)}
}
function renderHistory(app,all){
  if(history===null){app.append(el("div",{class:"empty"},"Yükleniyor…"));return}
  if(!history.length){app.append(el("div",{class:"empty"},"Henüz geçmiş gün yok. Yarından itibaren burada görünecek."));return}
  app.append(el("div",{class:"btns"},el("button",{class:"btn",onclick:exportCsv},"Geçmişi Excel/CSV olarak indir")));
  app.append(el("p",{class:"small"},"Bitmeyen günlük kontroller o günün kaydında “Yapılmadı” olarak kalır; bugünün listesine taşınmaz."));
  for(const h of history){
    const rows=dayRows(h);
    const c={done:0,checked:0,na:0,miss:0};
    rows.forEach(r=>{const s=r.it&&r.it.status;if(s==="done")c.done++;else if(s==="checked")c.checked++;else if(s==="na")c.na++;else c.miss++});
    const open=ui.histOpen.has(h.d);
    const card=el("div",{class:"card"},el("div",{class:"dayrow",onclick:()=>{open?ui.histOpen.delete(h.d):ui.histOpen.add(h.d);render()}},
      el("b",{},new Intl.DateTimeFormat("tr-TR",{weekday:"short",day:"numeric",month:"long"}).format(new Date(h.d+"T12:00:00"))),
      el("span",{class:"small"},`${c.done} tamamlandı · ${c.checked} işlem yok · ${c.na} uygulanmadı · ${c.miss} yapılmadı`)));
    if(open)card.append(el("div",{style:"margin-top:8px"},rows.map(r=>el("div",{class:"small",style:"padding:3px 0"},
      el("span",{class:"store"},r.i.store==="ALL"?"ORTAK":r.i.store),r.i.task.name+(r.i.slot?(r.i.slot==="am"?" — sabah":" — akşam"):"")+": "+(r.it&&r.it.status&&r.it.status!=="open"?STATUS[r.it.status]+(r.it.at?" ("+hm(r.it.at)+")":""):"Yapılmadı")))));
    app.append(card);
  }
}

/* Report: last 7 and 30 days */
function renderReport(app){
  if(history===null){app.append(el("div",{class:"empty"},"Yükleniyor…"));return}
  const days=[{d:day,m:items}].concat(history);
  const block=(n,title)=>{
    const ds=days.slice(0,n);let tot=0,closed=0,miss=0;const per={},perStore={CA:[0,0],MX:[0,0],ALL:[0,0]};
    for(const h of ds){for(const r of dayRows(h)){const s=r.it&&r.it.status;const c=s&&CLOSED.has(s);tot++;if(c)closed++;else if(h.d!==day)miss++;
      const k=r.i.task.name;per[k]=per[k]||{n:k,t:0,c:0,post:0};per[k].t++;if(c)per[k].c++;if(r.it&&r.it.hist&&r.it.hist.some(x=>x.s==="postponed"))per[k].post++;
      if(perStore[r.i.store]){perStore[r.i.store][0]++;if(c)perStore[r.i.store][1]++}}}
    const pct=tot?Math.round(closed/tot*100):0;
    const worst=Object.values(per).filter(x=>x.t).sort((a,b)=>a.c/a.t-b.c/b.t).slice(0,5);
    const post=Object.values(per).filter(x=>x.post).sort((a,b)=>b.post-a.post).slice(0,5);
    return el("div",{class:"card"},el("h3",{},title+(ds.length<n?" · "+ds.length+" günlük veri":"")),
      el("div",{},"Tamamlanma: %"+pct+" · "+closed+"/"+tot+" kayıt · yapılmayan: "+miss),el("div",{class:"bar"},el("i",{style:"width:"+pct+"%"})),
      el("div",{class:"small",style:"margin-top:6px"},Object.entries(perStore).filter(([k,v])=>v[0]).map(([k,v])=>STORES[k]+": %"+Math.round(v[1]/v[0]*100)).join(" · ")),
      el("div",{class:"lbl"},"En çok aksayan görevler"),worst.map(x=>el("div",{class:"small"},x.n+": "+x.c+"/"+x.t+" tamam")),
      post.length?el("div",{},el("div",{class:"lbl"},"Sürekli ertelenenler"),post.map(x=>el("div",{class:"small"},x.n+": "+x.post+" kez ertelendi"))):null);
  };
  if(!history.length)app.append(el("p",{class:"small"},"Geçmiş gün biriktikçe rapor dolacak. Şimdilik sadece bugün var."));
  app.append(el("div",{class:"card"},el("h3",{},"Seri"),el("div",{},(config.streak||0)+" gün üst üste bütün görevler kapandı.")));
  app.append(block(7,"Son 7 gün"),block(30,"Son 30 gün"));
  const open=issues.filter(x=>x.status!=="resolved");
  const over=open.filter(x=>x.deadline&&x.deadline<day);
  const byStore={};open.forEach(x=>byStore[x.store]=(byStore[x.store]||0)+1);
  const resolved=issues.filter(x=>x.status==="resolved"&&x.resolvedAt);
  const avg=resolved.length?Math.round(resolved.reduce((a,x)=>a+(new Date(x.resolvedAt)-new Date(x.createdAt)),0)/resolved.length/864e5*10)/10:null;
  app.append(el("div",{class:"card"},el("h3",{},"Takip işleri"),
    el("div",{},open.length+" açık · "+over.length+" işin son tarihi geçti"),
    el("div",{class:"small"},Object.entries(byStore).map(([k,v])=>STORES[k]+": "+v+" açık").join(" · ")||"Açık iş yok"),
    avg!=null?el("div",{class:"small"},"Ortalama çözülme süresi: "+avg+" gün"):null));
}

/* Account health metrics, typed in from Seller Central */
function level(m,v){if(v==null||v==="")return null;v=Number(v);if(isNaN(v))return null;
  const bad=m.dir==="max"?v>=m.lim:v<m.lim,warn=m.dir==="max"?v>m.tgt:v<m.tgt;return bad?"bad":warn?"warn":"ok"}
const LV={ok:"İyi",warn:"Dikkat",bad:"Risk"};
function renderHealth(app){
  app.append(el("p",{class:"small"},"Panel Amazon hesabına bağlı değil. Değerleri Seller Central → Hesap Sağlığı sayfasından okuyup buraya gir. Sınırlar Amazon'un asgari değerleri, hedefler bunların yaklaşık yarısı."));
  for(const st of ["CA","MX"]){
    if(ui.store!=="ALLV"&&ui.store!==st)continue;
    const mine=metrics.filter(x=>x.store===st).sort((a,b)=>b.date.localeCompare(a.date));
    const last=mine[0];
    const ins={};
    const tbl=el("table",{class:"m"},el("tr",{},el("th",{},"Metrik"),el("th",{},"Sınır / hedef"),el("th",{},"Son değer"),el("th",{},"Yeni değer")),
      METRICS.map(m=>{ins[m.k]=el("input",{type:"text",inputmode:"decimal",placeholder:m.u,style:"width:80px"});const v=last&&last.values[m.k];const l=level(m,v);
        return el("tr",{},el("td",{},m.n),el("td",{class:"small"},(m.dir==="max"?"< ":"> ")+m.lim+m.u+" / "+m.tgt+m.u),
          el("td",{},v!=null&&v!==""?String(v)+m.u+" ":"—",l?el("span",{class:"lv "+l},LV[l]):null),el("td",{},ins[m.k]))}));
    const prev=mine.slice(1,6);
    app.append(el("div",{class:"card"},el("h3",{},STORES[st]+(last?" · son giriş "+last.date:"")),tbl,
      el("div",{class:"btns"},el("button",{class:"btn pri1",onclick:async()=>{
        const values={};let any=false;for(const m of METRICS){const v=ins[m.k].value.trim().replace(",",".");if(v!==""){values[m.k]=Number(v);any=true}else if(last&&last.values[m.k]!=null)values[m.k]=last.values[m.k]}
        if(!any){setMsg("En az bir değer gir.",true);return}
        try{await db.collection("metrics").doc(day+"~"+st).set({date:day,store:st,values,at:new Date().toISOString()});setMsg("Kaydedildi.")}catch(e){setMsg("Kaydedilemedi: "+(e.code||e.message),true)}
      }},"Kaydet")),
      prev.length?el("div",{class:"hist"},"Önceki girişler: "+prev.map(p=>p.date+" ("+METRICS.map(m=>{const l=level(m,p.values[m.k]);return l&&l!=="ok"?m.n.split(" (")[0]+" "+LV[l]:null}).filter(Boolean).join(", ")+")").join(" · ").replace(/ \(\)/g," (hepsi iyi)")):null));
  }
}

/* Task templates */
function renderTasks(app){
  app.append(el("p",{class:"small"},"Görevi tamamlamak tekrarını kapatmaz. Kalıcı olarak kaldırmak için kapat. Bir görevde sabah/akşam ayrı kontrolü sadece sen açarsan uygulanır."));
  app.append(el("div",{class:"btns"},el("button",{class:"btn pri1",onclick:()=>{ui.editTask={id:null,name:"",stores:["CA","MX"],priority:"Normal",enabled:true,split:false,desc:"",steps:[],path:"",url:""};render()}},"Yeni görev")));
  if(ui.editTask)app.append(taskForm(ui.editTask));
  const L=el("div",{class:"list"});
  for(const t of tasks.slice().sort((a,b)=>(b.enabled-a.enabled)||(a.order||0)-(b.order||0))){
    const ck=el("input",{type:"checkbox",class:"ck","aria-label":"Etkin",onchange:async e=>{const nt=Object.assign({},t,{enabled:e.target.checked});delete nt.id;try{await db.collection("tasks").doc(t.id).set(nt)}catch(er){setMsg("Kaydedilemedi",true)}}});
    ck.checked=!!t.enabled;
    L.append(el("div",{class:"row"},el("div",{class:"rh"},ck,
      el("div",{class:"t",onclick:()=>{ui.editTask=Object.assign({},t);render();window.scrollTo({top:0,behavior:"smooth"})}},
        el("div",{class:"n"},t.name,t.enabled?null:el("span",{class:"tag off"},"kapalı")),
        el("div",{class:"s"},(t.stores||["ALL"]).map(s=>STORES[s]).join(", ")+(t.split?" · sabah ve akşam ayrı":"")+(t.days&&t.days.length?" · "+t.days.map(d=>DOW[d-1]).join(", "):""))),
      el("span",{class:"pri p-"+(t.priority||"Normal")},t.priority||"Normal"))));
  }
  app.append(L);
  const sc=config.stores||{};
  const ca=el("input",{type:"text",value:sc.CA||DEFAULT_BASE.CA}),mx=el("input",{type:"text",value:sc.MX||DEFAULT_BASE.MX});
  app.append(el("div",{class:"card",style:"margin-top:14px"},el("h3",{},"Mağaza bağlantıları"),
    el("div",{class:"small"},"Kanada Seller Central"),ca,el("div",{class:"small",style:"margin-top:6px"},"Meksika Seller Central"),mx,
    el("div",{class:"btns"},el("button",{class:"btn",onclick:async()=>{const c=Object.assign({},config,{stores:{CA:ca.value.trim(),MX:mx.value.trim()}});try{await db.doc("config/main").set(c);setMsg("Kaydedildi.")}catch(e){setMsg("Kaydedilemedi",true)}}},"Kaydet"))));
}
function taskForm(t){
  const f={name:el("input",{type:"text",value:t.name,placeholder:"Görev adı"}),
    pr:el("select",{},PRI.map(p=>{const o=el("option",{},p);if(p===t.priority)o.selected=true;return o})),
    desc:el("textarea",{placeholder:"Kontrolde bakılacaklar"},t.desc||""),
    done:el("input",{type:"text",value:t.done||"",placeholder:"Ne zaman tiklenir?"}),
    steps:el("textarea",{placeholder:"Kontrol adımları, her satıra bir adım"},(t.steps||[]).join("\n")),
    path:el("input",{type:"text",value:t.path||"",placeholder:"/returns"}),
    url:el("input",{type:"text",value:t.url||"",placeholder:"https://…"}),
    split:el("input",{type:"checkbox",checked:!!t.split})};
  const sc={};for(const s of ["CA","MX","ALL"])sc[s]=el("input",{type:"checkbox",checked:(t.stores||[]).includes(s)});
  const dw=DOW.map((n,ix)=>el("input",{type:"checkbox",checked:!t.days||!t.days.length||t.days.includes(ix+1)}));
  return el("div",{class:"card"},el("h3",{},t.id?"Görevi düzenle":"Yeni görev"),f.name,
    el("div",{class:"lbl"},"Mağazalar"),el("div",{class:"btns"},Object.entries(STORES).map(([k,v])=>el("label",{class:"inl"},sc[k],k==="ALL"?"Tüm mağazalar (ortak tek kayıt)":v))),
    el("div",{class:"grid2"},el("div",{},el("div",{class:"small"},"Öncelik"),f.pr),el("label",{class:"inl",style:"align-self:end"},f.split,"Sabah ve akşam ayrı kontrol")),
    el("div",{class:"lbl"},"Hangi günler"),el("div",{class:"days"},dw.map((c,ix)=>el("label",{},c,DOW[ix]))),
    el("div",{class:"lbl"},"Açıklama"),f.desc,el("div",{style:"margin-top:6px"},f.done),
    el("div",{class:"lbl"},"Adımlar"),f.steps,
    el("div",{class:"grid2",style:"margin-top:8px"},el("div",{},el("div",{class:"small"},"Seller Central yolu (mağazaya göre açılır)"),f.path),el("div",{},el("div",{class:"small"},"veya sabit bağlantı"),f.url)),
    el("div",{class:"btns"},el("button",{class:"btn pri1",onclick:async()=>{
      const stores=Object.keys(sc).filter(k=>sc[k].checked);
      if(!f.name.value.trim()||!stores.length){setMsg("Ad ve en az bir mağaza gerekli.",true);return}
      const days=dw.map((c,ix)=>c.checked?ix+1:0).filter(Boolean);
      if(!days.length){setMsg("En az bir gün seç.",true);return}
      if(stores.includes("ALL")&&stores.length>1){setMsg("Ortak görev ile mağaza seçimi birlikte olmaz.",true);return}
      const doc={name:f.name.value.trim(),stores,priority:f.pr.value,enabled:t.enabled!==false,split:f.split.checked,desc:f.desc.value,done:f.done.value,steps:f.steps.value.split("\n").map(s=>s.trim()).filter(Boolean),path:f.path.value.trim(),url:f.url.value.trim(),days:days.length===7?[]:days,order:t.order||(tasks.length+1)*10};
      try{if(t.id)await db.collection("tasks").doc(t.id).set(doc);else await db.collection("tasks").add(doc);ui.editTask=null;render()}catch(e){setMsg("Kaydedilemedi: "+(e.code||e.message),true)}
    }},"Kaydet"),el("button",{class:"btn",onclick:()=>{ui.editTask=null;render()}},"Vazgeç")));
}

function subscribeDay(){
  if(unsubItems)unsubItems();
  items={};
  unsubItems=db.collection("days/"+day+"/items").onSnapshot(s=>{const m={};s.docs.forEach(d=>m[d.id]=d.data());items=m;render()},e=>setMsg("Bağlantı koptu, sayfayı yenile.",true));
}

render();
(async()=>{
  try{db=await SA.openDB("seed-tasks.json")}catch(e){setMsg("Kayıtlar açılamadı: "+e.message,true);return}
  setMsg("Kayıtlar bu telefonda saklanır, internet olmadan da çalışır.");
  loadLastNotif();
  db.collection("tasks").onSnapshot(s=>{tasks=s.docs.map(d=>Object.assign({id:d.id},d.data()));render()},()=>setMsg("Bağlantı koptu, sayfayı yenile.",true));
  db.collection("issues").onSnapshot(s=>{issues=s.docs.map(d=>Object.assign({id:d.id},d.data()));render()},()=>{});
  db.collection("metrics").onSnapshot(s=>{metrics=s.docs.map(d=>d.data());render()},()=>{});
  db.doc("config/main").onSnapshot(s=>{config=s.data()||{};render()},()=>{});
    subscribeDay();
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){db._refresh();loadLastNotif();const k=todayKey();if(k!==day){day=k;ui.open.clear();subscribeDay()}}});
  setInterval(()=>{const k=todayKey();if(k!==day){day=k;ui.open.clear();subscribeDay()}render()},60000);
})();