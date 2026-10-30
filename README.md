# Jinx

Bot privado de Discord, desenvolvido exclusivamente para uma guilda. `GUILD_ID` identifica a guilda autorizada: os slash commands são registrados nela, e mensagens e interações de outras guildas são ignoradas. O projeto usa JavaScript ESM, `discord.js` e o driver oficial `mongodb`.

## Desenvolvimento local

Requer Node.js 22 ou superior e npm.

```sh
npm ci
```

Em um checkout novo, crie `.env` somente se ainda não existir: `test -e .env || cp .env.example .env`. Preencha localmente `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MONGODB_URI` e `GUILD_ID`. O `.env` já existente neste checkout pode ser mantido. Não compartilhe seus valores. A variável antiga `PREFIX`, se ainda existir no `.env`, não é usada.

Use a URI MongoDB da sua base e coloque o arquivo combinado `certificate.pem` fornecido pela Square Cloud em `certs/certificate.pem`. O driver usa TLS e aponta tanto `tlsCAFile` quanto `tlsCertificateKeyFile` para esse mesmo arquivo. O certificado é material privado e não deve ser copiado para documentação ou Git.

Inicie o bot com:

```sh
npm start
```

Ao iniciar, o bot conecta ao MongoDB, registra os comandos somente na guilda de `GUILD_ID` e conecta ao Gateway do Discord. O código solicita os intents `Guilds`, `Guild Members`, `Guild Voice States`, `Guild Messages` e `Message Content`. No Discord Developer Portal, habilite os intents privilegiados `Message Content` e **Server Members Intent** (`Guild Members`); eles permitem reconhecer expressões de dados, processar boas-vindas e adicionar membros dos cargos de atendimento aos tópicos privados. `Guild Voice States` permite detectar entradas e saídas de calls. Conceda ao bot acesso aos canais e permissão para responder e usar comandos. Para calls temporárias, ele também precisa de `Gerenciar canais` e `Mover membros`. Pessoas que alteram configurações precisam de `Gerenciar servidor`.

## Comandos e utilitários

- `/choose opcoes`: escolhe uma alternativa entre opções separadas por vírgulas, por exemplo `pizza, hambúrguer, sushi`. Cada alternativa precisa ter conteúdo.
- Envie uma mensagem que contenha somente uma expressão de dados, como `1d20`, `2d6+3` ou `3d10-2`. A expressão inteira deve corresponder ao formato. São aceitos de 1 a 100 dados, de 2 a 1000 faces e modificadores entre -10000 e 10000.
- `/botinfo`, `/uptime`, `/ping` e `/help`: informações e ajuda.
- `/nivel consultar`: consulta seu nível e XP; informe `membro` para consultar outra pessoa.
- `/nivel adicionar` e `/nivel remover`: ajuste administrativo de níveis.
- `/xp adicionar` e `/xp remover`: ajuste administrativo de XP.
- `/perfil [membro]`: exibe informações básicas do perfil e o banner público, quando disponível.
- `/painel`: abre o centro administrativo com níveis e economia, **Boas-vindas**, **Calls temporárias**, **Tickets e atendimento** e **Riot Games — Patch Notes e Updates**. Em Calls temporárias, escolha um canal de voz base e a categoria para as calls. Ao entrar no canal base, a pessoa recebe uma call aberta, sem limite de participantes, com seu nome e é movida para ela. A call é apagada quando fica vazia; canal base e categoria podem ser removidos no painel.

## Tickets e atendimento

Toda a administração fica em `/painel` → **Tickets e atendimento**. A seção **Configurações** define o canal padrão para tópicos privados, cargos de atendimento, canal de logs operacionais, canal de transcripts, limite simultâneo por membro, permissão para o solicitante reabrir e comportamento do tópico após resolução. Logs e transcripts precisam usar canais diferentes. Cada painel pode substituir o canal, os cargos, o prefixo, a mensagem inicial e o limite para uma opção específica.

