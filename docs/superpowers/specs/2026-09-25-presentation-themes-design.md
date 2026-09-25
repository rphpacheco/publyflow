# PublyFlow — Presentation Themes (V1) Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: Proposal Builder, Proposal Read APIs e Auth v1 (todos mergeados em `main`).
Blocks: Spec 2 — Envio e resposta da proposta (§6 traz as decisões já tomadas para ela).

## 1. Contexto

O campo `proposals.template` guarda um de seis valores (`PREMIUM`, `MINIMAL`, `EDITORIAL`, `FASHION`,
`BEAUTY`, `CORPORATE`), mas hoje não tem efeito visual nenhum: não existe renderização da proposta
fora do builder de formulário (spec do Proposal Builder, "Fora de escopo").

A prioridade atual é **enviar a proposta ao cliente**. Na conversa de design, o envio foi dividido em
duas specs:

1. **Presentation Themes (esta spec)** — o sistema visual que transforma a proposta em um documento
   apresentável, com 6 linguagens visuais, e uma pré-visualização para o creator.
2. **Envio e resposta** — link público, publicação de versão congelada, aceite/ajustes/recusa pelo
   cliente, automação do pipeline. Reusa o renderizador desta spec.

**Conceito.** O objetivo não é oferecer seis modelos de documento, e sim permitir que **a mesma
estrutura comercial assuma identidades visuais diferentes**. Por isso o conceito passa a se chamar
**Presentation Theme** (`theme`) em vez de `template`:

```
Proposal
 └── Presentation Theme
       ├── Premium
       ├── Minimal
       ├── Editorial
       ├── Fashion
       ├── Beauty
       └── Corporate
```

**Faseamento acordado:**
- **V1 (esta spec):** 6 temas realmente implementados sobre um sistema visual compartilhado. A única
  customização é a escolha do tema; o conteúdo (headline, texto, itens) já é editável no builder.
- **V1.1 (futura):** imagem de capa, logo, cor de destaque, eventualmente foto de fundo.
- **V2 (futura):** blocos adicionais (métricas, galeria, depoimentos, redes sociais), customização
  mais profunda, PDF.

**Fora de escopo desta spec:** tudo da Spec 2 (link público, status novos, respostas do cliente,
pipeline); customizações da V1.1; blocos da V2; PDF; histórico de versões na UI.

## 2. Direção visual dos temas

Aprovadas em mockup (companion visual, 2026-09-25). Cada tema define **composição, tipografia,
hierarquia, espaçamento, tratamento da capa, tabela de itens e estilo dos CTAs** — nunca estrutura
de conteúdo diferente.

| Tema (enum) | Rótulo na UI | Direção |
|---|---|---|
| `PREMIUM` | Premium | Fundo escuro (quase preto), serifa clássica (ex.: Cormorant Garamond), acento dourado, composição centralizada, filetes finos, muito respiro. CTA principal sólido dourado, secundários com contorno. |
| `MINIMAL` | Minimalista | Branco, sans-serif (ex.: Inter), alinhado à esquerda, hierarquia só por peso/tamanho, filetes cinza. CTA principal preto discreto, secundários como links. |
| `EDITORIAL` | Editorial | Papel off-white, serifa de display forte (ex.: Fraunces), cabeçalho tipo masthead, texto em duas colunas com capitular, itens numerados (01, 02…), acento vermelho. |
| `FASHION` | Moda | Alto contraste preto/branco, Didone em caixa-alta (ex.: Bodoni Moda), capa em bloco preto de largura total, itens em grade, CTAs retangulares em caixa-alta. |
| `BEAUTY` | Beleza | Fundo blush, cantos arredondados, serifa delicada (ex.: DM Serif Display) + sans, acento rosé, itens em cartões arredondados, CTAs em pílula. |
| `CORPORATE` | Corporativo | Barra institucional azul-marinho, linha de metadados (cliente, creator, data), tabela formal com cabeçalho, caixa de total, CTAs sóbrios. Sans técnica (ex.: IBM Plex Sans). |

As fontes citadas são as dos mockups aprovados; o plano pode trocar por equivalentes do Google Fonts
se houver motivo técnico, mantendo a direção.

