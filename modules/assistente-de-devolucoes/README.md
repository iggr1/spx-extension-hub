# Assistente de devoluções — 2.0.0

Recuperado do histórico anterior ao commit 17f5ef2. Executa somente na tela SPX de recebimento individual (`#/generalReceiveTaskOps/singleReceiveNew/`).

## Ativar

1. No launcher, clique em **Atualizar lista**.
2. Ligue **Assistente de devoluções**. O switch existente requer loader 1.1.0 ou superior.
3. Se solicitado pelo Chrome, habilite **Permitir scripts de usuário** nos detalhes da extensão.
4. Abra/recarregue a tela de recebimento do SPX e leia um pedido BR.
5. O painel consulta após 1,5 segundo. Use o botão de atualização para consultar novamente.
6. Recolha o painel pelo X e reabra pelo botão **Devoluções**.

Não requer alteração no código do loader. Usa o cadastro e as capacidades de user script já existentes.

## Interface

Painel branco e laranja, ícones Lucide inline, orientação primeiro, contadores de tentativas/dias válidos, histórico mais recente primeiro, links para fotos e botões de confirmação/cancelamento de motivo. A interface não rouba o foco durante a consulta.

## Regras preservadas e correções

- Fora de rota só orienta realocação quando for o motivo mais recente.
- Motivos finais continuam orientando retorno ao SOC.
- Retorno por quantidade exige tentativas válidas em pelo menos três dias distintos (America/Sao_Paulo). Motivos inválidos não completam a contagem de dias.
- Falha na consulta de endereço mostra **CONFERIR TRATATIVA NO SPX**.
- AutoAdd procura o registro mais recente do operador Admin(Polygon Auto Add), em uma janela de quatro horas anteriores à leitura até o momento da consulta.
- VTs são consultadas com paginação. A seleção considera a VT aberta mais recente; não usa VT encerrada como alternativa.
- A associação exige correspondência exata da AT. Respostas inesperadas não produzem uma rota de outra AT.
- Ausência de VT aberta e AT sem rota têm mensagens próprias.
- Uma nova leitura invalida respostas anteriores imediatamente. Sair da tela cancela a leitura agendada; consultas já em andamento não recriam o painel.
- A mesma etiqueta pode ser consultada novamente após limpar a entrada, pressionar Enter ou usar a atualização.
- Cliques repetidos não duplicam a ação de endereço. Uma falha de escrita exige atualizar e conferir o estado antes de tentar de novo.
- Consultas possuem timeout de 15 segundos e mensagens para sessão expirada.

## Verificação

Execute `node modules/assistente-de-devolucoes/assistente-de-devolucoes.test.cjs`.

Os testes usam DOM e rede simulados: regras operacionais, AutoAdd, paginação, escaping e concorrência entre pedidos. A integração com APIs internas do SPX e o layout no navegador ainda precisam de validação na sessão real.

O PDF de descrição foi recuperado da versão anterior. Este README documenta as alterações da versão 2.

## Aprovação visual com Sheets e Apps Script

Possível etapa seguinte, ainda não implementada:

- Login Google validado pelo backend (nunca confiar somente em e-mail digitado).
- Planilha privada com identidade do usuário, e-mail, status e módulos aprovados.
- Apps Script consulta a base e devolve somente a autorização do usuário autenticado.
- Launcher remoto exibe módulos aprovados e uma tela de acesso pendente para os demais usuários.
- Aprovação/revogação feita na planilha; nova consulta atualiza os cards.
- Tokens não devem ser enviados em query strings ou guardados no GitHub.

Sem mudar o loader, essa integração controla a interface do launcher. Ela não garante o bloqueio de módulos previamente ativados, acessos diretos ou cópias do código público. Um bloqueio de execução precisaria de verificação em um componente confiável.

A planilha, a implantação do Apps Script e a configuração de login ainda não foram criadas.