Em **Painéis de atendimento**, crie vários painéis, edite título, descrição, mensagem e até 10 imagens HTTPS, escolha botões ou Select Menu, configure opções, selecione o canal de publicação, publique/atualize e ative, desative ou exclua. Cada painel aceita até 25 opções para respeitar os limites de componentes do Discord. Uma opção pode abrir um ticket ou enviar uma resposta privada efêmera, sem DM. Alterações sincronizam a publicação existente quando a mensagem ainda está disponível.

Ao escolher uma opção de ticket, o membro preenche o Modal **Solicitar atendimento** com o motivo obrigatório. O Jinx valida novamente painel, opção e limite, reserva uma vaga atomicamente no MongoDB e cria um tópico privado no canal configurado. O solicitante e cada membro atual dos cargos de atendimento são adicionados individualmente; cargos não concedem acesso automaticamente a threads privadas. Novos membros que recebem o cargo de atendimento também são adicionados aos tickets abertos. O ticket recebe uma mensagem de controle com embed, motivo completo e botões, que o Jinx fixa no tópico.

O controle permite ao solicitante e à equipe fechar ou resolver o ticket. Fechar arquiva temporariamente o tópico; a equipe pode reabri-lo e o solicitante pode reabri-lo se essa opção estiver habilitada. Resolver pede confirmação, pagina o histórico inteiro disponível, cria um arquivo HTML e o envia ao canal de transcripts. Depois do envio, o estado passa a **encerrado** e é irreversível; o tópico é arquivado ou excluído conforme a configuração. Se gerar ou enviar o arquivo falhar, o ticket permanece recuperável para uma nova tentativa.

A equipe pode assumir um ticket, transferir explicitamente ou liberar a responsabilidade, adicionar membros e remover participantes adicionais. O solicitante, o atendente responsável e o bot não podem ser removidos pelo seletor de participantes; libere ou transfira o atendimento primeiro. Se alguém perder todos os cargos de atendimento configurados, o Jinx libera sua responsabilidade e revoga o acesso que não venha de uma participação explícita. As permissões são conferidas no servidor a cada ação. Painéis e tickets, estados, participantes, responsáveis, eventos, tentativas de transcript e identificadores das mensagens ficam no MongoDB; os controles continuam funcionando depois de reiniciar o bot.

### Permissões e limites no Discord

No canal que hospeda os tópicos, conceda ao bot `Ver canal`, `Criar tópicos privados`, `Enviar mensagens em tópicos`, `Gerenciar tópicos`, `Ler histórico de mensagens`, `Incorporar links` (para o embed de controle) e `Gerenciar mensagens` (necessário para fixá-lo). Membros do servidor precisam de `Ver canal` e `Enviar mensagens em tópicos` nesse canal; o bot verifica essas permissões antes de abrir o ticket. A associação a uma thread privada não contorna uma negação de acesso ao canal pai.

No canal de publicação, o bot precisa de `Ver canal` e `Enviar mensagens`; conceda também `Incorporar links` para imagens externas e `Usar emojis externos` quando uma opção usar emoji de outra guilda. No canal de logs, conceda `Incorporar links`; no canal de transcripts, conceda `Anexar arquivos`. Os membros dos cargos de atendimento precisam poder ver o canal pai para que o Jinx consiga adicioná-los ao tópico. O limite de membros de equipe que o bot adiciona a uma thread é 950, além do solicitante e do bot.

O intent privilegiado `Server Members Intent` já é solicitado pelo Jinx para boas-vindas e para manter o acesso da equipe às threads; não é necessário ativar um intent adicional para tickets se ele já estiver habilitado. Para operação manual no Discord Developer Portal, mantenha esse intent habilitado e atualize as permissões do bot conforme os canais escolhidos. O Jinx não cria canais individuais nem usa canais de fórum.

