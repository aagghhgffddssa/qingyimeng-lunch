// Prefer walking evidence; keep clearly labelled nearby estimates when routing is unavailable.
function userReportedTooFar(shop){
  return /皇室吉利堡/.test(shop.name||shop.displayName||'') && (!shop.address || /大忠街.*47/.test(shop.address));
}
function walkingEvidence(shop){
  if(userReportedTooFar(shop))return {seconds:Infinity,kind:'reported_far'};
  const known=confirmedLunchShop(shop);if(known)return {seconds:known.mins*60,kind:'confirmed'};
  if(['google_walk','manual_walk'].includes(shop.walkSource)){
    if(shop.walkOrigin!==BASE_ADDRESS)return {seconds:null,kind:'unknown'};
    const seconds=shop.walkDurationSeconds;
    if(typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>0)return {seconds,kind:shop.walkSource};
  }
  const distance=Number(shop.distanceMeters),roadDistance=Number(shop.walkDistanceMeters),saved=Number(shop.mins);
  const fromDistance=Number.isFinite(distance)&&distance>0?Math.ceil(distance*1.2/80):0;
  const fromRoadDistance=Number.isFinite(roadDistance)&&roadDistance>0?Math.ceil(roadDistance*1.2/80):0;
  const fromSaved=Number.isFinite(saved)&&saved>0?Math.ceil(saved):0;
  // Preserve a longer previously recorded time rather than shorten it on failure.
  const minutes=Math.max(fromDistance,fromRoadDistance,fromSaved);
  return {seconds:minutes>0?minutes*60:null,kind:minutes>0?'estimate':'unknown'};
}
function walkingSeconds(shop){return walkingEvidence(shop).seconds;}
function withinWalkingLimit(shop,minutes=10){const seconds=walkingSeconds(shop);return seconds!==null&&seconds<=Math.min(10,minutes)*60;}
function walkingLabel(shop){
  const evidence=walkingEvidence(shop),seconds=evidence.seconds;
  if(evidence.kind==='reported_far')return '實走超過 10 分鐘（使用者回報）';
  if(seconds===null)return '缺少步行資料（不參加抽選）';
  const prefix=evidence.kind==='estimate'?'估計步行':evidence.kind==='google_walk'?'Google 步行約':'已確認步行';
  return `${prefix} ${Math.ceil(seconds/60)} 分${evidence.kind==='estimate'?'（未核對路線）':''}${seconds>600?'（超過範圍）':''}`;
}
function walkingSummary(list){
  const eligible=list.filter(s=>withinWalkingLimit(s));
  const estimated=eligible.filter(s=>walkingEvidence(s).kind==='estimate').length;
  return `${eligible.length} 間可抽選（已核對 ${eligible.length-estimated} 間、估計 ${estimated} 間）`;
}
async function checkWalkingRoutes(shops,progress=()=>{}){
  const result=shops.map(s=>({...s})),notes=[];
  let Route;
  const candidates=result.filter(s=>!confirmedLunchShop(s)&&!userReportedTooFar(s)&&s.walkSource!=='manual_walk');
  if(!candidates.length)return {shops:result,notes};
  try{({Route}=await google.maps.importLibrary('routes'));if(!Route?.computeRoutes)throw Error('Routes library unavailable');}
  catch{notes.push('無法載入步行路線服務。請在 Google Cloud 啟用 Routes API，並確認金鑰允許使用；仍保留已核對時間；其餘使用標明的估計時間，不影響附近店家抽選。');return {shops:result,notes};}
  let errors=0;
  for(let i=0;i<candidates.length;i++){
    const shop=candidates[i];progress(i+1,candidates.length,shop.name);
    // Update only on success; failed rechecks must not erase a previous result.
    if(!shop.googlePlaceId&&!shop.address){notes.push(shop.name+'：缺少目的地地址');continue;}
    try{
      const response=await Route.computeRoutes({origin:BASE_ADDRESS,destination:shop.googlePlaceId?'places/'+shop.googlePlaceId:shop.address,travelMode:'WALKING',fields:['durationMillis','distanceMeters','warnings']});
      const route=response.routes?.[0];
      if(!route||!Number.isFinite(route.durationMillis)||route.durationMillis<=0){notes.push(shop.name+'：沒有可用的步行路線');continue;}
      shop.walkDurationSeconds=Math.ceil(route.durationMillis/1000);
      shop.walkDistanceMeters=Number.isFinite(route.distanceMeters)?route.distanceMeters:null;
      shop.walkSource='google_walk';shop.walkOrigin=BASE_ADDRESS;shop.walkCheckedAt=new Date().toISOString();
      shop.walkWarnings=Array.isArray(route.warnings)?route.warnings.map(String):[];
      shop.mins=Math.ceil(shop.walkDurationSeconds/60);
      errors=0;
    }catch(e){
      errors++;notes.push(shop.name+'：步行路線查詢失敗');
      if(/denied|permission|billing|not activated|not enabled|API.*enable/i.test(String(e.message||e))||errors>=3){
        notes.push('步行服務無法繼續，請確認 Routes API 已啟用及金鑰權限；已核對資料保留，其他店家使用標明的估計時間。');break;
      }
    }
  }
  return {shops:result,notes};
}
async function recheckWalkingRoutes(){
  if(lunchSearchBusy||catalogPublishing||!catalogReady){toast('請等目前操作完成');return;}
  lunchSearchBusy=true;$('#syncBtn').disabled=true;$('#lookupBtn').disabled=true;$('#walkingBtn').disabled=true;
  try{
    await loadGoogleMaps();
    const result=await checkWalkingRoutes(allShops(),(i,n,name)=>{$('#syncStatus').textContent=`核對步行 ${i} / ${n}：${name}`;});
    if(!beginCatalogEdit())return;
    googleShops=result.shops.filter(s=>s.source==='google');custom=result.shops.filter(s=>s.source!=='google');save();renderCats();renderList();
    showLunchReport(result.shops.map(s=>({name:s.name,reason:walkingLabel(s)})),result.notes);
    $('#searchReport').open=true;
    $('#syncStatus').textContent=`步行核對完成：${walkingSummary(shops())}。${result.notes.length?'路線服務未完成的店家已保留原資料，請查看下方原因。':''}請發布給所有人。`;
  }catch(e){$('#syncStatus').textContent='步行核對未完成：'+String(e.message||e);}
  finally{lunchSearchBusy=false;$('#syncBtn').disabled=false;$('#lookupBtn').disabled=false;$('#walkingBtn').disabled=false;}
}
