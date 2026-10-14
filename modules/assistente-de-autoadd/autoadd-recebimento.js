(function () {
  'use strict';
  const MARKER='spxAutoAddReceivingNotificationV1';
  if(document.documentElement.dataset[MARKER])return;
  document.documentElement.dataset[MARKER]='1';
  const ROUTES=['#/generalReceiveTaskMgt/singleReceiveNew/','#/generalReceiveTaskOps/singleReceiveNew/'];
  const TOAST_ID='spx-autoadd-toast';
  const RETRIES=[0,1200,1800,2500,3200];
  let input=null,lastCode='',generation=0,debounce=0;

  const active=()=>location.origin==='https://spx.shopee.com.br'&&ROUTES.some(x=>location.hash.startsWith(x));
  const clean=()=>document.getElementById(TOAST_ID)?.remove();
  const headers=()=>{
    const cookie=name=>document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
    const h={accept:'application/json, text/plain, */*',app:'FMS Portal'};
    const csrf=cookie('csrftoken'),device=cookie('spx-admin-device-id')||cookie('device-id');
    if(csrf)h['x-csrftoken']=decodeURIComponent(csrf);
    if(device)h['device-id']=decodeURIComponent(device);
    return h;
  };
  async function get(url){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(url,{credentials:'include',headers:headers(),signal:controller.signal});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const result=await response.json();
      if(typeof result?.retcode==='number'&&result.retcode!==0)throw new Error(result.message||'Falha SPX');
      return result;
    }finally{clearTimeout(timeout);}
  }
  function nodes(items,out=[]){
    if(!Array.isArray(items))return out;
    for(const item of items){
      if(!item||typeof item!=='object')continue;
      out.push(item);nodes(item.children,out);nodes(item.event_children,out);
    }
    return out;
  }
  function targetFromTracking(data,scanUnix){
    return nodes(data?.data?.tracking_list)
      .map((node,index)=>({node,index,match:String(node.message||'').match(/\[(AT[^\]\s]+)\]/i)}))
      .filter(x=>x.match&&/Assignment Task/i.test(x.node.message||'')
        &&(x.node.operator==='Admin(Polygon Auto Add)'||x.node.biz_staff_name==='Admin(Polygon Auto Add)')
        &&Number(x.node.timestamp||0)>=scanUnix-30
        &&Number(x.node.timestamp||0)<=scanUnix+14400)
      .sort((a,b)=>Number(b.node.timestamp||0)-Number(a.node.timestamp||0)||Number(b.node.id||0)-Number(a.node.id||0))[0]?.match?.[1]||'';
  }
  function todayRange(){
    const x=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).reduce((a,p)=>(a[p.type]=p.value,a),{});
    const start=Math.floor(Date.UTC(Number(x.year),Number(x.month)-1,Number(x.day),3)/1000);
    return {start,end:start+86399};
  }
  function show(info){
    clean();
    if(!active())return;
    const msg=info?.nextCycle?'AutoAdd para o próximo ciclo':info?.route?'AutoADD na rota '+info.route:'';
    if(!msg)return;
    const orange=!!info.nextCycle;
    const el=document.createElement('div');
    el.id=TOAST_ID;el.setAttribute('role','status');
    el.style.cssText='position:fixed;right:20px;bottom:65px;z-index:2147483645;display:flex;align-items:center;gap:9px;max-width:min(420px,calc(100vw - 32px));padding:11px 14px;border-radius:11px;background:rgba(15,23,42,.97);border:1px solid '+(orange?'#f59e0b':'#22c55e')+';border-left:4px solid '+(orange?'#f59e0b':'#22c55e')+';color:'+(orange?'#fef3c7':'#dcfce7')+';font:900 13px Arial,sans-serif;pointer-events:none;box-shadow:0 9px 22px #0006';
    const badge=document.createElement('span');badge.textContent=orange?'↻':'✓';
    badge.style.cssText='display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:99px;background:#ffffff18';
    const span=document.createElement('span');span.textContent=msg;
    el.append(badge,span);document.body.appendChild(el);
  }
  async function inspect(code,scanUnix,version){
    let at='';
    for(const delay of RETRIES){
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(!active()||version!==generation)return;
      try{at=targetFromTracking(await get('/api/fleet_order/order/detail/tracking_info?shipment_id='+encodeURIComponent(code)),scanUnix)}catch(error){console.warn('[AutoAdd] tracking',error);}
      if(at)break;
    }
    if(!at||version!==generation||!active())return;
    const range=todayRange();
    const response=await get('/api/in-station/lmhub/audit/task/list?'+new URLSearchParams({page_no:'1',count:'24',validation_start_time:String(range.start),validation_end_time:String(range.end)}));
    if(version!==generation||!active())return;
    const tasks=Array.isArray(response?.data?.list)?response.data.list:[];
    const task=tasks.find(x=>Number(x.end_time||0)===0)||tasks[0];
    if(!task?.validation_task_id)return;
    const result=await get('/api/in-station/lmhub/audit/target/list?'+new URLSearchParams({target_id:at,task_id:String(task.validation_task_id),page_no:'1',count:'24'}));
    if(version!==generation||!active())return;
    const list=Array.isArray(result?.data?.list)?result.data.list:[];
    const target=list.find(x=>String(x.target_id||'').toUpperCase()===at.toUpperCase())||list[0];
    if(!target)show({nextCycle:true});
    else if(target.binding_entity)show({route:String(target.binding_entity)});
  }
  function findInput(){
    const candidates=[...document.querySelectorAll('input')].filter(el=>{
      const box=el.getBoundingClientRect();return !el.disabled&&!el.readOnly&&box.width>0&&box.height>0;
    });
    return candidates.find(el=>el.matches('.ssc-input input[placeholder="Por favor, insira"]'))
      || candidates.find(el=>/shipment|pedido|código|codigo|barcode|scan|rastreio|waybill|br code/i.test([el.placeholder,el.getAttribute('aria-label'),el.outerHTML.slice(0,400)].join(' ')))
      ||candidates.find(el=>/^BR[0-9A-Z]{13}$/i.test(el.value.trim()))||null;
  }
  function onInput(event){
    if(!active()||event.target!==input)return;
    if(event.type==='keydown'&&event.key!=='Enter')return;
    const code=String(input.value||'').trim().toUpperCase();
    if(!/^BR[0-9A-Z]{13}$/.test(code))return;
    if(code===lastCode&&event.type!=='keydown')return;
    lastCode=code;const version=++generation,scannedAt=Math.floor(Date.now()/1000);
    clearTimeout(debounce);clean();
    debounce=setTimeout(()=>void inspect(code,scannedAt,version).catch(err=>console.warn('[AutoAdd] Notificação',err)),event.type==='keydown'?0:1500);
  }
  function check(){
    if(!active()){if(input){generation++;clearTimeout(debounce);clean();}input=null;lastCode='';return;}
    input=findInput();
  }
  document.addEventListener('input',onInput,true);
  document.addEventListener('change',onInput,true);
  document.addEventListener('keydown',onInput,true);
  const timer=setInterval(check,700);check();
  window.addEventListener('pagehide',()=>{clearInterval(timer);clearTimeout(debounce);clean();delete document.documentElement.dataset[MARKER]},{once:true});
})();