# PublyFlow — Inbox UX Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Design System v1, Commercial Inquiries Message Enrichment, Mark False Positive
Route, Ambiguous Party Guess Detection — all merged to `main`.
Blocks: Pipeline UX Spec (built next, informed by how the Inbox's conversion flow hands off to
Opportunities).

## 1. Contexto

Primeira das três telas prioritárias do PublyFlow (Inbox → Pipeline → Proposal Builder), na
ordem definida pelo fluxo operacional real do produto: Inbox → Inquiry → Lead → Opportunity.
Construída inteiramente sobre o Design System v1 (shadcn/ui + Radix, tokens "Electric
Editorial", shell com Sidebar/Header/Creator Switcher/Command Palette) e sobre o backend já
existente — nenhuma UX aqui pressupõe uma API que não exista.

**Contratos de backend consumidos** (todos já implementados e mergeados):
- `GET /api/commercial-inquiries?organizationId=&creatorId=&status=` → `CommercialInquiryWithMessage[]`
  (`status`: `NEW`/`DISCARDED`/`FALSE_POSITIVE`/`CONVERTED`; campos da IA: `companyGuess`,
  `brandGuess`, `contactNameGuess`, `budgetGuess`, `intentGuess`; campos da mensagem:
  `messageBody`, `messageReceivedAt`, `externalContactLabel`, `source`, `conversationId`).
- `POST /api/commercial-inquiries/[id]/convert` — corpo `{organizationId, contact: {id} |
  {fullName, email?, phone?}, companyId?, brandId?}` → `200` com `{inquiry, lead, opportunity}`,
  `404`/`409`/`422` mapeados.
- `POST /api/commercial-inquiries/[id]/discard` — corpo `{organizationId}` → `204`.
- `POST /api/commercial-inquiries/[id]/mark-false-positive` — corpo `{organizationId}` →
  `204`, `404`/`409` mapeados.
- `POST /api/inbox/messages` — corpo `{organizationId, creatorId, source, externalContactLabel,
  body}` → `201`, ingere e classifica via IA.
- `GET /api/companies?organizationId=` e `GET /api/contacts?organizationId=` — listas
  org-wide, usadas pelo Combobox de edição.

**Contexto de creator**: toda chamada é filtrada pelo creator selecionado no Creator Switcher
(header global) — a tela não tem seletor de creator próprio.

**Fora de escopo:**
- Kanban/Pipeline, Opportunity Detail, Proposal Builder — telas próprias, specs futuras.
- Integração real com Instagram/WhatsApp/TikTok — só ingestão manual via `POST /api/inbox/messages`.
- Busca/filtro por texto na lista (além dos filtros de status por tab).
- Paginação — nenhuma lista deste projeto pagina; `GET /api/commercial-inquiries` retorna a
  lista completa por creator+status.
- Histórico completo de conversa (múltiplas mensagens) — só a mensagem disparadora da
  inquiry é mostrada (decisão já registrada na spec de enriquecimento; `conversationId` fica
  disponível para quando isso for endereçado).
- Fuzzy-matching de nomes de empresa/marca no Combobox — busca é por substring simples sobre
  as listas já carregadas.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Layout | Lista + Side Panel (Sheet full-screen em mobile, painel lateral em desktop/tablet — padrão já definido pelo Design System). |
| 2 | Organização por status | Tabs no topo: "Novas" (NEW, padrão), "Convertidas" (CONVERTED), "Descartadas" (DISCARDED), "Falsos Positivos" (FALSE_POSITIVE). Cada tab dispara `GET` com o `status` correspondente. |
| 3 | Colunas da lista | Remetente (`externalContactLabel`), Empresa/Marca (`companyGuess`/`brandGuess`), trecho da mensagem (`messageBody` truncado), canal (`source`, ícone), recebido (`messageReceivedAt`, tempo relativo). |
| 4 | Conteúdo do Side Panel | Mensagem completa, remetente/canal/horário, e os campos adivinhados pela IA (`companyGuess`, `brandGuess`, `contactNameGuess`, `budgetGuess`, `intentGuess`) como referência. |
| 5 | Ações no Side Panel | "Converter em Opportunity" em destaque (primary) + "Descartar" e "Falso Positivo" secundários (outline/ghost), lado a lado — nenhuma escondida atrás de menu. |
| 6 | Conversão em 1 clique | `companyId`/`brandId` podem ser omitidos no fluxo de 1 clique; o backend resolve os guesses de forma segura, reutilizando correspondências inequívocas e criando apenas quando não houver correspondência (nunca escolhendo arbitrariamente entre múltiplas correspondências). |
| 7 | Resposta a ambiguidade (422) | Se `/convert` retornar `422` (`AmbiguousPartyGuessError`), a UI cai automaticamente no modo de edição (não mostra um erro genérico) com uma mensagem clara, ex: "Mais de uma empresa encontrada com esse nome — selecione a correta." |
| 8 | Modo de edição | Combobox (cmdk + Popover) para Contact (busca em `/api/contacts`) e Company/Brand (busca em `/api/companies`), com opção de criar novo digitando um nome sem correspondência. Campos de email/telefone opcionais aparecem só ao criar um contact novo. |
| 9 | Pós-ação | Linha some da lista (a tab ativa só mostra o status dela), Side Panel fecha, toast confirma a ação. |
| 10 | Nova Mensagem | Botão no header do Inbox abre Sheet com creator (fixo, do Creator Switcher), canal (Select), remetente (Input), mensagem (Textarea) → `POST /api/inbox/messages`. Lista refetch após sucesso. |
| 11 | Atalhos de teclado | `j`/`k` navegam linhas da lista; `C`/`D`/`F` disparam Converter/Descartar/Falso Positivo na linha selecionada; `Esc` fecha o Side Panel. `⌘K`/`Ctrl+K` já é o Command Palette global do shell. |
| 12 | Empty State | Quando a tab ativa não tem itens: ícone + texto; na tab "Novas", inclui CTA "Nova Mensagem". |

## 3. Novos Componentes do Design System

Nenhum existia antes desta spec — entram como parte da implementação do Inbox, não como uma
nova rodada isolada do Design System (são consumidos por esta tela especificamente, não por
uma fundação genérica ainda sem uso):

- **Toast** (sonner — já é o padrão de fato do ecossistema shadcn, construído para se integrar
  bem com Radix/Tailwind).
- **Empty State** — componente simples (ícone + texto + CTA opcional), já estava na lista
  original de "componentes prioritários" do Design System, nunca implementado até agora.
- **Combobox** — Popover (já existe) + cmdk (já instalado desde o Command Palette), busca
  client-side por substring sobre uma lista já carregada.
- **Select** — Radix Select, para o campo de canal no formulário de Nova Mensagem.
- **Textarea** — variante do Input para texto longo.

## 4. Próximo Passo

Gerar o plano de implementação via `writing-plans`. Depois de mergeado, seguir para a UX Spec
do Pipeline.
