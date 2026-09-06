// Search overlapping areas and independent food categories, then merge by Place ID.
const LUNCH_FIELDS=['id','displayName','location','formattedAddress','googleMapsURI','rating','userRatingCount','priceLevel','primaryType','primaryTypeDisplayName','types','businessStatus'];
let lunchSearchBusy=false;
function offsetPoint(center,north,east){return {lat:center.lat+north/111320,lng:center.lng+east/(111320*Math.cos(center.lat*Math.PI/180))};}
function searchBounds(center){const ne=offsetPoint(center,SEARCH_RADIUS_METERS,SEARCH_RADIUS_METERS),sw=offsetPoint(center,-SEARCH_RADIUS_METERS,-SEARCH_RADIUS_METERS);return {north:ne.lat,east:ne.lng,south:sw.lat,west:sw.lng};}
function confirmedLunchShop(p){
  const name=String(p.displayName?.text||p.displayName||p.name||''),address=String(p.formattedAddress||p.address||'');
  if(/越南小棧/.test(name)&&/水源街.*116/.test(address))return {id:'vietnam-house-tamsui',mins:10,cat:'東南亞'};
  if(/邵爺/.test(name)&&/水源街.*115/.test(address))return {id:'shaoye-shuiyuan',mins:10,cat:'鐵板燒'};
  return null;
}
function lunchExclusion(p,name){
  if(p.businessStatus==='CLOSED_PERMANENTLY')return 'Google 標示永久歇業';
  const primary=String(p.primaryType||'').toLowerCase(),types=(p.types||[]).map(x=>String(x).toLowerCase());
  const n=String(name||'').toLowerCase();
  const mealName=/便當|自助餐|快餐|鐵板燒|牛排|麵食|麵店|拉麵|牛肉麵|水餃|鍋貼|炒飯|燴飯|丼飯|咖哩|火鍋|餐酒|早午餐|早餐|越南|泰式|韓式|日式|漢堡|披薩|pasta|bistro|brunch|teppanyaki/.test(n);
  const mealTypes=['meal_takeaway','meal_delivery','breakfast_restaurant','brunch_restaurant','hamburger_restaurant','pizza_restaurant','vietnamese_restaurant','thai_restaurant','korean_restaurant','japanese_restaurant'];
  const specificMealType=types.some(t=>mealTypes.includes(t)||(/_restaurant$/.test(t)&&!['dessert_restaurant'].includes(t)));
  if(mealName||specificMealType||confirmedLunchShop(p))return '';
  const nonMealTypes=['cafe','coffee_shop','bakery','dessert_shop','dessert_restaurant','ice_cream_shop','candy_store','confectionery','tea_store','bar','night_club'];
  if(nonMealTypes.includes(primary))return '主要類型為飲料、甜點或酒吧，未辨識到正餐';
  if(/伴手禮|糕餅|花生糖|牛軋糖|鳳梨酥|手搖|飲料店|冰品|豆花/.test(n)&&!types.includes('restaurant'))return '未辨識到午餐品項';
  if(types.includes('restaurant')||primary==='restaurant'||/小吃|飯館|食堂|餐廳|食坊|滷味|肉圓|羹|飯店/.test(n))return '';
  return 'Google 分類未辨識為餐飲店，請人工確認';
}
function isLunchCandidate(p,name){return !lunchExclusion(p,name);}
async function searchOneType(center,type='restaurant',radius=420){
  const {Place,SearchNearbyRankPreference}=await google.maps.importLibrary('places');
  const {places}=await Place.searchNearby({fields:LUNCH_FIELDS,locationRestriction:{center,radius},includedTypes:[type],maxResultCount:20,rankPreference:SearchNearbyRankPreference.DISTANCE,language:'zh-TW',region:'TW'});
  return places||[];
}
async function searchLunchText(query,center,exact=false){
  const {Place}=await google.maps.importLibrary('places');
  const request={textQuery:query,fields:LUNCH_FIELDS,language:'zh-TW',region:'TW',maxResultCount:20};
  if(center){if(exact)request.locationBias={center,radius:2000};else request.locationRestriction=searchBounds(center);}
  const {places}=await Place.searchByText(request);return places||[];
}
function buildLunchSearchJobs(center){
  const jobs=[];
  for(const north of [-450,0,450])for(const east of [-450,0,450]){
    const point=offsetPoint(center,north,east);
    jobs.push({label:'周邊分區 '+(jobs.length+1),run:()=>searchOneType(point)});
  }
  const queries=[
    '淡水 長興街 餐廳','淡水 英專路 餐廳','淡水 水源街一段 餐廳',
    '淡水 清水街 餐廳','淡水 博愛街 餐廳','淡水 仁愛街 餐廳','淡水 中山路 餐廳','淡水 中正路 小吃',
    '淡水 便當 自助餐','淡水 麵食 牛肉麵','淡水 水餃 鍋貼','淡水 滷肉飯 雞肉飯','淡水 越南料理','淡水 泰式料理',
    '淡水 鐵板燒','淡水 日式料理','淡水 韓式料理','淡水 咖哩','淡水 素食','淡水 火鍋','淡水 義大利麵','淡水 早午餐'
  ];
  for(const query of queries)jobs.push({label:query,run:()=>searchLunchText(query,center)});
  for(const query of ['淡水 水源街 越南小棧','淡水 水源街 邵爺鐵板燒'])jobs.push({label:query,run:()=>searchLunchText(query,center,true)});
  return jobs;
}
function assessLunchPlace(p,center){
  const name=String(p.displayName?.text||p.displayName||'未命名店家');
  if(!p.id||!p.location)return {name,reason:'缺少 Google 店家編號或座標'};
  const location={lat:typeof p.location.lat==='function'?p.location.lat():p.location.lat,lng:typeof p.location.lng==='function'?p.location.lng():p.location.lng};
  if(!Number.isFinite(location.lat)||!Number.isFinite(location.lng))return {name,reason:'Google 座標不完整'};
  const meters=haversine(center,location),known=confirmedLunchShop(p);
  if(meters>SEARCH_RADIUS_METERS&&!known)return {name,reason:`超出直線 ${SEARCH_RADIUS_METERS} 公尺範圍（約 ${Math.round(meters)} 公尺）；實際步行可人工確認`};
  const excluded=lunchExclusion(p,name);if(excluded)return {name,reason:excluded};
  const primaryDisplay=String(p.primaryTypeDisplayName?.text||p.primaryTypeDisplayName||'');
  const shop={id:known?.id||'g-'+p.id,googlePlaceId:p.id,name,cat:known?.cat||categoryFromPlace({...p,name,primaryTypeDisplayName:primaryDisplay}),price:priceFromGoogle(p.priceLevel),mins:known?.mins||estimatedWalkMinutes(meters),distanceMeters:Math.round(meters),address:p.formattedAddress||'',rating:p.rating||null,userRatingCount:p.userRatingCount||null,googleMapsURI:p.googleMapsURI||'',note:known?'使用者確認實際步行十分鐘內':primaryDisplay,source:'google',businessStatus:p.businessStatus||''};
  return {name,shop,reason:state.removed.includes(shop.id)?'曾手動移除，保持移除狀態':known?'收錄：已確認步行十分鐘內':'候選店家：步行時間待核對'};
}
function mergeLunchPlaces(previous,places,center){
  const incoming=new Map(),report=[],rejected=new Set(),seen=new Set();
  for(const p of places){
    const key=p.id||String(p.displayName);if(seen.has(key))continue;seen.add(key);
    const result=assessLunchPlace(p,center);report.push(result);
    if(result.shop)incoming.set(result.shop.id,result.shop);
    else if(p.id)rejected.add(p.id);
  }
  // Absent from a limited result set does not mean a restaurant disappeared.
  // Only re-evaluated, explicitly rejected Google records are dropped.
  const merged=new Map(previous.filter(s=>!rejected.has(s.googlePlaceId)).map(s=>[s.id,s]));
  for(const shop of incoming.values()){
    for(const [id,old] of merged)if(old.googlePlaceId===shop.googlePlaceId&&id!==shop.id)merged.delete(id);
    merged.set(shop.id,shop);
  }
  return {shops:[...merged.values()].sort((a,b)=>a.mins-b.mins||(b.rating||0)-(a.rating||0)),report,found:incoming.size,added:[...incoming.keys()].filter(id=>!previous.some(s=>s.id===id)).length};
}
function showLunchReport(report,failures=[]){
  $('#searchReportBody').innerHTML=(failures.length?'<p>'+failures.map(x=>escapeHtml(x)).join('<br>')+'</p>':'')+(report.length?'<table style="width:100%;text-align:left"><thead><tr><th>店家</th><th>搜尋結果</th></tr></thead><tbody>'+report.map(r=>'<tr><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.reason)+'</td></tr>').join('')+'</tbody></table>':'<p>沒有取得店家結果；原圖鑑已保留。</p>');
}
async function syncGooglePlaces(){
  if(lunchSearchBusy||catalogPublishing||!catalogReady){toast('請等待共用圖鑑載入或目前操作完成');return;}
  lunchSearchBusy=true;
  const btn=$('#syncBtn'),status=$('#syncStatus');btn.disabled=true;$('#lookupBtn').disabled=true;
  const failures=[];let all=[],successes=0;
  try{
    status.textContent='正在載入 Google 並定位青藝盟…';await loadGoogleMaps();const center=await locateBaseWithPlaces();
    const jobs=buildLunchSearchJobs(center);
    for(let i=0;i<jobs.length;i++){
      status.textContent=`搜尋 ${i+1} / ${jobs.length}：${jobs[i].label}`;
      try{all.push(...await jobs[i].run());successes++;}catch(e){failures.push(jobs[i].label+'：'+String(e.message||e));}
    }
    if(!successes)throw new Error('所有搜尋均失敗，原图鑑已保留');
    const result=mergeLunchPlaces(googleShops,all,center);
    const walking=await checkWalkingRoutes(result.shops,(i,n,name)=>{status.textContent=`核對步行 ${i} / ${n}：${name}`;});
    result.shops=walking.shops;failures.push(...walking.notes);
    for(const row of result.report)if(row.shop){const checked=result.shops.find(s=>s.id===row.shop.id);if(checked)row.reason=walkingLabel(checked);}

    if(result.shops.length||result.shops.length!==googleShops.length){if(!beginCatalogEdit())return;googleShops=result.shops;save();}
    showLunchReport(result.report,failures);
    localStorage.setItem('lunch_google_synced_at',new Date().toISOString());
    status.textContent=`本次找到 ${result.found} 間，新增 ${result.added} 間；Google 圖鑑共 ${googleShops.length} 間。${failures.length?'有 '+failures.length+' 組搜尋失敗，請查看原因或稍後重試。':''}修改後請發布給所有人。`;
    renderCats();renderList();toast('周邊搜尋完成，請查看圖鑑並發布');
  }catch(e){showLunchReport([],failures);status.textContent='搜尋未完成：'+String(e.message||e)+'。原圖鑑已保留。';toast('搜尋未完成，請查看提示');}
  finally{lunchSearchBusy=false;btn.disabled=false;$('#lookupBtn').disabled=false;}
}
async function lookupMissingShop(){
  const query=$('#lookupName').value.trim(),status=$('#lookupStatus');
  if(!query){status.textContent='請先輸入店名。';return;}
  if(lunchSearchBusy||catalogPublishing||!catalogReady){status.textContent='請等目前操作完成後再查漏。';return;}
  lunchSearchBusy=true;$('#syncBtn').disabled=true;$('#lookupBtn').disabled=true;
  try{
    status.textContent='正在查找店家與未收錄原因…';await loadGoogleMaps();const center=await locateBaseWithPlaces();
    const places=await searchLunchText('淡水 '+query,center,true);
    const normalize=s=>String(s).replace(/[\s（）()・·-]/g,'').toLowerCase();
    const exact=places.filter(p=>normalize(p.displayName?.text||p.displayName).includes(normalize(query)));
    const result=mergeLunchPlaces(googleShops,exact,center);
    const targets=new Set(result.report.filter(r=>r.shop).map(r=>r.shop.id));
    const walking=await checkWalkingRoutes(result.shops.filter(s=>targets.has(s.id)));
    result.shops=result.shops.map(s=>walking.shops.find(x=>x.id===s.id)||s);
    for(const row of result.report)if(row.shop){const checked=result.shops.find(s=>s.id===row.shop.id);if(checked)row.reason=walkingLabel(checked);}

    if(result.found){if(!beginCatalogEdit())return;googleShops=result.shops;save();renderCats();renderList();}
    showLunchReport(result.report,walking.notes);$('#searchReport').open=true;
    status.textContent=result.found?'找到 '+result.found+' 間候選店家並更新草稿；只有步行核對通過的店家會進入十分鐘清單。請確認結果後發布。':exact.length?'找到店家但未自動收錄，原因如下；若你確認實際步行可達，可用下方表單手動加入。':'Google 未回傳名稱相符的店家，請試試簡短店名，或使用下方表單手動加入。';
  }catch(e){status.textContent='查漏失敗：'+String(e.message||e)+'；原圖鑑已保留。';}
  finally{lunchSearchBusy=false;$('#syncBtn').disabled=false;$('#lookupBtn').disabled=false;}
}
