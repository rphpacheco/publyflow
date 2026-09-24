# PublyFlow — Proposal Builder UX Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Design System v1, Inbox screen, Pipeline screen, Proposals core domain, Proposal
Read APIs, Rate Card Items List API — all merged to `main`.
Blocks: nothing — this is the third and last of the three priority screens
(Inbox → Pipeline → Proposal Builder).

## 1. Contexto

Terceira e última das três telas prioritárias do PublyFlow, na ordem do fluxo operacional real:
Inbox → Inquiry → Lead → Opportunity → Pipeline → **Proposal**. Construída sobre o Design System
v1, o Pipeline screen (ponto de entrada) e o backend de Proposals + Rate Cards, todos já
mergeados — nenhuma UX aqui pressupõe uma API que não exista.

**Escopo v1**: dos dois conceitos que o backend de Proposals separa — `proposal_items` (tabela de
preços) e `proposal_blocks` (11 tipos de bloco de documento, com conteúdo `jsonb` livre não
validado pelo backend) — só **COVER** e **TEXT** têm qualquer evidência de design real (conteúdo
de teste trivial: `{headline}`/`{body}`); os outros 9 tipos são nomes especulativos num enum, sem
estrutura de conteúdo definida em lugar nenhum. O v1 constrói: itens de precificação + os blocos
COVER e TEXT (sempre presentes, um de cada por proposta). Um editor de documento mais rico
(demais tipos de bloco) fica para uma spec futura baseada em casos de uso reais.

**Contratos de backend consumidos** (todos já implementados e mergeados):
- `GET /api/proposals?organizationId=&opportunityId=` → `Proposal[]` (lista de propostas de uma
  Opportunity).
- `POST /api/proposals` — corpo `{organizationId, opportunityId, title, template, userId}` → cria
  a Proposal **e seus dois blocos estruturais iniciais** (`COVER {headline: ""}` e
  `TEXT {body: ""}`) numa única transação. **Isso é uma mudança de comportamento em
  `ProposalService.create` que este plano de implementação precisa fazer** — hoje o método só
  cria a Proposal; passa a criar Proposal + COVER + TEXT juntos, gerando um único snapshot de
  versão no final (em vez de três, se o frontend orquestrasse três chamadas separadas). Não é um
  mini-ciclo à parte: é uma task do plano de implementação do Proposal Builder.
- `GET /api/proposals/:id?organizationId=` → `Proposal`, `404` se não encontrada.
- `PATCH /api/proposals/:id` — corpo `{organizationId, title?, template?, status?, userId}`.
- `GET /api/proposals/:id/items?organizationId=` → `ProposalItem[]`, ordenado deterministicamente
  por `sortOrder, createdAt`.
- `POST /api/proposals/:id/items` — corpo `{organizationId, userId, quantity?, sortOrder?}` +
  união de `{rateCardItemId}` (catálogo) ou `{description, unitPrice}` (avulso — `unitPrice`
  aceita negativo, para desconto).
- `PATCH /api/proposal-items/:id` — corpo `{organizationId, proposalId, userId, description?,
  unitPrice?, quantity?, sortOrder?}`.
- `DELETE /api/proposal-items/:id` — corpo `{organizationId, proposalId, userId}`.
- `GET /api/proposals/:id/blocks?organizationId=` → `ProposalBlock[]`, mesma ordenação
  determinística.
- `PATCH /api/proposal-blocks/:id` — corpo `{organizationId, proposalId, userId, content?,
  sortOrder?}`.
- `GET /api/rate-card-items?organizationId=&creatorId=` → `RateCardItemWithService[]` (itens de
  todos os rate cards ativos do creator, já enriquecidos com `serviceName` e `unitDescription`
  resolvido, filtrando itens de rate card ou serviço inativos).

**Contexto de creator**: toda chamada é filtrada pelo creator da Opportunity de origem — a tela
não tem seletor de creator próprio (mesmo padrão do Inbox/Pipeline).

**`userId`**: nenhuma rota de Proposals tem auth ainda — `userId` é um campo explícito no corpo
de toda chamada mutante. Não existe hoje um helper de dev-user no frontend (só
`getDevOrganizationId()`); este plano precisa criar `getDevUserId()` em `src/lib/organization.ts`
(ou arquivo irmão), espelhando o padrão de ler uma env var `NEXT_PUBLIC_DEV_*`.

**Fora de escopo:**
- Editor de blocos completo (os outros 9 tipos: IMAGE, METRICS, SERVICES, PRICING, TIMELINE,
  GALLERY, TESTIMONIALS, SOCIAL_LINKS, FOOTER) — nenhum tem evidência de design real; ficam para
  uma spec futura.
- Envio da proposta pro cliente, geração de PDF, link público, aprovação/rejeição — o backend só
  tem `status: DRAFT | ARCHIVED`; `SENT`/`APPROVED`/`REJECTED` não existem ainda.
- Histórico de versões visível na UI — `GET /api/proposals/:id/versions` existe, mas sem endpoint
  de restore, mostrar uma lista sem poder fazer nada com ela tem pouco valor agora.
- Reordenar itens manualmente (drag ou botões) — ordem de inserção apenas.
- Tela organizacional de listagem de propostas (`/proposals`, fora do contexto de uma
  Opportunity) — pode vir depois.
- Preview visual renderizado por `template` — o campo é armazenado mas não tem efeito visual (não
  existe gerador de documento/PDF ainda).
