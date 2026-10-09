/* Local storage for the app: one JSON state object in IndexedDB.
   Used by the page (LocalDB) and by the service worker (openTasksNow). */
(function(g){
const TZ="Europe/Istanbul";
const DBNAME="seller-assistant",STORE="kv",KEY="state";
const CLOSED=new Set(["done","checked","na"]);
const STORE_NAMES={CA:"Kanada",MX:"Meksika",ALL:"Ortak"};

function idb(){return new Promise((res,rej)=>{const r=indexedDB.open(DBNAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function load(k=KEY){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(STORE).objectStore(STORE).get(k);t.onsuccess=()=>res(t.result||null);t.onerror=()=>rej(t.error)})}
async function save(s,k=KEY){const d=await idb();return new Promise((res,rej)=>{const tx=d.transaction(STORE,"readwrite");tx.objectStore(STORE).put(s,k);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

function todayKey(d=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
function isoDow(d){const x=new Date(d+"T12:00:00Z").getUTCDay();return x===0?7:x}
function emptyState(){return {tasks:{},issues:{},metrics:{},config:{},notifications:{},days:{}}}

/* "tasks" -> state.tasks ; "days/2026-10-09/items" -> state.days["2026-10-09"] */
function bucket(s,path,create){
  const p=path.split("/");
  if(p.length===1){if(!s[p[0]]&&create)s[p[0]]={};return s[p[0]]||{}}
  if(p[0]==="days"&&p[2]==="items"){if(!s.days[p[1]]&&create)s.days[p[1]]={};return s.days[p[1]]||{}}
  throw new Error("unknown path "+path);
}

/* Minimal Firestore-like API the panel code expects */
function LocalDB(state,persist){
  const subs=new Set();
  const snapDocs=(path,opts)=>{let docs=Object.entries(bucket(state,path)).map(([id,v])=>({id,data:()=>JSON.parse(JSON.stringify(v))}));
    if(opts&&opts.order){const[f,dir]=opts.order;docs.sort((a,b)=>{const x=a.data()[f]||"",y=b.data()[f]||"";return (x<y?-1:x>y?1:0)*(dir==="desc"?-1:1)})}
    if(opts&&opts.limit)docs=docs.slice(0,opts.limit);return {docs}};
  const notify=()=>{for(const s of subs)s();};
  const write=async(path,id,doc)=>{bucket(state,path,true)[id]=JSON.parse(JSON.stringify(doc));notify();await persist(state)};
  const col=(path,opts={})=>({
    doc:id=>docRef(path,id),
    add:async doc=>{const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6);await write(path,id,doc);return {id}},
    get:async()=>snapDocs(path,opts),
    orderBy:(f,dir)=>col(path,Object.assign({},opts,{order:[f,dir]})),
    limit:n=>col(path,Object.assign({},opts,{limit:n})),
    onSnapshot:cb=>{const f=()=>cb(snapDocs(path,opts));subs.add(f);f();return()=>subs.delete(f)}
  });
  const docRef=(path,id)=>({
    set:doc=>write(path,id,doc),
    delete:async()=>{delete bucket(state,path,true)[id];notify();await persist(state)},
    onSnapshot:cb=>{const f=()=>{const v=bucket(state,path)[id];cb({exists:!!v,data:()=>v?JSON.parse(JSON.stringify(v)):undefined})};subs.add(f);f();return()=>subs.delete(f)}
  });
  return {
    collection:col,
    doc:p=>{const i=p.lastIndexOf("/");return docRef(p.slice(0,i),p.slice(i+1))},
    _state:()=>state,
    _replace:async s=>{for(const k of Object.keys(state))delete state[k];Object.assign(state,emptyState(),s);notify();await persist(state)},
    _refresh:async()=>{const s=await load();if(s){for(const k of Object.keys(state))delete state[k];Object.assign(state,s);notify()}}
  };
}

async function openDB(seedUrl){
  let s=await load();
  if(!s){
    s=emptyState();
    try{const r=await fetch(seedUrl);s.tasks=await r.json()}catch(e){}
    s.config.main={startDate:todayKey(),stores:{CA:"https://sellercentral.amazon.ca",MX:"https://sellercentral.amazon.com.mx"}};
    await save(s);
  }
  return LocalDB(Object.assign(emptyState(),s),st=>save(st));
}

/* Open tasks for today, same rules as the panel. Waiting/postponed items count again once their time has passed. */
function openTasksNow(s,now=new Date()){
  const d=todayKey(now),items=(s.days&&s.days[d])||{},out=[];
  for(const [id,t] of Object.entries(s.tasks||{})){
    if(!t.enabled)continue;
    if(t.days&&t.days.length&&!t.days.includes(isoDow(d)))continue;
    for(const st of (t.stores&&t.stores.length?t.stores:["ALL"]))for(const sl of (t.split?["am","pm"]:[""])){
      const key=[id,st,sl].filter(Boolean).join("~"),it=items[key];
      if(it&&CLOSED.has(it.status))continue;
      if(it&&(it.status==="waiting"||it.status==="postponed")&&it.until&&new Date(it.until)>now)continue;
      out.push({id,name:t.name,store:st,slot:sl,priority:t.priority||"Normal",order:t.order||0});
    }
  }
  const pr=["Kritik","Yüksek","Normal"];
  return out.sort((a,b)=>pr.indexOf(a.priority)-pr.indexOf(b.priority)||a.order-b.order);
}

/* Short notification text: "Kanada: A, B · Meksika: A · Ortak: C" */
function reminderText(list){
  const by={};for(const i of list){(by[i.store]=by[i.store]||[]).push(i.name+(i.slot?(i.slot==="am"?" (sabah)":" (akşam)"):""))}
  const ca=(by.CA||[]).join("|"),mx=(by.MX||[]).join("|");
  const parts=[];
  if(ca&&ca===mx)parts.push("Kanada + Meksika: "+by.CA.join(", "));
  else{if(by.CA)parts.push("Kanada: "+by.CA.join(", "));if(by.MX)parts.push("Meksika: "+by.MX.join(", "))}
  if(by.ALL)parts.push("Ortak: "+by.ALL.join(", "));
  return parts.join("\n");
}

g.SA={todayKey,load,save,openDB,openTasksNow,reminderText,STORE_NAMES,TZ};
})(self);
