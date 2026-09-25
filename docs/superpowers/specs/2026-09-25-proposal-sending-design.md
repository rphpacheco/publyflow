# PublyFlow — Envio e Resposta da Proposta (Spec 2) Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Presentation Themes V1 (`2026-09-25-presentation-themes-design.md`, mergeado em `main`),
Auth v1.
Insumos: §6 da spec de Presentation Themes (decisões de produto já tomadas e notas da revisão final).

## 1. Contexto e escopo

O creator precisa enviar a proposta ao cliente e receber uma resposta. A V1 de temas já entrega a
renderização (`buildPresentation` + `PresentationRenderer`) e a pré-visualização autenticada. Esta
spec entrega:

- um **link público** por proposta (`/p/<token>`), que o creator envia pelo canal que já usa
  (WhatsApp, DM, e-mail próprio) — o PublyFlow não envia e-mail;
- **publicação de versões congeladas**: o cliente sempre vê exatamente o documento enviado;
- **resposta do cliente sem login**: Aceitar, Pedir ajustes ou Recusar, sempre com nome e e-mail;
- **status comercial** da proposta e **automação do pipeline**;
- no builder: painel de envio, histórico de envios e respostas, badges.

**Fora de escopo (V1):** rastreio de visualização; PDF; e-mail enviado pelo PublyFlow; rate limit;
revogar/regenerar o link; validade do link; reabrir para resposta sem editar; conversa/comentários
com o cliente; assinatura eletrônica; múltiplos destinatários; avisos fora do app.

## 2. Princípios e invariantes

Estas regras atravessam todas as partes; nenhuma simplificação da máquina de estados pode violá-las.

- **`ProposalVersion` é o documento.** Toda edição de conteúdo já gera uma versão imutável.
- **`ProposalPublication` é o documento efetivamente enviado**: aponta para uma versão e guarda o
  contexto congelado (creator, cliente, data de emissão).
- **`ProposalResponse` pertence a uma publication** — no máximo uma por publication.
- **Publications e responses são imutáveis** depois de criadas (sem caminho de update na aplicação;
  trigger no banco bloqueia `UPDATE`). Uma resposta nunca troca de publication.
- **`proposals.status` representa o estado comercial atual** (`DRAFT`, `SENT`, `CHANGES_REQUESTED`,
  `APPROVED`, `REJECTED`, `ARCHIVED`).
- **`hasUnsentChanges` representa a divergência entre o documento atual e o publicado**: é verdadeiro
  exatamente quando `latestVersion.versionNumber ≠ latestPublication.versionNumber`; sem nenhuma
  publicação, é verdadeiro. É independente do status comercial (`APPROVED` + alterações não enviadas
  é um estado válido e comum).
- **O token identifica a proposta pública, não uma versão.** O mesmo token aponta para publications
  sucessivas; a página pública sempre exibe a **publication mais recente**.
- **Respostas a publications que não são a mais recente recebem `SUPERSEDED`.**
- **Enviar e responder nunca criam versão.**

Invariantes verificáveis (testados ao fim de cada cenário de domínio):

1. `status ∈ {SENT, CHANGES_REQUESTED, APPROVED, REJECTED}` ⇒ existe publication.
2. `status = SENT` ⇒ a publication mais recente não tem response.
3. `status ∈ {CHANGES_REQUESTED, APPROVED, REJECTED}` ⇒ a publication mais recente tem response
   com a ação correspondente (`REQUEST_CHANGES`, `ACCEPT`, `REJECT`).
4. No momento do envio, `publication.versionNumber = última versão da proposta`; sempre
   `latestPublication.versionNumber ≤ última versão`.
5. Enviar e responder não alteram a contagem de versões.
6. Publications e responses existentes nunca mudam.

## 3. Parte 1 — Modelo de publicação e resposta

### 3.1 Dados (migration 0017)

- **`proposals.public_token`** — `text`, único, nullable. 32 bytes de `crypto.randomBytes` em
  base64url (43 caracteres). Criado no primeiro envio e reutilizado para sempre pela proposta.
