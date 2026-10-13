(() => {
  'use strict';
  const VERSION = '1.9.4';
  const KEY = 'spxDockFlowChangelogSeenV1';
  const changes = [
    ['13/10/2026', 'Aviso de atualizações', 'Resumo das melhorias importantes exibido uma vez por versão.'],
    ['12/10/2026', 'Recuperação de conexão', 'Limite de espera e proteção contra requisições presas, preservando os últimos dados.'],
    ['12/10/2026', 'Conexão com a SPX', 'Consultas mantidas pelo loader para evitar bloqueios de acesso entre domínios.'],
    ['11/10/2026', 'Alertas por quantidade', 'O tempo de alerta de carregamento agora considera a quantidade de pedidos da AT.'],
    ['11/10/2026', 'Configuração simplificada', 'Removidos os limites manuais de alerta de carregamento das configurações.'],
    ['Melhoria', 'Visibilidade de pedidos', 'Quantidades de pedidos e volumosos exibidas junto às informações das rotas.'],
    ['Melhoria', 'Painel de ocupação', 'Acompanhamento dos tempos de espera e carregamento nas mesas.'],
    ['Melhoria', 'Histórico operacional', 'Indicadores de ocupação e tempos acompanhados em uma janela configurável.'],
    ['Melhoria', 'Visualização de rotas', 'Melhor organização das informações de motorista, rota e AT em cada mesa.'],
    ['Melhoria', 'Ajustes de interface', 'Controles de zoom, atualização automática e melhor adaptação a diferentes telas.']
  ];
  let priorFocus = null;
  let overlay = null;
  try { if (localStorage.getItem(KEY) === VERSION) return; } catch {}
  const icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const closeIcon = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const style = document.createElement('style');
  style.id = 'dock-flow-changelog-style';
  style.textContent = `
    #dock-flow-changelog-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(3,9,21,.78);backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;padding:20px}
    #dock-flow-changelog-overlay *{box-sizing:border-box}
    #dock-flow-changelog-overlay .cl-dialog{width:min(690px,100%);max-height:min(760px,92dvh);display:flex;flex-direction:column;overflow:hidden;color:#f8fafc;background:#111c2e;border:1px solid #3a4b65;border-radius:20px;box-shadow:0 24px 90px #0009;font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
    #dock-flow-changelog-overlay .cl-top{padding:24px 26px 18px;background:linear-gradient(110deg,#182f4d,#111c2e);border-bottom:1px solid #32445e;display:flex;gap:12px;align-items:flex-start}
    #dock-flow-changelog-overlay .cl-heading{flex:1;min-width:0}
    #dock-flow-changelog-overlay .cl-kicker{font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;color:#93c5fd;margin:0 0 7px}
    #dock-flow-changelog-overlay h2{font-size:23px;letter-spacing:-.5px;margin:0 0 5px;line-height:1.25;color:#f8fafc}
    #dock-flow-changelog-overlay .cl-desc{margin:0;color:#a7b7cf;font-size:12px}
    #dock-flow-changelog-overlay .cl-close{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border-radius:9px;border:1px solid #475569;background:#23344d;color:#dbeafe;cursor:pointer}
    #dock-flow-changelog-overlay .cl-list{list-style:none;margin:0;padding:8px 24px 20px;overflow-y:auto;min-height:0}
    #dock-flow-changelog-overlay .cl-item{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:start;gap:12px;padding:14px 0;border-bottom:1px solid #304057}
    #dock-flow-changelog-overlay .cl-item:last-child{border:0}
    #dock-flow-changelog-overlay .cl-item-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:#164e63;color:#67e8f9}
    #dock-flow-changelog-overlay .cl-item strong{display:block;font-size:13px;font-weight:720;color:#f1f5f9}
    #dock-flow-changelog-overlay .cl-item p{margin:3px 0 0;font-size:12px;color:#9eb0c9}
    #dock-flow-changelog-overlay .cl-item time{font-size:10px;white-space:nowrap;color:#8196b5;padding-top:5px}
    #dock-flow-changelog-overlay .cl-footer{padding:16px 24px;background:#162338;border-top:1px solid #32445e;display:flex;align-items:center;justify-content:space-between;gap:12px}
    #dock-flow-changelog-overlay .cl-footer span{font-size:11px;color:#94a3b8}
    #dock-flow-changelog-overlay .cl-confirm{padding:10px 19px;border:0;border-radius:10px;background:#2563eb;color:#fff;font:700 12px system-ui;cursor:pointer}
    #dock-flow-changelog-overlay button:focus-visible{outline:2px solid #93c5fd;outline-offset:3px}
    @media(max-width:540px){#dock-flow-changelog-overlay{padding:10px}#dock-flow-changelog-overlay .cl-top{padding:18px}#dock-flow-changelog-overlay .cl-list{padding:4px 16px}#dock-flow-changelog-overlay .cl-item{grid-template-columns:26px minmax(0,1fr)}#dock-flow-changelog-overlay .cl-item time{grid-column:2;padding:0}#dock-flow-changelog-overlay .cl-footer{padding:12px 16px}#dock-flow-changelog-overlay h2{font-size:20px}}
  `;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  overlay = document.createElement('div');
  overlay.id = 'dock-flow-changelog-overlay';
  overlay.innerHTML = `<section class="cl-dialog" role="dialog" aria-modal="true" aria-labelledby="dock-changelog-title" aria-describedby="dock-changelog-desc">
    <header class="cl-top"><div class="cl-heading"><p class="cl-kicker">Dock Flow · Versão ${VERSION}</p><h2 id="dock-changelog-title">Novidades e melhorias</h2><p id="dock-changelog-desc" class="cl-desc">Confira as 10 atualizações em destaque. Este aviso aparecerá novamente quando uma nova versão for publicada.</p></div><button type="button" class="cl-close" data-close aria-label="Fechar novidades">${closeIcon}</button></header>
    <ol class="cl-list">${changes.map(([date,title,description]) => `<li class="cl-item"><span class="cl-item-icon">${icon}</span><div><strong>${escape(title)}</strong><p>${escape(description)}</p></div><time>${escape(date)}</time></li>`).join('')}</ol>
    <footer class="cl-footer"><span>Exibido uma vez por versão neste navegador</span><button type="button" class="cl-confirm" data-close>Entendi, continuar</button></footer>
  </section>`;
  function dismiss() {
    try { localStorage.setItem(KEY, VERSION); } catch {}
    overlay.remove();
    style.remove();
    document.removeEventListener('keydown', onKeydown, true);
    priorFocus?.focus?.();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key !== 'Tab') return;
    const buttons = [...overlay.querySelectorAll('button')];
    if (!buttons.length) return;
    if (event.shiftKey && document.activeElement === buttons[0]) {event.preventDefault(); buttons.at(-1).focus();}
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {event.preventDefault(); buttons[0].focus();}
  }
  priorFocus = document.activeElement;
  overlay.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', dismiss));
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKeydown, true);
  overlay.querySelector('[data-close]').focus();
})();
