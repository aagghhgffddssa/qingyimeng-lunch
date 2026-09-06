/* Shared restaurant data lives in catalog.json; personal progress stays local. */
const CATALOG_API = 'https://api.github.com/repos/aagghhgffddssa/qingyimeng-lunch/contents/catalog.json';
const CACHE_KEY = 'lunch_shared_catalog_v1';
const DRAFT_KEY = 'lunch_catalog_draft_v1';
let sharedCatalog = null, draftBase = null, catalogDirty = false;
let catalogReady = false, catalogPublishing = false, catalogReading = false;
const legacyCatalog = {shops: dedupe([...googleShops,...seedShops,...custom]), removed:[...state.removed]};

function readStored(key) { try {return JSON.parse(localStorage.getItem(key)||'null');} catch {return null;} }
function validateCatalog(value) {
  if(!value || value.version!==1 || typeof value.revision!=='string' || !Array.isArray(value.shops) || !Array.isArray(value.removed) || value.shops.length>5000) throw new Error('圖鑑格式不正確');
  const ids=new Set();
  const clean=value.shops.map(s=>{
    if(!s || typeof s.id!=='string' || !/^[\w-]{1,160}$/.test(s.id) || ids.has(s.id) || typeof s.name!=='string' || !s.name.trim()) throw new Error('店家資料不完整或編號重複');
    ids.add(s.id);
    const shop={id:s.id};
    for(const k of ['name','cat','address','note','googlePlaceId','businessStatus']) shop[k]=String(s[k]||'').slice(0,2000);
    shop.price=['cheap','mid','treat'].includes(s.price)?s.price:'cheap';
    shop.mins=Math.max(1,Math.min(60,Number(s.mins)||10));
    shop.source=s.source==='google'?'google':'manual';
    shop.rating=Number.isFinite(Number(s.rating)) && s.rating!==null?Math.max(0,Math.min(5,Number(s.rating))):null;
    shop.userRatingCount=Math.max(0,Math.floor(Number(s.userRatingCount)||0));
    shop.distanceMeters=Math.max(0,Number(s.distanceMeters)||0);
    shop.googleMapsURI='';
    try {const u=new URL(s.googleMapsURI);if(u.protocol==='https:' && (u.hostname==='maps.google.com'||u.hostname==='www.google.com'||u.hostname==='maps.app.goo.gl')) shop.googleMapsURI=u.href;}catch{}
    return shop;
  });
  return {version:1,revision:value.revision,updatedAt:String(value.updatedAt||''),shops:clean,removed:[...new Set(value.removed.filter(id=>typeof id==='string' && /^[\w-]{1,160}$/.test(id)))]};
}
function snapshotCatalog() {
  return validateCatalog({version:1,revision:sharedCatalog?.revision||'initial',updatedAt:sharedCatalog?.updatedAt||'',shops:allShops(),removed:state.removed});
}
function displayCatalog(catalog) {
  googleShops=catalog.shops.filter(s=>s.source==='google');
  custom=catalog.shops.filter(s=>s.source!=='google');
  state.removed=[...catalog.removed];
  if(currentResult && !shops().some(s=>s.id===currentResult.id)) {
    currentResult=null;
    $('#roulette').textContent='圖鑑已更新，請重新抽選午餐。';
  }
  renderCats();renderList();
}
function catalogStatus(message) {
  $('#sharedStatus').textContent=message || (catalogDirty?'有尚未發布的草稿；目前只有這台電腦看得到。':`共用圖鑑：${shops().length} 間店家${sharedCatalog?.updatedAt?'｜更新於 '+new Date(sharedCatalog.updatedAt).toLocaleString('zh-TW'):''}`);
  $('#publishCatalog').disabled=!catalogReady||!catalogDirty||catalogPublishing;
  $('#discardDraft').hidden=!catalogDirty;
}
function persistCatalogDraft() {
  if(!catalogDirty)return;
  try {localStorage.setItem(DRAFT_KEY,JSON.stringify({base:draftBase,catalog:snapshotCatalog()}));catalogStatus();}
  catch {catalogStatus('草稿暫時只存在此頁，瀏覽器儲存空間不足。請先發布，勿關閉頁面。');}
}
function beginCatalogEdit() {
  if(!catalogReady || catalogPublishing){toast(catalogPublishing?'正在發布，請稍候':'請先成功載入共用圖鑑再編輯');return false;}
  if(!catalogDirty)draftBase=structuredClone(sharedCatalog);
  catalogDirty=true;catalogStatus();return true;
}
function cacheCatalog(catalog) {try{localStorage.setItem(CACHE_KEY,JSON.stringify(catalog));}catch{}}
async function refreshSharedCatalog(manual=false) {
  if(catalogReading||catalogPublishing)return;
  catalogReading=true;
  try {
    const res=await fetch('./catalog.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw new Error('暫時無法連線（'+res.status+'）');
    const next=validateCatalog(await res.json());
    // The Pages deploy may still serve the previous version just after a publish.
    if(sharedCatalog && Date.parse(next.updatedAt)<Date.parse(sharedCatalog.updatedAt)) {
      catalogStatus('新版已發布，網站正在更新中。');return;
    }
    catalogReady=true;
    if(catalogDirty) {
      catalogStatus(next.revision!==draftBase?.revision?'共用圖鑑已有新版；草稿已保留，發布時會合併不衝突的修改。':undefined);
      return;
    }
    const changed=sharedCatalog?.revision!==next.revision;
    sharedCatalog=next;cacheCatalog(next);displayCatalog(next);catalogStatus();
    if(manual)toast('已取得最新共用圖鑑');else if(changed)toast('共用圖鑑已更新');
  }catch(error) {
    catalogStatus((catalogDirty?'草稿已保留。':sharedCatalog?'目前顯示上次讀取的圖鑑。':'目前顯示預設店家。')+'無法檢查最新版本，請稍後按「取得最新圖鑑」。');
  }finally{catalogReading=false;}
}
function mergeCatalog(base,local,remote) {
  const before=new Map(base.shops.map(s=>[s.id,s]));
  const after=new Map(local.shops.map(s=>[s.id,s]));
  const result=new Map(remote.shops.map(s=>[s.id,s]));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  for(const id of new Set([...before.keys(),...after.keys()])) {
    const b=before.get(id),l=after.get(id),r=result.get(id);
    if(equal(b,l))continue;
    if(!equal(b,r)&&!equal(l,r))throw new Error('「'+(l?.name||b?.name||id)+'」已被另一位管理者修改。草稿已保留，請協調後再發布。');
    if(l)result.set(id,l);else result.delete(id);
  }
  const removed=new Set(remote.removed),oldRemoved=new Set(base.removed),newRemoved=new Set(local.removed);
  for(const id of new Set([...oldRemoved,...newRemoved])) {
    if(oldRemoved.has(id)===newRemoved.has(id))continue;
    if(newRemoved.has(id))removed.add(id);else removed.delete(id);
  }
  return validateCatalog({version:1,revision:crypto.randomUUID(),updatedAt:new Date().toISOString(),shops:[...result.values()],removed:[...removed]});
}
function decodeContent(content) {return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0)));}
function encodeContent(content) {let binary='';for(const byte of new TextEncoder().encode(content))binary+=String.fromCharCode(byte);return btoa(binary);}
function githubFailure(status) {
  if(status===401)return '授權無效或已到期，請建立新的 Token。';
  if(status===403||status===404)return '請確認 Token 已選 qingyimeng-lunch，且 Contents 為 Read and write。';
  if(status===409||status===422)return '發布期間有另一筆更新，草稿已保留，請再按一次發布。';
  return 'GitHub 暫時無法完成發布（'+status+'），草稿已保留。';
}
async function publishSharedCatalog(token) {
  const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'};
  const read=await fetch(CATALOG_API+'?ref=main&t='+Date.now(),{headers,cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!read.ok)throw new Error(githubFailure(read.status));
  const file=await read.json();
  const remote=validateCatalog(JSON.parse(decodeContent(file.content)));
  const merged=mergeCatalog(draftBase,snapshotCatalog(),remote);
  const write=await fetch(CATALOG_API,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({message:'Update shared lunch catalog',branch:'main',sha:file.sha,content:encodeContent(JSON.stringify(merged,null,2)+'\n')})});
  if(!write.ok)throw new Error(githubFailure(write.status));
  sharedCatalog=merged;catalogDirty=false;draftBase=null;
  try{localStorage.removeItem(DRAFT_KEY);}catch{}
  cacheCatalog(merged);displayCatalog(merged);
  catalogStatus('已發布！網站完成更新後，所有人會自動讀到新版，通常約 1–2 分鐘。');
}
$('#publishCatalog').onclick=()=>{
  if($('#syncBtn').disabled){toast('Google 同步完成後再發布');return;}
  $('#publishError').textContent='';$('#githubToken').value='';
  $('#publishDialog').showModal();$('#githubToken').focus();
};
$('#cancelPublish').onclick=()=>{if(!catalogPublishing)$('#publishDialog').close();};
$('#publishDialog').addEventListener('close',()=>{$('#githubToken').value='';});
$('#publishDialog').addEventListener('cancel',e=>{if(catalogPublishing)e.preventDefault();});
$('#publishForm').onsubmit=async e=>{
  e.preventDefault();if(catalogPublishing)return;
  let token=$('#githubToken').value.trim();if(!token)return;
  $('#githubToken').value='';catalogPublishing=true;
  $('#confirmPublish').disabled=true;$('#cancelPublish').disabled=true;catalogStatus('正在發布共用圖鑑…');
  try{await publishSharedCatalog(token);$('#publishDialog').close();toast('共用圖鑑發布成功');}
  catch(error){$('#publishError').textContent=error.name==='TimeoutError'?'連線逾時，請重新發布以確認結果；草稿已保留。':error.message;catalogStatus('發布未確認完成；草稿已保留，請重試。');}
  finally{token='';catalogPublishing=false;$('#confirmPublish').disabled=false;$('#cancelPublish').disabled=false;$('#publishCatalog').disabled=!catalogDirty;}
};
$('#refreshCatalog').onclick=()=>refreshSharedCatalog(true);
$('#discardDraft').onclick=()=>{
  if($('#syncBtn').disabled){toast('Google 同步完成後再捨棄草稿');return;}
  if(catalogPublishing||!confirm('確定捨棄這台電腦尚未發布的草稿，恢復共用圖鑑嗎？'))return;
  catalogDirty=false;draftBase=null;try{localStorage.removeItem(DRAFT_KEY);}catch{}
  displayCatalog(sharedCatalog);catalogStatus();refreshSharedCatalog(true);
};
$('#importLegacy').onclick=()=>{
  if(!catalogReady||catalogPublishing)return;
  if(!confirm('將這台電腦舊版的店家及移除清單加入草稿？發布後所有人都會套用。'))return;
  if(!beginCatalogEdit())return;
  const merged=validateCatalog({...snapshotCatalog(),shops:dedupe([...allShops(),...legacyCatalog.shops]),removed:[...new Set([...state.removed,...legacyCatalog.removed])]});
  displayCatalog(merged);persistCatalogDraft();toast('舊圖鑑已加入草稿，請發布給所有人');
};
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action],[data-map]');if(!b)return;
  if(b.dataset.map){try{const u=new URL(b.dataset.map);if(u.protocol==='https:')window.open(u.href,'_blank','noopener,noreferrer');}catch{}return;}
  const id=b.dataset.id;
  if(b.dataset.action==='remove')removeShop(id);
  if(b.dataset.action==='fav')toggleFav(id);
  if(b.dataset.action==='block')toggleBlock(id);
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSharedCatalog();});
setInterval(()=>{if(!document.hidden)refreshSharedCatalog();},30000);
try {
  const cached=readStored(CACHE_KEY);
  sharedCatalog=cached?validateCatalog(cached):validateCatalog({version:1,revision:'initial',updatedAt:'',shops:seedShops,removed:[]});
  displayCatalog(sharedCatalog);
  const draft=readStored(DRAFT_KEY);
  if(draft){draftBase=validateCatalog(draft.base);const local=validateCatalog(draft.catalog);catalogDirty=true;displayCatalog(local);}
}catch{sharedCatalog=validateCatalog({version:1,revision:'initial',updatedAt:'',shops:seedShops,removed:[]});displayCatalog(sharedCatalog);}
catalogStatus('正在讀取共用圖鑑…');
refreshSharedCatalog();
