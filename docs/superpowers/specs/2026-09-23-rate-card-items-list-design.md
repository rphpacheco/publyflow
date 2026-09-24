# PublyFlow — Rate Card Items List API Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Services & Rate Cards domain (merged) — reuses its schema and repositories.
Blocks: Proposal Builder UX Spec — the "Adicionar item" Combobox needs a creator-scoped, enriched
list of catalog items to pick from; nothing today returns rate card items joined with their
Service's name, nor aggregated across a creator's rate cards.

## 1. Contexto

`rate_card_items` stores `price` and an optional `unitDescription` override, but its display
label ("what is this line item called") lives on the linked `services.name` row — there is no
`GET` anywhere that joins the two, and no endpoint that lists items across all of a creator's
rate cards in one call (only `RateCardItemsRepository.listByRateCard`, scoped to a single rate
card, exists — and only at the repository layer, no service method or route). The Proposal
Builder's catalog Combobox needs exactly this: "every currently-offered priced item for this
creator, with its name."

**Contratos de backend consumidos** (novo neste ciclo):
- `GET /api/rate-card-items?organizationId=&creatorId=` → `RateCardItemWithService[]`.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Forma do endpoint | Um único endpoint agregado por creator (não por rate card) — `GET /api/rate-card-items?organizationId=&creatorId=`, mirrors the `creatorId`-scoped flat-list convention already used by `GET /api/services` and `GET /api/rate-cards`. |
| 2 | Campos retornados | Todos os campos de `RateCardItem` (`id`, `rateCardId`, `serviceId`, `price`, `sortOrder`, `createdAt`) mais `serviceName: string` (de `services.name`) e `unitDescription: string \| null` (já resolvido: o valor do próprio `rateCardItem.unitDescription` quando não-nulo, senão o `services.unitDescription` do serviço vinculado — a mesma regra de fallback já documentada no domínio, agora materializada na resposta em vez de deixar o cliente recalcular). |
| 3 | Filtro de visibilidade | Só retorna itens cujo `rate_card.isActive = true` **e** cujo `service.isActive = true` — os dois precisam estar ativos. Um item de um rate card arquivado ou de um serviço descontinuado não aparece como opção nova no Combobox; isso não afeta propostas já criadas com esse item (o valor foi copiado no momento da criação, nunca recalculado). |
| 4 | Camada de repository | Novo `RateCardItemsRepository.listByCreator(db, organizationId, creatorId)` — `INNER JOIN` com `rate_cards` (para filtrar `isActive` e obter `rateCardId`) e `INNER JOIN` com `services` (para `serviceName`/`unitDescription`/filtrar `isActive`); ambos os joins podem ser `INNER` porque `rateCardId`/`serviceId` são `NOT NULL` em `rate_card_items`. Ordenado por `rate_card_id, sort_order, created_at` (mesma disciplina de ordenação determinística já corrigida no ciclo anterior). |
| 5 | Camada de service | Novo `RateCardItemService.listByCreator` — pass-through simples, sem enriquecimento adicional (a query já retorna o formato final). |
| 6 | Sem mudanças de escrita | Nenhuma rota `POST`/`PATCH`/`DELETE` existente é tocada. |

**Fora de escopo:** paginação; busca/filtro por texto (o Combobox filtra client-side sobre a lista
completa, como o Combobox de Brands da Inbox screen já faz); mudança em `RateCardService.lock`/
`duplicate`; qualquer alteração no comportamento de `ProposalItemService.addItem` (que já resolve
`rateCardItemId` → descrição/preço internamente, de forma independente desta listagem).

## 3. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, retomar o brainstorm da
UX Spec do Proposal Builder.
