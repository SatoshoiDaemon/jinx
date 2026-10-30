---
name: repository-architecture
description: Ative ao criar, mover ou reorganizar módulos, pacotes ou diretórios do repositório.
---

# Arquitetura do repositório

## Antes de mudar a estrutura

1. Leia as instruções aplicáveis e mapeie arquivos, imports, entrypoints, manifestos, scripts, workflows, configurações de runtime e documentação que dependem dos caminhos afetados. Exclua `.env` e arquivos privados de `certs/` da inspeção; não imprima seu conteúdo.
2. Separe fatos observados de propostas. Neste checkout, existem `.agents/`, `.github/`, `docs/`, `packages/`, `src/` e `certs/`; os arquivos visíveis da aplicação, dos documentos, dos pacotes e dos workflows não revelam uma organização existente. Inspecione novamente quando a tarefa ocorrer; não trate o mapa abaixo como convenção já adotada.
3. Prefira estender o módulo responsável que já existe. Mova arquivos somente quando a tarefa exigir ou quando uma dependência concreta justificar a mudança; não reorganize por simetria ou preferência estética.

## Limites propostos quando não houver padrão local

- `.agents/`: instruções e skills de agentes, sem módulos de runtime.
- `.github/`: automação do repositório. Workflows podem chamar scripts ou comandos existentes, mas regras de negócio devem permanecer no código responsável.
- `docs/`: documentação de comportamento e procedimentos já verificados no código e na configuração.
- `src/`: implementação específica da aplicação, agrupada pela responsabilidade e pelos fluxos encontrados.
- `packages/`: código com fronteira de pacote real — consumidor independente, API própria ou ciclo de build/publicação distinto. Não crie pacote para isolar um único módulo sem essa necessidade.
- `certs/`: material operacional sensível. Preserve caminhos exigidos pela configuração; não copie certificados privados para código, documentação, exemplos ou novos pacotes, e não os leia para uma reorganização comum.

Como direção de dependências proposta, mantenha `src/` consumindo pacotes por suas APIs públicas, sem dependência reversa de um pacote sobre código da aplicação; evite ciclos. Documentação e workflows apontam para comandos e caminhos existentes, sem duplicar sua lógica. Só adote essa direção depois de conferir consumidores e configuração reais.

## Ao criar ou reorganizar um módulo

1. Coloque código específico da aplicação junto da responsabilidade correspondente em `src/`, seguindo os diretórios, exports e testes que encontrar. Use `packages/` somente se a fronteira independente acima tiver um consumidor concreto.
2. Antes de mover, liste os imports, exports públicos, manifestos de workspace, scripts de inicialização/build, workflows e configurações que referenciam o caminho. Atualize apenas as referências afetadas.
3. Atualize somente a documentação cujo caminho, instalação, configuração, uso ou deploy realmente mudou. Confira README e guias em `docs/` quando existirem; não documente estruturas planejadas como existentes.
4. Revise o diff para confirmar que a mudança ficou restrita à reorganização necessária, que os caminhos sensíveis foram preservados e que não surgiram camadas, pacotes ou abstrações sem consumidor. Proponha uma regra em `AGENTS.md` apenas se ela for curta, permanente e aplicável a todas as tarefas; mantenha orientações específicas de arquitetura nesta skill.