- Seleção manual de rate card no Combobox de itens — o catálogo é uma lista única de
  `rate_card_items`, sem etapa de "escolher a tabela primeiro" (ver Decisão #9).

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Ponto de entrada | O Side Panel de uma Opportunity (Pipeline, já mergeado) ganha uma seção "Propostas", listando as propostas existentes via `GET /api/proposals?opportunityId=`. Cada proposta aparece como título + badge de status (Rascunho/Arquivada). Clicar navega para `/proposals/[id]`. |
| 2 | Fluxo de criação | Botão "Nova Proposta" no Side Panel abre um Dialog pequeno pedindo título + template (Select dos 6 temas). Ao confirmar, `POST /api/proposals` cria a Proposal junto com seus dois blocos estruturais iniciais, COVER (`{headline: ""}`) e TEXT (`{body: ""}`), numa única transação no backend (ver mudança em `ProposalService.create`, §1). Após sucesso, a UI navega para `/proposals/[id]`. |
| 3 | Layout do builder | Rota `/proposals/[id]`, página única com seções empilhadas: metadados (título editável, template Select) no topo → Capa (Input de headline) → Texto (Textarea de body) → Itens (tabela de preços, Decisão #9). Sem preview lado a lado, sem abas — três peças pequenas não justificam a complexidade extra. |
| 4 | Padrão de edição | Todo campo editável (título, template, headline, body, quantidade/preço de item) segue o mesmo padrão: inline, salva ao perder o foco (blur), disparando o `PATCH` correspondente automaticamente. Nenhum botão "Salvar" explícito em lugar nenhum da tela. |
| 5 | Campo template | Select simples (6 opções fixas). Sem efeito visual na tela do builder hoje — só armazenado, pronto pro dia que existir um renderizador de documento. |
| 6 | Arquivar | Botão "Arquivar" no topo (com confirmação) muda `status` para `ARCHIVED` via `PATCH`. Uma proposta arquivada fica **read-only**: todos os campos, blocos e itens ficam desabilitados para edição; só resta a ação "Desarquivar" (volta pra `DRAFT`) para voltar a editar. |
| 7 | Navegação de volta | Um link "Voltar" no topo da página leva para `/pipeline` — não reabre o Side Panel automaticamente (exigiria propagar o id da Opportunity, complexidade sem necessidade clara). O usuário reabre o card se precisar. |
| 8 | Carregamento e erro | A página busca `GET /api/proposals/:id`, `.../items` e `.../blocks` em paralelo ao abrir. Um único estado de loading cobre a tela inteira (mesmo padrão do Pipeline: mensagem simples enquanto carrega). Em caso de erro em qualquer uma das três chamadas, mostra mensagem de erro + botão de retry — nunca deixa a tela renderizar com dados parciais/silenciosamente vazios. |
| 9 | Adicionar item — Combobox de catálogo | O Combobox de "Adicionar item" mostra todos os `rate_card_items` elegíveis do creator (via `GET /api/rate-card-items?creatorId=`) como **uma lista única, sem agrupamento por rate card e sem etapa de seleção de rate card**. Cada opção mostra o nome do serviço + preço. Quando o mesmo nome de serviço aparece em mais de um rate card ativo (preços diferentes), o nome do rate card aparece como metadado secundário na opção, só nesse caso, para desambiguar — não é mostrado por padrão. Uma opção "Item avulso" no fim abre campos livres de descrição + preço (aceita negativo, para desconto). O `rateCardItemId` escolhido já identifica de forma única qual preço/origem foi selecionado — não é necessário guardar um `rateCardId` adicional no item da proposta. |
| 10 | Editar item | Quantidade e preço são Inputs inline diretamente na linha da tabela; mesmo padrão de salvar-no-blur da Decisão #4. Vale também para itens vindos do catálogo (o backend permite mudar `description`/`unitPrice` mesmo com `rateCardItemId` setado). |
| 11 | Remover item | Ícone de remover abre um `AlertDialog` de confirmação antes de disparar o `DELETE` — evita perda acidental de um item de preço já configurado. |
| 12 | Ordem dos itens | Ordem de inserção, sem drag-and-drop nem botões de mover no v1. Reforçado pelo backend: `GET .../items` já retorna ordenação determinística por `sortOrder, createdAt` (corrigido no ciclo anterior) — a UI não precisa (e não deve) tentar reordenar. |
| 13 | Total da proposta | Uma linha de total (BRL) no rodapé da tabela de itens, soma automática de quantidade × preço unitário de todos os itens — incluindo descontos negativos — recalculada a cada adição, edição ou remoção de item. |
| 14 | Tabela de itens vazia | Usa o `EmptyState` já existente no Design System, convidando a adicionar o primeiro item. |
| 15 | Blocos COVER/TEXT | Toda proposta nasce sempre com exatamente um bloco COVER e um bloco TEXT (Decisão #2) — não são opcionais, não há ação de "adicionar capa"/"adicionar texto" na UI; a seção correspondente já existe e está pronta pra edição assim que a página carrega. |
| 16 | Estrutura de conteúdo dos blocos | `COVER.content = {headline: string}`. `TEXT.content = {body: string}`. Nenhum campo além desses — mínimo viável, exatamente o que os testes do backend já exercitam. |
| 17 | Histórico de versões | Não exposto na UI do v1 — versionamento continua sendo bookkeeping automático e invisível do backend. |

## 3. Próximo Passo

Gerar o plano de implementação via `writing-plans`.
