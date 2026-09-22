# PublyFlow — Backend Audit Fix Wave (Pre-UI Hardening) Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Milestone 1/2, Services & Rate Cards, Proposals (core domain) — all merged to
`main`.

## 1. Contexto

Uma auditoria de integração cross-milestone (registrada na conversa, não em documento
separado) encontrou 2 achados Critical e 3 Important. Esta spec cobre a wave de correção
focada em eliminar os bloqueadores de UI e as inconsistências arquiteturais de baixo custo.
Débitos técnicos de severidade Minor/Informational ficam explicitamente fora de escopo
(ver §5).

**Fora de escopo** (nenhuma UI, nenhuma abstração nova por antecipação):
- Qualquer tela ou componente de interface.
- CRUD completo de Companies/Contacts/Leads/Brands — só a superfície de leitura mínima
  necessária para a próxima fase (Inbox/Pipeline).
- Paginação — não existe padrão de paginação em nenhum lugar do projeto hoje; não introduzir
  um agora só por antecipação. Ordenação determinística (`ORDER BY`) é suficiente.
- Modelo de autenticação/sessão — a inconsistência de `userId` obrigatório só em Proposals
  fica registrada como decisão pendente, não resolvida aqui.
- Regras de transição de stage (ex: "não pode pular de NOVO_LEAD pra FECHADO") — não existe
  essa regra na spec de produto original; não inventar uma agora.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Validação de `creatorId` | Novo `CreatorsRepository.existsForOrganization`/`existsForOrganizationWithTx`, mesmo padrão de `OrganizationMembersRepository`. Aplicado em `InboxService.ingestManualMessage`, `ServiceService.create`, `RateCardService.create`. Lança `CreatorNotFoundError` (novo, `src/domain/creators/errors.ts` — arquivo compartilhado pelos três módulos consumidores, evitando duplicar a classe). |
| 2 | Superfície de leitura do Milestone 2 | Listagens ordenadas por `created_at desc` (sem paginação, por decisão explícita do escopo). Commercial Inquiries: lista por org+creator, filtro opcional de status. Opportunities: lista por org+creator, filtro opcional de stage; endpoint de detalhe. Leads/Companies/Contacts: lista por org(+creator quando aplicável) e detalhe — mínimo necessário pra Inbox/Pipeline selecionarem/visualizarem entidades existentes, sem CRUD completo. |
| 3 | Mudança de stage de Opportunity | `PATCH /api/opportunities/:id` com `{organizationId, stage}`. A escrita (update do stage + insert em `opportunity_stage_history`) segue o mesmo padrão já usado em `OpportunitiesRepository.insertOpportunity` (que já grava a entrada inicial do histórico junto com o insert da opportunity, dentro do repositório — não é regra de negócio, é a mecânica de manter as duas linhas consistentes) — `updateStage`/`updateStageWithTx` fazem o mesmo para transições. Nenhuma regra de transição válida é imposta nesta fase. |
| 4 | Camada de serviço para Leads/Companies/Contacts | Mesmo que a lógica seja hoje um simples wrapper (`listByX`/`findById`), cada um ganha um `LeadService`/`CompanyService`/`ContactService` fino — para não repetir o mesmo anti-padrão que a Decisão #6 está corrigindo em Proposals (rota chamando repository direto). |
| 5 | `ProposalVersionsRepository` vira persistência pura | `buildSnapshotWithTx` (orquestra 3 repositórios-irmãos) e o cálculo de `versionNumber` migram para um novo `ProposalVersionService`. O repository fica só com `insertWithTx`, `countByProposalWithTx`, `listByProposal`. Todos os call sites atuais (`ProposalService`, `ProposalItemService`, `ProposalBlockService`) trocam a chamada de `ProposalVersionsRepository.createVersionWithTx` para `ProposalVersionService.createVersionWithTx` — comportamento idêntico, camada correta. |
| 6 | GETs de Proposals passam a usar Service | `ProposalService.listByOpportunity` (novo, wrapper fino) e `ProposalVersionService.listByProposal` (novo, wrapper fino) substituem as chamadas diretas a repository nas rotas `GET /api/proposals` e `GET /api/proposals/:id/versions`. |
| 7 | Documentação da decisão de escopo Company/Contact vs Lead/Opportunity | Registrado nesta spec (§3) como decisão de domínio explícita, não alteração de schema. |

