// Discovery radius is only a candidate search. Eligibility requires walking evidence.
function userReportedTooFar(shop){
  return /皇室吉利堡/.test(shop.name||shop.displayName||'') && (!shop.address || /大忠街.*47/.test(shop.address));
}
function walkingSeconds(shop){
  if(userReportedTooFar(shop))return Infinity;
  const known=confirmedLunchShop(shop);if(known)return known.mins*60;
  if(!['google_walk','manual_walk'].includes(shop.walkSource))return null;
  if(shop.walkOrigin!==BASE_ADDRESS)return null;
  const seconds=shop.walkDurationSeconds;
  return typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>0?seconds:null;
}
function withinWalkingLimit(shop,minutes=10){const seconds=walkingSeconds(shop);return seconds!==null&&seconds<=Math.min(10,minutes)*60;}
function walkingLabel(shop){
  if(userReportedTooFar(shop))return '實走超過 10 分鐘（使用者回報）';
  const seconds=walkingSeconds(shop);
  if(seconds===null)return '步行待確認（不參加抽選）';
  return `${shop.walkSource==='google_walk'&&!confirmedLunchShop(shop)?'Google 步行約':'已確認步行'} ${Math.ceil(seconds/60)} 分${seconds>600?'（超過範圍）':''}`;
}
async function checkWalkingRoutes(shops,progress=()=>{}){
  const result=shops.map(s=>({...s})),notes=[];
  let Route;
  const candidates=result.filter(s=>!confirmedLunchShop(s)&&!userReportedTooFar(s)&&s.walkSource!=='manual_walk');
  if(!candidates.length)return {shops:result,notes};
  try{({Route}=await google.maps.importLibrary('routes'));if(!Route?.computeRoutes)throw Error('Routes library unavailable');}
  catch{notes.push('無法載入步行路線服務。請在 Google Cloud 啟用 Routes API，並確認金鑰允許使用；未確認店家不會加入十分鐘抽選。');return {shops:result,notes};}
  let errors=0;
  for(let i=0;i<candidates.length;i++){
    const shop=candidates[i];progress(i+1,candidates.length,shop.name);
    // Never silently fall back to the straight-line estimate after a failed check.
    shop.walkSource='unknown';shop.walkDurationSeconds=null;shop.walkWarnings=[];
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
        for(const pending of candidates.slice(i+1)){pending.walkSource='unknown';pending.walkDurationSeconds=null;}
        notes.push('步行服務無法繼續，請確認 Routes API 已啟用及金鑰權限；未確認店家已移至「待確認／超時」。');break;
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
    $('#syncStatus').textContent=`步行核對完成：${shops().filter(s=>withinWalkingLimit(s)).length} 間符合十分鐘條件。${result.notes.length?'部分店家未確認，請查看下方原因。':''}請發布給所有人。`;
  }catch(e){$('#syncStatus').textContent='步行核對未完成：'+String(e.message||e);}
  finally{lunchSearchBusy=false;$('#syncBtn').disabled=false;$('#lookupBtn').disabled=false;$('#walkingBtn').disabled=false;}
}
