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

Ao iniciar, o bot conecta ao MongoDB, registra os comandos somente na guilda de `GUILD_ID` e conecta ao Gateway do Discord. O código solicita os intents `Guilds`, `Guild Members`, `Guild Voice States`, `Guild Messages` e `Message Content`. No Discord Developer Portal, habilite os intents privilegiados `Message Content` e **Server Members Intent** (`Guild Members`); eles permitem reconhecer expressões de dados e processar boas-vindas. `Guild Voice States` permite detectar entradas e saídas de calls. Conceda ao bot acesso aos canais e permissão para responder e usar comandos. Para calls temporárias, ele também precisa de `Gerenciar canais` e `Mover membros`. Pessoas que alteram configurações precisam de `Gerenciar servidor`.

## Comandos e utilitários

- `/choose opcoes`: escolhe uma alternativa entre opções separadas por vírgulas, por exemplo `pizza, hambúrguer, sushi`. Cada alternativa precisa ter conteúdo.
- Envie uma mensagem que contenha somente uma expressão de dados, como `1d20`, `2d6+3` ou `3d10-2`. A expressão inteira deve corresponder ao formato. São aceitos de 1 a 100 dados, de 2 a 1000 faces e modificadores entre -10000 e 10000.
- `/botinfo`, `/uptime`, `/ping` e `/help`: informações e ajuda.
- `/nivel consultar`: consulta seu nível e XP; informe `membro` para consultar outra pessoa.
- `/nivel adicionar` e `/nivel remover`: ajuste administrativo de níveis.
- `/xp adicionar` e `/xp remover`: ajuste administrativo de XP.
- `/perfil [membro]`: exibe informações básicas do perfil e o banner público, quando disponível.
- `/painel`: abre o centro administrativo com níveis e economia, **Boas-vindas** e **Calls temporárias**. Em Calls temporárias, escolha um canal de voz base e a categoria para as calls. Ao entrar no canal base, a pessoa recebe uma call aberta, sem limite de participantes, com seu nome e é movida para ela. A call é apagada quando fica vazia; canal base e categoria podem ser removidos no painel.

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

## Dados e configurações

As configurações ativas ficam no documento global `_id: "jinx:config"`, na coleção `bot_config`, agrupadas por módulo. As boas-vindas ficam em `modules.welcome`; o Jinx não cria configurações por guilda. O XP dos membros é armazenado por ID de usuário, sem `guildId` no documento.

O módulo guarda `initialRoles: { enabled, roleIds }`, `directMessage: { enabled, content }` e `publicMessage: { enabled, channelId, content }`. Os três recursos começam desativados; a duração de 5 segundos da mensagem pública é fixa e não é uma opção persistida.

Na primeira inicialização após esta versão, uma adaptação idempotente copia as configurações da guilda de `GUILD_ID` para `jinx:config`, converte os registros de XP dessa guilda preservando XP e timestamps e remove o índice composto antigo. Os documentos legados só são removidos após a cópia correspondente. A conexão MongoDB continua usando TLS mútuo.

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