O transcript inclui mensagens, conteúdo textual, anexos, links, imagens e embeds disponíveis. Versões anteriores de mensagens editadas e mensagens apagadas não podem ser recuperadas. O arquivo respeita o limite de upload do servidor; se o histórico ultrapassar esse limite, o ticket continua aberto/fechado e a finalização pode ser tentada novamente depois de ajustar o limite ou o histórico disponível. Se um tópico for excluído manualmente, os metadados permanecem e a vaga simultânea é liberada, mas o histórico removido não pode ser transcrito.

## Economia virtual em Yen

A moeda do Jinx é Yen fictício (`¥`). Não há dinheiro real, criptomoedas, pagamentos, prêmios externos nem conversão de Yen para valores reais. Todas as apostas são simuladas e resolvidas no servidor com aleatoriedade criptográfica.

### Comandos

- `/carteira [membro]`: consulta sua carteira ou a de um membro, com avatar, identificação, saldo, posição econômica, valores recebidos/gastos, estatísticas de apostas e as quatro movimentações mais recentes. A resposta é privada.
- `/daily`: recebe a recompensa diária. O padrão é `¥100` a cada 24 horas. O cooldown é contado desde o resgate; respostas simultâneas não duplicam o pagamento.
- `/trabalhar`: recebe uma recompensa aleatória de `¥50` a `¥150`; padrão de cooldown de uma hora.
- `/crime`: ação de história fictícia, com 40% de chance de sucesso por padrão. O sucesso paga de `¥100` a `¥400`; a falha cobra de `¥25` a `¥200`, limitada ao saldo disponível. O cooldown padrão é de duas horas, e a chance e os valores são mostrados na resposta.
- `/pagar membro valor`: transfere Yen para outro membro. O padrão aceita de `¥1` a `¥100.000` por transferência. Não aceita o próprio usuário nem bots.
- `/adicionar yen membro quantidade` e `/remover yen membro quantidade`: ajustam a carteira de um membro. Exigem **Gerenciar servidor**; informam o administrador no histórico e respondem em privado. Remoções nunca deixam o saldo negativo.
- `/aposta blackjack aposta`: joga contra o dealer; omitir `aposta` retoma uma partida ativa. O dealer compra até 17 e para em soft 17. Blackjack natural paga 3:2, vitória comum paga 1:1 e empate devolve a aposta. Aposta precisa ser par para que o pagamento natural seja Yen inteiro. Não há split, insurance, surrender ou double down.
- `/aposta roleta aposta tipo [numero]`: roleta europeia de 0 a 36. Número exato paga 35:1 de lucro (36× de retorno bruto); vermelho/preto, par/ímpar e baixo/alto pagam 1:1 (2× bruto); dúzia paga 2:1 (3× bruto). O zero é verde e não ganha apostas de cor, paridade ou faixa. Um número específico tem chance de 1 em 37; cor, paridade e faixa cobrem 18 em 37; cada dúzia cobre 12 em 37.
- `/aposta slots aposta`: caça-níquel de três posições. Cada posição sorteia independentemente: 🍒 40%, 🍋 25%, 🍇 15%, 🔔 10%, ⭐ 7% e 💎 3%. Apenas trincas iguais pagam; o número mostrado é o retorno bruto, incluindo a aposta:

  | Trinca | Chance por jogada | Retorno bruto padrão |
  | --- | ---: | ---: |
  | 🍒🍒🍒 | 6,4% | 3× |
  | 🍋🍋🍋 | 1,5625% | 4× |
  | 🍇🍇🍇 | 0,3375% | 6× |
  | 🔔🔔🔔 | 0,1% | 10× |
  | ⭐⭐⭐ | 0,0343% | 20× |
  | 💎💎💎 | 0,0027% | 50× |

- `/aposta moeda aposta lado`: escolhe cara ou coroa. Acerto paga 1:1 de lucro (2× de retorno bruto); erro perde a aposta.
- `/aposta dados aposta`: compara um d20 do jogador com um d20 da casa. Maior resultado vence e paga 1:1 de lucro (2× bruto); empate devolve a aposta; menor resultado perde.
- `/ranking economia` e `/ranking nivel`: mostram os 10 primeiros; a modalidade de economia ordena pelo saldo, e a de nível ordena por XP total. Sua posição aparece fora do Top 10 quando aplicável. Membros que saíram são identificados como tal.

