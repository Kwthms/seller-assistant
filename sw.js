/* Offline cache + reminder notifications.
   The server only says "it's reminder time"; the list of open tasks is read here, from this phone's own data. */
importScripts("store.js");
const CACHE="sa-v2";
const FILES=["./","index.html","style.css","store.js","pwa.js","panel.js","seed-tasks.json","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png"];

self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
/* Network first so updates arrive, cache when offline */
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))));
});

self.addEventListener("push",e=>{
  let msg={};try{msg=e.data?e.data.json():{}}catch(_){}
  e.waitUntil(handlePush(msg));
});
async function handlePush(msg){
    const s=await SA.load();
  const open=s?SA.openTasksNow(s):[];
    const now=new Date().toISOString();
    if(msg.test){
      await self.registration.showNotification("Bildirimler çalışıyor",{body:open.length?open.length+" görev açık.":"Bugünkü görevler tamam.",tag:"sa-test",icon:"icons/icon-192.png"});
      return;
    }
    if(!open.length){
      /* iOS requires a visible notification for every push, so show it and remove it right away */
      await self.registration.showNotification("Bugünkü görevler tamam",{tag:"sa-done",silent:true,icon:"icons/icon-192.png"});
      const ns=await self.registration.getNotifications({tag:"sa-done"});ns.forEach(n=>n.close());
      await SA.save({at:now,text:"gönderilmedi, hepsi tamamdı"},"lastNotif");
      return;
    }
    const title=(msg.resend?"Tekrar: ":"")+open.length+" görev kaldı";
    const thu=new Intl.DateTimeFormat("en-US",{timeZone:SA.TZ,weekday:"short"}).format(new Date())==="Thu"&&open.some(i=>i.id==="payout");
    const body=SA.reminderText(open)+(thu?"\nPerşembe: para çekmek için haberi bekle.":"");
    await self.registration.showNotification(title,{body,tag:"sa-reminder",renotify:true,icon:"icons/icon-192.png",badge:"icons/icon-192.png",data:{url:"./"}});
    await SA.save({at:now,text:title},"lastNotif");
}

self.addEventListener("notificationclick",e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{for(const c of cs){if("focus" in c)return c.focus()}return self.clients.openWindow("./")}));
});