## 3. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Renomeação | `template` → `theme` em todo o sistema. Migration **escrita à mão** (o `drizzle-kit generate` pergunta interativamente em renomeações): `ALTER TYPE proposal_template RENAME TO proposal_theme` e `ALTER TABLE proposals RENAME COLUMN template TO theme`. Sem perda de dados. API (`POST /api/proposals`, `PATCH /api/proposals/:id`), repository, services, hooks e UI passam a usar `theme`; `src/lib/proposal-templates.ts` vira `proposal-themes.ts` (`ProposalTheme`, `PROPOSAL_THEMES`, `PROPOSAL_THEME_LABELS`, mesmos rótulos em português). Rótulo do campo na UI: "Tema". Sem camada de compatibilidade na API (não há consumidor externo). |
| 2 | Snapshots antigos | `ProposalSnapshot.proposal` passa a ter `theme`. Snapshots já gravados em `proposal_versions` têm `template`; a leitura (em `buildPresentation`) aceita os dois (`theme ?? template`). Snapshots antigos não são reescritos. |
| 3 | Pipeline de renderização | `ProposalSnapshot` → `buildPresentation(snapshot, context)` → `PresentationModel` → `PresentationRenderer` (seções compartilhadas + tema). A mesma cadeia serve à pré-visualização (snapshot do rascunho atual) e, na Spec 2, à página pública (snapshot publicado). |
| 4 | `buildPresentation` | Função pura, sem I/O, em `src/lib/presentation/`. Entrada: o snapshot + `context { creator: { displayName, instagramHandle \| null }, client: { name \| null }, issuedAt }`. Saída (`PresentationModel`): `theme`, `title`, `headline` (headline do bloco COVER; se vazia, o título), `body` (texto do bloco TEXT; `null` se vazio), `creator { name, handle \| null }`, `clientName \| null`, `items[] { description, quantity, unitPriceCents, subtotalCents, unitPriceLabel, subtotalLabel }` na ordem de `sortOrder`, `totalCents`, `totalLabel`, `issuedAtLabel`. Valores formatados em BRL (`R$ 2.500,00` via `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`); data em `pt-BR`. `issuedAt` chega pronto no `context`: na pré-visualização, o servidor gera a data atual ao montar snapshot/contexto (`now → snapshot/context → buildPresentation()`); na Spec 2, é a data de publicação da versão. `buildPresentation()` **nunca** chama `new Date()` nem lê relógio/fuso da máquina — formata `issuedAt` em `pt-BR` com fuso fixo `America/Sao_Paulo`, para o resultado ser determinístico. |
| 5 | Cliente exibido | `clientName` = nome da marca da oportunidade, se houver; senão o nome da empresa; senão `null` (a capa omite a linha). |
| 6 | Renderizador | `src/components/presentation/`: `PresentationRenderer({ model, actions })` + seções compartilhadas (Cover, Text, Items, Total, Actions) + um arquivo por tema com a sua definição visual (tokens, classes, variante de itens: lista / tabela / grade / cartões, tratamento de capa e CTAs). Composições específicas (bloco preto do Fashion, barra do Corporate, masthead do Editorial) ficam dentro do tema. Registro tipado `THEMES: Record<ProposalTheme, ThemeDefinition>` — um tema faltando é erro de compilação. |
| 7 | Renderizador sem servidor | O renderizador é puramente de apresentação: não importa `@/db`, services, `next/headers` nem nada server-only, para poder rodar dentro de um Client Component (PreviewShell) e, na Spec 2, num Server Component (página pública). |
| 8 | Fontes | Carregadas com `next/font/google`, uma família por tema (exposta como CSS variable). Todas as 6 ficam disponíveis na pré-visualização para a troca de tema ser instantânea. |
| 9 | Ações no documento | A seção Actions recebe um slot `actions`. Nesta spec, a pré-visualização passa os três botões ("Aceitar", "Pedir ajustes", "Recusar") **inertes** (`aria-disabled`, sem handler), só para o creator ver a página completa. A Spec 2 liga os botões. |
| 10 | Conteúdo incompleto | Headline vazia → capa usa o título. Texto vazio → seção Text não renderiza. Sem itens → Items e Total não renderizam. **Nenhum aviso operacional dentro do documento**: o documento é sempre uma simulação limpa do que o cliente verá. |
| 11 | Responsividade | Todo tema funciona de 375px a desktop. No desktop o documento fica centralizado com largura máxima ≈ 880px e o fundo do tema ocupa a viewport. Sem rolagem horizontal em 375px. |
| 12 | Rota de pré-visualização | `/proposals/[id]/preview`, tela cheia, **sem App Shell**, num route group próprio `src/app/(preview)/`, protegido pelo **mesmo mecanismo do `(app)`, definido no Auth v1**: (a) sem usuário Supabase, o `src/proxy.ts` redireciona para `/login` antes da página rodar; (b) usuário Supabase autenticado mas sem acesso ao PublyFlow (`getSession()` nulo) vai para `/auth/signout?reason=no-access` → `/sem-acesso`. Para não duplicar essa regra, ela é extraída do layout `(app)` para um helper compartilhado (`requireAppSession()` em `src/lib/auth/`), usado pelos layouts `(app)` e `(preview)`. |
| 13 | Carregamento (servidor) | A página é Server Component. Chama um loader de servidor que busca a proposta por `id` **e** `organization_id = session.organizationId`, mais itens, blocos, oportunidade (empresa/marca) e creator. Não encontrou → `notFound()` (404), sem revelar que a proposta existe em outra organização. Com os dados, monta o `ProposalSnapshot` do rascunho atual (mesma forma de `ProposalVersionService`) e chama `buildPresentation`. |
| 14 | PreviewShell (cliente) | Client Component que recebe o `PresentationModel`, o tema salvo e o status. Contém a Toolbar, o seletor de tema, o toggle de viewport e o `PresentationRenderer`. A interatividade vive aqui; a rota continua Server Component para os dados. |
| 15 | Toolbar | Fora do documento, estilo neutro do app. Contém: "← Voltar ao editor" (para `/proposals/[id]`), seletor com os 6 temas (o salvo marcado "atual"), botão "Aplicar este tema" (só quando o tema visualizado ≠ salvo e a proposta não está arquivada), toggle Desktop / Celular, e o aviso "Adicione itens para mostrar valores" quando não há itens. |
| 16 | Troca de tema sem persistência | Escolher um tema atualiza `?theme=<tema>` na URL (sem recarregar dados) e re-renderiza com o novo tema sobre o mesmo `PresentationModel`. Não chama a API — cada PATCH de proposta gera uma versão, e comparar temas não pode poluir o histórico. `?theme=` inválido é ignorado (usa o salvo). |
| 17 | Aplicar tema | "Aplicar este tema" usa a **mesma mutation do builder** (`useUpdateProposal(proposalId)` com `{ theme }`), mostra toast de sucesso, passa a marcar o tema como "atual" e remove `?theme=` da URL. Desde o Auth v1, o hook não recebe nem envia `organizationId`/`userId` e o `PATCH /api/proposals/:id` tira organização e usuário exclusivamente da sessão; a renomeação `template` → `theme` preserva isso (só o nome do campo do corpo muda). O loader da pré-visualização também usa só `session.organizationId`. |
| 18 | Viewport Celular | O modo Celular renderiza o documento dentro de uma moldura de 390px de largura (centralizada), para o creator ver como o cliente abre pelo WhatsApp. |
| 19 | Proposta arquivada | Pré-visualização funciona normalmente (troca de tema e viewport inclusive), mas sem "Aplicar este tema". |
| 20 | Builder | O Select "Template" vira "Tema" (mesmos 6 rótulos, continua gravando pelo PATCH como hoje). Botão "Pré-visualizar" ao lado abre `/proposals/[id]/preview`. |