As apostas padrão aceitam de `¥10` a `¥10.000`, com retorno máximo de `¥1.000.000`. Valores e jogos são configuráveis. Partidas de blackjack abandonadas expiram após cinco minutos e devolvem a aposta; o prazo pode ser alterado entre 60 e 3.600 segundos. Resultados e pagamentos pendentes ficam registrados no MongoDB para recuperação após reinicialização. Botões de blackjack só avançam a partida e versão atuais.

### Configurações e integridade

Pessoas com **Gerenciar servidor** podem ajustar tudo em `/painel` → **Níveis e economia** → **Economia**. O painel separa visão geral, daily, trabalho, crime, transferências e apostas. É possível ativar/desativar a economia e cada jogo, definir saldo inicial para novas carteiras, recompensas e cooldowns, bônus e limites da sequência diária, chance/multas do crime, limites de transferências/apostas, prazo das partidas, limite de retorno e multiplicadores de cada trinca dos slots. Níveis e XP continuam na seção independente **Níveis**.

O sistema valida inteiros seguros, limites, probabilidades fixas e pagamentos dos slots antes de salvar alterações. Novas carteiras começam com `¥100`; editar o saldo inicial não altera carteiras existentes. Os padrões diários são `¥100` por 24 horas, sequência desativada, bônus progressivo de `¥25` por dia até `¥250` e 10 dias considerados (ao ativar, o bônus começa no primeiro dia da sequência). A sequência conta um resgate como consecutivo quando feito até 24 horas após o momento em que o próximo resgate já estaria liberado.

Cada carteira guarda saldo inteiro não negativo, totais recebidos/gastos, estatísticas, cooldowns e até 30 movimentações recentes. As carteiras dos membros existentes são inicializadas na conexão do bot; novos membros recebem a carteira ao entrar, e qualquer comando que consulte uma pessoa também cria a carteira se faltar. Daily, trabalho, crime, ajustes e apostas usam atualizações atômicas por carteira. O valor apostado é debitado antes do resultado e não pode ser usado novamente; partidas interativas e liquidações usam identificadores idempotentes.

Em MongoDB com suporte a transações, uma transferência debita e credita as duas carteiras dentro de uma transação. Em MongoDB standalone, o Jinx usa uma saga persistida de transferência com um bloqueio global curto, reservas por carteira e marcadores idempotentes. Isso não é atomicidade entre documentos: se houver uma interrupção, a transferência fica pendente e é retomada pelo processo de recuperação ao iniciar ou no próximo ciclo. As carteiras envolvidas não aceitam outra movimentação enquanto a transferência estiver pendente.

A configuração fica em `bot_config.modules.economy`; carteiras e histórico em `economy_wallets`; operações e recuperação de transferências em `economy_operations` e `economy_transfer_locks`. Não há Redis ou serviço externo.

## Boas-vindas

Toda a configuração é feita em `/painel` → **Boas-vindas**. As páginas **Cargos iniciais**, **Mensagem privada** e **Mensagem pública** permitem ativar cada ação de forma independente. Os cargos são escolhidos por Role Select Menu; a mensagem pública usa Channel Select Menu. As mensagens podem ser editadas em modal, restauradas ao padrão e visualizadas/testadas pelo próprio painel. A mensagem pública de teste também é removida após 5 segundos.

As três ações começam desativadas. Para atribuir cargos, o bot precisa de `Gerenciar cargos`, e o cargo mais alto do bot precisa estar acima de cada cargo inicial selecionado. Para a mensagem pública, conceda ao bot `Ver canal` e `Enviar mensagens` no canal escolhido. A DM é enviada diretamente ao membro; se as DMs estiverem fechadas, a falha não afeta os cargos nem a mensagem pública.

As mensagens aceitam os placeholders abaixo. Datas são exibidas em português, usando UTC. Placeholders desconhecidos permanecem no texto. Menções são limitadas ao membro da mensagem, então `@everyone` e `@here` não notificam o servidor.

