# PublyFlow — Proposals (Core Domain) Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Milestone 1/2 (multi-tenant core, Inbox→Inquiry→Lead→Opportunity) and
Services & Rate Cards, already merged to `main`.

## 1. Escopo e Contexto

Esta spec cobre apenas o **núcleo estrutural** de Proposals: criação, itens (de catálogo ou
avulsos), blocos de conteúdo, e versionamento automático por snapshot. Segue o mesmo padrão
incremental dos planos anteriores.

**Fora de escopo nesta fase** (specs separadas, futuras):
- `AIService.generateProposal()` — geração assistida por IA.
- Geração de PDF.
- Links públicos de compartilhamento e `proposal_view_events` (tracking de visualização).
- Aprovação/rejeição pelo cliente, e os status `SENT`/`APPROVED`/`REJECTED` associados —
  entram junto com a spec de compartilhamento, quando também definirmos suas transições e
  regras de negócio. Modelar esses estados agora, sem operação real que os use, foi
  deliberadamente descartado.
- Colaboração em tempo real.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Itens avulsos | `proposal_items.rateCardItemId` é **nullable**. Um item pode vir de um `rate_card_item` (preço copiado) ou ser inteiramente avulso (descrição/quantidade/preço digitados na hora — desconto negociado, taxa de deslocamento, hospedagem, bônus comercial, etc.). A flexibilidade vive no nível da proposta, não no catálogo — `rate_card_items` continuam obrigatoriamente vinculados a um `service`. |
| 2 | Gatilho de trava da Rate Card | A trava acontece no **primeiro uso efetivo** de qualquer `rate_card_item`, seja na criação da Proposal ou numa edição posterior — nunca amarrada ao momento de criação da Proposal em si. Se `rate_card_item_id` é informado e a Rate Card de origem ainda não está travada, `RateCardService.lock()` é chamado na mesma transação. Itens avulsos nunca disparam trava. `rate_cards` ganha `locked_at` timestamp nullable para auditoria. |
| 3 | Tipos de bloco | `pgEnum` fixo — `COVER`, `TEXT`, `IMAGE`, `METRICS`, `SERVICES`, `PRICING`, `TIMELINE`, `GALLERY`, `TESTIMONIALS`, `SOCIAL_LINKS`, `FOOTER`. São domínio do produto, não dado livre do usuário — um tipo novo no futuro exige migration explícita, deliberadamente. |
| 4 | Templates visuais | Mesma lógica da decisão #3: `pgEnum` fixo — `PREMIUM`, `MINIMAL`, `EDITORIAL`, `FASHION`, `BEAUTY`, `CORPORATE`. |
| 5 | Rate Card por Proposal | **Não existe** `rate_card_id` fixo em `proposals`. Cada `proposal_item` referencia seu próprio `rate_card_item_id` (potencialmente de tabelas diferentes) ou é avulso — uma mesma Proposal pode combinar itens de Rate Cards diferentes e itens avulsos. |
| 6 | Gatilho de versionamento | **Automático**, a cada mutação estrutural (add/edit/remove de item, bloco, ou metadados da proposta — título/template/status), dentro da mesma transação da mudança. Sem versionamento manual nesta fase. Snapshots são **completos**, não diffs. Uma mutação que não altera efetivamente o conteúdo (ex: update com os mesmos valores) **não** gera versão nova — comparação explícita antes de decidir se grava snapshot. |
| 7 | Status de Proposal | Apenas `DRAFT` e `ARCHIVED` nesta fase (ver §1 — `SENT`/`APPROVED`/`REJECTED` ficam para a spec de compartilhamento). |
| 8 | Autoria de versão | `proposal_versions.created_by` é `uuid` **not null**. Como autenticação/sessão continua fora de escopo, os endpoints de mutação de Proposal exigem `userId` explícito no corpo da requisição, mesmo padrão já usado para `organizationId`. Quando auth for implementada, `userId` passa a vir da sessão, sem mudança de semântica do campo. **Validação explícita**: o `userId` informado deve corresponder a um `organization_members` existente para o `organizationId` da requisição — se não houver membership, a operação falha (não confiar apenas no FK `users.id`, que aceita qualquer usuário de qualquer organização). |
| 9 | Validação de `creator_id` do `rate_card_item` | Quando um `proposal_item` referencia `rate_card_item_id`, o serviço deve validar não só que o `rate_card_item`/`rate_card` pertence à mesma `organization_id` (já coberto pela regra geral de ownership do §4), mas também que o `creator_id` da Rate Card de origem é **o mesmo `creator_id` da Opportunity** à qual a Proposal pertence (`proposals.opportunity_id → opportunities.creator_id`). Isso impede anexar a uma proposta de um creator um item de tabela de preço de outro creator da mesma organização — a mesma invariante de catálogo por creator já aplicada em `RateCardItemService.addItem`, agora estendida à cadeia Proposal→Opportunity→Creator. |

## 3. Modelo de Dados

### `proposals`
- `id` uuid pk
- `organization_id` uuid not null, FK → organizations, cascade
- `opportunity_id` uuid not null, FK → opportunities, restrict
- `title` text not null
- `template` `proposal_template` enum not null
- `status` `proposal_status` enum not null default `DRAFT`
- `created_at` timestamp

### `proposal_items`
- `id` uuid pk
- `organization_id` uuid not null, FK → organizations, cascade
- `proposal_id` uuid not null, FK → proposals, cascade
- `rate_card_item_id` uuid **nullable**, FK → rate_card_items, restrict
- `description` text not null (copiado do service/rate_card_item na criação, ou digitado
  manualmente para itens avulsos)
