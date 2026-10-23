# Coleta de uso do SPX Extension Hub

## Publicar a planilha

1. Crie uma planilha Google exclusiva para o registro de adoção da extensão.
2. Nessa planilha, abra **Extensões > Apps Script**, substitua o código por `Coleta_Hubs_SPX.gs` e salve.
3. Execute **configurarColeta** uma vez e autorize o projeto com a conta responsável pela planilha. O script guarda o ID da planilha nas propriedades do projeto e cria as abas **Acessos** e **Hubs**. Ele não remove outras abas.
4. Use **Implantar > Nova implantação > Aplicativo da Web**. Selecione **Executar como: eu** e **Quem pode acessar: qualquer pessoa**, caso a política da organização permita receber este registro sem login Google dos usuários da extensão. A planilha continua privada.
5. Copie a URL que termina em **/exec**. O endereço `/dev` é apenas para testes do proprietário.
6. Em `launcher/usage-config.json`, informe a URL e altere `enabled` para `true`:

```json
{
  "enabled": true,
  "endpoint": "https://script.google.com/macros/s/SEU_ID_DE_IMPLANTACAO/exec"
}
```

7. Publique o arquivo de configuração na `main`. A configuração é recarregada automaticamente; abra **Atualizar lista** no catálogo para atualizar a conta imediatamente. Não é necessário instalar outro loader. Scripts de usuário já ativados recebem a nova versão quando o catálogo é atualizado pelo loader.
8. Confira a aba **Acessos** após um acesso real. O perfil da conta e o aviso de envio ficam no ícone de usuário. Faça um teste com uma conta de analista e outra de operador.

Se alterar o `.gs` depois, atualize a implantação para uma nova versão mantendo a mesma URL. A integração usa POST simples, segue o redirecionamento do ContentService e só elimina o lote pendente após uma resposta JSON com confirmação. Se o Workspace bloquear acesso público, o login ou CORS, não troque para `no-cors`: uma resposta opaca não comprova gravação. Nesse caso, utilize um endpoint corporativo autorizado com CORS e o mesmo contrato JSON.

## O que é registrado

- **Acessos**: uma linha por data de São Paulo + HUB + usuário + ferramenta, com nome/login/e-mail quando fornecidos, perfil de acesso, versão, primeiro/último acesso, tipos de evento e horário do recebimento.
- **Hubs**: um resumo por HUB com primeiro/último uso e ferramentas observadas.
- O catálogo registra abertura, presença enquanto visível, abertura de módulo e ativação de scripts. Dock Flow registra atividade real a cada 15 minutos enquanto visível, excluindo a demo. Os dois assistentes registram que seus scripts estão em execução em uma aba SPX visível, mesmo sem reabrir o catálogo; isso indica disponibilidade em execução, não comprova que uma função específica foi usada.
- A conta e o HUB são lidos prioritariamente de `station_list`: `data.id`, `data.email`, `data.current_station_id` e `data.current_station_name`. A resposta é confirmada novamente para evitar misturar contas durante uma troca; `basic_info` é opcional e complementa o nome somente quando corresponde à mesma conta. A estação usada é `current_station_id`; a primeira estação da lista não é presumida como atual. Quando o nome não aparece na resposta, é mostrado apenas o ID do HUB.
- **Analista** significa o perfil de acesso já usado pela extensão: conta `@shopee.com` com os aliases `RESOLVE_EO` e `CANCEL_EO_REASON`. **Operador** significa que a consulta de permissões foi concluída e a conta não atende a esse conjunto. Falha na consulta aparece como **Não identificado**. Não é uma consulta ao cargo do funcionário e não altera as permissões dos módulos.

## Comportamento e limites

- A configuração inicial vem desativada, sem URL. O painel de usuário funciona mesmo antes da implantação do WebApp; nenhum dado é enviado até ativar a configuração.
- Cookies, cabeçalhos de autenticação, tokens SPX, pedidos e dados de clientes não são enviados à planilha. Somente os campos listados acima saem do navegador.
- O painel informa a finalidade do registro; não há formulário nem confirmação por acesso.
- Há fila local de até 100 combinações diárias pendentes, retida por no máximo sete dias. Se o armazenamento do navegador estiver bloqueado, a fila fica apenas em memória até fechar a página.
- O servidor valida o lote inteiro antes de gravar, usa bloqueio de script e consolida registros repetidos. Reenvios podem atualizar os mesmos horários, mas não aumentam uma contagem fictícia de acessos. Não há ranking de produtividade.
- O recebimento público é telemetria declarada pelo cliente: não autentica nem comprova a identidade SPX no servidor. A URL não é um segredo, e um token dentro do repositório público também não seria. Não use essa planilha como auditoria de segurança ou autorização. Para comprovação de identidade, é necessário um backend corporativo autenticado.
- A planilha não é exposta por `doGet`, que retorna apenas o estado do serviço. O script neutraliza textos interpretáveis como fórmulas. Mantenha o acesso à planilha restrito à equipe responsável e defina a retenção adequada; a remoção de linhas da planilha não é automática.

## Desenvolvimento

Execute `node telemetry/build-agents.cjs` ao alterar `shared/hub-usage.js` ou a versão dos assistentes. Os arquivos em `shared/usage-agents/` são cópias autocontidas geradas para a API de scripts de usuário; não carregam bibliotecas externas.

Validação local: `node --test telemetry/usage.test.cjs telemetry/receiver.test.cjs` e `node telemetry/browser.test.cjs` (Playwright e Chromium de teste disponíveis no ambiente de desenvolvimento).

Referências: [Web Apps](https://developers.google.com/apps-script/guides/web), [ContentService](https://developers.google.com/apps-script/guides/content), [LockService](https://developers.google.com/apps-script/reference/lock/lock-service).