| Placeholder | Resultado |
| --- | --- |
| `{user.id}` | ID do membro |
| `{user.name}` | Nome de usuário |
| `{user.displayName}` | Nome de exibição no servidor |
| `{user.mention}` | Menção ao membro |
| `{user.createdAt}` | Data de criação da conta |
| `{guild.id}` | ID do servidor |
| `{guild.name}` | Nome do servidor |
| `{guild.memberCount}` | Quantidade atual de membros |
| `{guild.ownerId}` | ID do proprietário |
| `{guild.createdAt}` | Data de criação do servidor |

O XP total é a fonte de verdade. A pessoa começa no nível 1; o XP necessário para passar do nível `L` é `xpBase + L * xpStep`. O progresso atual é preservado ao ajustar níveis, limitado ao espaço disponível no nível de destino. Ao conceder XP em excesso, todos os níveis atingidos são calculados a partir do total.

Os valores iniciais são 5–15 XP por mensagem, cooldown de 60 segundos, `xpBase=100`, `xpStep=25` e boost máximo de 5×. Pessoas com permissão de `Gerenciar servidor` podem alterá-los no `/painel`.

Se vários cargos da pessoa tiverem boosts, vale o maior deles (ou 1 se nenhum se aplicar). Esse valor é multiplicado pelo boost do canal (ou 1). O XP sorteado é multiplicado pelo resultado e arredondado para baixo. O cooldown é atômico por membro. Bots e mensagens fora da guilda autorizada não recebem XP.

## Riot Games — Patch Notes e Updates do Wild Rift

O módulo mantém dois fluxos independentes, ambos desativados por padrão: **Patch Notes** publica balanceamento de campeões, itens, runas e sistemas; **Updates** publica novos campeões, skins, eventos, modos, passes e grandes anúncios. Cada fluxo usa um webhook, canal e cargo de notificação próprios. As mensagens usam exclusivamente Discord Components V2, com um container por item, imagem oficial quando disponível e menções limitadas ao cargo escolhido. Uma publicação extensa é dividida em mensagens ordenadas sem separar o container de um item.

### Fonte e parsing

O monitor consulta primeiro a lista oficial em português do Brasil e usa a versão inglesa como fallback configurável:

- `https://wildrift.leagueoflegends.com/pt-br/news/game-updates/`
- `https://wildrift.leagueoflegends.com/en-us/news/game-updates/`

As páginas entregam no HTML os cards, datas, canonical, resumo e seções dos artigos. Não foi encontrada uma API pública estruturada adequada; o módulo usa HTTP nativo do Node e parsing do HTML publicado pela Riot, sem Chromium ou navegador automatizado. O parser separa coleta, classificação e apresentação, preserva texto e valores numéricos originais e encaminha seções desconhecidas para revisão em vez de adivinhar. A análise é limitada a 100 seções e 1.000 subdivisões por artigo; excedentes permanecem no texto original e exigem revisão. URLs de artigos e imagens são validadas contra os domínios oficiais. A Riot pode mudar a estrutura do HTML; nesse caso a seção fica registrada para revisão e os testes com fixtures ajudam a detectar a mudança.

As fixtures são cópias HTML de artigos oficiais 7.3 e 7.3b em português. A validação atual extrai habilidades e valores como `100% → 110%`, classifica seções mistas por item e preserva a data publicada pela Riot. Mudanças posteriores no mesmo canonical geram uma nova revisão identificada como retificação; itens sem mudança continuam deduplicados.

### Calendário

As datas abaixo foram conferidas nas páginas oficiais de atualizações e armazenadas como histórico inicial, em UTC, às 09:00:

