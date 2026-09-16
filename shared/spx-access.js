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
