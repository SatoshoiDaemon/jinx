---
name: slash-command-development
description: Ative ao adicionar ou alterar comandos slash do Discord, subcomandos, autocomplete ou interações associadas.
---

# Desenvolvimento de comandos slash

1. Antes de criar ou mover arquivos, confira `.agents/AGENTS.md`, a estrutura real do projeto, os comandos existentes, o carregador e o processo de registro. Verifique também a versão efetivamente instalada de `discord.js`; para detalhes de API, intents, permissões, limites e respostas de interação, siga `discordjs-development` e a documentação oficial dessa versão.
2. Separe definição e tratamento do comando, registro/publicação no Discord e lógica de negócio. Preserve os padrões encontrados. Se não houver estrutura local, trate qualquer organização proposta como nova convenção e escolha a menor separação que mantenha esses papéis independentes; não afirme que essa estrutura já existe.
3. Valide opções e dados de autocomplete na fronteira do comando, incluindo regras de negócio e limites atuais do Discord. Exija as permissões mínimas para quem invoca e confira as permissões efetivas do bot no canal. Dê mensagens de erro seguras e claras em português do Brasil, salvo padrão local diferente.
4. Reconheça cada interação uma única vez e no prazo: responda imediatamente quando possível, ou faça defer cedo quando houver trabalho demorado; autocomplete deve responder rapidamente com opções válidas. Garanta que todo caminho de sucesso ou erro termine com a resposta apropriada. Depois do defer, use a forma de edição ou acompanhamento adequada ao estado da interação. Deixe os detalhes exatos de métodos e prazos para `discordjs-development`.
5. Mantenha uma única fonte de definições e um fluxo claro de registro, separado da inicialização e da lógica do bot. Inspecione o processo existente antes de alterá-lo; evite caminhos duplicados de registro e não publique/substitua comandos remotamente sem pedido explícito.
6. Trate falhas esperadas no handler, encaminhe falhas inesperadas ao tratamento central existente e registre contexto diagnóstico sem tokens, dados privados ou payloads desnecessários. Escreva logs e comentários em português, conforme `.agents/AGENTS.md`.
7. Não guarde estado importante apenas em collectors ou mapas em memória. Para fluxos que precisam sobreviver a reinícios, use a persistência existente ou reprojete a interação para não depender desse estado; consulte `discordjs-development` para roteamento durável de componentes.