| Versão | Publicação oficial |
| --- | --- |
| 7.2 | 08 jul 2026 |
| 7.2a | 15 jul 2026 |
| 7.2b | 29 jul 2026 |
| 7.2c | 12 ago 2026 |
| 7.2d | 26 ago 2026 |
| 7.2e | 09 set 2026 |
| 7.3 | 21 set 2026 |
| 7.3a | 29 set 2026 |
| 7.3b | 14 out 2026 |
| 7.3c | 21 out 2026 |
| 7.3d | 28 out 2026 |

Os intervalos observados variam: as atualizações menores listadas acima tiveram intervalos de 7 a 15 dias; 7.2 até 7.3 levou 75 dias. Não são promessas de datas futuras. As janelas adicionais usam a mediana recente do histórico observado — no histórico inicial, 7 dias para as menores e 75 dias entre as versões principais — e uma janela configurável ao redor da projeção. Assim, o scheduler intensifica consultas perto da expectativa, mas continua verificando a fonte em outros horários.

### Ativação administrativa

1. Não é necessária uma chave adicional de criptografia. Os tokens dos webhooks ficam no documento de configuração Riot do MongoDB para que o bot possa publicar. Restrinja o acesso ao banco e aos backups: quem obtiver esses tokens pode publicar pelo webhook correspondente.
2. Em `/painel` → **Riot Games — Patch Notes e Updates**, configure canal e cargo separadamente para cada fluxo. O bot verifica as permissões de canal e a permissão para mencionar o cargo antes de ativar.
3. Use **Criar webhook** para criar os webhooks `Patch Notes` e `Updates`. O bot não define avatar e não altera avatares personalizados de webhooks existentes. A criação requer `Gerenciar webhooks`; publicação requer `Ver canal`, `Enviar mensagens` e `Ler histórico`.
4. Selecione português como idioma preferido (padrão) e configure fallback em inglês, janelas de terça/quarta e durações das janelas adaptativas.
5. Escolha o comportamento da primeira ativação. **Registrar histórico sem publicar** é o padrão e grava até os 12 artigos mais recentes encontrados por inspeção como baseline. **Publicar os recentes** coloca até os 3 artigos mais novos na fila por fluxo, ainda aguardando aprovação manual.
6. Ative cada fluxo desejado, mantendo o scheduler desligado, e execute uma inspeção manual. Ela coleta, processa e enfileira, mas não publica automaticamente. Abra uma prévia e aprove explicitamente a publicação. Com a opção padrão de baseline, artigos antigos não geram prévias; para revisar e aprovar até os 3 mais recentes na primeira ativação, escolha **Publicar os recentes**.
7. Quando as prévias estiverem aprovadas e a configuração validada, ligue o scheduler para permitir que inspeções futuras publiquem automaticamente.

Se houver um webhook salvo por uma versão anterior com token criptografado, exclua-o e crie outro pelo painel. Sem a chave antiga, aquele token não pode ser recuperado.

O scheduler não inicia inspeções de fonte enquanto `scheduler.enabled` estiver falso. Ao ativá-lo, faz verificações regulares a cada 12 horas, às terças a partir de 00:01 UTC por padrão (intervalo de 60 minutos) e às quartas a cada 5 minutos dentro da janela configurável (00:00–02:00 UTC por padrão). Também considera as janelas adaptativas de versões menores e principais. Quando slots coincidem, uma única inspeção registra todos os motivos. Locks MongoDB com lease e heartbeat impedem execução concorrente e recuperam após reinicialização.

### Persistência, fila e recuperação

Os dados ficam no MongoDB existente, sem serviço adicional: `riot_articles` guarda canonical, versão, data, hash, classificação e estado; `riot_http_cache` guarda corpos HTML limitados e cabeçalhos ETag/Last-Modified; `riot_inspections` mantém histórico e métricas; `riot_scheduler_state` persiste slots e lock; `riot_publications` e `riot_publication_items` guardam fila, tentativas, mensagens e deduplicação; `riot_errors` retém falhas recentes. Índices únicos protegem canonical URL, publicação por artigo/hash/fluxo e item por fluxo/hash.

