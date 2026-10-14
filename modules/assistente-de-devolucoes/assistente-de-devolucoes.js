(function initializeReturnsAssistant() {
  const MARKER = 'spxReturnsAssistantV2';
  const ROUTE_PREFIXES = ['#/generalReceiveTaskMgt/singleReceiveNew/', '#/generalReceiveTaskOps/singleReceiveNew/'];
  const MODAL_ID = 'spx-returns-assistant-modal';
  const AUTOADD_TOAST_ID = 'spx-autoadd-toast';
  const AUTOADD_RECENT_BEFORE_SCAN_SEC = 30;
  const AUTOADD_RECENT_AFTER_SCAN_SEC = 14400;
  const AUTOADD_TRACKING_RETRY_DELAYS_MS = [0, 1200, 1800, 2500, 3200];
  const STYLE_ID = 'spx-returns-assistant-style';
  const ADDRESS_REASON_ID = 'ER40';
  const ADDRESS_REASON_DESC = 'Onhold with Delivery Address Issue';
  const AUTO_ADDRESS_KEY = 'spxReturnsAutoAddressV1';
  const AUTO_ADD_OPERATOR = 'Admin(Polygon Auto Add)';

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
  const autoAddressHandled = new Set();
  let autoAddressEnabled = (() => { try { return localStorage.getItem(AUTO_ADDRESS_KEY) === '1'; } catch { return false; } })();
  const FAB_ID = 'spx-returns-assistant-toggle';

// Shared by the catalog and embedded in the standalone user script.
function evaluateSpxAccess(basic, permissions) {
  const denied = { allowed: false, email: '', message: 'Acesso restrito: use uma conta @shopee.com com permissão para resolver e cancelar ocorrências.' };
  if (basic?.retcode !== 0 || permissions?.retcode !== 0) return denied;
  const email = typeof basic.data?.email === 'string' ? basic.data.email.trim().toLowerCase() : '';
  const local = email.split('@')[0];
  if (!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@shopee\.com$/.test(email) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return denied;
  if (!Number.isSafeInteger(basic.data?.id) || basic.data.id <= 0 || !Array.isArray(permissions.data?.perm_list)) return denied;
  const aliases = new Set(permissions.data.perm_list.flatMap(item => Array.isArray(item?.perm_alias) ? item.perm_alias : []));
  if (!aliases.has('RESOLVE_EO') || !aliases.has('CANCEL_EO_REASON')) return { ...denied, email };
  return { allowed: true, email, message: 'Acesso autorizado pela conta SPX.' };
}

function createSpxAccessChecker(read, fingerprint = () => '') {
  const root = 'https://spx.shopee.com.br/api/admin/basicserver/current_user/';
  let pending = null;
  let checkedAt = 0;
  let identity = '';
  let result = { allowed: false, email: '', message: 'Verificando conta SPX...' };
  async function check(force = false) {
    if (pending) return pending;
    const currentIdentity = fingerprint();
    if (!force && checkedAt && currentIdentity === identity && Date.now() - checkedAt < 30000) return result;
    pending = (async () => {
      try {
        const basic = await read(root + 'basic_info');
        const permissions = await read(root + 'user_permission_info');
        const confirmation = await read(root + 'basic_info');
        if (confirmation?.retcode !== 0 || basic?.data?.id !== confirmation?.data?.id || basic?.data?.email !== confirmation?.data?.email || currentIdentity !== fingerprint()) {
          throw new Error('A conta SPX mudou. Verifique o acesso novamente.');
        }
        result = evaluateSpxAccess(basic, permissions);
      } catch (_) {
        result = { allowed: false, email: '', message: 'Não foi possível validar o acesso. Entre no SPX e tente novamente.' };
      }
      identity = currentIdentity;
      checkedAt = Date.now();
      return result;
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { check };
}


  const ACCESS_NOTICE_ID = 'spx-returns-access-notice';
  let runtimeAccess = { allowed: false };
  let runtimeIdentity = '';
  let runtimeCheckedAt = 0;
  let runtimePending = null;
  function sessionFingerprint() {
    return ['spx_uid', 'fms_user_id', 'spx_uk', 'fms_user_skey'].map(cookie).join('|');
  }
  const accessChecker = createSpxAccessChecker(url => fetchJson(url), sessionFingerprint);
  function hasRuntimeAccess() {
    return runtimeAccess.allowed && runtimeIdentity === sessionFingerprint() && Date.now() - runtimeCheckedAt < 60000;
  }
  function showAccessNotice(message) {
    let notice = document.getElementById(ACCESS_NOTICE_ID);
    if (!notice) {
      notice = document.createElement('div');
      notice.id = ACCESS_NOTICE_ID;
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;right:16px;top:16px;z-index:999999;max-width:360px;padding:14px 16px;border:1px solid #d97706;border-left:4px solid #f59e0b;border-radius:11px;background:#152238;color:#f8fafc;box-shadow:0 12px 32px #02061766;font:12px/1.5 Inter,system-ui,Arial,sans-serif';
      document.body.appendChild(notice);
    }
    notice.textContent = message;
  }
  function verifyRuntimeAccess(force = false) {
    if (runtimePending) return runtimePending;
    if (!force && hasRuntimeAccess()) return Promise.resolve(true);
    const identity = sessionFingerprint();
    // Invalidate pending operational responses before checking a different account.
    if (identity !== runtimeIdentity || !runtimeAccess.allowed) {
      runtimeAccess = { allowed: false };
      stop();
      if (isTargetRoute()) showAccessNotice('Verificando acesso do assistente pela conta SPX...');
    }
    runtimePending = accessChecker.check(force).then(result => {
      runtimeAccess = result;
      runtimeIdentity = identity;
      runtimeCheckedAt = Date.now();
      if (!isTargetRoute()) return false;
      if (!hasRuntimeAccess()) {
        stop();
        showAccessNotice(result.message);
        return false;
      }
      document.getElementById(ACCESS_NOTICE_ID)?.remove();
      return true;
    }).finally(() => { runtimePending = null; });
    return runtimePending;
  }

  function isCurrent(version) {
    return version === requestVersion && isTargetRoute() && hasRuntimeAccess();
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
      #${MODAL_ID}{position:fixed;z-index:999999;font-family:Arial,sans-serif;color:#f8fafc}
      #${MODAL_ID}{top:16px;right:16px;width:min(500px,calc(100vw - 32px));max-height:min(82vh,680px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #334155;border-radius:14px;background:#0f172a;box-shadow:0 22px 62px #0008}
      #${MODAL_ID} *{box-sizing:border-box}#${MODAL_ID} header{position:relative;padding:13px 44px 11px 14px;border-bottom:1px solid #334155;background:linear-gradient(135deg,#ff600033,#0f172a)}
      #${MODAL_ID} h2{margin:0;font-size:17px}#${MODAL_ID} header small{display:block;margin-top:3px;color:#cbd5e1}#${MODAL_ID} .close{position:absolute;top:7px;right:9px;border:0;background:transparent;color:#fff;font-size:25px;cursor:pointer}
      #${MODAL_ID} .body{overflow:auto;padding:10px}#${MODAL_ID} .message{padding:22px;text-align:center;color:#cbd5e1}#${MODAL_ID} .error{color:#fca5a5}
      #${MODAL_ID} .attempt{display:grid;grid-template-columns:27px minmax(0,1fr) auto;gap:9px;margin-bottom:7px;padding:9px;border:1px solid #334155;border-radius:10px;background:#ffffff08}
      #${MODAL_ID} .index{display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#334155;font-size:11px;font-weight:900}
      #${MODAL_ID} .reason{display:inline-block;padding:3px 7px;border-radius:999px;background:#2563eb33;color:#bfdbfe;font-size:11px;font-weight:800}#${MODAL_ID} .reason.valid{background:#16a34a33;color:#bbf7d0}#${MODAL_ID} .reason.final{background:#dc262633;color:#fecaca}
      #${MODAL_ID} .driver{margin-top:5px;color:#dbeafe;font-size:11px}#${MODAL_ID} time{color:#94a3b8;font-size:10px;white-space:nowrap}#${MODAL_ID} img{width:52px;height:52px;margin-top:7px;border-radius:7px;object-fit:cover;cursor:zoom-in}
      #${MODAL_ID} .decision{margin-top:9px;padding:10px;border:1px solid #22c55e66;border-radius:10px;background:#16a34a22}#${MODAL_ID} .decision.warn{border-color:#fb923c88;background:#9a341e33}#${MODAL_ID} .decision.stop{border-color:#ef444488;background:#7f1d1d44}#${MODAL_ID} .decision.address{border-color:#c084fc88;background:#6b21a844}#${MODAL_ID} .decision strong{font-size:15px}
      #${MODAL_ID} .auto-address{display:inline-flex;align-items:center;position:relative;flex-shrink:0;cursor:pointer}
      #${MODAL_ID} .auto-address input{position:absolute;opacity:0;width:1px;height:1px}
      #${MODAL_ID} .auto-address .switch{position:relative;display:block;width:33px;height:19px;border-radius:20px;background:#475569;transition:background .2s}
      #${MODAL_ID} .auto-address .switch:after{content:"";position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:white;transition:transform .2s}
      #${MODAL_ID} .auto-address input:checked+.switch{background:#16a34a}
      #${MODAL_ID} .auto-address input:checked+.switch:after{transform:translateX(14px)}
      #${MODAL_ID} .auto-address input:focus-visible+.switch{outline:2px solid #fb923c;outline-offset:3px}
      #${MODAL_ID} .auto-info{display:inline-grid;place-items:center;flex-shrink:0;color:#94a3b8;cursor:help}
      #${MODAL_ID} .auto-info:hover,#${MODAL_ID} .auto-info:focus{color:#bfdbfe}
      #${MODAL_ID} .auto-info:focus-visible{outline:2px solid #fb923c;outline-offset:2px;border-radius:50%}
      #${MODAL_ID} .address-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}#${MODAL_ID} .address-actions button{border:0;border-radius:8px;padding:8px;color:#fff;font-weight:900;cursor:pointer}#${MODAL_ID} .confirm{background:#16a34a}#${MODAL_ID} .cancel{background:#dc2626}#${MODAL_ID} .action-status{grid-column:1/-1;min-height:13px;color:#cbd5e1;font-size:10px}
      @media(max-width:680px){#${MODAL_ID}{top:8px;right:8px;width:calc(100vw - 16px);max-height:calc(100vh - 16px)}}

      #${MODAL_ID}[hidden]{display:none!important}
      #${MODAL_ID} header{padding-right:80px}
      #${MODAL_ID} .header-actions{position:absolute;right:9px;top:9px;display:flex;align-items:center;gap:6px}
      #${MODAL_ID} [data-onhold-report]{display:inline-flex;align-items:center;justify-content:center;min-width:78px;width:auto;height:28px;padding:4px 11px;white-space:nowrap;flex-shrink:0;font-size:11px;font-weight:700;line-height:1}
      #${MODAL_ID} .icon-button{display:grid;place-items:center;width:28px;height:28px;padding:4px;border:1px solid #334155;border-radius:6px;background:#1e293b;color:#fff;cursor:pointer}
      #${MODAL_ID} .icon,#${FAB_ID} svg{width:18px;height:18px}
      #${MODAL_ID} .shipment{margin-top:3px;color:#cbd5e1;font-size:12px}
      #${MODAL_ID} .photo-link{display:block;width:fit-content}
      #${MODAL_ID} .message strong{display:block}
      #${MODAL_ID} button:disabled{opacity:.5;cursor:wait}
      #${MODAL_ID} button:focus-visible,#${MODAL_ID} a:focus-visible,#${FAB_ID}:focus-visible{outline:2px solid #ff6000;outline-offset:3px}

      #${MODAL_ID}{font:12px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#0f172a;border:1px solid #334155;border-radius:14px;box-shadow:0 18px 55px rgba(2,6,23,.42)}
      #${MODAL_ID} header{background:linear-gradient(120deg,#18263d,#111827);padding:13px 14px;border-bottom:1px solid #334155;min-height:64px}
      #${MODAL_ID} h2{font-size:15px;font-weight:800;letter-spacing:-.2px}
      #${MODAL_ID} .body{background:#0f172a;padding:11px}
      #${MODAL_ID} .attempt{background:#18263a;border:1px solid #334155;border-radius:11px;padding:11px;gap:10px}
      #${MODAL_ID} .index{background:#26354a;color:#bfdbfe}
      #${MODAL_ID} .decision{border-radius:11px;padding:12px}
      #${MODAL_ID} .icon-button,#${MODAL_ID} [data-onhold-report]{border-radius:9px;background:#23344d;border:1px solid #3b4a60;color:#e2e8f0;font-family:inherit;font-weight:750}
      #${MODAL_ID} .icon-button:hover,#${MODAL_ID} [data-onhold-report]:hover{background:#30445d}
      #${MODAL_ID} .address-actions button{border-radius:9px;font-family:inherit}
      #${FAB_ID}{font:750 12px Inter,system-ui,Arial,sans-serif;border:1px solid #334155;border-radius:11px;background:#152238;box-shadow:0 10px 28px #02061750}
      #${FAB_ID}:hover{background:#23344d}
      #${MODAL_ID} button:focus-visible,#${MODAL_ID} input:focus-visible,#${FAB_ID}:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
      #${MODAL_ID} .auto-info{color:#93a6c1}
      @media(max-width:680px){#${MODAL_ID} header{padding-right:14px}#${MODAL_ID} h2{font-size:13px;max-width:45%}#${MODAL_ID} .header-actions{gap:5px}}
      @media(max-width:680px){#${MODAL_ID}{max-height:calc(100vh - 130px)}}
      #${FAB_ID}{position:fixed;right:16px;bottom:16px;z-index:999999;display:flex;align-items:center;gap:7px;padding:9px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f8fafc;font:700 12px Arial,sans-serif;cursor:pointer}
    `;
    style.textContent += `      #${AUTOADD_TOAST_ID} {
        left: auto;
        top: auto;
        right: 20px;
        bottom: 22px;
        display: flex;
        align-items: center;
        gap: 9px;
        max-width: min(420px, calc(100vw - 32px));
        padding: 11px 14px;
        color: #dcfce7;
        background: rgba(15,23,42,0.96);
        border: 1px solid rgba(34,197,94,0.42);
        border-left: 4px solid #22c55e;
        font-size: 13px;
        font-weight: 900;
        position: fixed;
        z-index: 999999;
        border-radius: 11px;
        font-family: Arial, sans-serif;

        pointer-events: none;
      }

      #${AUTOADD_TOAST_ID}.spx-autoadd-next-cycle {
        color: #fef3c7;
        border-color: rgba(245,158,11,0.42);
        border-left-color: #f59e0b;
      }

      #${AUTOADD_TOAST_ID} .spx-autoadd-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        border-radius: 999px;
        background: rgba(255,255,255,0.1);
        font-size: 13px;
      }

      #${AUTOADD_TOAST_ID} .spx-autoadd-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

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
  modal.innerHTML=`<header><h2>Histórico de tentativas</h2><div class="shipment"><span>Shipment ID:</span> <strong></strong></div><div class="header-actions"><label class="auto-address" title="Ativar tratativa automática"><input type="checkbox" data-auto-address aria-label="Tratativa automática de endereço"><span class="switch" aria-hidden="true"></span></label><span class="auto-info" tabindex="0" role="note" aria-label="Automação: confirma com 2 ou mais tentativas de endereço não encontrado e cancela com 1. Somente se houver exceção pendente." title="Automação de endereço: 2 ou mais tentativas confirmam; 1 tentativa cancela. Só age com exceção pendente. Continua processando mesmo após escanear outro BR."><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v5M12 7h.01"/></svg></span><button class="icon-button" type="button" data-onhold-report aria-label="Abrir relatório On Hold do dia" title="Abrir relatório On Hold em nova aba">On Hold</button><button class="icon-button" type="button" data-refresh aria-label="Atualizar pedido" title="Atualizar pedido">${icon('refresh')}</button><button class="icon-button" type="button" data-collapse aria-label="Recolher painel" title="Recolher painel">${icon('chevron')}</button></div></header><div class="body"></div>`;
  modal.onclick=handleModalClick;modal.querySelector('[data-auto-address]').addEventListener('change', event => { autoAddressEnabled = event.target.checked; try { localStorage.setItem(AUTO_ADDRESS_KEY, autoAddressEnabled ? '1' : '0'); } catch {} if(autoAddressEnabled && !historyBusy && lastShipmentId) startShipment(lastShipmentId,0); });document.body.appendChild(modal);
  const toggle=document.createElement('button');toggle.id=FAB_ID;toggle.type='button';
  toggle.innerHTML=icon('package')+' Devoluções';toggle.setAttribute('aria-controls',MODAL_ID);
  toggle.onclick=()=>setCollapsed(!collapsed);document.body.appendChild(toggle);
 }
 modal.querySelector('[data-auto-address]').checked=autoAddressEnabled;
 modal.dataset.shipmentId=shipmentId;
 modal.querySelector('.shipment strong').textContent=shipmentId;
 modal.querySelector('.body').innerHTML=html;
 modal.querySelector('[data-refresh]').disabled=historyBusy||pendingActions.has(shipmentId);
 setCollapsed(collapsed);
 positionToggle();
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
  if(!isCurrent(version) && !autoAddressEnabled)return;
  if(!Array.isArray(data?.data?.recipient?.On_Hold))throw new Error('O SPX não retornou o histórico no formato esperado.');
  const attempts=data.data.recipient.On_Hold.filter(item=>item&&typeof item==='object');
  recordDailyOnHold(shipmentId, attempts);
  const latestReason=normalize(translateReason(attempts.slice().sort((a,b)=>Number(a.ctime)-Number(b.ctime)).at(-1)?.on_hold_reason__desc));
  let address={state:''};
  if(latestReason==='endereco nao encontrado'&&recommendation(attempts,'').text!=='RETORNAR AO SOC'){
   try{address=addressState(await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/no_reason_inbound',{shipment_id:shipmentId}));}
   catch{address={state:'unknown'};}
  }
  if(isCurrent(version))showModal(shipmentId,renderHistory(attempts,address));
  if(autoAddressEnabled && isTargetRoute()) void autoTreatAddress(shipmentId,attempts,address,version);
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


  function recordDailyOnHold(id, attempts) {
    try {
      const key = 'spxOnHoldDailyV1';
      const today = new Date().toLocaleDateString('sv-SE');
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      for (const day of Object.keys(all)) {
        if (new Date(day + 'T12:00:00').getTime() < Date.now() - 7 * 86400000) delete all[day];
      }
      const latest = attempts.slice().sort((a, b) => Number(a.ctime) - Number(b.ctime)).at(-1);
      all[today] ||= {};
      all[today][id] = { id, reason: latest ? translateReason(latest.on_hold_reason__desc) : '', driver: String(latest?.driver_name || ''), attempts: attempts.length, checkedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(all));
    } catch (error) { console.warn('[SPX OnHold]', error); }
  }

  function dailyOnHoldReport() {
    const today = new Date().toLocaleDateString('sv-SE');
    const all = JSON.parse(localStorage.getItem('spxOnHoldDailyV1') || '{}');
    const rows = Object.values(all[today] || {}).filter(row => row.attempts > 0);
    const csv = [['BR', 'Motivo', 'Motorista', 'Tentativas', 'Consulta'], ...rows.map(row => [row.id, row.reason, row.driver, row.attempts, new Date(row.checkedAt).toLocaleString('pt-BR')])]
      .map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'onhold-' + today + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  function showDailyOnHold() {
    const tab = window.open('', '_blank');
    if (!tab) { alert('Permita pop-ups para abrir o relatório On Hold.'); return; }
    const day = new Date().toLocaleDateString('sv-SE');
    let store = {};
    try { store = JSON.parse(localStorage.getItem('spxOnHoldDailyV1') || '{}'); } catch {}
    const records = Object.values(store[day] || {});
    const rows = records.filter(item => item && Number(item.attempts) > 0).sort((a,b) => b.checkedAt-a.checkedAt);
    const reasons = Object.create(null);
    for (const row of rows) {
      const reason = String(row.reason || 'Não informado');
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
    const totalAttempts = rows.reduce((n,item) => n + Number(item.attempts || 0),0);
    const reasonHtml = Object.entries(reasons).sort((a,b)=>b[1]-a[1]).map(([reason,count]) => {
      const pct = rows.length ? Math.round(count / rows.length * 100) : 0;
      return '<article class="reason"><div class="reason-head"><strong>'+escapeHtml(reason)+'</strong><b>'+count+' · '+pct+'%</b></div><div class="bar"><i style="width:'+pct+'%"></i></div></article>';
    }).join('');
    const tableHtml = rows.map(row => '<tr data-search="'+escapeHtml([row.id,row.reason,row.driver].join(' ').toLowerCase())+'"><td>'+escapeHtml(row.id)+'</td><td>'+escapeHtml(row.reason)+'</td><td>'+escapeHtml(row.driver)+'</td><td>'+Number(row.attempts)+'</td><td>'+new Date(row.checkedAt).toLocaleString('pt-BR')+'</td></tr>').join('');
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>On Hold · ${day}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#0b1220;color:#f8fafc;font:14px system-ui,Arial,sans-serif}main{max-width:1180px;margin:auto;padding:32px 22px}
      header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:25px}
      h1{font-size:27px;letter-spacing:-.7px;margin:0 0 5px}h2{font-size:17px;margin:0 0 15px}p,small{color:#94a3b8}
      button{background:#26364c;color:#fff;border:1px solid #40516a;border-radius:9px;padding:11px 15px;cursor:pointer;font-weight:650}
      .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card,.panel{border:1px solid #334155;border-radius:15px;background:#152135;padding:21px}
      .card span{display:block;color:#94a3b8;font-size:12px}.card strong{display:block;font-size:30px;margin-top:8px}
      .panels{display:grid;grid-template-columns:minmax(300px,1fr) minmax(0,1.65fr);gap:15px;margin-top:18px}
      .reason{padding:14px;border-radius:10px;background:#1c2c42;margin:9px 0}.reason-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:12px}
      .reason-head b{color:#fbbf24;white-space:nowrap}.bar{height:8px;background:#334155;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:#f59e0b;border-radius:99px}
      input{width:100%;padding:12px;border-radius:9px;background:#0e1828;border:1px solid #40516a;color:white;margin-bottom:12px;font:inherit}
      .table-wrap{overflow:auto;max-height:65vh}table{border-collapse:collapse;width:100%;text-align:left;min-width:630px}th,td{padding:12px 9px;border-bottom:1px solid #304057}th{color:#94a3b8;position:sticky;top:0;background:#152135}
      body{background:#0b1220;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.5}
      .card,.panel{background:#152238;border-color:#334155;border-radius:14px}
      .reason{background:#1b2b43;border-radius:11px}
      button{background:#23344d;border:1px solid #3b4a60;border-radius:9px}
      button:hover{background:#30445d}button:focus-visible,input:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
            @media(max-width:820px){.panels{grid-template-columns:1fr}.grid{gap:8px}.card{padding:13px}.card strong{font-size:23px}main{padding:18px 12px}}
      </style></head><body><main><header><div><h1>Relatório On Hold</h1><p>${day} · Registros deste navegador</p></div><button id="export">Exportar CSV</button></header>
      <div class="grid"><div class="card"><span>Pedidos consultados</span><strong>${records.length}</strong></div><div class="card"><span>Pedidos com On Hold</span><strong style="color:#fbbf24">${rows.length}</strong></div><div class="card"><span>Tentativas registradas</span><strong>${totalAttempts}</strong></div></div>
      <div class="panels"><section class="panel"><h2>Motivos On Hold</h2>${reasonHtml || '<p>Nenhum registro encontrado.</p>'}</section>
      <section class="panel"><h2>Pedidos consultados</h2><input id="filter" type="search" placeholder="Pesquisar BR, motivo ou motorista"><div class="table-wrap"><table><thead><tr><th>BR</th><th>Motivo</th><th>Motorista</th><th>Tentativas</th><th>Consulta</th></tr></thead><tbody>${tableHtml}</tbody></table></div></section></div>
      <p>Dados locais, com retenção de até 7 dias. Não representam todos os pedidos da operação.</p></main></body></html>`;
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
    tab.document.getElementById('filter').addEventListener('input', event => {
      const q = event.target.value.trim().toLowerCase();
      tab.document.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !tr.dataset.search.includes(q); });
    });
    tab.document.getElementById('export').addEventListener('click', dailyOnHoldReport);
  }

  function selectAuditTask(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    return list.find((task) => Number(task?.end_time || 0) === 0) || list[0] || null;
  }

  function collectTrackingNodes(nodes, output) {
    if (!Array.isArray(nodes)) return output;

    nodes.forEach((node) => {
      if (!node || typeof node !== "object") return;

      output.push(node);
      collectTrackingNodes(node.children, output);
      collectTrackingNodes(node.event_children, output);
    });

    return output;
  }

  function extractAssignmentTaskId(message) {
    const text = String(message || "");
    if (!/Assignment Task/i.test(text)) return "";

    const match = text.match(/\[(AT[^\]\s]+)\]/i);
    return match ? String(match[1]).trim() : "";
  }

  function isPolygonAutoAddNode(node) {
    const operator = String(node?.operator || "").trim();
    const bizStaffName = String(node?.biz_staff_name || "").trim();
    return operator === "Admin(Polygon Auto Add)" || bizStaffName === "Admin(Polygon Auto Add)";
  }

  function isRecentAutoAddNode(node, scanUnix) {
    const timestamp = Number(node?.timestamp || 0);
    const reference = Number(scanUnix || 0);
    if (!timestamp || !reference) return false;

    return timestamp >= reference - AUTOADD_RECENT_BEFORE_SCAN_SEC &&
      timestamp <= reference + AUTOADD_RECENT_AFTER_SCAN_SEC;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function findPolygonAutoAddTargetId(trackingData, scanUnix) {
    const nodes = collectTrackingNodes(trackingData?.data?.tracking_list, []);
    const candidates = nodes
      .map((node, index) => ({
        node,
        index,
        targetId: extractAssignmentTaskId(node?.message)
      }))
      .filter((item) =>
        item.targetId &&
        isPolygonAutoAddNode(item.node) &&
        isRecentAutoAddNode(item.node, scanUnix)
      )
      .sort((a, b) => {
        const timestampDiff = Number(b.node?.timestamp || 0) - Number(a.node?.timestamp || 0);
        if (timestampDiff !== 0) return timestampDiff;

        const idDiff = Number(b.node?.id || 0) - Number(a.node?.id || 0);
        if (idDiff !== 0) return idDiff;

        return b.index - a.index;
      });

    return candidates[0]?.targetId || "";
  }

  async function fetchPolygonAutoAddTargetId(shipmentId, scanUnix) {
    const trackingUrl = `https://spx.shopee.com.br/api/fleet_order/order/detail/tracking_info?shipment_id=${encodeURIComponent(shipmentId)}`;
    const trackingData = await fetchJson(trackingUrl);
    return findPolygonAutoAddTargetId(trackingData, scanUnix);
  }

  async function fetchRecentPolygonAutoAddTargetId(shipmentId, scanUnix, version) {
    let lastError = null;

    for (let i = 0; i < AUTOADD_TRACKING_RETRY_DELAYS_MS.length; i += 1) {
      const delay = AUTOADD_TRACKING_RETRY_DELAYS_MS[i];
      if (delay > 0) await sleep(delay);

      if (!isCurrent(version)) return "";
      try {
        const targetId = await fetchPolygonAutoAddTargetId(shipmentId, scanUnix);
        if (targetId) return targetId;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
    return "";
  }

  async function fetchAutoAddInfo(shipmentId, scanUnix, version) {
    try {
      const referenceUnix = Number(scanUnix || Math.floor(Date.now() / 1000));
      const autoAddTargetId = await fetchRecentPolygonAutoAddTargetId(shipmentId, referenceUnix, version);
      if (!autoAddTargetId || !isCurrent(version)) return null;

      const range = todayRange();
      const taskUrl = `https://spx.shopee.com.br/api/in-station/lmhub/audit/task/list?page_no=1&count=24&validation_start_time=${range.start}&validation_end_time=${range.end}`;
      const taskData = await fetchJson(taskUrl);
      if (!isCurrent(version)) return null;
      const task = selectAuditTask(taskData?.data?.list);
      const taskId = task?.validation_task_id;

      if (!taskId) return null;

      const targetUrl = `https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list?target_id=${encodeURIComponent(autoAddTargetId)}&task_id=${encodeURIComponent(taskId)}&page_no=1&count=24`;
      const targetData = await fetchJson(targetUrl);
      if (!isCurrent(version)) return null;
      const targets = Array.isArray(targetData?.data?.list) ? targetData.data.list : [];
      const target = targets.find((item) => String(item?.target_id || "").toUpperCase() === String(autoAddTargetId).toUpperCase()) || targets[0];

      if (!target) {
        return {
          nextCycle: true,
          taskId: String(taskId),
          targetId: String(autoAddTargetId)
        };
      }

      if (!target.binding_entity) return null;

      return {
        route: String(target.binding_entity),
        taskId: String(taskId),
        targetId: String(autoAddTargetId)
      };
    } catch (err) {
      console.warn("SPX Toolkit AutoADD:", err);
      return null;
    }
  }

  function getAutoAddMessage(autoAddInfo) {
    if (autoAddInfo?.nextCycle) return "AutoAdd para o próximo ciclo";
    if (autoAddInfo?.route) return `AutoADD na rota ${autoAddInfo.route}`;
    return "";
  }

  function removeAutoAddToast() {
    const toast = document.getElementById(AUTOADD_TOAST_ID);
    if (toast) toast.remove();
  }

  function showAutoAddToast(autoAddInfo) {
    const message = getAutoAddMessage(autoAddInfo);
    removeAutoAddToast();
    if (!message) return;

    ensureStyle();

    const toast = document.createElement("div");
    toast.id = AUTOADD_TOAST_ID;
    if (autoAddInfo?.nextCycle) {
      toast.className = "spx-autoadd-next-cycle";
    }
    toast.innerHTML = `
      <span class="spx-autoadd-icon">${autoAddInfo?.nextCycle ? "↻" : "✓"}</span>
      <span class="spx-autoadd-text">${escapeHtml(message)}</span>
    `;
    document.body.appendChild(toast);
    positionToggle();
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

    async function autoTreatAddress(shipmentId, attempts, address, version) {
    if (!autoAddressEnabled || address?.state !== 'pending' || !isTargetRoute() || autoAddressHandled.has(shipmentId) || pendingActions.has(shipmentId)) return;
    const ordered = attempts.slice().sort((a,b)=>Number(a.ctime)-Number(b.ctime));
    if (normalize(translateReason(ordered.at(-1)?.on_hold_reason__desc)) !== 'endereco nao encontrado') return;
    if (recommendation(attempts,'').text === 'RETORNAR AO SOC') return;
    const count = attempts.filter(item => normalize(translateReason(item?.on_hold_reason__desc)) === 'endereco nao encontrado').length;
    if (!count) return;
    const action = count >= 2 ? 'confirm' : 'cancel';
    const fingerprint = sessionFingerprint();
    const statusForOriginal = message => {
      const modal = document.getElementById(MODAL_ID);
      if (modal?.dataset.shipmentId === shipmentId) {
        const status = modal.querySelector('[data-auto-address-status]');
        if (status) status.textContent = message;
      }
    };
    pendingActions.add(shipmentId);
    statusForOriginal(count+' tentativa(s). Verificando exceção antes da tratativa automática...');
    try {
      if (!(await verifyRuntimeAccess(true)) || !autoAddressEnabled || fingerprint !== sessionFingerprint()) return;
      const response = await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/no_reason_inbound', { shipment_id: shipmentId });
      const check = addressState(response);
      if (check.state !== 'pending' || String(check.reasonId) !== String(address.reasonId)) {
        statusForOriginal('Exceção não está mais pendente. Nenhuma ação automática realizada.');
        return;
      }
      if (!autoAddressEnabled || fingerprint !== sessionFingerprint() || !hasRuntimeAccess()) return;
      autoAddressHandled.add(shipmentId);
      statusForOriginal('Executando '+(action === 'confirm' ? 'confirmação' : 'cancelamento')+' automático para '+shipmentId+'...');
      if (action === 'confirm') {
        await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/resolve_reason', {
          shipment_id: shipmentId, reason_id: check.reasonId
        });
      } else {
        await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/cancel_eo_reason', {
          shipment_id: shipmentId, reason_id: check.reasonId,
          reason_desc: ADDRESS_REASON_DESC, local_lang: check.localLang || ''
        });
      }
      statusForOriginal('Tratativa automática concluída para '+shipmentId+'.');
      const modal = document.getElementById(MODAL_ID);
      if (modal?.dataset.shipmentId === shipmentId) {
        modal.querySelectorAll('.address-actions button').forEach(button => { button.hidden = true; });
        const decision = modal.querySelector('.decision');
        if (decision) {
          decision.className = 'decision' + (action === 'confirm' ? ' address' : '');
          decision.querySelector('strong').textContent = action === 'confirm' ? 'AGUARDAR TRATATIVA (24h)' : 'PROCESSAR PARA ENTREGA';
        }
      }
    } catch (error) {
      statusForOriginal(autoAddressHandled.has(shipmentId)
        ? 'Resultado não confirmado. Consulte o pedido no SPX antes de repetir.'
        : 'Não foi possível verificar a exceção. Nenhuma tratativa enviada.');
    } finally {
      pendingActions.delete(shipmentId);
      const modal = document.getElementById(MODAL_ID);
      if (modal?.dataset.shipmentId === shipmentId) {
        const refresh = modal.querySelector('[data-refresh]');
        if (refresh) refresh.disabled = historyBusy;
      }
    }
  }

  async function handleAddress(button){
 const accessVersion=requestVersion;
 if(!(await verifyRuntimeAccess(true))||accessVersion!==requestVersion)return;
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
 if(target.closest('[data-onhold-report]')){showDailyOnHold();return;}
 if(target.closest('[data-refresh]')){if(!historyBusy&&!pendingActions.has(lastShipmentId))startShipment(lastShipmentId,0);return;}
 const button=target.closest('[data-address-action]');if(button)void handleAddress(button);
}

  function shipmentChanged(event){
 if(!isTargetRoute()||!hasRuntimeAccess())return;
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
 document.getElementById('spx-onhold-report-window')?.remove();
 lastShipmentId='';observedInput='';collapsed=false;removeUi();
}

  function positionToggle() {
 const toggle=document.getElementById(FAB_ID);
 if(!toggle)return;
 const margin=16,gap=12;
 let bottom=margin;
 const toast=document.getElementById('spx-autoadd-toast');
 if(toast&&!toast.hidden){
  const rect=toast.getBoundingClientRect();
  const width=toggle.offsetWidth,height=toggle.offsetHeight;
  const left=window.innerWidth-margin-width;
  const top=window.innerHeight-margin-height;
  if(rect.width>0&&rect.height>0&&rect.right>left-gap&&rect.left<window.innerWidth-margin+gap&&rect.bottom>top-gap&&rect.top<window.innerHeight){
   bottom=Math.min(window.innerHeight-rect.top+gap,Math.max(margin,window.innerHeight-height-margin));
  }
 }
 toggle.style.bottom=bottom+'px';
}

  function checkRoute(){
 positionToggle();
 if(!isTargetRoute()){if(monitorId||lastShipmentId)stop();document.getElementById(ACCESS_NOTICE_ID)?.remove();return;}
 if(hasRuntimeAccess() && !runtimePending && Date.now()-runtimeCheckedAt>=30000)void verifyRuntimeAccess(true);
 if(!hasRuntimeAccess()){
  if(!runtimePending && (runtimeIdentity!==sessionFingerprint() || Date.now()-runtimeCheckedAt>=30000))void verifyRuntimeAccess();
  return;
 }
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
 chevron:'<path d="m6 9 6 6 6-6"/>',
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
 if(!shipmentId||!isTargetRoute()||!hasRuntimeAccess())return;
 clearTimeout(debounceId);
 const version=++requestVersion;
  lastShipmentId=shipmentId;historyBusy=true;
 showModal(shipmentId,'<div class="message" role="status"><span class="spinner" aria-hidden="true"></span><strong>Consultando pedido</strong>Buscando histórico de tentativas...</div>');
 debounceId=setTimeout(()=>{
  if(!isCurrent(version))return;
  void loadHistory(shipmentId,version);
 },delay);
}

  window.addEventListener('resize', positionToggle);
  window.addEventListener('hashchange', checkRoute);
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('focus', () => { if(isTargetRoute())void verifyRuntimeAccess(true).then(checkRoute); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isTargetRoute()) void verifyRuntimeAccess(true).then(checkRoute); });
  setInterval(checkRoute, 700);
  checkRoute();
})();