- **Enum `proposal_status`** ganha `SENT`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED`.
- **`proposal_publications`**: `id` (uuid), `organization_id`, `proposal_id` (FK, cascade),
  `version_id` (FK para `proposal_versions`, restrict), `version_number` (int, desnormalizado para
  exibição), `context` (jsonb, not null), `published_by` (FK `users`), `published_at` (timestamptz).
  Índice por `(proposal_id, published_at desc)`.
- **`context`** congela, no momento do envio:
  `{ creator: { displayName, instagramHandle | null }, clientName | null, issuedAt }` (`issuedAt` =
  `published_at` em ISO-8601). Nome do cliente segue a regra da V1: marca > empresa > `null`.
- **`proposal_responses`**: `id`, `organization_id`, `publication_id` (FK, cascade, **único**),
  `action` (enum `proposal_response_action`: `ACCEPT`, `REQUEST_CHANGES`, `REJECT`),
  `respondent_name`, `respondent_email`, `message` (nullable), `responded_at`. Sem IP nem
  user-agent (evita coletar dado pessoal desnecessário).
- **Imutabilidade:** trigger `BEFORE UPDATE` nas duas tabelas levanta erro. `DELETE` só por cascade.
- **RLS:** as duas tabelas novas seguem o padrão de policies por organização das demais (políticas
  escritas à mão na migration, como nas anteriores).

### 3.2 Regras de status

| Ação | Permitida quando | Efeito |
|---|---|---|
| **Enviar / Reenviar** (creator) | `canSend` (§5.2) | Cria publication com a **última versão** e o contexto congelado; gera o token se faltar; status → `SENT`; oportunidade → `PROPOSTA_ENVIADA` (se aberta). |
| **Responder** (cliente) | status ∉ {`DRAFT`, `ARCHIVED`}; a publication respondida é a **mais recente** da proposta; ela ainda não tem response | Grava a response; status → `APPROVED` / `CHANGES_REQUESTED` / `REJECTED`; oportunidade → `FECHADO` / `NEGOCIACAO` / `PERDIDO` (se aberta). |
| **Arquivar** | qualquer status | status → `ARCHIVED`; link indisponível; publications intactas. |
| **Desarquivar** | status = `ARCHIVED` | status → `DRAFT`; link continua indisponível até novo envio. |

- **Status comercial só muda por esses caminhos.** `PATCH /api/proposals/:id` continua aceitando
  apenas `status: "DRAFT" | "ARCHIVED"`, com a regra nova: `DRAFT` só é aceito quando o status atual
  é `ARCHIVED` (desarquivar); caso contrário `409`. Assim o creator não "desenvia" uma proposta pelo
  PATCH.
- **Envio e resposta atualizam o status por um caminho próprio que não cria versão** (não passam por
  `ProposalService.update`, que gera snapshot em mudança de status).
- **Edição depois do envio** continua permitida (exceto `ARCHIVED`), não muda o status comercial e
  gera `hasUnsentChanges = true`.

### 3.3 Automação do pipeline

- Mapeamento: envio → `PROPOSTA_ENVIADA`; ajustes → `NEGOCIACAO`; aprovada → `FECHADO`;
  recusada → `PERDIDO`. Move para frente ou para trás (reenviar após ajustes volta para
  `PROPOSTA_ENVIADA`).
- **Oportunidade encerrada** (`FECHADO` ou `PERDIDO`): a automação não altera a etapa; só o status
  da proposta muda. Reabrir é decisão explícita do creator no pipeline.
- A mudança de etapa usa `OpportunitiesRepository.updateStageWithTx` **na mesma transação** do
  envio/resposta, registrando `opportunity_stage_history` (mesmo comportamento da mudança manual,
  inclusive no-op quando a etapa já é a mesma).

### 3.4 Concorrência

- Envio e resposta rodam em transação que trava a linha da proposta (`SELECT … FOR UPDATE`) antes de
  ler a publication mais recente.
- **Dois envios simultâneos** depois de uma edição: o primeiro cria a publication (`201`,
  `created: true`); o segundo, ao obter a trava, encontra a última versão já publicada e devolve a
  publication existente (`200`, `created: false`). É idempotência sob concorrência, não erro.
- **Duas respostas simultâneas** à mesma publication: exatamente uma entra; a outra recebe
  `409 ALREADY_RESPONDED` (garantido pela unicidade de `publication_id` além da trava).

## 4. Parte 2 — Página pública

### 4.1 Rota e cabeçalhos

- `/p/[token]`, em route group próprio `src/app/(public)/`, cujo layout só aplica as variáveis de
  fonte dos temas (`presentationFontVariables`); sem sessão, sem App Shell.
- `/p` entra em `isPublicPath` (`src/lib/auth/public-paths.ts`) para o proxy não redirecionar a
  `/login`.
- `export const dynamic = "force-dynamic"`; nada é cacheado (o estado muda quando o cliente responde).
  A resposta HTML da página também sai com `Cache-Control: private, no-store` (configurado em
  `next.config.ts` `headers()` para `/p/:path*`), para caches intermediários não guardarem a página.
- Metadata: `robots: { index: false, follow: false }`, `referrer: "no-referrer"` (o token não vaza
  via Referer). Título da aba: o título da proposta publicada; página indisponível usa "PublyFlow".

### 4.2 Leitura por token — `PublicProposalService.loadByToken(db, token)`

1. Formato do token validado antes de qualquer consulta (43 caracteres `[A-Za-z0-9_-]`); inválido →
   `not_found`.
2. Busca a proposta por `public_token`. **Único caminho de leitura sem organização de sessão**:
   a organização é derivada da proposta encontrada e o restante roda em `runInTenantContext` com
   ela. Comentário no código registra que o subprojeto 4 (RLS) precisa dar a esta busca um caminho
   privilegiado explícito. Não encontrada → `not_found`.
3. Status `DRAFT` ou `ARCHIVED` → `unavailable` (sem título, valores ou nomes).
4. Caso contrário: publication **mais recente** da proposta, snapshot da versão dela, response (se
   houver). Resultado `available` com `{ publicationId, versionNumber, publishedAt, snapshot,
   context, response }`.
5. **Validação com zod**: `snapshot_json` é validado por `presentationSnapshotSchema` (aceita
   `theme` ou o legado `template`) e `context` por `publicationContextSchema`. Dado inválido é erro
   de servidor logado (500), nunca uma página parcialmente renderizada.

Página: `not_found` → `notFound()`; `unavailable` → "Esta proposta não está mais disponível.";
`available` → `buildPresentation(snapshot, { creator: context.creator, client: { name:
context.clientName }, issuedAt: context.issuedAt })`, onde o loader já entrega `context.issuedAt`
normalizado como `Date` (o `publicationContextSchema` converte a string ISO); `buildPresentation()`
continua puro e não converte nada. O tema vem do snapshot publicado;
**nada é lido ao vivo** (renomear creator ou marca depois do envio não muda a página).

### 4.3 Renderizador e wrapper cliente

- `PresentationRenderer` ganha a prop opcional `response?: { action, respondentName,
  respondedAtLabel, message | null }`. Com `response`, a seção de ações exibe o resultado com a
  tipografia do tema no lugar dos botões:
  - "Proposta aceita por {nome} em {data}."
  - "Ajustes solicitados por {nome} em {data}." + a mensagem.
  - "Proposta recusada por {nome} em {data}." + o motivo, se houver.
- `PublicProposalView` (Client Component) recebe o modelo, o `publicationId`, o `versionNumber`, a
  data de envio e a response; quando não há response, passa `onAction` ao renderer, que abre um
  diálogo no estilo neutro do app:
  - **Aceitar**: Nome*, E-mail*; texto "Você está aceitando a versão {N} desta proposta, enviada em
    {data}."
  - **Pedir ajustes**: Nome*, E-mail*, Mensagem*.
  - **Recusar**: Nome*, E-mail*, Motivo (opcional).
  - Sucesso → `router.refresh()` (a página passa a exibir o resultado).

### 4.4 API pública — `POST /api/public/proposals/[token]/responses`

- Sem sessão. Corpo `{ publicationId, action, name, email, message? }` validado com zod: `name`
  1–120 caracteres (trim); `email` válido, até 254; `message` até 2000, **obrigatória** em
  `REQUEST_CHANGES`; `publicationId` uuid.
- Resolução **sempre dentro da cadeia token → proposta → publication**: a publication é procurada
  apenas entre as publications da proposta do token. Nunca há lookup global de publication.

| Situação | Resposta | Tela |
|---|---|---|
| Sucesso | `201 { response }` | refresh → resultado |
| Corpo inválido | `400 { errors }` | erros inline no diálogo |
| Token inválido/desconhecido | `404` | "Proposta não encontrada." |
| Proposta `DRAFT`/`ARCHIVED` | `410` | "Esta proposta não está mais disponível." |
| `publicationId` não é a mais recente da proposta — antiga, inexistente ou de outra proposta | `409 { code: "SUPERSEDED" }` | "Esta proposta foi atualizada. Recarregue para ver a versão atual." + botão **Recarregar** |
| Publication mais recente já respondida | `409 { code: "ALREADY_RESPONDED" }` | refresh → mostra a resposta registrada |

- Todas as respostas com `Cache-Control: no-store`.
- **Risco conhecido (sem rate limit na V1):** quem tiver o link pode consumir a única resposta
  disponível (link encaminhado, terceiro curioso). Mitigações: token de alta entropia; nome e e-mail
  de quem respondeu ficam visíveis ao creator; o creator abre nova rodada editando e reenviando.
  "Reabrir sem editar" e rate limit ficam para evolução futura.

## 5. Parte 3 — Experiência do creator e máquina de estados

### 5.1 Fonte única de verdade — `GET /api/proposals/[id]/send-state`

Calculado no servidor numa **única transação `REPEATABLE READ`** (proposta, última versão, última
publication e response do mesmo instante). Resposta:

```
{
  status,
  publicPath: "/p/<token>" | null,
  latestPublication: { id, versionNumber, publishedAt,
                       response: { action, respondentName, respondentEmail, message, respondedAt } | null } | null,
  latestVersionNumber,
  hasUnsentChanges,
  canSend
}
```

O frontend só renderiza este estado; não deduz nada. `canSend` informa a UI, mas **o `POST` é a
autoridade**: entre o GET e o POST outro usuário pode ter enviado.

Toda mutação de conteúdo ou status no builder invalida `proposalSendStateQueryKey(proposalId)`:
título, tema, capa, texto, itens (adicionar/editar/remover), arquivar, desarquivar, enviar.

### 5.2 `canSend` (decisão do service)

| status | Alterações não enviadas | canSend | UX |
|---|---|---|---|
| `DRAFT`, nunca publicada | — | ✅ | Enviar |
| `DRAFT`, desarquivada (tem publication) | — | ✅ | Reenviar |
| `SENT` | não | ❌ | "Nada mudou desde o envio" |
| `SENT` | sim | ✅ | Reenviar |
| `CHANGES_REQUESTED` | não | ❌ | "Edite a proposta e reenvie" |
| `CHANGES_REQUESTED` | sim | ✅ | Reenviar (sem confirmação — é o fluxo normal) |
| `APPROVED` | não | ❌ | — |
| `APPROVED` | sim | ✅ | Reenviar **com confirmação** |
| `REJECTED` | não | ❌ | — |
| `REJECTED` | sim | ✅ | Reenviar **com confirmação** |
| `ARCHIVED` | — | ❌ | painel oculto |

A confirmação de `APPROVED`/`REJECTED` é só UX ("Esta proposta já foi aceita/recusada. Reenviar abre
uma nova rodada e o status volta para Enviada."), não regra de autorização.

**Algoritmo do envio** (dentro da transação com trava): se status = `ARCHIVED` → `409 { code:
"PROPOSAL_ARCHIVED" }`; se status ≠ `DRAFT` e a última publication já é da última versão → devolve
a publication existente (`200`, `created: false`); senão cria nova publication da última versão
(`201`, `created: true`).

### 5.3 API do creator (com sessão, Auth v1)

- `POST /api/proposals/[id]/publications` → `{ publication, publicPath, created }`
  (`201`/`200`/`409`; `401` sem sessão; `404` proposta de outra organização).
- `GET /api/proposals/[id]/publications` → histórico (mais recente primeiro), cada item com a
  response.
- `GET /api/proposals/[id]/send-state` → §5.1.

### 5.4 Builder

- **Painel "Envio"** no topo, em dois blocos visualmente separados:
  - **Negociação**: badge do status + cartão da resposta mais recente (nome · e-mail · data/hora;
    mensagem ou motivo), ou "Aguardando resposta · versão N enviada em {data}".
  - **Documento**: "⚠ Alterações não enviadas — o cliente ainda vê a versão N." quando
    `hasUnsentChanges` e já houve envio.
  - Ações: **Enviar proposta** / **Reenviar**, **Copiar link**, **Abrir** (as duas últimas só com
    link disponível). Botão de envio desabilitado quando `!canSend`, com o motivo como dica.
  - `DRAFT` desarquivada: "O link está desativado até você reenviar."
- **Diálogo pós-envio**: link completo (`window.location.origin` + `publicPath`) com **Copiar link**
  e **Abrir**; texto "Envie este link ao cliente pelo canal que você já usa."
- **Histórico de envios** abaixo do painel: versão · data · resultado ("aguardando", "ajustes: …",
  "aceita por …", "recusada por …"). Publications antigas continuam visíveis para sempre.
- **Arquivar**: o diálogo ganha "O link público deixará de funcionar."; `ARCHIVED` oculta o painel e
  mantém o builder somente leitura (como hoje).
- **Badges** (rótulos): Rascunho, Enviada, Ajustes pedidos, Aceita, Recusada, Arquivada — no
  cabeçalho do builder e na lista de propostas do painel da oportunidade. O card do pipeline não
  muda (a etapa já reflete a automação).

## 6. Parte 4 — Testes

**Domínio (banco de teste real), com helper que verifica os 6 invariantes ao fim de cada cenário:**
- Enviar: primeiro envio cria token, publication com contexto congelado, status `SENT`, etapa
  `PROPOSTA_ENVIADA` + linha em `opportunity_stage_history`, sem versão nova; sem alterações →
  `created: false`; após edição → nova publication e a anterior preservada; `ARCHIVED` →
  `PROPOSAL_ARCHIVED`; oportunidade encerrada → etapa inalterada.
- Responder: as três ações → status e etapa corretos; oportunidade encerrada → etapa inalterada;
  segunda resposta → `ALREADY_RESPONDED`; sem versão nova.
- `SUPERSEDED`: publication antiga da mesma proposta; `publicationId` inexistente; `publicationId`
  de outra proposta — todos `SUPERSEDED`, sem lookup global.
- **Isolamento do token**: o token da proposta A nunca dá acesso a publication, snapshot ou response
  da proposta B; `token(A) + publicationId(B)` → `SUPERSEDED`, sem revelar que B existe.
- Concorrência: dois envios simultâneos após uma edição → exatamente uma publication, um `created:
  true` e um `created: false` apontando para a mesma; duas respostas simultâneas → exatamente uma.
- Imutabilidade: `UPDATE` direto em publication/response falha (trigger).
- PATCH de status: `DRAFT` só a partir de `ARCHIVED`; `SENT`/`CHANGES_REQUESTED`/`APPROVED`/
  `REJECTED` → `DRAFT` pelo PATCH → `409`.
- `send-state`: toda a tabela §5.2; `hasUnsentChanges` em cada transição.
- **Regressão aprovação → edição → reenvio**: V1 enviada e aceita; edição (V2) → `status =
  APPROVED`, `hasUnsentChanges = true`, `canSend = true`; reenvio → `status = SENT`,
  `hasUnsentChanges = false`, `latestPublication.versionNumber = V2`, publication(V1).response =
  `ACCEPT`, publication(V2).response = `null`.
- `loadByToken`: formato inválido e token desconhecido → `not_found`; `DRAFT`/`ARCHIVED` →
  `unavailable` sem conteúdo; snapshot legado com `template` válido; snapshot/contexto corrompido →
  erro; renomear creator/marca após o envio não altera o resultado.

**API:** rotas do creator (`401`, `404` outra organização, `409` arquivada, `201`/`200`);
rota pública sem sessão (`400` incluindo mensagem obrigatória em ajustes, `404`, `410`,
`409 SUPERSEDED`, `409 ALREADY_RESPONDED`, `201`, `Cache-Control: no-store`); proxy trata `/p/...`
como público.

**UI:** renderer com `response` mostra o resultado no lugar dos botões nos 6 temas;
`PublicProposalView` (campos obrigatórios por ação, cada código de erro → mensagem, refresh no
sucesso); painel de envio dirigido por fixtures de `send-state` cobrindo cada linha da §5.2,
confirmação só em `APPROVED`/`REJECTED`, separação Negociação/Documento; badges no builder e no
painel da oportunidade.

**Verificação visual (controller, navegador), desktop e celular:**
1. Criar/enviar V1. 2. Abrir `/p/<token>` numa aba sem sessão. 3. Pedir ajustes. 4. Confirmar
`CHANGES_REQUESTED` no builder. 5. Editar (V2). 6. Reenviar. 7. Na aba ainda em V1, tentar
responder → "proposta atualizada". 8. Recarregar o mesmo link → V2. 9. Aceitar V2.
10. Confirmar `APPROVED` + oportunidade `FECHADO`. 11. Arquivar. 12. O mesmo link fica
indisponível.

## 7. Próximo Passo

Gerar o plano de implementação via `writing-plans`.