## 3. Decisão de Domínio Registrada: Escopo Organization vs. Creator

`companies` e `contacts` são **organization-scoped** (sem `creator_id`). `leads` e
`opportunities` são **creator-scoped**. Isso é intencional: uma mesma organização/assessoria
pode negociar com a mesma empresa/contato em nome de creators diferentes — a empresa e a
pessoa de contato são compartilhadas no nível da organização, mas cada negociação
(Lead/Opportunity) pertence a um creator específico. Não é inconsistência, é o modelo
correto para agências multi-creator. Nenhuma mudança de schema decorre desta decisão — ela
só estava implícita e agora fica explícita.

## 4. Escopo de Implementação

### 4.1 Ownership de `creatorId` (Critical)
- `CreatorsRepository.existsForOrganization`/`existsForOrganizationWithTx`.
- `InboxService.ingestManualMessage`, `ServiceService.create`, `RateCardService.create`
  validam antes de escrever.
- `ServicesRepository` ganha `createWithTx` (não existia — só `create`), seguindo o mesmo
  padrão de extração de helper privado já usado em todo o resto do código.

### 4.2 Read APIs do Milestone 2 (Critical / bloqueador de UI)
- `CommercialInquiriesRepository.listByCreator` (+ filtro de status) → `CommercialInquiryService.listByCreator` → `GET /api/commercial-inquiries?organizationId=&creatorId=&status=`.
- `OpportunitiesRepository.listByCreator` (+ filtro de stage) → `OpportunityService.listByCreator` → `GET /api/opportunities?organizationId=&creatorId=&stage=`.
- `GET /api/opportunities/:id` (detalhe).
- `OpportunitiesRepository.updateStage`/`updateStageWithTx` (opportunity + stage_history numa transação) → `OpportunityService.changeStage` → `PATCH /api/opportunities/:id`.
- `LeadsRepository.listByCreator` → `LeadService` (novo) → `GET /api/leads?organizationId=&creatorId=`, `GET /api/leads/:id`.
- `CompaniesRepository.listByOrganization` + `findById` (novos) → `CompanyService` (novo) → `GET /api/companies?organizationId=`, `GET /api/companies/:id`.
- `ContactsRepository.listByOrganization` (novo) → `ContactService` (novo) → `GET /api/contacts?organizationId=`, `GET /api/contacts/:id`.

### 4.3 `ProposalVersionService` (Important)
Extração descrita na Decisão #5.

### 4.4 GETs de Proposals via Service (Important)
Descrito na Decisão #6.

## 5. Fora Desta Wave (débito técnico registrado, não resolvido agora)

`converted_lead_id`/`linked_opportunity_id` sem FK; ordenação determinística dentro de
`snapshot_json`; classes de erro `NotFound` duplicadas por módulo; `proposals.creator_id`
ausente; camada HTTP genérica de mapeamento de erro; mapeamento completo dos erros antigos
do Milestone 2 (`convert`/`discard`/`inbox/messages` sem try/catch); `userId` obrigatório
de forma inconsistente entre módulos (fica registrado como decisão pendente até existir
modelo de autenticação).

## 6. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis via skill `writing-plans`.
Ao final, revisão específica confirmando: (1) nenhum caminho de `creatorId` permite
cross-tenant; (2) Inbox lível; (3) Pipeline lível e com mudança de stage funcionando;
(4) `opportunity_stage_history` atualizado corretamente; (5) Companies/Contacts
consultáveis; (6) Proposals continuam funcionando após a reorganização de camadas;
(7) nenhuma regra nova introduzida por antecipação.
