(function initializeReturnsAssistantAccessNotice() {
  'use strict';

  const NOTICE_ID = 'spx-returns-access-notice';
  const DENIED_PREFIX = 'Acesso restrito:';
  const HIDE_DELAY_MS = 10000;
  const COOKIE_NAMES = ['spx_uid', 'fms_user_id', 'spx_uk', 'fms_user_skey'];
  const DENIED_MESSAGE = 'O Assistente de devoluções não pode ser aberto porque a conta SPX atual não possui e-mail @shopee.com e/ou as permissões necessárias para resolver e cancelar ocorrências.';

  let hideTimer = null;
  let lastDeniedFingerprint = null;

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const item = String(document.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return item ? item.slice(prefix.length) : '';
  }

  function sessionFingerprint() {
    return COOKIE_NAMES.map(readCookie).join('|');
  }

  function hideNotice(notice) {
    if (notice?.isConnected) notice.remove();
  }

  function handleNotice() {
    const notice = document.getElementById(NOTICE_ID);
    if (!notice) return;

    const text = String(notice.textContent || '').trim();
    if (!text.startsWith(DENIED_PREFIX)) return;

    const fingerprint = sessionFingerprint();
    if (lastDeniedFingerprint === fingerprint) {
      hideNotice(notice);
      return;
    }

    lastDeniedFingerprint = fingerprint;
    notice.textContent = DENIED_MESSAGE;

    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      hideNotice(notice);
      hideTimer = null;
    }, HIDE_DELAY_MS);
  }

  const observer = new MutationObserver(handleNotice);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  handleNotice();
})();
