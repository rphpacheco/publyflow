# Papel CREATOR — permissões (spec B de A→B→C→D)

**Status:** Aprovado para planejamento (2026-09-29)
**Sequência:**
- A (feita): cadastro de creator.
- **B (esta):** o que um usuário com papel CREATOR vê e faz.
- C: convite, isto é, criar o vínculo `CREATOR` e o link de login.
- D: aprovação do creator antes do envio da proposta, um recurso novo.

Esta spec **não** cria acesso para ninguém: prepara o app para que, quando C existir, um creator logado veja e faça só o permitido.

## 1. Problema

`Session` já carrega `role` (OWNER | MANAGER | CREATOR), mas só `POST` e `PATCH` de `/api/creators` o respeitam. Hoje um CREATOR logado:
- vê e edita tudo da organização, trocando o creator no seletor ou o `creatorId` na URL;
- recebe as notificações de todos os creators.

O comportamento combinado para o CREATOR é **ler tudo o que é dele e editar pouco**.

## 2. Regras de produto

| Área | CREATOR pode | CREATOR não pode |
|---|---|---|
| Inbox | ver as próprias demandas; **registrar mensagem** (Nova Mensagem) | converter, descartar, marcar falso positivo |
| Pipeline | ver as próprias oportunidades e propostas | mover etapa, criar proposta |
| Proposta | ver a apresentação, o status e o histórico; **compartilhar o link** (Copiar link, WhatsApp, E-mail, Copiar mensagem) de uma proposta já enviada | editar, enviar, reenviar, arquivar |
| Notificações | ver e marcar como lidas as notificações das **próprias** propostas | receber as de outros creators |
| Cadastros da organização | nada | creators, empresas, contatos, marcas, leads, rate cards, serviços |

## 3. Arquitetura (Abordagem A com defesa em camadas)

### 3.1 Sessão
- `Session` ganha `creatorId: string | null`.
- Para CREATOR, é o `creators.id` cujo `user_id = session.userId` na organização da sessão.
- Para OWNER e MANAGER, é sempre `null`.
- Em `resolveSessionForAuthUser`, um membro CREATOR sem registro de creator na organização **não recebe sessão** (`null`).

### 3.2 Helpers de acesso (`src/lib/auth/access.ts`)
- `creatorScope(session): string | null`: devolve `session.creatorId` quando o papel é CREATOR e `null` (sem restrição) nos outros casos.
- `isCreator(session): boolean`.
- `denyCreatorWrite(session): NextResponse | null`: devolve `forbiddenResponse()` para CREATOR e `null` para os demais. Toda rota de escrita o chama logo depois da sessão e do guard de UUID.
- `canManageOrganization(role)`: true para OWNER e MANAGER. Substitui `canManageCreators` e passa a valer para o CRM da organização.

### 3.3 Escopo nos repositórios críticos
Métodos de leitura destes repositórios aceitam `creatorScope: string | null`. Com um valor, a consulta SQL filtra pelo creator.

- **Oportunidades:** listagem e busca por id filtram por `opportunities.creator_id`.
- **Propostas e derivados** (proposta, versões, publicações e respostas, blocos, itens, send-state, share-info):
  - filtram por `proposals.opportunity_id` → `opportunities.creator_id`;
  - o dono é **sempre derivado da oportunidade**, por um único ponto: `ProposalsRepository.creatorIdForProposal(tx, orgId, proposalId): Promise<string | null>`;
  - blocos e itens resolvem a proposta e, a partir dela, a oportunidade.
- **Demandas comerciais e Inbox:** filtram por `commercial_inquiries.creator_id`. Antes da conversão ainda não existe oportunidade.

Os serviços repassam o escopo. As rotas continuam checando, e o filtro no repositório é a segunda camada.

### 3.4 Regras por rota

**Escrita:** 403 `{ "error": "Sem permissão." }` para CREATOR em todo POST/PATCH/PUT/DELETE, **exceto**:
- `POST /api/inbox/messages`: permitido. Para CREATOR, o `creatorId` do corpo é **ignorado** e vale `session.creatorId`.
- `PATCH /api/notifications/[id]` e `POST /api/notifications/read-all`: permitidos, porque já afetam só as notificações do próprio usuário.

**Leitura por creator:**
- `GET /api/commercial-inquiries` e `GET /api/opportunities`: para CREATOR, o `creatorId` da query é substituído por `session.creatorId`.

**Leitura por id:** um registro de outro creator dá **404**, com o mesmo corpo de "não encontrado" da rota. Vale para:
- `GET /api/opportunities/[id]`;
- `GET /api/proposals/[id]`, `.../blocks`, `.../items`, `.../versions`, `.../send-state`, `.../share-info`;
- `GET /api/proposals/[id]/publications` (histórico).

