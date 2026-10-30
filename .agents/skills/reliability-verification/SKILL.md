---
name: reliability-verification
description: Ative ao corrigir bugs, alterar fluxos críticos ou revisar mudanças que possam afetar a disponibilidade do bot.
---

# Verificação de confiabilidade

1. Reproduza o problema com o menor cenário disponível antes de editar. Inspecione o caminho real do evento até a resposta e os efeitos persistidos; consulte logs, contratos, versões e verificações existentes. Não atribua a falha ao Discord, MongoDB ou hospedagem sem evidência.
2. Formule a causa provável com base na reprodução e rastreie efeitos concorrentes antes da correção: eventos ou interações duplicados, retries, duas execuções simultâneas, timeout após uma escrita, reconexão e reinício do processo. Identifique quais efeitos precisam ser idempotentes ou atômicos.
3. Para fluxos críticos, examine explicitamente desconexão/reconexão do Gateway, falhas REST e permissões do Discord; disponibilidade, timeout e erro de escrita do MongoDB; e recuperação após reinício. Confira se trabalho ou estado essencial depende apenas de memória e se retries podem repetir efeitos.
4. Corrija a causa no limite mais próximo que a controla. Trate falhas esperadas de modo explícito; propague ou registre falhas inesperadas no tratamento central existente. Não use `catch` genérico para esconder erro, retornar sucesso fictício, descartar uma operação ou manter o bot aparentemente saudável. Siga `discordjs-development` e `mongodb-modeling` para detalhes específicos dessas integrações.
5. Faça ou adicione verificações focadas quando forem apropriadas: reproduza o caso original e cubra o cenário de concorrência, duplicidade, indisponibilidade ou reinício que motivou a mudança. Prefira os comandos e ferramentas já existentes; deixe claros os limites de uma simulação local e não afirme que ela prova comportamento hospedado.
6. Registre diagnóstico útil — operação, evento, IDs de correlação disponíveis, tentativa e estado — usando o logger existente. Remova tokens, segredos, URIs, dados privados e payloads completos; não transforme a redação de logs em perda da causa ou do contexto do erro.
7. No relatório, separe causa reproduzida, mudanças realizadas, verificações executadas e seus resultados de cenários ainda não verificados. Declare como pendentes os testes de concorrência, reinício ou disponibilidade que não foram executados e diferencie validação local de confirmação em hospedagem.
