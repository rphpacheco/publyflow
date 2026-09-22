# PublyFlow — Services & Rate Cards Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Milestone 1 (multi-tenant core) and Milestone 2 (Inbox → Inquiry → Lead →
Opportunity), already merged to `main`.

## 1. Escopo e Contexto

Esta spec cobre o subsistema de catálogo de serviços e tabelas de preço (Rate Cards), que é
pré-requisito direto do subsistema de Proposals (spec/plano separado, próximo passo depois
deste). Rate Cards e Proposals foram deliberadamente separados em duas specs/planos porque,
juntos, formam um escopo grande demais para um ciclo — Rate Cards é pequeno, independente e
testável isoladamente, e Proposals se apoia diretamente nele.

**Fora de escopo nesta fase** (YAGNI, adiado):
- `service_packages` (combos de serviços) — aditivo, não bloqueia Proposals.
- Qualquer UI — este subsistema, como Milestone 1/2, é backend-only (schema → repositories →
  services → API routes), seguindo o mesmo padrão já estabelecido.
- Proposals em si (`proposals`, `proposal_items`, `proposal_blocks`, `proposal_versions`,
  `proposal_view_events`) — próxima spec.

## 2. Decisões de Design (revisão sobre a spec de produto original)

| # | Decisão | Resolução |
|---|---|---|
| 1 | Versionamento de preço | Rate Card é **imutável após uso**: assim que qualquer `rate_card_item` é referenciado pela primeira vez (contrato que a spec de Proposals vai consumir), a Rate Card inteira fica travada para edição (`is_locked`). Mudar preço = duplicar a tabela inteira em uma nova Rate Card. |
| 2 | Seleção de Rate Card | Sempre explícita — não existe "tabela padrão automática" nesta fase. Quem cria uma Proposal escolhe qual Rate Card usar. |
| 3 | Escopo de Services | **Por creator**, não compartilhado pela organização — desvio deliberado da spec de produto original (que sugeria um catálogo por organização com Rate Cards podendo ser "gerais da org"). Motivo: simplicidade de modelo — um catálogo por creator evita ambiguidade sobre "esse serviço serve pra qual creator" quando a organização administra múltiplos creators com formatos/preços muito diferentes. |
| 4 | Escopo de Rate Cards | Consequência da decisão #3: `rate_cards.creator_id` é **not null** (sempre amarrada a um creator), não nullable como a spec de produto original sugeria para "tabela geral da org". |
| 5 | `service_packages` (combos) | Fora de escopo — adicionado depois, se necessário. |
| 6 | Vigência de Rate Card | `rate_cards` ganha `valid_from`/`valid_to` nullable — permite marcar tabelas sazonais (ex: "Tabela Black Friday") com janela de validade, sem exigir lógica adicional de seleção automática (decisão #2 continua valendo: seleção é sempre explícita, `valid_from`/`valid_to` são apenas metadados informativos nesta fase, não usados para filtrar/ativar automaticamente). |
| 7 | Ordenação de itens | `rate_card_items` ganha `sort_order` integer not null default 0 — ordem de exibição dos itens dentro de uma Rate Card, controlada pelo usuário (não alfabética/por data). |
| 8 | Opções avaliadas e conscientemente adiadas | `rate_cards.is_default` (marcar uma tabela como padrão por creator) e um state machine `DRAFT → PUBLISHED → LOCKED` (em vez de apenas `is_locked`) foram avaliados e explicitamente adiados — não têm valor claro de uso real ainda e adicionariam regras de negócio (ex: garantir só uma default por creator; transições de estado válidas) sem um caso de uso concreto no momento. Revisitar quando o uso real do produto pedir. |

## 3. Modelo de Dados

### `services`
- `id` uuid pk
- `organization_id` uuid not null, FK → organizations, cascade
- `creator_id` uuid not null, FK → creators, cascade
- `name` text not null (ex: "01 Reel")
- `description` text nullable
- `unit_description` text nullable (ex: "por publicação")
- `is_active` boolean not null default true (soft-hide sem deletar; serviços usados em rate
  cards travadas nunca devem ser hard-deletados — ver §5)
- `created_at` timestamp

### `rate_cards`
- `id` uuid pk
- `organization_id` uuid not null, FK → organizations, cascade
- `creator_id` uuid not null, FK → creators, cascade
- `name` text not null (ex: "Tabela 2026", "Tabela Black Friday")
- `is_active` boolean not null default true (visibilidade em seletores; não confundir com
  `is_locked`)
- `is_locked` boolean not null default false (trava de edição — ver §5)
- `valid_from` timestamp nullable (metadado informativo — não usado para seleção automática,
  ver Decisão #6)
- `valid_to` timestamp nullable (idem)
- `created_at` timestamp

### `rate_card_items`
- `id` uuid pk
- `organization_id` uuid not null, FK → organizations, cascade
- `rate_card_id` uuid not null, FK → rate_cards, cascade
- `service_id` uuid not null, FK → services, restrict (não pode deletar um Service referenciado
  por um item de rate card)
- `price` integer not null (centavos)
- `unit_description` text nullable (sobrescreve o do Service quando preenchido)
- `sort_order` integer not null default 0 (ordem de exibição dentro da Rate Card)
- `created_at` timestamp

**Regra não-negociável** (herdada de Milestone 1/2): toda tabela carrega `organization_id`
com RLS habilitado desde a primeira migration — sem exceções, incluindo teste de isolamento
via role `app_user` (não superuser), seguindo exatamente o padrão de
`docker/test-db-init/01-app-user.sql` e `runInTenantContext`.

## 4. Camadas (mesmo padrão de Milestone 1/2)

`db/schema` → `repositories` (via `runInTenantContext`) → `services` (regras de domínio) →
`app/api` (rotas REST finas).

- `ServicesRepository` / `ServiceService` — CRUD simples (create, update, list por creator,
  soft-deactivate via `is_active`). Sem hard-delete de Service — usar `is_active: false`.
- `RateCardsRepository` / `RateCardService` — create, list por creator, `duplicate(rateCardId)`
  (copia a Rate Card e todos os seus `rate_card_items` para uma nova Rate Card não travada).
- `RateCardItemsRepository` — create/update/delete de itens, sempre validando
  `rate_card.is_locked === false` antes de qualquer escrita (erro de domínio
  `RateCardLockedError` caso contrário).
- **Trigger de trava**: a spec de Proposals (próxima) é responsável por chamar um método
  `RateCardService.lock(rateCardId)` na primeira vez que um `rate_card_item` é copiado para um
  `proposal_item` — este subsistema apenas expõe esse método e a validação de escrita bloqueada,
  não decide quando a trava acontece (isso pertence ao fluxo de Proposals).

## 5. API Routes

- `POST /api/services` — cria Service
- `PATCH /api/services/:id` — atualiza (nome, descrição, `is_active`)
- `GET /api/services?creatorId=` — lista
- `POST /api/rate-cards` — cria Rate Card vazia
- `POST /api/rate-cards/:id/duplicate` — duplica (nova Rate Card + cópia de todos os items)
- `GET /api/rate-cards?creatorId=` — lista
- `POST /api/rate-cards/:id/items` — adiciona item (falha se `is_locked`)
- `PATCH /api/rate-card-items/:id` — atualiza item (falha se a rate card pai estiver travada)
- `DELETE /api/rate-card-items/:id` — remove item (falha se travada)

Todas as rotas seguem o padrão já estabelecido em Milestone 2: `organizationId` no corpo da
requisição (autenticação/sessão continua fora de escopo, pendência documentada desde Task 7).

## 6. Pendências Registradas

1. Autenticação/sessão (mesma pendência de Milestone 1/2) — `organizationId` seguirá vindo no
   corpo da requisição até o plano de Auth/UI ser executado.
2. Mapeamento de erros HTTP para respostas estruturadas (404/409 em vez de 500 genérico) — gap
   já registrado no ledger de Milestone 2, não resolvido aqui, deve ser endereçado numa fase de
   observabilidade/API conventions.
3. `service_packages` (combos) — explicitamente fora de escopo, ver §1.

## 7. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis via skill `writing-plans`,
seguindo exatamente o padrão TDD/subagent-driven já usado em Milestone 1/2 (schema com RLS
primeiro, depois repositories, depois services de domínio, depois API routes).