## 4. Garantia do que o cliente vê

O preview desta spec usa o **rascunho atual**. Na Spec 2, o cliente usa o **snapshot publicado**.
Portanto a garantia arquitetural é:

> O cliente verá exatamente o snapshot que foi pré-visualizado no momento da publicação — não
> necessariamente o estado atual da proposta.

```
Versão 3 → Preview → Publicar → cliente vê V3
Creator edita → Versão 4 → Builder/Preview mostram V4
Cliente continua vendo V3 até um novo envio/publicação
```

Isso é garantido por construção: pré-visualização e página pública passam pelo mesmo
`buildPresentation` + `PresentationRenderer`, mudando só a origem do snapshot.

## 5. Testes e verificação

**Automatizados:**
- `buildPresentation` (unidade, função pura): soma de subtotais e total em centavos; formatação BRL;
  headline vazia → título; marca > empresa > `null`; creator sem `@`; snapshot antigo com
  `template`; texto vazio → `body: null`; sem itens → `items: []`, total 0; ordem por `sortOrder`;
  `issuedAtLabel` vem só do `context` (mesma entrada → mesma saída, sem depender do relógio).
- `requireAppSession()`: sessão válida → devolve a sessão; sessão nula → redireciona para
  `/auth/signout?reason=no-access`. Layout `(app)` continua com o mesmo comportamento.
