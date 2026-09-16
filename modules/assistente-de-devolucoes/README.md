# Assistente de devoluções — 3.0.0

## Acesso pela conta SPX

O assistente exige simultaneamente:

- Sessão SPX válida e e-mail válido com domínio exato `shopee.com`.
- Alias de permissão `RESOLVE_EO`.
- Alias de permissão `CANCEL_EO_REASON`.

Não existe login próprio, envio de código, aprovação em planilha ou chamada ao Apps Script. Não há regra baseada em `user_type` e permissões semelhantes de HUB/AM não substituem os aliases exigidos.

O catálogo consulta `current_user/basic_info` e `current_user/user_permission_info` pelo bridge de rede existente do loader, com capacidades declaradas no catálogo. O assistente também verifica diretamente a sessão na página SPX; estar ativado no navegador não dispensa essa validação.

A identidade é conferida novamente após obter as permissões. As respostas ficam somente em memória. A sessão é revalidada a cada 30 segundos; durante a consulta, o resultado anterior vale por no máximo 60 segundos, para evitar que o painel desapareça em cada atualização. Alterações nos cookies de identidade/sessão invalidam o acesso local; foco, retorno à aba e ações de confirmar/cancelar provocam nova validação. Falhas de rede, dados inválidos e ausência de qualquer requisito bloqueiam o uso. Respostas operacionais antigas não podem recriar o painel após o bloqueio.

O Dock Flow permanece livre de autenticação do Hub. Seus dados continuam dependendo da sessão normal do SPX.

## Atualizar e ativar

1. Abra o SPX e entre com a conta corporativa autorizada.
2. No catálogo, clique em **Atualizar lista** e **Verificar acesso**.
3. Ative o assistente (loader 1.1.0 ou superior, com scripts de usuário permitidos no Chrome).
4. Recarregue o recebimento. São suportadas as rotas `#/generalReceiveTaskMgt/singleReceiveNew/` e `#/generalReceiveTaskOps/singleReceiveNew/`.

A consulta do estado do script não tenta registrá-lo novamente. Somente a ação explícita de ativar/desativar altera o registro pelo loader.

## Interface e funcionamento

Painel escuro no layout clássico, histórico em ordem cronológica e orientação abaixo das tentativas. Os controles permitem atualizar e recolher o painel; o botão Devoluções se desloca para evitar sobreposição ao `spx-autoadd-toast`.

A leitura agenda as consultas após 1,5 segundo. Histórico e AutoAdd executam independentemente. O AutoAdd reproduz a lógica do ZIP fornecido: operador `Admin(Polygon Auto Add)` em `operator` ou `biz_staff_name`, janela de 30 segundos antes a quatro horas depois da leitura e novas tentativas com intervalos de 0, 1200, 1800, 2500 e 3200 ms. Desempata por timestamp, ID e posição. Consulta a primeira página de VTs do dia e prefere uma aberta, com fallback para a primeira; procura a AT, com fallback para o primeiro resultado, como no ZIP. Exibe a rota associada ou próximo ciclo.

As correções do histórico permanecem: contagem de dias válidos, prioridade do motivo mais recente para Fora de Rota, proteção contra consultas antigas e ações duplicadas, escaping e timeout das consultas.

## Verificação

- `node shared/spx-access.test.cjs`
- `node modules/assistente-de-devolucoes/assistente-de-devolucoes.test.cjs`

Os testes usam rede e DOM simulados. A integração com o bridge e as APIs internas precisa ser validada na sessão real do SPX.

Como o código é público e executa no navegador, este controle orienta e bloqueia o uso normal da interface; não é uma barreira contra quem modifica o próprio script. O SPX continua responsável por autorizar suas APIs.
