# PublyFlow — Pipeline UX Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Design System v1, Inbox screen, Opportunities Party Enrichment — all merged to
`main`.
Blocks: Proposal Builder UX Spec (built next, informed by how the Pipeline hands off to
Proposals).

## 1. Contexto

Segunda das três telas prioritárias do PublyFlow (Inbox → Pipeline → Proposal Builder), na
ordem do fluxo operacional real: Inbox → Inquiry → Lead → Opportunity → Pipeline → Proposal.
Construída sobre o Design System v1 (shadcn/ui + Radix, tokens "Electric Editorial", shell
completo) e o backend já existente — nenhuma UX aqui pressupõe uma API que não exista.

**Contratos de backend consumidos** (todos já implementados e mergeados):
- `GET /api/opportunities?organizationId=&creatorId=&stage=` → `OpportunityWithParties[]`
  (`stage`: `NOVO_LEAD`/`QUALIFICACAO`/`PRIMEIRO_CONTATO`/`MIDIA_KIT_ENVIADO`/
  `PROPOSTA_SOLICITADA`/`PROPOSTA_ENVIADA`/`NEGOCIACAO`/`AGUARDANDO_CLIENTE`/`FECHADO`/
  `PERDIDO`; `status`: `OPEN`/`WON`/`LOST`, já sincronizado automaticamente com stage
  FECHADO/PERDIDO; `estimatedValueCents`; `createdAt`; `companyName`, `brandName`,
  `contactName`).
- `PATCH /api/opportunities/:id` — corpo `{organizationId, stage}` → `200` com a Opportunity
  atualizada (não enriquecida), `404` se não encontrada. Aceita qualquer transição de stage —
  sem regra de fluxo válido imposta pelo backend.

**Contrato `stage` vs. `status` (explícito, para evitar decisão implícita na implementação):**
a UI é 100% orientada a `stage` — é o único campo que a UI lê para decidir em qual coluna um
card aparece, e o único campo que a UI envia no `PATCH`. `status` (`OPEN`/`WON`/`LOST`) é
somente leitura do ponto de vista da UI: o backend já sincroniza `status` automaticamente
quando `stage` chega em `FECHADO`/`PERDIDO` (`OpportunitiesRepository.updateStage`, já
mergeado). A UI nunca lê, envia, nem tenta manter `status` sincronizado — isso já é
responsabilidade do backend.

**Contexto de creator**: toda chamada é filtrada pelo creator selecionado no Creator Switcher
global — a tela não tem seletor de creator próprio (mesmo padrão do Inbox).

**Fora de escopo:**
- Opportunity Detail completo — tela própria, spec futura própria; o Side Panel desta spec
  mostra apenas o essencial (dados já disponíveis via `GET /api/opportunities`), não tenta ser
  a tela completa de detalhe (que teria contexto adicional como Leads/Proposals associadas).
- Histórico de mudanças de stage (`opportunity_stage_history`) — não há API que exponha essa
  tabela hoje; fica registrado como capacidade futura, não resolvido nesta spec.
- Filtros além do Creator Switcher (busca por texto, filtro por valor, por data).
- Arquivamento ou ocultação das colunas FECHADO/PERDIDO — sempre visíveis.
- Validação de transição de stage (ex: "não pode pular de NOVO_LEAD pra FECHADO") — o backend
  não impõe essa regra, a UI não inventa uma.
- Drag-and-drop no mobile — no mobile (uma coluna por vez, já definido pelo Design System v1),
  a única forma de mudar stage é o menu "Mover para...".
- Paginação — nenhuma lista deste projeto pagina.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Layout do board | 10 colunas (uma por stage), largura fixa (~280px cada), scroll horizontal no desktop/tablet. No mobile: uma coluna por vez com navegação horizontal (comportamento já definido pela spec do Design System v1 — Kanban, regra única, sem alternativa de lista). |
| 2 | Header da coluna | Nome do stage + contador de cards. |
| 3 | Conteúdo do card | Label principal = `brandName ?? companyName ?? contactName` (composição feita na UI, não no backend). Valor estimado formatado em BRL quando `estimatedValueCents` existir. Tempo relativo desde `createdAt`. |
| 4 | Colunas FECHADO/PERDIDO | Sempre visíveis, sem toggle de ocultar, sem arquivamento — 10 colunas = 10 stages, sem exceção. |
| 5 | Mudança de stage — desktop/tablet | Drag-and-drop (`@dnd-kit/core`, adicionado nesta implementação — decisão do Design System v1 foi deferir a instalação até a UX do Pipeline existir, não pré-instalar) é o fluxo principal. **Optimistic update + rollback**: ao soltar, o card muda de coluna imediatamente no cache local, o `PATCH /api/opportunities/:id` é disparado em seguida; sucesso mantém o estado, erro reverte o card pra coluna original e mostra um toast de erro. Não espera o `PATCH` responder antes de mover o card visualmente. |
| 6 | Mudança de stage — ação "Mover para..." | O card e o Side Panel oferecem a ação "Mover para..." (mecanismo visual pode diferir — no card pode ser um menu `⋯`, no Side Panel um `Select` mais evidente; não é necessariamente o mesmo componente nos dois lugares) com as 10 stages, a stage atual já selecionada/desabilitada como opção. Cobre mover várias colunas de distância sem arrastar. É a **única** forma de mudar stage no mobile, já que só uma coluna fica visível por vez. |
| 7 | Validação de transição | Nenhuma — qualquer stage → qualquer stage, exatamente como o backend permite. |
| 8 | Clique no card (fora do drag) | Abre um Side Panel (Sheet, mesmo padrão do Inbox) usando os dados já retornados pela listagem (`GET /api/opportunities` — **não** faz um `GET` individual da Opportunity, já que o endpoint de detalhe não é enriquecido e essa spec não pressupõe uma API que não exista). Mostra empresa/marca/contato, valor estimado, stage atual, e a mesma ação "Mover para...". Sem histórico de stage. |
| 9 | Ordem dos cards | Sem `sort_order`/posição no backend — a listagem continua determinística por `createdAt desc` (já o comportamento de `GET /api/opportunities`). Drag-and-drop muda **stage**, nunca a ordem manual dentro de uma coluna; após qualquer refetch, a ordem volta a ser `createdAt desc`. Não é um sistema de posicionamento persistente. |
| 10 | Novos componentes do Design System | Nenhum primitive novo é necessário (Sheet/Select/Card/Badge já existem). O único item novo desta implementação é a infraestrutura de drag-and-drop (`@dnd-kit/core`, instalado nesta implementação) — entra como parte da implementação do Pipeline, não como uma rodada separada do Design System. |

## 3. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, seguir para a UX Spec
do Proposal Builder.
