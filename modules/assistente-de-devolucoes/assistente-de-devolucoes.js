(function initializeReturnsAssistant() {
  const MARKER = 'spxReturnsAssistantV2';
  const ROUTE_PREFIX = '#/generalReceiveTaskOps/singleReceiveNew/';
  const MODAL_ID = 'spx-returns-assistant-modal';
  const TOAST_ID = 'spx-returns-assistant-autoadd';
  const STYLE_ID = 'spx-returns-assistant-style';
  const ADDRESS_REASON_ID = 'ER40';
  const ADDRESS_REASON_DESC = 'Onhold with Delivery Address Issue';
  const AUTO_ADD_OPERATOR = 'Admin(Polygon Auto Add)';
  const AUTO_ADD_DELAYS = [0, 1200, 1800, 2500, 3200];

  if (document.documentElement.dataset[MARKER] === 'active') return;
  document.documentElement.dataset[MARKER] = 'active';

  const translations = {
    'cannot find address': 'Endereço não encontrado',
    disaster: 'Chuva forte / Desastres Naturais',
    'do not deliver': 'Não entregar',
    'incorrect/ missing verification': 'Palavra-chave incorreta ou não informada',
    'incorrect/missing verification': 'Palavra-chave incorreta ou não informada',
    'insufficient time': 'Motorista não teve tempo de entregar',
    'insufficient vehicle capacity': 'Não coube no veículo',
    'office closed': 'Comércio Fechado',
    'parcel damaged, cannot attempt': 'Item Danificado',
    'parcel lost': 'Item Perdido',
    'recipient change location': 'Mudança de endereço',
    'recipient reject': 'Recusado por terceiros',
    'recipient unavailable for parcel': 'Ausente',
    'reject - buyers change their mind': 'Rejeitado pelo comprador',
    'risky area of delivery': 'Área de risco',
    'robbery attempt': 'Tentativa de Roubo/Assalto',
    theft: 'Roubo/Assalto',
    'unforeseen circumstances': 'Motorista desistiu da rota',
    'vehicle breakdown': 'Problemas Mecânicos',
    'wrongly assigned': 'Fora de Rota'
  };
  const validReasons = new Set([
    'endereco nao encontrado',
    'palavra-chave incorreta ou nao informada',
    'comercio fechado',
    'recusado por terceiros',
    'ausente'
  ]);
  const finalReasons = new Set(['nao entregar', 'mudanca de endereco', 'rejeitado pelo comprador']);

  let lastShipmentId = '';
  let requestVersion = 0;
  let monitorId = null;
  let debounceId = null;
  let collapsed = false;
  let observedInput = '';
  let historyBusy = false;
  const pendingActions = new Set();
  const FAB_ID = 'spx-returns-assistant-toggle';

  function isCurrent(version) {
    return version === requestVersion && isTargetRoute();
  }

  function isTargetRoute() {
    return location.origin === 'https://spx.shopee.com.br' && location.hash.startsWith(ROUTE_PREFIX);
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function translateReason(value) {
    const clean = String(value || '').replace(/^\s*\[[^\]]+\]\s*/i, '').replace(/\s+/g, ' ').trim();
    return translations[clean.toLowerCase()] || clean || '-';
  }

  function ensureStyle() {
 if(document.getElementById(STYLE_ID))return;
 const style=document.createElement('style');style.id=STYLE_ID;
 style.textContent=`
 #${MODAL_ID},#${FAB_ID}{font:13px/1.5 Inter,Arial,sans-serif;color:#243044;box-sizing:border-box}
 #${MODAL_ID}{position:fixed;z-index:999990;top:20px;right:20px;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 96px);display:flex;flex-direction:column;border:1px solid #e6e8ec;border-radius:20px;background:white;box-shadow:0 16px 60px #19263c26;overflow:hidden;animation:spx-returns-in .2s ease-out}
 #${MODAL_ID}[hidden]{display:none!important}
 #${MODAL_ID} *{box-sizing:border-box}
 #${MODAL_ID} header{display:flex;align-items:center;gap:10px;padding:18px;border-bottom:1px solid #edf0f3;background:linear-gradient(115deg,#fff3eb,#fff)}
 #${MODAL_ID} .brand-icon{display:grid;place-items:center;flex-shrink:0;width:40px;height:40px;background:#ee4d2d;color:white;border-radius:12px}
 #${MODAL_ID} .heading{flex:1;min-width:0}#${MODAL_ID} .eyebrow{font-size:10px;font-weight:800;letter-spacing:1px;color:#b54323}
 #${MODAL_ID} h2{font-size:17px;line-height:1.4;margin:0;font-weight:750;color:#1d2939}
 #${MODAL_ID} .icon,#${FAB_ID} svg{width:18px;height:18px;vertical-align:middle;flex-shrink:0}
 #${MODAL_ID} button{font:inherit;cursor:pointer}
 #${MODAL_ID} .icon-button{display:grid;place-items:center;flex-shrink:0;width:32px;height:32px;border:1px solid #e4e7ec;background:white;color:#475467;border-radius:9px;padding:0}
 #${MODAL_ID} button:hover{filter:brightness(.96)}
 #${MODAL_ID} button:focus-visible,#${FAB_ID}:focus-visible,#${MODAL_ID} a:focus-visible{outline:3px solid #ff9f66;outline-offset:3px}
 #${MODAL_ID} button:disabled{opacity:.55;cursor:wait}
 #${MODAL_ID} .shipment{padding:10px 18px;display:flex;justify-content:space-between;gap:8px;align-items:center;background:#fafbfc;border-bottom:1px solid #edf0f3}
 #${MODAL_ID} .shipment span{font-size:11px;color:#667085}
 #${MODAL_ID} .shipment strong{font-size:12px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
 #${MODAL_ID} .body{overflow:auto;overscroll-behavior:contain;padding:16px}
 #${MODAL_ID} .message{text-align:center;padding:26px 12px;color:#667085}
 #${MODAL_ID} .message strong{display:block;color:#344054;margin:10px 0 5px}
 #${MODAL_ID} .error{color:#b42318}
 #${MODAL_ID} .spinner{display:inline-block;width:24px;height:24px;border:3px solid #ffe6d5;border-top-color:#ee4d2d;border-radius:50%;animation:spx-returns-spin .8s linear infinite}
 #${MODAL_ID} .decision{display:flex;gap:10px;align-items:flex-start;padding:14px;border:1px solid #abefc6;border-radius:13px;background:#ecfdf3;color:#067647;margin-bottom:14px}
 #${MODAL_ID} .decision.warn{background:#fffaeb;border-color:#fedf89;color:#93370d}
 #${MODAL_ID} .decision.stop{background:#fef3f2;border-color:#fecdca;color:#b42318}
 #${MODAL_ID} .decision.address{background:#f4f3ff;border-color:#d9d6fe;color:#6941c6}
 #${MODAL_ID} .decision small{display:block;font-size:10px;letter-spacing:.7px;margin-bottom:3px}
 #${MODAL_ID} .decision strong{font-size:13px}
 #${MODAL_ID} .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
 #${MODAL_ID} .stat{padding:10px;background:#f8fafc;border:1px solid #edf0f3;border-radius:11px}
 #${MODAL_ID} .stat b{display:block;font-size:20px;font-variant-numeric:tabular-nums;line-height:1.3;color:#1d2939}
 #${MODAL_ID} .stat span{font-size:10px;color:#667085}
 #${MODAL_ID} .section-label{display:flex;justify-content:space-between;color:#667085;font-size:10px;font-weight:700;letter-spacing:.7px;margin-bottom:10px}
 #${MODAL_ID} .attempt{display:grid;grid-template-columns:26px minmax(0,1fr);gap:10px;padding:12px 0;border-bottom:1px solid #edf0f3}
 #${MODAL_ID} .attempt:last-child{border-bottom:0}
 #${MODAL_ID} .index{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#f2f4f7;color:#667085;font-size:11px;font-weight:700}
 #${MODAL_ID} .attempt:first-child .index{background:#fff0e7;color:#c63d1d}
 #${MODAL_ID} .reason{display:inline-block;padding:3px 8px;border-radius:6px;background:#eff4ff;color:#3538cd;font-size:11px;font-weight:650}
 #${MODAL_ID} .reason.valid{background:#ecfdf3;color:#067647}#${MODAL_ID} .reason.final{background:#fef3f2;color:#b42318}
 #${MODAL_ID} .driver{margin-top:7px;color:#475467;font-size:11px;overflow-wrap:anywhere}
 #${MODAL_ID} time{display:block;font-size:10px;color:#667085;margin-top:4px}
 #${MODAL_ID} .photo-link{display:inline-flex;align-items:center;gap:8px;font-size:11px;text-decoration:none;color:#b54323;margin-top:8px}
 #${MODAL_ID} img{width:42px;height:42px;border-radius:8px;object-fit:cover;background:#f2f4f7}
 #${MODAL_ID} .address-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
 #${MODAL_ID} .address-actions button{border:1px solid #d0d5dd;border-radius:9px;padding:9px;font-size:11px;font-weight:700}
 #${MODAL_ID} .confirm{background:#ee4d2d!important;color:#fff;border-color:#ee4d2d!important}
 #${MODAL_ID} .cancel{background:#fff;color:#b42318}
 #${MODAL_ID} .action-status{grid-column:1/-1;font-size:11px;overflow-wrap:anywhere}
 #${MODAL_ID} footer{padding:11px 18px;border-top:1px solid #edf0f3;color:#667085;font-size:10px}
 #${MODAL_ID} footer a{color:inherit;text-decoration:none}
 #${TOAST_ID}{margin:10px 16px 0;border:1px solid #abefc6;background:#ecfdf3;color:#067647;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:650}
 #${TOAST_ID}.next{background:#fffaeb;color:#93370d;border-color:#fedf89}
 #${TOAST_ID}.neutral{background:#f8fafc;color:#667085;border-color:#e4e7ec;font-weight:400}
 #${FAB_ID}{position:fixed;right:20px;bottom:20px;z-index:999991;display:flex;align-items:center;gap:8px;padding:11px 16px;border:1px solid #edcab9;border-radius:999px;background:#fff;color:#b54323;box-shadow:0 5px 20px #19263c20;font-weight:700;cursor:pointer}
 @keyframes spx-returns-spin{to{transform:rotate(360deg)}}
 @keyframes spx-returns-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
 @media(max-width:600px){#${MODAL_ID}{right:8px;top:8px;width:calc(100vw - 16px);max-height:calc(100dvh - 78px);border-radius:15px}#${FAB_ID}{right:10px;bottom:12px}}
 @media(prefers-reduced-motion:reduce){#${MODAL_ID},#${MODAL_ID} .spinner{animation:none}}
 `;
 document.documentElement.appendChild(style);
}

  async function fetchJson(url,options={}){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(url,{...options,credentials:'include',headers:{accept:'application/json, text/plain, */*',...(options.headers||{})},signal:controller.signal});
  if(response.status===401||response.status===403)throw new Error('Confira seu acesso e a sessão do SPX.');
  let data;try{data=await response.json();}catch{throw new Error('Resposta inesperada. Confira se sua sessão do SPX continua ativa.');}
  if(!response.ok||data?.retcode!==0)throw new Error(data?.message||`HTTP ${response.status}`);
  return data;
 }catch(error){
  if(error.name==='AbortError')throw new Error('A consulta demorou demais. Tente atualizar o pedido.');
  throw error;
 }finally{clearTimeout(timeout);}
}

  function cookie(name) {
    const prefix = `${name}=`;
    const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  }

  function postJson(url, body) {
    const headers = { app: 'FMS Portal', 'content-type': 'application/json;charset=UTF-8' };
    const csrf = cookie('csrftoken');
    const deviceId = cookie('spx-admin-device-id') || cookie('device-id');
    if (csrf) headers['x-csrftoken'] = csrf;
    if (deviceId) headers['device-id'] = deviceId;
    return fetchJson(url, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  function findInput() {
    return [...document.querySelectorAll('.ssc-input input[placeholder="Por favor, insira"]')].find(input => {
      const rect = input.getBoundingClientRect();
      return !input.disabled && !input.readOnly && rect.width > 0 && rect.height > 0;
    }) || null;
  }

  function readShipmentId() {
    return String(findInput()?.value || '').trim();
  }

  function focusInput(){if(!isTargetRoute())return;const input=findInput();input?.focus({preventScroll:true});input?.select?.();}

  function removeUi(){document.getElementById(MODAL_ID)?.remove();document.getElementById(FAB_ID)?.remove();}

  function showModal(shipmentId,html) {
 if(!isTargetRoute()||shipmentId!==lastShipmentId)return;
 ensureStyle();
 let modal=document.getElementById(MODAL_ID);
 if(!modal){
  modal=document.createElement('section');modal.id=MODAL_ID;
  modal.setAttribute('aria-label','Assistente de devoluções');
  modal.innerHTML=`<header><span class="brand-icon">${icon('package')}</span><div class="heading"><span class="eyebrow">SPX · RECEBIMENTO</span><h2>Assistente de devoluções</h2></div><button class="icon-button" type="button" data-refresh aria-label="Atualizar pedido" title="Atualizar pedido">${icon('refresh')}</button><button class="icon-button" type="button" data-collapse aria-label="Recolher painel" title="Recolher painel">${icon('close')}</button></header><div class="shipment"><span>Pedido</span><strong></strong></div><div id="${TOAST_ID}" class="neutral" role="status">Consultando AutoAdd...</div><div class="body"></div><footer><a href="mailto:igor.camara@shopee.com">developed by igor.camara</a></footer>`;
  modal.onclick=handleModalClick;document.body.appendChild(modal);
  const toggle=document.createElement('button');toggle.id=FAB_ID;toggle.type='button';
  toggle.innerHTML=icon('package')+' Devoluções';toggle.setAttribute('aria-controls',MODAL_ID);
  toggle.onclick=()=>setCollapsed(!collapsed);document.body.appendChild(toggle);
 }
 if(modal.dataset.shipmentId!==shipmentId)showAutoAddToast({message:'Consultando AutoAdd...'});
 modal.dataset.shipmentId=shipmentId;
 modal.querySelector('.shipment strong').textContent=shipmentId;
 modal.querySelector('.body').innerHTML=html;
 modal.querySelector('[data-refresh]').disabled=historyBusy||pendingActions.has(shipmentId);
 setCollapsed(collapsed);
}

  function showAutoAddToast(result){
 const toast=document.getElementById(TOAST_ID);if(!toast)return;
 toast.className=result?.nextCycle?'next':result?.route?'':'neutral';
 toast.textContent=result?.message||(result?.nextCycle?'AutoAdd para o próximo ciclo':result?.route?`AutoAdd na rota ${result.route}`:'Nenhum AutoAdd recente identificado.');
}

  function formatDate(timestamp) {
    if (!Number(timestamp)) return '-';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(Number(timestamp) * 1000));
  }

  function attemptDay(timestamp) {
    if (!Number(timestamp)) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(Number(timestamp) * 1000));
  }

  function photoUrl(attempt){
 const image=Array.isArray(attempt?.image_list)?attempt.image_list.find(item=>typeof item?.image_url==='string')?.image_url:'';
 const photo=Array.isArray(attempt?.photo_list)?attempt.photo_list.find(item=>typeof item==='string'&&item):'';
 const value=(image||photo||'').trim();if(!value)return '';
 if(/^https?:\/\//i.test(value))return value;
 if(/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('//'))return '';
 return 'https://spx.shopee.com.br/shopee-live-spx-perm-data/'+value.replace(/^\/+/,'');
}

  function recommendation(attempts,addressState){
 const ordered=attempts.slice().sort((a,b)=>Number(a.ctime)-Number(b.ctime));
 const reasons=ordered.map(item=>normalize(translateReason(item.on_hold_reason__desc)));
 const days=validAttemptDays(ordered);
 if(reasons.at(-1)==='fora de rota')return{text:'REALOCAR/FLEET',className:'warn'};
 if(reasons.some(reason=>finalReasons.has(reason))||days>=3)return{text:'RETORNAR AO SOC',className:'stop'};
 if(addressState==='unknown')return{text:'CONFERIR TRATATIVA NO SPX',className:'warn'};
 if(addressState==='pending')return{text:'TRATATIVA DE ENDEREÇO',className:'address'};
 if(addressState==='confirmed')return{text:'AGUARDAR TRATATIVA (24h)',className:'address'};
 return{text:'PROCESSAR PARA ENTREGA',className:''};
}

  function addressState(data) {
    const reason = data?.data?.reason || {};
    const eo = data?.data?.eo_info || {};
    const list = Array.isArray(eo.reason_list) ? eo.reason_list : [];
    const active = list.find(item => Number(item.reason_status) === 1 && (item.reason_id === reason.reason_id || item.reason_desc === reason.reason_desc)) || list.find(item => Number(item.reason_status) === 1);
    if (active?.reason_desc === ADDRESS_REASON_DESC && active?.follow_up_function === 'Confirm') {
      return { state: 'pending', reasonId: active.reason_id || reason.reason_id || ADDRESS_REASON_ID, localLang: active.local_lang ?? reason.local_lang ?? '' };
    }
    if (active?.reason_desc === 'Delivery Address Issue' || active?.follow_up_function === 'Update Delivery Address' || reason.reason_id === 'ER41') return { state: 'confirmed' };
    return { state: '' };
  }

  function renderHistory(attempts,address){
 if(!attempts.length)return '<div class="message">'+icon('package')+'<strong>Nenhuma tentativa encontrada</strong>O pedido não possui histórico de tentativas On Hold.</div>';
 const ordered=attempts.slice().sort((a,b)=>Number(a.ctime)-Number(b.ctime));
 const valid=ordered.filter(item=>validReasons.has(normalize(translateReason(item.on_hold_reason__desc)))).length;
 const decision=recommendation(ordered,address?.state);
 const cards=ordered.map((attempt,index)=>{
  const reason=translateReason(attempt.on_hold_reason__desc);
  const normalized=normalize(reason);
  const className=finalReasons.has(normalized)?'final':validReasons.has(normalized)?'valid':'';
  const photo=photoUrl(attempt);
  const showAddressActions=index===ordered.length-1&&normalized==='endereco nao encontrado'&&address?.state==='pending';
  return `<article class="attempt"><span class="index">${index+1}</span><div><span class="reason ${className}">${escapeHtml(reason)}</span><div class="driver">${escapeHtml(attempt.driver_name||'Motorista não informado')}</div><time>${escapeHtml(formatDate(attempt.ctime))}</time>${photo?`<a class="photo-link" href="${escapeHtml(photo)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(photo)}" loading="lazy" referrerpolicy="no-referrer" alt="Foto da tentativa">Ver foto</a>`:''}${showAddressActions?`<div class="address-actions" data-reason-id="${escapeHtml(address.reasonId)}" data-local-lang="${escapeHtml(address.localLang)}"><button type="button" class="confirm" data-address-action="confirm">Confirmar motivo</button><button type="button" class="cancel" data-address-action="cancel">Cancelar motivo</button><div class="action-status" role="status"></div></div>`:''}</div></article>`;
 }).reverse().join('');
 return `<div class="decision ${decision.className}" role="status">${icon(decision.className?'alert':'check')}<div><small>ORIENTAÇÃO DO PEDIDO</small><strong>${escapeHtml(decision.text)}</strong></div></div><div class="stats"><div class="stat"><b>${ordered.length}</b><span>Tentativas</span></div><div class="stat"><b>${valid}</b><span>Válidas</span></div><div class="stat"><b>${validAttemptDays(ordered)}</b><span>Dias válidos</span></div></div><div class="section-label"><span>HISTÓRICO DE TENTATIVAS</span><span>MAIS RECENTES</span></div>${cards}`;
}

  async function loadHistory(shipmentId,version){
 try{
  const data=await fetchJson(`https://spx.shopee.com.br/api/fleet_order/order/detail/recipient_info?shipment_id=${encodeURIComponent(shipmentId)}&station_type=3`);
  if(!isCurrent(version))return;
  if(!Array.isArray(data?.data?.recipient?.On_Hold))throw new Error('O SPX não retornou o histórico no formato esperado.');
  const attempts=data.data.recipient.On_Hold.filter(item=>item&&typeof item==='object');
  const latestReason=normalize(translateReason(attempts.slice().sort((a,b)=>Number(a.ctime)-Number(b.ctime)).at(-1)?.on_hold_reason__desc));
  let address={state:''};
  if(latestReason==='endereco nao encontrado'&&recommendation(attempts,'').text!=='RETORNAR AO SOC'){
   try{address=addressState(await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/no_reason_inbound',{shipment_id:shipmentId}));}
   catch{address={state:'unknown'};}
  }
  if(isCurrent(version))showModal(shipmentId,renderHistory(attempts,address));
 }catch(error){
  if(isCurrent(version))showModal(shipmentId,'<div class="message error"><strong>Não foi possível consultar</strong>'+escapeHtml(error.message||error)+'</div>');
 }finally{
  if(isCurrent(version)){
   historyBusy=false;
   const refresh=document.getElementById(MODAL_ID)?.querySelector('[data-refresh]');
   if(refresh)refresh.disabled=pendingActions.has(shipmentId);
  }
 }
}

  function flattenTracking(nodes, output = []) {
    if (!Array.isArray(nodes)) return output;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      output.push(node);
      flattenTracking(node.children, output);
      flattenTracking(node.event_children, output);
    }
    return output;
  }

  function autoAddTarget(data,scanTime){
 const now=Math.floor(Date.now()/1000);
 return flattenTracking(data?.data?.tracking_list)
 .map(node=>({node,targetId:/Assignment Task/i.test(String(node.message||''))?String(node.message||'').match(/\[(AT[^\]\s]+)\]/i)?.[1]||'':''}))
 .filter(item=>item.targetId&&String(item.node.operator||item.node.biz_staff_name||'').trim()===AUTO_ADD_OPERATOR&&Number(item.node.timestamp||0)>=scanTime-14400&&Number(item.node.timestamp||0)<=now)
 .sort((a,b)=>Number(b.node.timestamp||0)-Number(a.node.timestamp||0))[0]?.targetId||'';
}

  function todayRange() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    const start = Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 3) / 1000);
    return { start, end: start + 86399 };
  }

  async function loadAutoAdd(shipmentId,version,scanTime){
 try{
  let targetId='';
  for(const delay of AUTO_ADD_DELAYS){
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(!isCurrent(version))return;
   const tracking=await fetchJson(`https://spx.shopee.com.br/api/fleet_order/order/detail/tracking_info?shipment_id=${encodeURIComponent(shipmentId)}`);
   if(!isCurrent(version))return;
   if(!Array.isArray(tracking?.data?.tracking_list))throw new Error('Histórico de AutoAdd indisponível.');
   targetId=autoAddTarget(tracking,scanTime);
   if(targetId)break;
  }
  if(!isCurrent(version))return;
  if(!targetId)return showAutoAddToast(null);
  const tasks=await loadTaskPages(todayRange(),version);
  if(!tasks||!isCurrent(version))return;
  const task=currentTask(tasks);
  if(!task)return showAutoAddToast({message:'AutoAdd identificado · nenhuma VT aberta hoje.'});
  const targetData=await fetchJson(`https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list?target_id=${encodeURIComponent(targetId)}&task_id=${encodeURIComponent(task.validation_task_id)}&page_no=1&count=100`);
  if(!isCurrent(version))return;
  const targets=targetData?.data?.list;
  if(!Array.isArray(targets))throw new Error('Não foi possível conferir a AT na VT.');
  const target=exactTarget(targets,targetId);
  if(!target&&targets.length)return showAutoAddToast({message:'AutoAdd identificado · confirme a AT na VT.'});
  showAutoAddToast(target?(target.binding_entity?{route:String(target.binding_entity)}:{message:'AutoAdd identificado · AT sem rota vinculada.'}):{nextCycle:true});
 }catch(error){if(isCurrent(version))showAutoAddToast({message:'AutoAdd não conferido. '+String(error.message||error)});}
}

  async function handleAddress(button){
 const modal=button.closest('#'+MODAL_ID);
 const actions=button.closest('.address-actions');
 const status=actions?.querySelector('.action-status');
 const shipmentId=modal?.dataset.shipmentId||'';
 const action=button.dataset.addressAction;
 const version=requestVersion;
 if(!isCurrent(version)||!actions||!shipmentId||shipmentId!==lastShipmentId||pendingActions.has(shipmentId)||!['confirm','cancel'].includes(action))return;
 pendingActions.add(shipmentId);
 const buttons=[...actions.querySelectorAll('button')];
 buttons.forEach(item=>{item.disabled=true;});
 modal.querySelector('[data-refresh]').disabled=true;
 if(status)status.textContent=action==='confirm'?'Confirmando motivo...':'Cancelando motivo...';
 try{
  if(action==='confirm'){
   await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/resolve_reason',{shipment_id:shipmentId,reason_id:actions.dataset.reasonId||ADDRESS_REASON_ID});
  }else{
   await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/cancel_eo_reason',{shipment_id:shipmentId,reason_id:actions.dataset.reasonId||ADDRESS_REASON_ID,reason_desc:ADDRESS_REASON_DESC,local_lang:actions.dataset.localLang||''});
  }
  if(!isCurrent(version)||modal.dataset.shipmentId!==shipmentId)return;
  if(status)status.textContent=action==='confirm'?'Motivo confirmado com sucesso.':'Motivo cancelado com sucesso.';
  buttons.forEach(item=>{item.hidden=true;});
  const decision=modal.querySelector('.decision');
  if(decision){decision.className='decision'+(action==='confirm'?' address':'');decision.querySelector('strong').textContent=action==='confirm'?'AGUARDAR TRATATIVA (24h)':'PROCESSAR PARA ENTREGA';}
  focusInput();
 }catch{
  // A timed-out write may have succeeded: never repeat it automatically.
  if(!isCurrent(version))return;
  if(status)status.textContent='Não foi possível confirmar o resultado. Atualize o pedido antes de tentar novamente.';
  buttons.forEach(item=>{item.hidden=true;});
 }finally{
  pendingActions.delete(shipmentId);
  if(isCurrent(version))modal.querySelector('[data-refresh]').disabled=historyBusy;
 }
}

  function handleModalClick(event){
 const target=event.target;if(!target?.closest)return;
 if(target.closest('[data-collapse]')){setCollapsed(true);document.getElementById(FAB_ID)?.focus();return;}
 if(target.closest('[data-refresh]')){if(!historyBusy&&!pendingActions.has(lastShipmentId))startShipment(lastShipmentId,0);return;}
 const button=target.closest('[data-address-action]');if(button)void handleAddress(button);
}

  function shipmentChanged(event){
 if(!isTargetRoute())return;
 const value=readShipmentId().toUpperCase();
 if(event?.type==='keydown'&&(event.key!=='Enter'||event.target!==findInput()))return;
 const repeatedScan=event?.type==='keydown'&&!historyBusy;
 if(value===observedInput&&!repeatedScan)return;
 observedInput=value;
 // SPX can clear the input after accepting a scan; retain its result.
 if(!value)return;
 if(!/^BR[0-9A-Z]{13}$/.test(value)){
  clearTimeout(debounceId);requestVersion+=1;historyBusy=false;lastShipmentId='';removeUi();return;
 }
 if(!pendingActions.has(value))startShipment(value);
}

  function stop(){
 clearTimeout(debounceId);if(monitorId)clearInterval(monitorId);
 monitorId=null;requestVersion+=1;historyBusy=false;
 document.removeEventListener('input',shipmentChanged,true);
 document.removeEventListener('change',shipmentChanged,true);
 document.removeEventListener('keydown',shipmentChanged,true);
 lastShipmentId='';observedInput='';collapsed=false;removeUi();
}

  function checkRoute(){
 if(!isTargetRoute()){if(monitorId||lastShipmentId)stop();return;}
 if(monitorId)return shipmentChanged();
 monitorId=setInterval(shipmentChanged,300);
 document.addEventListener('input',shipmentChanged,true);
 document.addEventListener('change',shipmentChanged,true);
 document.addEventListener('keydown',shipmentChanged,true);
 shipmentChanged();
}

  function icon(name){
 // Inline Lucide icons; license in THIRD_PARTY_NOTICES.md.
 const paths={
 package:'<path d="m7.5 4.27 9 5.15M21 8l-9 5-9-5M12 22V12"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
 close:'<path d="m18 6-12 12M6 6l12 12"/>',
 refresh:'<path d="M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M8 16H3v5"/>',
 check:'<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/>',
 alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"/>'
 };
 return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.package)+'</svg>';
}

  function setCollapsed(value){collapsed=value;const modal=document.getElementById(MODAL_ID);if(modal)modal.hidden=collapsed;document.getElementById(FAB_ID)?.setAttribute('aria-expanded',String(!collapsed));}

  function validAttemptDays(attempts){
 return new Set(attempts.filter(item=>validReasons.has(normalize(translateReason(item.on_hold_reason__desc)))).map(item=>attemptDay(item.ctime)).filter(Boolean)).size;
}

  async function loadTaskPages(range,version){
 const tasks=[];const ids=new Set();
 for(let page=1;page<=30;page+=1){
  if(!isCurrent(version))return null;
  const response=await fetchJson(`https://spx.shopee.com.br/api/in-station/lmhub/audit/task/list?page_no=${page}&count=100&validation_start_time=${range.start}&validation_end_time=${range.end}`);
  if(!isCurrent(version))return null;
  const list=response?.data?.list;if(!Array.isArray(list))throw new Error('Lista de VTs indisponível.');
  let added=0;
  for(const task of list){if(!task?.validation_task_id||ids.has(task.validation_task_id))continue;ids.add(task.validation_task_id);tasks.push(task);added+=1;}
  const total=Number(response.data.total??response.data.total_count);
  if(!list.length||(Number.isFinite(total)&&tasks.length>=total)||(!Number.isFinite(total)&&list.length<100))return tasks;
  if(!added)throw new Error('O SPX repetiu a página de VTs.');
 }
 throw new Error('A lista de VTs excedeu o limite de consulta.');
}

  function currentTask(tasks){
 return tasks.filter(item=>Number(item.end_time||0)===0).sort((a,b)=>Number(b.start_time||b.validation_start_time||b.ctime||0)-Number(a.start_time||a.validation_start_time||a.ctime||0))[0]||null;
}

  function exactTarget(targets,targetId){return targets.find(item=>String(item?.target_id||'').toUpperCase()===targetId.toUpperCase())||null;}

  function startShipment(shipmentId,delay=1500){
 if(!shipmentId||!isTargetRoute())return;
 clearTimeout(debounceId);
 const version=++requestVersion;
 const scanTime=Math.floor(Date.now()/1000);
 lastShipmentId=shipmentId;historyBusy=true;
 showModal(shipmentId,'<div class="message" role="status"><span class="spinner" aria-hidden="true"></span><strong>Consultando pedido</strong>Buscando histórico de tentativas...</div>');
 showAutoAddToast({message:'Consultando AutoAdd...'});
 debounceId=setTimeout(()=>{
  if(!isCurrent(version))return;
  void loadHistory(shipmentId,version);
  void loadAutoAdd(shipmentId,version,scanTime);
 },delay);
}

  window.addEventListener('hashchange', checkRoute);
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('focus', checkRoute);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRoute(); });
  setInterval(checkRoute, 700);
  checkRoute();
})();