O processamento usa `DISCOVERED → CLASSIFIED → QUEUED → PUBLISHED`, além de `REVIEW_REQUIRED`, `DUPLICATE`, `RETRYABLE_FAILURE` e `FAILED`. HTTP usa timeout de 12 segundos, resposta máxima de 2 MiB, concorrência de 2 requisições por domínio, fila limitada, até 3 tentativas, backoff com jitter e suporte a `Retry-After`. A recuperação procura marcadores `WR:` nas últimas 100 mensagens do canal antes de reenviar uma publicação interrompida, reduzindo duplicações se o processo cair após o Discord aceitar a mensagem. Uma falha terminal pode ser reaberta até 3 vezes por administradores no painel; cada reabertura exige prévia e aprovação, e não envia automaticamente.

O painel **Inspeções e prévias** mostra última inspeção, publicação, estado de cada fluxo e erros recentes. Limites de tamanho de Components V2 que não possam ser respeitados deixam a publicação em revisão. Se uma mudança futura na Riot não puder ser interpretada, o texto original permanece no documento de artigo e o painel contabiliza o item para revisão.

## Dados e configurações

As configurações ativas ficam no documento global `_id: "jinx:config"`, na coleção `bot_config`, agrupadas por módulo. As boas-vindas ficam em `modules.welcome`; o Jinx não cria configurações por guilda. O XP dos membros é armazenado por ID de usuário, sem `guildId` no documento.

O módulo guarda `initialRoles: { enabled, roleIds }`, `directMessage: { enabled, content }` e `publicMessage: { enabled, channelId, content }`. Os três recursos começam desativados; a duração de 5 segundos da mensagem pública é fixa e não é uma opção persistida.

Na primeira inicialização após a versão single-guild, uma adaptação idempotente copia as configurações da guilda de `GUILD_ID` para `jinx:config`, converte os registros de XP dessa guilda preservando XP e timestamps e remove o índice composto antigo. Os documentos legados só são removidos após a cópia correspondente. Tickets usam `bot_config.modules.tickets`, `ticket_panels`, `tickets`, `ticket_requests`, `ticket_events`, `ticket_counters` e `ticket_member_limits`; nenhum desses documentos inclui `guildId`. A conexão MongoDB continua usando TLS mútuo.

## ZIP local da Square Cloud

O arquivo `squarecloud.app` usa `index.js` como entrada. Para preparar o ZIP inicial localmente, deixe `.env` e `certs/certificate.pem` presentes e execute:

```sh
npm run package:squarecloud
```

O script valida a presença dos dois arquivos sem abrir ou exibir seus conteúdos e grava um ZIP datado em `dist/`. O pacote inclui `.env` e o certificado no caminho esperado. `dist/`, `.env` e `certs/` são ignorados pelo Git, mas `.env` e o certificado são incluídos explicitamente no ZIP. Este comando apenas monta o arquivo; não faz upload nem chama a Square Cloud.

O empacotador usa o utilitário `zip` instalado localmente.

## CI e deploy

O workflow de CI roda em push e pull request, instala dependências e valida sintaxe/configuração sem acessar secrets.

O workflow `squarecloud-deploy.yml` atualiza a aplicação `e663fa87c2c646c5abfeca508851ef62` em push para `main` ou por execução manual nessa branch. Ele valida o projeto, reconstrói `.env` e `certs/certificate.pem` no runner, monta o ZIP e o envia diretamente à Square Cloud, sem publicar artifact.

Configure estes secrets de Actions no repositório:

- `SQUARECLOUD_API_KEY`: chave da API com os escopos `apps:deploy` e `apps:control`.
- `JINX_ENV_FILE_BASE64`: conteúdo do `.env` codificado em Base64.
- `JINX_MONGODB_CERTIFICATE_PEM_BASE64`: conteúdo de `certs/certificate.pem` codificado em Base64.

O script `npm run restore:github-secrets` exige `GITHUB_ACTIONS=true`, falha se os arquivos de destino já existirem e não imprime os valores. Base64 é apenas codificação, não criptografia; esses secrets nunca devem aparecer em logs, código ou artifacts públicos.
