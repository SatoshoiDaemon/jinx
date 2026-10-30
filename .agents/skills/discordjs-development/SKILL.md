---
name: discordjs-development
description: Use when implementing or debugging Discord integrations that use discord.js, Gateway, REST, permissions, intents, embeds, or message components.
---

# Desenvolvimento com Discord.js

1. Inspecione o pacote que realmente inicia a integração e descubra a versão resolvida de `discord.js` usando o gerenciador de pacotes e o lockfile desse pacote. Não trate uma faixa declarada como versão instalada. Se não estiver instalada, registre isso e use a versão travada no lockfile como alvo, quando houver; sem versão resolvida, não presuma a mais recente.
2. Antes de usar ou trocar uma API, consulte a [documentação oficial do discord.js](https://discord.js.org/docs/packages/discord.js/) e selecione a versão exata encontrada. Consulte também a documentação oficial da API do Discord para comportamento de protocolo. Confirme assinaturas, depreciações, flags, limites e exemplos nessa versão; não copie APIs de outra versão sem verificar.
3. Relacione os eventos e dados realmente usados às intents necessárias e configure somente o mínimo. Intents privilegiadas exigem habilitação no Developer Portal e podem exigir aprovação. Diferencie intents do Gateway das permissões do bot: determine as permissões mínimas para as operações, confira permissões efetivas do canal e hierarquia de cargos, e não peça `Administrator` por conveniência.
4. Trate falhas de chamadas assíncronas nas fronteiras adequadas: registre contexto diagnóstico sem tokens, conteúdo privado ou payloads inteiros e apresente erros seguros. Respeite o rate limiter do discord.js; não codifique limites fixos nem repita cegamente operações. Em tratamento próprio de `429`, respeite `Retry-After`/`retry_after` e só repita operações seguras ou idempotentes.
5. Responda cada interação em até 3 segundos. Se o trabalho puder demorar, faça `deferReply()` ou `deferUpdate()` cedo e depois use `editReply()`/`followUp()` conforme o estado; envie apenas uma resposta inicial e trate falhas de resposta expirada ou já reconhecida.
6. Para botões e menus que precisam continuar funcionando em mensagens existentes após reinícios, não dependa só de collectors ou estado em memória. Registre o roteador de interações a cada inicialização, despache pelo `customId` e recarregue o estado necessário do armazenamento já usado pelo projeto; revalide usuário, servidor, mensagem, permissões e estado atual. Se um controle depender de estado não persistido, faça-o expirar ou ficar indisponível com uma resposta clara.
7. Para embeds e componentes, confira builders, limites e compatibilidade da combinação de payload/flags na versão instalada e na documentação oficial do Discord. Trate dados externos como entrada não confiável e controle menções.

A skill de comandos slash é responsável pela organização dos arquivos de comando. Siga essa skill para essa decisão; não invente nem reorganize essa estrutura aqui.

Referências oficiais: [Gateway e intents](https://docs.discord.com/developers/events/gateway), [permissões](https://docs.discord.com/developers/topics/permissions), [interações e prazo de resposta](https://docs.discord.com/developers/interactions/receiving-and-responding), [componentes](https://docs.discord.com/developers/components/overview) e [rate limits](https://docs.discord.com/developers/topics/rate-limits).