- Registro de temas: todo valor de `PROPOSAL_THEMES` tem definição em `THEMES`.
- `PresentationRenderer`, parametrizado sobre os 6 temas: renderiza headline, cada descrição de item
  e o total; oculta Items/Total sem itens; oculta Text sem body; os três botões aparecem com
  `aria-disabled`.
- `PreviewShell`: trocar tema atualiza `?theme=` e o tema renderizado sem chamar a API; "Aplicar
  este tema" só aparece com tema ≠ salvo e status ≠ `ARCHIVED`; clicar chama a mutation com
  `{ theme }`; modo Celular aplica a moldura de 390px; aviso "Adicione itens…" aparece na toolbar
  (não no documento) sem itens.
- Loader de servidor (contra o banco de teste real): devolve os dados da proposta da organização;
  devolve `null` para proposta de outra organização e para id inexistente.
- Renomeação: testes existentes de repository/service/rotas/hooks/componentes ajustados para
  `theme` continuam passando (criar, ler e atualizar tema).
- Builder: select "Tema" grava via PATCH; botão "Pré-visualizar" aponta para a rota de preview.

**Verificação visual (antes da revisão final, no navegador):**
- Capturas dos 6 temas em 1280px e 390px, com a proposta de demonstração.
- Conteúdo de estresse: headline longa, 8 itens com descrições longas, valores altos (≥ R$ 100.000).
- Critérios: sem rolagem horizontal em 375px, texto legível, total sempre visível, nada cortado.

## 6. Insumos para a Spec 2 — Envio e resposta (decisões já tomadas)

Registradas aqui para não se perderem; a Spec 2 fará o próprio brainstorming a partir delas.

- **Núcleo:** link público + resposta do cliente. O creator gera o link e o envia pelo canal que já
  usa (WhatsApp, DM, e-mail próprio). Sem envio de e-mail pelo PublyFlow nesta fase. Rastreio de
  visualização e PDF ficam para depois.
- **Edição pós-envio:** o link mostra o snapshot congelado da versão publicada. O creator continua
  editando o rascunho; só "Reenviar" publica uma nova versão (mesmo link). Cada resposta fica
  atrelada à versão exata que o cliente viu.
- **Status da proposta:** novos `SENT`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED` (além de
  `DRAFT`, `ARCHIVED`).
- **Ações do cliente (sem login), todas vinculadas à versão publicada:**
  - Aceitar → pede nome e e-mail; registra `proposal_id`, `version_number`, nome, e-mail,
    `accepted_at`; status `APPROVED`.
  - Pedir ajustes → pede nome, e-mail e mensagem; registra também `message`, `requested_at`;
    status `CHANGES_REQUESTED`.
  - Recusar → pede nome, e-mail e motivo opcional; status `REJECTED`.
- **Pipeline automático:** envio → `PROPOSTA_ENVIADA`; pedido de ajustes → `NEGOCIACAO`;
  aprovada → `FECHADO`; recusada → `PERDIDO` (o creator pode reabrir movendo no pipeline).
- **Aviso ao creator:** só dentro do app (status da proposta, badge no builder e no painel da
  oportunidade, oportunidade movida no pipeline, resposta com quem/quando/mensagem no builder).

**Notas da revisão final da V1 para a Spec 2:**
- **Congelar o contexto na publicação.** Nome/@ do creator, nome do cliente e `issuedAt` hoje entram
  via `context`, carregados ao vivo. Na página pública, persistir esse contexto junto com a versão
  publicada (ou o `PresentationModel` construído); senão, renomear creator/marca depois de enviar
  mudaria o que o cliente vê, quebrando a garantia do §4.
- **Validar o snapshot salvo.** `proposal_versions.snapshot_json` é `jsonb` sem tipo; validar (ex.:
  zod) para `PresentationSnapshotInput` em vez de cast — linhas antigas têm `template`.
- **Ações do cliente.** O renderer expõe `onAction?: (action) => void` (não um slot `actions`);
  funções não atravessam de Server Component, então a página pública precisa de um wrapper cliente
  fino (como o `PreviewShell`) para ligar Aceitar / Pedir ajustes / Recusar aos diálogos.
- **Deploy da V1:** a migration 0016 (rename) e o código precisam subir juntos; rollback é o par
  inverso de `RENAME`s.

## 7. Próximo Passo

Gerar o plano de implementação via `writing-plans`.