- `quantity` integer not null default 1
- `unit_price` integer not null (centavos — copiado na criação, nunca recalculado a partir
  do preço atual do catálogo)
- `sort_order` integer not null default 0
- `created_at` timestamp

### `proposal_blocks`
- `id` uuid pk
- `organization_id` uuid not null, FK → organizations, cascade
- `proposal_id` uuid not null, FK → proposals, cascade
- `block_type` `proposal_block_type` enum not null
- `content` jsonb not null (payload livre por tipo — estrutura interna não é validada pelo
  backend nesta fase, cada tipo de bloco terá seu próprio schema quando a UI for construída)
- `sort_order` integer not null default 0
- `created_at` timestamp

### `proposal_versions`
- `id` uuid pk
- `organization_id` uuid not null, FK → organizations, cascade
- `proposal_id` uuid not null, FK → proposals, cascade
- `version_number` integer not null (sequencial por proposta, começando em 1)
- `snapshot_json` jsonb not null — estado completo reconstruível: `{ proposal: {title,
  template, status}, items: [...], blocks: [...] }`
- `created_by` uuid not null, FK → users, restrict
- `created_at` timestamp
- `UNIQUE (proposal_id, version_number)` — impede colisão/duplicação de número de versão
  para a mesma proposta (defesa a nível de banco contra uma race condition na leitura do
  próximo `version_number`, mesmo com a escrita protegida por transação).

### `rate_cards` (alteração a uma tabela existente)
- `+ locked_at` timestamp nullable — preenchido no momento em que `RateCardService.lock()`
  é chamado (seja pela trava manual já existente, seja pelo gatilho automático desta spec).

**Regra não-negociável** (herdada): toda tabela nova carrega `organization_id` com RLS
habilitada **na mesma migration** que a cria — sem exceções, sem tarefa separada. As duas
últimas revisões finais de branch encontraram exatamente esse desalinhamento quando ele foi
deferido; esta spec não repete o erro.

## 4. Arquitetura

Mesmo padrão de camadas: `db/schema` → `repositories` (via `runInTenantContext`) →
`services` (regras de domínio) → `app/api`.

**Lições dos dois planos anteriores aplicadas desde o desenho, não como correção
posterior:**
- Toda operação que escreve em mais de uma tabela (criar proposta + versão inicial;
  adicionar item + travar rate card + nova versão) nasce com o padrão `*WithTx`
  (`createWithTx`/`findByIdWithTx`/etc., seguindo exatamente a forma já estabelecida em
  `creators.repository.ts`/`contacts.repository.ts`) dentro de uma única transação — não
  escrevemos a versão sem transação para depois corrigir.
- Toda referência a uma entidade de outra tabela que o caller pode informar livremente é
  validada explicitamente na camada de serviço — nunca confiando em RLS sozinha, já que
  checks de FK no Postgres ignoram RLS. Isso é exatamente o bug de bypass cross-tenant
  corrigido na revisão final do plano de Rate Cards; aqui ele é evitado por desenho, em
  dois pontos concretos (ver Decisões #8 e #9):
  - `rate_card_item_id` num `proposal_item`: valida `organization_id` E `creator_id`
    (via `opportunity.creator_id`), não apenas `organization_id`.
  - `userId` em qualquer endpoint de mutação: valida que existe `organization_members`
    para esse par `(userId, organizationId)`, não apenas que o `userId` existe em `users`.

**Serviços:**
- `ProposalService.create(db, organizationId, input: { opportunityId, title, template, userId })` — cria a proposta (status `DRAFT`) e a versão 1 (snapshot do estado inicial: items/blocks vazios), atômico.
- `ProposalService.update(db, organizationId, proposalId, input: { title?, template?, status?, userId })` — atualiza metadados; se algo realmente mudou, grava nova versão.
- `ProposalItemService.addItem` / `updateItem` / `removeItem` — grava a mudança; se `rateCardItemId` foi informado e a rate card de origem não está travada, chama `RateCardService.lock()`; se o conteúdo mudou de fato, grava nova versão. Tudo numa transação.
- `ProposalBlockService.addBlock` / `updateBlock` / `removeBlock` — mesma lógica de versionamento condicional, sem a parte de trava de rate card.

## 5. API Routes

- `POST /api/proposals`, `GET /api/proposals?organizationId=&opportunityId=`
- `PATCH /api/proposals/:id`
- `POST /api/proposals/:id/items`, `PATCH /api/proposal-items/:id`, `DELETE /api/proposal-items/:id`
- `POST /api/proposals/:id/blocks`, `PATCH /api/proposal-blocks/:id`, `DELETE /api/proposal-blocks/:id`
- `GET /api/proposals/:id/versions` — lista o histórico, prova que o versionamento funciona ponta a ponta.

Mesmo padrão de `organizationId` (e agora também `userId`, para autoria de versão) no corpo
da requisição — autenticação/sessão continua fora de escopo.

## 6. Pendências Registradas

1. Autenticação/sessão — mesma pendência documentada desde Milestone 1.
2. Mapeamento de erros HTTP estruturado — mesma pendência documentada desde Milestone 2.
3. Geração por IA, PDF, compartilhamento público, `proposal_view_events`, estados
   `SENT`/`APPROVED`/`REJECTED` — explicitamente fora de escopo, specs futuras (ver §1).
4. Validação de estrutura interna de `content` (jsonb) por tipo de bloco — fica para quando
   a UI/editor de blocos for construído; nesta fase o backend aceita qualquer jsonb.

## 7. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis via skill `writing-plans`,
seguindo o padrão TDD/subagent-driven já usado nos planos anteriores.