**Organização:** `GET` de `companies`, `companies/[id]`, `contacts`, `contacts/[id]`, `brands`, `leads`, `leads/[id]`, `rate-cards`, `rate-card-items` e `services` dão **403** para CREATOR.

**`GET /api/creators`:** para CREATOR, devolve só o próprio creator, sem e-mail: `[{ id, displayName, instagramHandle }]`. OWNER e MANAGER continuam recebendo a lista completa com e-mail.

**Preview:** a página `/proposals/[id]/preview` aplica o escopo; se falhar, `notFound()`.

**Ordem de checagem em toda rota:** sessão (401) → `isUuid` (404) → escrita de CREATOR (403) → escopo (404 ou 403) → corpo (400) → o resto.

### 3.5 Notificações
- O disparo de `proposal.approved`, `proposal.changes_requested` e `proposal.rejected` cria uma linha para cada membro OWNER e MANAGER.
- Para membros CREATOR, só cria linha quando `creators.user_id` do membro é o dono da oportunidade da proposta, resolvido por `creatorIdForProposal`.
- A leitura das notificações já é filtrada por usuário e não muda.

## 4. Interface

### 4.1 Layout e navegação
- **Layout** (`src/app/(app)/layout.tsx):**
  - passa ao cliente só `{ id, displayName }` de cada creator. Para CREATOR, só o próprio;
  - passa o papel por um contexto novo `SessionRoleProvider` / `useSessionRole()`, com os valores `"OWNER" | "MANAGER" | "CREATOR"`.
- **Sidebar do CREATOR:** Inbox, Pipeline e Proposals. Creators, Companies, Contacts e Dashboard ficam ocultos.
- **Seletor do header:** para CREATOR, vira o texto fixo com o próprio `displayName`, sem menu.

### 4.2 Telas
- **Inbox:**
  - o botão "Nova Mensagem" continua;
  - no detalhe da demanda, os botões Converter em Opportunity, Descartar e Falso positivo ficam ocultos para CREATOR;
  - a demanda aparece só para leitura (mensagem e dados extraídos).
- **Pipeline:**
  - não há arrastar-e-soltar;
  - no painel lateral, o seletor de etapa fica desabilitado e o botão "Nova Proposta" oculto;
  - as propostas listadas abrem `/proposals/[id]`.
- **Proposta `/proposals/[id]`:** para CREATOR, no lugar do editor, uma **tela de leitura**:
  1. o título e o status da proposta;
  2. a apresentação da última versão, com o mesmo renderizador do preview;
  3. o histórico de envios e respostas (componente existente);
  4. se houver um link público ativo, os botões Copiar link, Abrir e `ProposalShareActions` (WhatsApp, E-mail, Copiar mensagem), sem Enviar nem Reenviar.
- **`/creators`:** CREATOR que abre a URL é redirecionado para `/pipeline`.
- **Formulário de creator:** um erro sem `errors` por campo (403, 404, 5xx) aparece como mensagem geral do formulário, com `role="alert"` e o texto de `error.message`, e não mais embaixo do E-mail. O 409 continua embaixo do E-mail.

## 5. Testes

- **Sessão:**
  - CREATOR com creator: `creatorId` preenchido;
  - CREATOR sem creator: sem sessão;
  - OWNER e MANAGER: `creatorId: null`.
- **Repositórios:** com `creatorScope`, oportunidades, propostas (e derivados) e demandas de outro creator não aparecem na lista nem na busca por id. `creatorIdForProposal` resolve pela oportunidade.
- **Rotas:** uma **tabela única de rota × método** com sessão CREATOR do creator X e registros do creator Y. O resultado esperado é:
  - 403 nas escritas não liberadas e no CRM;
  - 404 nos registros de Y;
  - 200 nos registros de X;
  - `POST /api/inbox/messages` com o `creatorId` de Y cria a demanda para X;
  - as notificações continuam funcionando.

  OWNER continua com acesso total (os testes existentes seguem passando).
- **Notificações:** a resposta a uma proposta do creator Y não gera notificação para o membro CREATOR X, mas gera para OWNER e MANAGER e para o CREATOR Y.
- **Interface:**
  - sidebar e seletor do CREATOR;
  - Inbox sem as ações de demanda;
  - Pipeline sem o arrastar, com a etapa desabilitada e sem "Nova Proposta";
  - tela de leitura da proposta, com compartilhar e sem Enviar;
  - redirecionamento de `/creators`;
  - mensagem geral de 403 no formulário.

## 6. Fora de escopo
- Convite e criação do vínculo `CREATOR` (spec C).
- Aprovação do creator antes do envio (spec D).
- RLS por creator no Postgres (subprojeto 4 do Auth).
- Telas de Companies, Contacts e Dashboard.
- Troca de organização para usuários em várias organizações (anotado para a spec C).
