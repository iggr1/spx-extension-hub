// Shared by the catalog and embedded in the standalone user script.
const SPX_ACCESS_LOG_PREFIX = '[SPX Hub Auth]';
function spxAccessLog(message, data) {
  if (data === undefined) console.log(`${SPX_ACCESS_LOG_PREFIX} ${message}`);
  else console.log(`${SPX_ACCESS_LOG_PREFIX} ${message}`, data);
}
function spxAccessError(message, error) {
  console.error(`${SPX_ACCESS_LOG_PREFIX} ${message}`, error);
}

function evaluateSpxAccess(basic, permissions) {
  const denied = { allowed: false, email: '', message: 'Acesso restrito: use uma conta @shopee.com com permissão para resolver e cancelar ocorrências.' };
  spxAccessLog('Avaliando dados da conta SPX.', {
    basicRetcode: basic?.retcode,
    permissionsRetcode: permissions?.retcode,
    hasBasicData: Boolean(basic?.data),
    hasPermissionList: Array.isArray(permissions?.data?.perm_list)
  });
  if (basic?.retcode !== 0 || permissions?.retcode !== 0) {
    spxAccessLog('Acesso negado por retcode inválido.', { basicRetcode: basic?.retcode, permissionsRetcode: permissions?.retcode });
    return denied;
  }
  const email = typeof basic.data?.email === 'string' ? basic.data.email.trim().toLowerCase() : '';
  const local = email.split('@')[0];
  const validEmail = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@shopee\.com$/.test(email) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
  if (!validEmail) {
    spxAccessLog('Acesso negado por e-mail inválido.', { email });
    return denied;
  }
  if (!Number.isSafeInteger(basic.data?.id) || basic.data.id <= 0 || !Array.isArray(permissions.data?.perm_list)) {
    spxAccessLog('Acesso negado por estrutura de identidade/permissões inválida.', {
      userId: basic.data?.id,
      hasPermissionList: Array.isArray(permissions.data?.perm_list)
    });
    return denied;
  }
  const aliases = new Set(permissions.data.perm_list.flatMap(item => Array.isArray(item?.perm_alias) ? item.perm_alias : []));
  const hasResolve = aliases.has('RESOLVE_EO');
  const hasCancel = aliases.has('CANCEL_EO_REASON');
  spxAccessLog('Permissões necessárias avaliadas.', { email, hasResolve, hasCancel, aliasCount: aliases.size });
  if (!hasResolve || !hasCancel) return { ...denied, email };
  return { allowed: true, email, message: 'Acesso autorizado pela conta SPX.' };
}

function createSpxAccessChecker(read, fingerprint = () => '') {
  const root = 'https://spx.shopee.com.br/api/admin/basicserver/current_user/';
  let pending = null;
  let checkedAt = 0;
  let identity = '';
  let result = { allowed: false, email: '', message: 'Verificando conta SPX...' };
  async function check(force = false) {
    if (pending) {
      spxAccessLog('Checker reutilizando validação pendente.');
      return pending;
    }
    const currentIdentity = fingerprint();
    if (!force && checkedAt && currentIdentity === identity && Date.now() - checkedAt < 30000) {
      spxAccessLog('Checker reutilizando resultado em cache.');
      return result;
    }
    pending = (async () => {
      try {
        spxAccessLog('Etapa 1/3: basic_info inicial.');
        const basic = await read(root + 'basic_info');
        spxAccessLog('basic_info inicial recebido.', { retcode: basic?.retcode, userId: basic?.data?.id, email: basic?.data?.email || null });

        spxAccessLog('Etapa 2/3: user_permission_info.');
        const permissions = await read(root + 'user_permission_info');
        spxAccessLog('user_permission_info recebido.', { retcode: permissions?.retcode, permissionGroups: permissions?.data?.perm_list?.length ?? null });

        spxAccessLog('Etapa 3/3: basic_info de confirmação.');
        const confirmation = await read(root + 'basic_info');
        spxAccessLog('basic_info de confirmação recebido.', { retcode: confirmation?.retcode, userId: confirmation?.data?.id, email: confirmation?.data?.email || null });

        if (confirmation?.retcode !== 0 || basic?.data?.id !== confirmation?.data?.id || basic?.data?.email !== confirmation?.data?.email || currentIdentity !== fingerprint()) {
          throw new Error('A conta SPX mudou. Verifique o acesso novamente.');
        }
        result = evaluateSpxAccess(basic, permissions);
        spxAccessLog('Resultado final da política.', { allowed: result.allowed, email: result.email || null, message: result.message });
      } catch (error) {
        spxAccessError('Falha durante a validação da sessão SPX.', error);
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
