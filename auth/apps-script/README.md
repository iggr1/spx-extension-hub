# Login e aprovação de módulos

O launcher mostra todos os módulos publicados. Os restritos ficam com aviso e ações bloqueadas até a aprovação do e-mail. O login usa um código de seis dígitos enviado por e-mail.

Implementação somente neste repositório; não exige atualização do loader.

## 1. Criar a planilha

1. Crie uma planilha Google vazia chamada **SPX Hub — Acessos**.
2. Mantenha a planilha privada. Compartilhe como editor somente com quem pode administrar os acessos.
3. Na planilha, abra **Extensões > Apps Script**.
4. Substitua o conteúdo do arquivo `Código.gs` pelo conteúdo completo de [Code.gs](Code.gs).
5. Salve o projeto como **SPX Hub — Autenticação**.
6. Em **Configurações do projeto**, habilite a exibição do arquivo de manifesto `appsscript.json`.
7. Substitua o manifesto pelo conteúdo de [appsscript.json](appsscript.json).
8. Selecione a função **instalarAutenticacao** e clique em **Executar**.
9. Autorize o acesso à planilha e o envio de e-mails.

A instalação não envia mensagens. Cria as abas abaixo, o identificador da planilha e uma chave interna nas propriedades do projeto. Rodar novamente mantém usuários, aprovações e chave.

| Aba | Uso |
| --- | --- |
| USUARIOS | Usuários que confirmaram o código de e-mail |
| MODULOS | Define quais módulos exigem aprovação |
| PERMISSOES | Aprovação individual por e-mail e módulo |
| SESSOES | Controle interno de sessões; fica oculta |

## 2. Implantar o Apps Script

1. Clique em **Implantar > Nova implantação**.
2. Selecione o tipo **App da Web**.
3. Em **Executar como**, selecione **Eu**.
4. Em **Quem pode acessar**, selecione **Qualquer pessoa**.
5. Clique em **Implantar** e copie a URL terminada em `/exec`.

O endpoint precisa aceitar chamadas sem a sessão Google do navegador: a identificação é feita pelo código de e-mail. Se a organização não permitir a opção **Qualquer pessoa**, esta implantação depende de liberação do administrador Google Workspace.

## 3. Conectar ao GitHub

Edite somente a propriedade `apiUrl` em [launcher/auth-config.js](../../launcher/auth-config.js):

```js
window.SPX_AUTH_CONFIG = Object.freeze({
  apiUrl: 'COLE_AQUI_A_URL_DO_APPS_SCRIPT_TERMINADA_EM_EXEC'
});
```

A URL da implantação é pública. Não coloque chave interna, códigos, dados da planilha ou listas de usuários no GitHub.

Depois do commit e da atualização do GitHub Pages, recarregue a central da extensão. Clique em **Entrar**, informe nome (opcional) e e-mail, solicite o código e confirme.

Sem URL configurada, os módulos ficam bloqueados e o login informa que está em configuração.

## 4. Aprovar usuários

O usuário aparece em **USUARIOS** somente depois de validar o código. É criada uma linha em **PERMISSOES** para cada módulo configurado, inicialmente com **PENDENTE**.

Na aba **PERMISSOES**, localize o e-mail e o `modulo_id` e altere a coluna **status**:

| Status | Comportamento |
| --- | --- |
| PENDENTE | Card visível; aguarda aprovação |
| APROVADO | Pode abrir/ativar esse módulo no launcher |
| NEGADO | Card visível; mostra acesso não autorizado |

Não é preciso implantar o Apps Script novamente ao alterar a planilha. O launcher verifica a cada 60 segundos enquanto visível, ao recuperar o foco, pelo botão **Atualizar acesso** e antes de abrir/ativar.

A coluna **alterado_em** é registrada ao editar o status. **alterado_por** depende de o Google disponibilizar o e-mail do editor; pode ficar vazia.

