# SPX Extension Loader 1.2.4

Loader modular para ferramentas operacionais publicadas no repositório `iggr1/spx-extension-hub`.

## Novidades da versão 1.2.4

- O catálogo deixa o controle de user scripts disponível quando o Chrome não consegue consultar os registros existentes. O botão tenta registrar ou remover apenas os IDs daquele módulo; a API do Chrome confirma se a operação pode ser concluída.
- A consulta de estado usa o valor salvo pelo loader quando `userScripts.getScripts()` falha e sinaliza que o estado do Chrome é desconhecido.

## Novidades da versão 1.2.3

- Consulta da conta autenticada no catálogo pela operação `account.read`, limitada a `basic_info`, `station_list` e `user_permission_info`, via GET.
- Preserva a verificação de permissões do módulo e o bloqueio de chamadas genéricas de rede pelo catálogo.
- Atualize os arquivos da pasta instalada e recarregue a extensão em `chrome://extensions`. O perfil do catálogo depende desta versão; os agentes de telemetria nas abas SPX funcionam independentemente dessa consulta.
- O manifesto mantém o domínio SPX necessário e disponibiliza permissões opcionais de host para páginas HTTP e HTTPS. O Chrome só libera páginas adicionais quando o usuário concede esse acesso; a extensão não recebe acesso silencioso a todos os sites.
- Os patches incrementais incluem também `dock-alarm-background.js`, `dock-alarm-audio.js`, `dock-alarm-audio.html` e `loader.html`. Copie os sete arquivos do patch para a pasta original do loader. `background.js` importa o primeiro desses arquivos ao iniciar o service worker; sem ele, o Chrome falha ao registrar o worker (erro de status 15). `loader.html` remove um atributo de iframe redundante que gerava um aviso no console.

## Novidades da versão 1.2.0

- Monitor de atrasos do Dock Flow no service worker, sem depender da dashboard aberta.
- Escolha entre apenas doca marcada (padrão) e todas as docas atrasadas.
- Alarmes `chrome.alarms`, verificação autenticada das docas e som em documento `chrome.offscreen`.
- O áudio é disparado uma vez por operação que entra em atraso. O Chrome pode atrasar os alarmes durante suspensão do navegador ou do computador.
- A versão 1.2.0 exige substituir/recarregar a extensão instalada para ativar o monitor em segundo plano.

## Recursos existentes da versão 1.1.0

- Suporte genérico a módulos do tipo `user_script` com switch ligado/desligado no catálogo.
- Estado do switch persistido no Chrome.
- Registro e remoção dinâmica por `chrome.userScripts`.
- Recarregamento das abas compatíveis ao ativar ou desativar um módulo.
- Atualização automática do código remoto dos user scripts ativos quando o catálogo é sincronizado.

## Instalação

1. Extraia o ZIP.
2. Abra `chrome://extensions`.
3. Ative o modo do desenvolvedor.
4. Use **Carregar sem compactação** e selecione a pasta extraída.
5. Nos detalhes da extensão, ative **Permitir scripts de usuário**.

Quando um módulo exigir uma permissão ainda não prevista, contate `igor.camara@shopee.com`.
