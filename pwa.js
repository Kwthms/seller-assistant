/* Phone-app pieces: install hint, notifications, backup, file saving. Loaded before panel.js. */
const VAPID_PUBLIC="BAemue9PYx6qct4T8i8tYu3uOV2AGg0kFsdNqpRYkwSEZbUEeCpZxy9bzx_2PoQwGFDlxn9cvzFTR05amWdF2F0";
const isStandalone=()=>window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
let swReg=null,pushSub=null;

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").then(async r=>{swReg=r;await navigator.serviceWorker.ready;
    if(r.pushManager){pushSub=await r.pushManager.getSubscription().catch(()=>null)}
    if(typeof render==="function")render()}).catch(()=>{});
}
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});

const localDownloads={async save({filename,data,type}){
  const file=new File([data],filename,{type:type||"text/csv"});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file]});return}catch(e){if(e.name==="AbortError")return}}
  const a=document.createElement("a");a.href=URL.createObjectURL(file);a.download=filename;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}};

async function loadLastNotif(){try{lastNotif=await SA.load("lastNotif");if(typeof render==="function")render()}catch(e){}}

function b64ToBytes(b){const p="=".repeat((4-b.length%4)%4);const s=atob((b+p).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(s,c=>c.charCodeAt(0))}
function subCode(){return pushSub?JSON.stringify(pushSub.toJSON()):""}

async function enablePush(){
  try{
    const perm=await Notification.requestPermission();
    if(perm!=="granted"){setMsg("Bildirim izni verilmedi. Ayarlar → Bildirimler → Satıcı Görevleri'nden açabilirsin.",true);render();return}
    const r=swReg||await navigator.serviceWorker.ready;
    pushSub=await r.pushManager.getSubscription()||await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(VAPID_PUBLIC)});
    setMsg("Bildirimler açıldı. Şimdi bağlantı kodunu kopyalayıp bir kez gönder.");
  }catch(e){setMsg("Bildirim açılamadı: "+e.message,true)}
  render();
}
async function copySub(){
  try{await navigator.clipboard.writeText(subCode());toast("Kod kopyalandı.")}
  catch(e){const ta=document.getElementById("subcode");if(ta){ta.select();document.execCommand("copy");toast("Kod kopyalandı.")}}
}

function notifCard(){
  const c=el("div",{class:"card"},el("h3",{},"Bildirimler"));
  c.append(el("p",{class:"small"},"Her gün 10.15 ve 23.00'te (Türkiye saati) sadece açık kalan görevlerin adları gelir. Hepsini bitirdiysen bildirim gelmez. Hatırlatmadan 20 dakika sonra hâlâ açık görev varsa bir kez daha gelir."));
  if(!("serviceWorker" in navigator)||!("PushManager" in window)){
    if(!isStandalone())c.append(el("p",{},"Bildirimler için önce uygulamayı ana ekrana ekle: Safari'de Paylaş düğmesi → Ana Ekrana Ekle. Sonra uygulamayı ana ekrandaki simgesinden aç."));
    else c.append(el("p",{},"Bu cihaz bildirimleri desteklemiyor. iOS 16.4 veya üstü gerekiyor."));
    return c;
  }
  const perm=window.Notification?Notification.permission:"default";
  if(perm==="denied"){c.append(el("p",{},"Bildirim izni kapalı. iPhone Ayarlar → Bildirimler → Satıcı Görevleri'nden aç."));return c}
  if(!pushSub){c.append(el("div",{class:"btns"},el("button",{class:"btn pri1",onclick:enablePush},"Bildirimleri aç")));return c}
  c.append(el("p",{},"Bildirim izni açık."));
  c.append(el("div",{class:"small"},"Bağlantı kodu (kurulumda bir kez gönderilir):"),
    el("textarea",{id:"subcode",readonly:true,style:"min-height:70px;font-size:.7rem"},subCode()),
    el("div",{class:"btns"},
      el("button",{class:"btn pri1",onclick:copySub},"Kodu kopyala"),
      el("button",{class:"btn",onclick:async()=>{const r=swReg||await navigator.serviceWorker.ready;await r.showNotification("Deneme bildirimi",{body:"Bu telefonda bildirimler görünüyor.",icon:"icons/icon-192.png"})}},"Deneme bildirimi göster")));
  return c;
}

function backupCard(){
  const inp=el("input",{type:"file",accept:"application/json,.json",style:"display:none",onchange:async e=>{
    const f=e.target.files[0];if(!f)return;
    try{const s=JSON.parse(await f.text());if(!s.tasks)throw new Error("Bu dosya bir yedek değil");
      if(!confirm("Bu telefondaki kayıtlar yedektekilerle değiştirilsin mi?"))return;
      await db._replace(s);toast("Yedek geri yüklendi.")}catch(er){setMsg("Yedek okunamadı: "+er.message,true)}}});
  return el("div",{class:"card"},el("h3",{},"Yedek"),
    el("p",{class:"small"},"Görevlerin ve tiklerin sadece bu telefonda duruyor. Telefon değiştirirsen veya uygulamayı silersen kaybolmasın diye ara sıra yedek al (Dosyalar'a kaydedebilirsin)."),
    el("div",{class:"btns"},
      el("button",{class:"btn",onclick:()=>localDownloads.save({filename:"satici-gorevleri-yedek-"+day+".json",data:JSON.stringify(db._state()),type:"application/json"})},"Yedeği indir"),
      el("button",{class:"btn",onclick:()=>inp.click()},"Yedekten geri yükle"),inp));
}
