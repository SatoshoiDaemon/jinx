# TDR-Bot — Instruções do repositório

## Escopo

Este é um bot JavaScript para uma comunidade do Discord, inicialmente focado em uma única guilda. Não é um SaaS, um backend genérico ou um produto empresarial.

O escopo principal é:

- níveis e economia da comunidade;
- tickets e atendimento;
- entrada de membros, com boas-vindas no servidor, DM opcional e cargos iniciais;
- sugestões;
- destaque de perfis;
- comandos centrais e utilitários;
- notificações de patch notes de Wild Rift.

Não reintroduza sistemas removidos, como parcerias ou Redis, nem crie suporte genérico a múltiplas guildas sem solicitação explícita.

## Stack e arquitetura

- Use JavaScript e MongoDB.
- `index.js` na raiz é o ponto de entrada da aplicação e inicializa o código de `src/`.
- Mantenha o código da aplicação em `src/`, organizado por responsabilidade:
  - `src/commands/`: comandos slash cada um em subpastas e entrada das interações;
  - `src/events/`: eventos do Discord;
  - `src/models/`: modelos e schemas do MongoDB;
  - `src/modules/`: lógica organizada por funcionalidade;
  - `src/config/`: configuração e validação do ambiente.
- Comandos devem cuidar da interação com o Discord e encaminhar a lógica da funcionalidade ao módulo correspondente.
- Mantenha a aplicação modular, sem concentrar eventos, comandos e serviços em um arquivo central grande.
- Este repositório é um monorepo. Use `packages/` para pacotes que tenham uma fronteira real de reutilização ou publicação; não transforme cada funcionalidade do bot em um pacote separado só por convenção.
- Respeite o gerenciador de pacotes e o lockfile já adotados. Não mantenha lockfiles concorrentes.

## Preferências de desenvolvimento

Este projeto é pessoal e voltado à comunidade. Não imponha processos de empresa, startup ou infraestrutura de grande escala.

Prefira a solução mais simples que resolva o problema com clareza. Antes de adicionar dependências, abstrações ou camadas, explique qual necessidade concreta elas resolvem e avalie se a stack existente já atende.

Evite frameworks internos, sistemas genéricos de plugins, filas, microserviços, containers adicionais e padrões elaborados sem uma necessidade demonstrável. Modularidade não significa criar uma camada para cada operação.

Faça mudanças proporcionais à tarefa. Preserve o trabalho existente e não reescreva áreas não relacionadas. Escolha verificações compatíveis com o impacto da mudança; não crie infraestrutura de testes ou CI apenas por formalidade.

## Discord

Use intents e permissões mínimas para as funcionalidades existentes. Responda ou adie interações dentro do prazo do Discord. Consulte a skill de discord.js para detalhes de comandos, componentes e APIs. Os comandos devem preferencialmente serem de fácil escrita, com palavras (uma ou duas) simples de escrever e lembrar. Sempre opte por componentes V2/Containers ao invés das embeds. Todos os comandos devem estar por Prefixo e Slash.

## MongoDB e Square Cloud

A conexão do MongoDB na Square Cloud exige TLS mútuo. Com o `certificate.pem` combinado, configure `tls: true` e use o caminho do arquivo tanto em `tlsCAFile` quanto em `tlsCertificateKeyFile`. Consulte a documentação do driver para aplicar as opções corretamente.

O `certificate.pem` é uma credencial: não o versione, não registre seu conteúdo em logs e não o exponha em documentação. Garanta que o certificado necessário esteja disponível ao processo em produção por meio do fluxo de deploy do projeto. Não exclua `certs/` cegamente nem inclua credenciais no Git.

Montar um ZIP é uma operação legitima e incluir .env nele é obrigatório para o circuito do de desenvolvimento, não substituir por presupostos genéricos.

O deploy inicial na Square Cloud é feito por ZIP e exige que o arquivo `.env` esteja incluído para a plataforma extrair as variáveis de ambiente. Não o omita do artefato de deploy com base em regras genéricas. Preserve esse fluxo ao preparar o pacote inicial.

## Idioma

Comentários e logs devem ser escritos em português. Textos exibidos aos membros devem estar em português do Brasil, salvo padrão já definido pelo projeto.