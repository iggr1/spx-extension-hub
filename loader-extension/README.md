# SPX Extension Loader 1.2.2

Loader modular para ferramentas operacionais publicadas no repositório `iggr1/spx-extension-hub`.

## Novidades da versão 1.2.2

- Consulta da conta autenticada no catálogo pela operação `account.read`, limitada a `basic_info`, `station_list` e `user_permission_info`, via GET.
- Preserva a verificação de permissões do módulo e o bloqueio de chamadas genéricas de rede pelo catálogo.
- Atualize os arquivos da pasta instalada e recarregue a extensão em `chrome://extensions`. O perfil do catálogo depende desta versão; os agentes de telemetria nas abas SPX funcionam independentemente dessa consulta.

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
