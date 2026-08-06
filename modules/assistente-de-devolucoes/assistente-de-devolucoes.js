(function initializeReturnsAssistant() {
  const MARKER = 'spxReturnsAssistantV1';
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
    `;
    document.documentElement.appendChild(style);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json, text/plain, */*', ...(options.headers || {}) },
      ...options
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 220) || `HTTP ${response.status}`); }
    if (!response.ok || data.retcode !== 0) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
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

  function focusInput() {
    for (const delay of [0, 50, 120, 250, 500]) setTimeout(() => {
      const input = findInput();
      input?.focus({ preventScroll: true });
      input?.select?.();
    }, delay);
  }

  function removeUi() {
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById(TOAST_ID)?.remove();
  }

  function showModal(shipmentId, html) {
    ensureStyle();
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement('section');
      modal.id = MODAL_ID;
      document.body.appendChild(modal);
    }
    modal.dataset.shipmentId = shipmentId;
    modal.innerHTML = `<header><h2>Histórico de tentativas</h2><small>Shipment ID: <b>${escapeHtml(shipmentId)}</b></small><button class="close" type="button">×</button></header><div class="body">${html}</div>`;
    modal.querySelector('.close')?.addEventListener('click', () => modal.remove());
    modal.onclick = handleModalClick;
  }

  function showAutoAddToast(result) {
    document.getElementById(TOAST_ID)?.remove();
    const message = result?.nextCycle ? 'AutoAdd para o próximo ciclo' : result?.route ? `AutoAdd na rota ${result.route}` : '';
    if (!message) return;
    ensureStyle();
    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    if (result.nextCycle) toast.className = 'next';
    toast.textContent = message;
    document.body.appendChild(toast);
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

  function photoUrl(attempt) {
    const image = Array.isArray(attempt?.image_list) ? attempt.image_list.find(item => item?.image_url)?.image_url : '';
    const photo = Array.isArray(attempt?.photo_list) ? attempt.photo_list.find(Boolean) : '';
    const value = image || photo;
    if (!value) return '';
    if (/^https?:/i.test(value)) return value;
    return `https://spx.shopee.com.br/shopee-live-spx-perm-data${value.startsWith('/') ? '' : '/'}${value}`;
  }

  function recommendation(attempts, addressState) {
    const ordered = attempts.slice().sort((a, b) => Number(a.ctime) - Number(b.ctime));
    const reasons = ordered.map(item => normalize(translateReason(item.on_hold_reason__desc)));
    const valid = reasons.filter(reason => validReasons.has(reason)).length;
    const days = new Set(ordered.map(item => attemptDay(item.ctime)).filter(Boolean)).size;
    if (reasons.at(-1) === 'fora de rota') return { text: 'REALOCAR/FLEET', className: 'warn' };
    if (reasons.some(reason => finalReasons.has(reason)) || (ordered.length >= 3 && valid >= 3 && days >= 3)) return { text: 'RETORNAR AO SOC', className: 'stop' };
    if (addressState === 'pending') return { text: 'TRATATIVA DE ENDEREÇO', className: 'address' };
    if (addressState === 'confirmed') return { text: 'AGUARDAR TRATATIVA (24h)', className: 'address' };
    return { text: 'PROCESSAR PARA ENTREGA', className: '' };
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
      return `<article class="attempt"><span class="index">${index + 1}</span><div><span class="reason ${className}">${escapeHtml(reason)}</span><div class="driver"><b>Motorista:</b> ${escapeHtml(attempt.driver_name || '-')}</div>${photo ? `<img src="${escapeHtml(photo)}" data-photo="${escapeHtml(photo)}" alt="Foto da tentativa">` : ''}${showAddressActions ? `<div class="address-actions" data-reason-id="${escapeHtml(address.reasonId)}" data-local-lang="${escapeHtml(address.localLang)}"><button class="confirm" data-address-action="confirm">Confirmar</button><button class="cancel" data-address-action="cancel">Cancelar</button><div class="action-status"></div></div>` : ''}</div><time>${escapeHtml(formatDate(attempt.ctime))}</time></article>`;
    }).join('');
    const decision = recommendation(ordered, address?.state);
    return `${cards}<div class="decision ${decision.className}"><strong>${decision.text}</strong></div>`;
  }

  async function loadHistory(shipmentId, version) {
    try {
      const data = await fetchJson(`https://spx.shopee.com.br/api/fleet_order/order/detail/recipient_info?shipment_id=${encodeURIComponent(shipmentId)}&station_type=3`);
      if (version !== requestVersion) return;
      const attempts = Array.isArray(data?.data?.recipient?.On_Hold) ? data.data.recipient.On_Hold : [];
      const latestReason = normalize(translateReason(attempts.slice().sort((a, b) => Number(a.ctime) - Number(b.ctime)).at(-1)?.on_hold_reason__desc));
      let address = { state: '' };
      if (latestReason === 'endereco nao encontrado' && recommendation(attempts, '').text !== 'RETORNAR AO SOC') {
        try {
          address = addressState(await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/no_reason_inbound', { shipment_id: shipmentId }));
        } catch (error) { console.warn('Assistente de devoluções — endereço:', error); }
      }
      if (version === requestVersion) showModal(shipmentId, renderHistory(attempts, address));
    } catch (error) {
      if (version === requestVersion) showModal(shipmentId, `<div class="message error">Não foi possível buscar as tentativas. ${escapeHtml(error.message || error)}</div>`);
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

  function autoAddTarget(data, scanTime) {
    return flattenTracking(data?.data?.tracking_list)
      .map(node => ({ node, targetId: /Assignment Task/i.test(String(node.message || '')) ? String(node.message || '').match(/\[(AT[^\]\s]+)\]/i)?.[1] || '' : '' }))
      .filter(item => item.targetId && String(item.node.operator || item.node.biz_staff_name || '').trim() === AUTO_ADD_OPERATOR && Number(item.node.timestamp || 0) >= scanTime - 30 && Number(item.node.timestamp || 0) <= scanTime + 14400)
      .sort((a, b) => Number(b.node.timestamp || 0) - Number(a.node.timestamp || 0))[0]?.targetId || '';
  }

  function todayRange() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    const start = Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 3) / 1000);
    return { start, end: start + 86399 };
  }

  async function loadAutoAdd(shipmentId, version, scanTime) {
    try {
      let targetId = '';
      for (const delay of AUTO_ADD_DELAYS) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const tracking = await fetchJson(`https://spx.shopee.com.br/api/fleet_order/order/detail/tracking_info?shipment_id=${encodeURIComponent(shipmentId)}`);
        targetId = autoAddTarget(tracking, scanTime);
        if (targetId) break;
      }
      if (!targetId || version !== requestVersion) return;
      const range = todayRange();
      const taskData = await fetchJson(`https://spx.shopee.com.br/api/in-station/lmhub/audit/task/list?page_no=1&count=24&validation_start_time=${range.start}&validation_end_time=${range.end}`);
      const tasks = Array.isArray(taskData?.data?.list) ? taskData.data.list : [];
      const task = tasks.find(item => Number(item.end_time || 0) === 0) || tasks[0];
      if (!task?.validation_task_id) return;
      const targetData = await fetchJson(`https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list?target_id=${encodeURIComponent(targetId)}&task_id=${encodeURIComponent(task.validation_task_id)}&page_no=1&count=24`);
      const targets = Array.isArray(targetData?.data?.list) ? targetData.data.list : [];
      const target = targets.find(item => String(item.target_id || '').toUpperCase() === targetId.toUpperCase()) || targets[0];
      if (version === requestVersion) showAutoAddToast(target ? (target.binding_entity ? { route: String(target.binding_entity) } : null) : { nextCycle: true });
    } catch (error) { if (version === requestVersion) console.warn('Assistente de devoluções — AutoAdd:', error); }
  }

  async function handleAddress(button) {
    const modal = button.closest(`#${MODAL_ID}`);
    const actions = button.closest('.address-actions');
    const status = actions?.querySelector('.action-status');
    const shipmentId = modal?.dataset.shipmentId || '';
    const action = button.dataset.addressAction;
    if (!actions || !shipmentId || shipmentId !== lastShipmentId) return;
    const buttons = [...actions.querySelectorAll('button')];
    buttons.forEach(item => { item.disabled = true; });
    if (status) status.textContent = action === 'confirm' ? 'Confirmando...' : 'Cancelando...';
    try {
      if (action === 'confirm') {
        await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/resolve_reason', { shipment_id: shipmentId, reason_id: actions.dataset.reasonId || ADDRESS_REASON_ID });
      } else {
        await postJson('https://spx.shopee.com.br/api/in-station/admin/common_site/eha/cancel_eo_reason', { shipment_id: shipmentId, reason_id: actions.dataset.reasonId || ADDRESS_REASON_ID, reason_desc: ADDRESS_REASON_DESC, local_lang: actions.dataset.localLang || '' });
      }
      if (status) status.textContent = action === 'confirm' ? 'Motivo confirmado com sucesso.' : 'Motivo cancelado com sucesso.';
      buttons.forEach(item => { item.hidden = true; });
      const decision = modal.querySelector('.decision strong');
      if (decision) decision.textContent = action === 'confirm' ? 'AGUARDAR TRATATIVA (24h)' : 'PROCESSAR PARA ENTREGA';
      focusInput();
    } catch (error) {
      if (status) status.textContent = String(error.message || error);
      buttons.forEach(item => { item.disabled = false; });
    }
  }

  function handleModalClick(event) {
    const addressButton = event.target.closest('[data-address-action]');
    if (addressButton) return void handleAddress(addressButton);
    const photo = event.target.closest('[data-photo]');
    if (photo) window.open(photo.dataset.photo, '_blank', 'noopener,noreferrer');
  }

  function shipmentChanged() {
    if (!isTargetRoute()) return;
    const shipmentId = readShipmentId();
    if (!shipmentId || shipmentId === lastShipmentId) return;
    document.getElementById(TOAST_ID)?.remove();
    lastShipmentId = shipmentId;
    const scanTime = Math.floor(Date.now() / 1000);
    clearTimeout(debounceId);
    debounceId = setTimeout(() => {
      const current = readShipmentId() || shipmentId;
      if (current !== lastShipmentId) return;
      requestVersion += 1;
      showModal(current, '<div class="message">Buscando tentativas...</div>');
      loadHistory(current, requestVersion);
      loadAutoAdd(current, requestVersion, scanTime);
    }, 1500);
  }

  function stop() {
    if (monitorId) clearInterval(monitorId);
    monitorId = null;
    document.removeEventListener('input', shipmentChanged, true);
    document.removeEventListener('change', shipmentChanged, true);
    lastShipmentId = '';
    removeUi();
  }

  function checkRoute() {
    if (!isTargetRoute()) return stop();
    if (monitorId) return shipmentChanged();
    monitorId = setInterval(shipmentChanged, 300);
    document.addEventListener('input', shipmentChanged, true);
    document.addEventListener('change', shipmentChanged, true);
    setTimeout(shipmentChanged, 400);
  }

  window.addEventListener('hashchange', checkRoute);
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('focus', checkRoute);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRoute(); });
  setInterval(checkRoute, 700);
  checkRoute();
})();
