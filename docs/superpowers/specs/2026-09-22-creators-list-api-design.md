# PublyFlow — Creators List API Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Milestone 1/2, Backend Audit Fix Wave — all merged to `main`.
Blocks: Design System v1 (the Creator Switcher, part of the application shell, needs this
API to populate itself).

## 1. Contexto

`CreatorsRepository.listByOrganization` já existe (usado internamente por
`CreatorsRepository.existsForOrganization`'s sibling tests and by no production caller today),
mas não existe nenhuma rota HTTP que o exponha, nem um `CreatorService`. O Creator Switcher —
elemento fixo do header, presente em toda tela do produto — depende de uma lista de creators
da organização atual para se popular. Sem essa API, o Design System não pode implementar o
application shell.

Esse é um mini-ciclo isolado, fora da sequência normal de specs de UX (Design System → Inbox
→ Pipeline → Proposal Builder), porque bloqueia a primeira peça de UI que qualquer uma delas
vai precisar.

**Fora de escopo:**
- "Todos os creators" / agregação cross-creator — decisão já registrada: fica para quando
  houver uma necessidade real de endpoint agregado no backend. Não simular no frontend.
- CRUD de creators (create/update/deactivate) — não solicitado, já existe `create`/`createWithTx`
  no repositório para outros fluxos (onboarding), sem rota HTTP e sem necessidade de uma agora.
- Paginação — mesma decisão de todas as listagens deste projeto: não existe em lugar nenhum,
  não introduzir aqui.
- Avatar/foto e status do creator — não existem colunas para isso no schema atual
  (`src/db/schema/creators.ts`: `id`, `organizationId`, `userId`, `displayName`,
  `instagramHandle`, `createdAt`). Não inventar campos por antecipação do Design System.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Endpoint de listagem | `GET /api/creators?organizationId=` → `200` com `Creator[]`, ordenado deterministicamente por `displayName` (ordem alfabética, `asc`) — `listByOrganization` hoje não tem `orderBy`; precisa ganhar um. |
| 2 | Endpoint de detalhe | Não criado nesta wave. Nenhum fluxo de UI já especificado precisa dele; criar por simetria REST seria antecipação. Se um fluxo futuro (ex: perfil do creator) precisar, entra numa spec própria. |
| 3 | Camada de serviço | Novo `CreatorService` fino (`src/services/creator.service.ts`) com `listByOrganization`, espelhando o padrão já usado por `LeadService`/`CompanyService`/`ContactService` na wave anterior — a rota nunca chama o repository direto. |
| 4 | Isolamento multi-tenant | `listByOrganization` já filtra por `organizationId` via `runInTenantContext`; um creator de outra organização é invisível — nenhuma mudança de isolamento necessária, só confirmar com teste. |
| 5 | Campos retornados | O shape completo de `Creator` (id, organizationId, userId, displayName, instagramHandle, createdAt) — não há necessidade de um DTO reduzido; nenhuma outra rota deste projeto já usa uma projeção de campos, e criar uma agora seria abstração antecipada. |

## 3. Escopo de Implementação

- `CreatorsRepository.listByOrganization` ganha `orderBy(asc(creators.displayName))`.
- Novo `src/services/creator.service.ts` com `CreatorService.listByOrganization`.
- Novo `src/app/api/creators/route.ts` com `GET`.
- Testes: listagem da própria organização; isolamento entre organizações (creator de outra org
  não aparece); organização sem creators (lista vazia, não erro); ordenação determinística
  (dois+ creators fora de ordem alfabética de criação, confirmar retorno ordenado).

## 4. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis via skill `writing-plans`.
Depois de mergeado, seguir para o brainstorming do Design System v1.
