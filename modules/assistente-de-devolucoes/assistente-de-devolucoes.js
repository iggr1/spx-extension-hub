(function initializeReturnsAssistant() {
  const MARKER = 'spxReturnsAssistantV2';
  const ROUTE_PREFIXES = ['#/generalReceiveTaskMgt/singleReceiveNew/', '#/generalReceiveTaskOps/singleReceiveNew/'];
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
    return location.origin === 'https://spx.shopee.com.br' && ROUTE_PREFIXES.some(prefix => location.hash.startsWith(prefix));
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
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID},#${TOAST_ID}{position:fixed;z-index:999999;font-family:Arial,sans-serif;color:#f8fafc}
      #${MODAL_ID}{top:16px;right:16px;width:min(500px,calc(100vw - 32px));max-height:min(82vh,680px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #334155;border-radius:14px;background:#0f172a;box-shadow:0 22px 62px #0008}
      #${MODAL_ID} *{box-sizing:border-box}#${MODAL_ID} header{position:relative;padding:13px 44px 11px 14px;border-bottom:1px solid #334155;background:linear-gradient(135deg,#ff600033,#0f172a)}
      #${MODAL_ID} h2{margin:0;font-size:17px}#${MODAL_ID} header small{display:block;margin-top:3px;color:#cbd5e1}#${MODAL_ID} .close{position:absolute;top:7px;right:9px;border:0;background:transparent;color:#fff;font-size:25px;cursor:pointer}
      #${MODAL_ID} .body{overflow:auto;padding:10px}#${MODAL_ID} .message{padding:22px;text-align:center;color:#cbd5e1}#${MODAL_ID} .error{color:#fca5a5}
      #${MODAL_ID} .attempt{display:grid;grid-template-columns:27px minmax(0,1fr) auto;gap:9px;margin-bottom:7px;padding:9px;border:1px solid #334155;border-radius:10px;background:#ffffff08}
      #${MODAL_ID} .index{display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#334155;font-size:11px;font-weight:900}
      #${MODAL_ID} .reason{display:inline-block;padding:3px 7px;border-radius:999px;background:#2563eb33;color:#bfdbfe;font-size:11px;font-weight:800}#${MODAL_ID} .reason.valid{background:#16a34a33;color:#bbf7d0}#${MODAL_ID} .reason.final{background:#dc262633;color:#fecaca}
      #${MODAL_ID} .driver{margin-top:5px;color:#dbeafe;font-size:11px}#${MODAL_ID} time{color:#94a3b8;font-size:10px;white-space:nowrap}#${MODAL_ID} img{width:52px;height:52px;margin-top:7px;border-radius:7px;object-fit:cover;cursor:zoom-in}
      #${MODAL_ID} .decision{margin-top:9px;padding:10px;border:1px solid #22c55e66;border-radius:10px;background:#16a34a22}#${MODAL_ID} .decision.warn{border-color:#fb923c88;background:#9a341e33}#${MODAL_ID} .decision.stop{border-color:#ef444488;background:#7f1d1d44}#${MODAL_ID} .decision.address{border-color:#c084fc88;background:#6b21a844}#${MODAL_ID} .decision strong{font-size:15px}
      #${MODAL_ID} .address-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}#${MODAL_ID} .address-actions button{border:0;border-radius:8px;padding:8px;color:#fff;font-weight:900;cursor:pointer}#${MODAL_ID} .confirm{background:#16a34a}#${MODAL_ID} .cancel{background:#dc2626}#${MODAL_ID} .action-status{grid-column:1/-1;min-height:13px;color:#cbd5e1;font-size:10px}
      #${TOAST_ID}{top:16px;left:50%;transform:translateX(-50%);padding:10px 14px;border:1px solid #22c55e88;border-radius:11px;background:#052e20;box-shadow:0 12px 36px #0007;font-size:13px;font-weight:900}#${TOAST_ID}.next{border-color:#fb923c99;background:#431407}
      @media(max-width:680px){#${MODAL_ID}{top:8px;right:8px;width:calc(100vw - 16px);max-height:calc(100vh - 16px)}}

      #${MODAL_ID}[hidden]{display:none!important}
      #${MODAL_ID} header{padding-right:80px}
      #${MODAL_ID} .header-actions{position:absolute;right:9px;top:9px;display:flex;gap:6px}
      #${MODAL_ID} .icon-button{display:grid;place-items:center;width:28px;height:28px;padding:4px;border:1px solid #334155;border-radius:6px;background:#1e293b;color:#fff;cursor:pointer}
      #${MODAL_ID} .icon,#${FAB_ID} svg{width:18px;height:18px}
      #${MODAL_ID} .shipment{margin-top:3px;color:#cbd5e1;font-size:12px}
      #${MODAL_ID} .photo-link{display:block;width:fit-content}
      #${MODAL_ID} .message strong{display:block}
      #${MODAL_ID} button:disabled{opacity:.5;cursor:wait}
      #${MODAL_ID} button:focus-visible,#${MODAL_ID} a:focus-visible,#${FAB_ID}:focus-visible{outline:2px solid #ff6000;outline-offset:3px}
      #${TOAST_ID}.neutral{border-color:#475569;background:#1e293b}
      #${FAB_ID}{position:fixed;right:16px;bottom:16px;z-index:999999;display:flex;align-items:center;gap:7px;padding:9px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f8fafc;font:700 12px Arial,sans-serif;cursor:pointer}
      @media(max-width:680px){#${TOAST_ID}{top:auto;bottom:60px;max-width:calc(100vw - 16px);width:max-content}#${MODAL_ID}{max-height:calc(100vh - 130px)}}
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
  modal.innerHTML=`<header><h2>Histórico de tentativas</h2><div class="shipment"><span>Shipment ID:</span> <strong></strong></div><div class="header-actions"><button class="icon-button" type="button" data-refresh aria-label="Atualizar pedido" title="Atualizar pedido">${icon('refresh')}</button><button class="icon-button" type="button" data-collapse aria-label="Recolher painel" title="Recolher painel">${icon('close')}</button></div></header><div id="${TOAST_ID}" class="neutral" role="status">Consultando AutoAdd...</div><div class="body"></div>`;
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

  function renderHistory(attempts, address) {
    if (!attempts.length) return '<div class="message">Nenhuma tentativa On Hold encontrada.</div>';
    const ordered = attempts.slice().sort((a, b) => Number(a.ctime) - Number(b.ctime));
    const cards = ordered.map((attempt, index) => {
      const reason = translateReason(attempt.on_hold_reason__desc);
      const normalized = normalize(reason);
      const className = finalReasons.has(normalized) ? 'final' : validReasons.has(normalized) ? 'valid' : '';
      const photo = photoUrl(attempt);
      const showAddressActions = index === ordered.length - 1 && normalized === 'endereco nao encontrado' && address?.state === 'pending';
      return `<article class="attempt"><span class="index">${index + 1}</span><div><span class="reason ${className}">${escapeHtml(reason)}</span><div class="driver"><b>Motorista:</b> ${escapeHtml(attempt.driver_name || '-')}</div>${photo ? `<a class="photo-link" href="${escapeHtml(photo)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(photo)}" loading="lazy" referrerpolicy="no-referrer" alt="Foto da tentativa"></a>` : ''}${showAddressActions ? `<div class="address-actions" data-reason-id="${escapeHtml(address.reasonId)}" data-local-lang="${escapeHtml(address.localLang)}"><button class="confirm" data-address-action="confirm">Confirmar</button><button class="cancel" data-address-action="cancel">Cancelar</button><div class="action-status"></div></div>` : ''}</div><time>${escapeHtml(formatDate(attempt.ctime))}</time></article>`;
    }).join('');
    const decision = recommendation(ordered, address?.state);
    return `${cards}<div class="decision ${decision.className}"><strong>${escapeHtml(decision.text)}</strong></div>`;
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