Para bloquear o usuário inteiro, altere **USUARIOS > status** de **ATIVO** para **BLOQUEADO**. ATIVO significa que a conta está habilitada; não aprova automaticamente nenhum módulo restrito.

Não edite os e-mails/identificadores para transferir acessos entre pessoas. Cada pessoa deve confirmar seu próprio e-mail. Não duplique linhas de usuário ou de permissão: duplicações são bloqueadas por segurança.

## 5. Definir módulos públicos/restritos

Em **MODULOS**, altere a coluna **restrito**:

- **SIM**: exige login e aprovação individual.
- **NAO**: fica livre para todos, inclusive sem login.

Os dois módulos atuais começam como **SIM**:

| modulo_id | Módulo |
| --- | --- |
| spx-dock-flow | SPX Dock Flow |
| assistente-de-devolucoes | Assistente de devoluções |

Para um novo módulo, publique normalmente no catálogo e acrescente seu ID exato à aba **MODULOS**, com nome e SIM/NAO. A ausência de configuração mantém o novo módulo bloqueado. As permissões individuais são criadas no próximo login/consulta do usuário.

## 6. Configurações opcionais

Em **Configurações do projeto > Propriedades do script**, você pode criar:

| Propriedade | Exemplo | Finalidade |
| --- | --- | --- |
| ALLOWED_EMAIL_DOMAINS | shopee.com | Aceitar códigos somente para esse domínio |
| ALLOWED_EMAIL_DOMAINS | shopee.com,empresa.com.br | Aceitar vários domínios |

Se a propriedade estiver ausente/vazia, qualquer e-mail válido pode solicitar código. Receber e validar o código não libera módulos restritos automaticamente.

Não altere **AUTH_SECRET** ou **SPREADSHEET_ID** manualmente. A chave é criada pela instalação e nunca vai para o navegador.

## Funcionamento e limites

- Código expira em 10 minutos, tem uso único e no máximo cinco tentativas.
- Reenvio após 60 segundos, no máximo três códigos por hora/e-mail.
- Limite global de 100 envios/dia e respeito à cota disponível do MailApp.
- Códigos ficam com hash no cache do Apps Script; uma remoção antecipada do cache exige pedir novo código.
- Sessão dura oito horas. O token fica no sessionStorage da aba; se indisponível, apenas em memória. A planilha guarda somente seu hash.
- Sair revoga a sessão no servidor. Se a rede estiver indisponível, encerra localmente e a sessão remota expira pelo prazo.
- Não há operação pública para listar usuários ou aprovar acessos; a administração ocorre na planilha privada.
- Falhas de rede, sessão expirada e resposta inválida deixam os restritos bloqueados.
- A aprovação controla a interface do launcher e as ações disparadas por ela. Sem modificar o loader, não encerra dashboards já abertos, scripts já ativados ou acessos diretos/cópias do código. Scripts ativos ainda podem ser desativados pelo card bloqueado.

## Testar na implantação real

1. Antes de entrar, confira os dois cards bloqueados.
2. Entre com um e-mail que você consiga acessar e valide o código recebido.
3. Confira o cadastro em USUARIOS e as duas linhas PENDENTE em PERMISSOES.
4. Aprovar somente Dock Flow deve liberar somente seu card.
5. Mude Dock Flow para NEGADO e clique em Atualizar acesso.
6. Defina Devoluções como NAO em MODULOS, saia e confira acesso livre a ele.
7. Restaure SIM e confira o bloqueio.
8. Teste abertura/ativação na central real da extensão.

A verificação local cobre 44 cenários com serviços simulados. Entrega de e-mail, permissões Google, chamadas entre origens e funcionamento dentro do iframe real do loader dependem dessa implantação e ainda não foram testados.

Para rodar as verificações: `node auth/apps-script/auth.test.cjs`.

Ao alterar o código do Apps Script posteriormente, use **Implantar > Gerenciar implantações > Editar > Nova versão**. Mantenha a mesma URL.

## Referências

- [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [Content Service e redirecionamentos](https://developers.google.com/apps-script/guides/content)
- [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app)
