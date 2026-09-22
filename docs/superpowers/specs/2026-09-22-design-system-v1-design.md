# PublyFlow — Design System v1 Design Spec

Status: Approved for planning
Owner: Raphael Pacheco
Depends on: full backend (Milestone 1/2, Services & Rate Cards, Proposals, Backend Audit Fix
Wave, Creators List API) — all merged to `main`.
Blocks: Inbox UX Spec → Pipeline UX Spec → Proposal Builder UX Spec (in that order, each
starting only after the previous is approved).

## 1. Contexto

O backend está pronto para sustentar UI (auditoria de integração fechada, wave de correção
mergeada). O frontend hoje é o boilerplate padrão do `create-next-app` — Tailwind v4
configurado, mas nenhum componente, nenhuma lib de UI instalada, `globals.css`/`page.tsx`
intocados. Esta spec define a fundação visual e comportamental (Design System v1) que toda
tela do PublyFlow vai consumir, **antes** de qualquer tela ser desenhada ou implementada.

**Referências de produto deliberadamente combinadas:**
- **Attio** — referência principal de CRM moderno.
- **Linear** — referência principal de UX operacional.
- **Notion** — referência principal para experiências baseadas em blocos.
- **Stripe** — referência principal de consistência visual e design system.

**Objetivos de produto:**
- Parecer um SaaS premium e moderno de 2026.
- Transmitir confiança para creators, assessorias e marcas.
- Priorizar velocidade operacional acima de efeitos visuais.
- Alta densidade de informação sem parecer poluído.
- **Desktop-priority + responsive-by-design** (não "desktop-first depois responsivo", nem
  "mobile-first" — ver §4).
- Totalmente compatível com teclado e power users.

**Princípios:**
1. **Action-first UI** — toda tela responde rapidamente a uma pergunta operacional.
2. **Information density without clutter** — alta densidade, hierarquia visual clara.
3. **Fast paths everywhere** — ações frequentes exigem o menor número possível de cliques/toques.
4. **Consistent interaction patterns** — o mesmo padrão visual e comportamental se repete em
   todo o produto.
5. **Premium restraint** — poucas cores, poucas sombras, poucos ornamentos; a sofisticação vem
   da consistência.

**Fora de escopo desta spec (e desta primeira implementação):**
- Dark mode — capacidade futura planejada; a arquitetura de tokens (CSS variables) deve
  permitir sua introdução sem refatoração estrutural, mas não é implementado agora.
- "Todos os creators" no switcher — não há endpoint agregado no backend ainda (decisão já
  registrada na spec da Creators List API); switcher v1 trabalha só com um creator por vez.
- Qualquer UX específica de tela (Inbox, Pipeline, Proposal Builder, Opportunity Detail,
  Dashboard) — cada uma tem sua própria spec, na ordem: Inbox → Pipeline → Proposal Builder.
- Kanban Board completo, DataTable avançado, Rich Block Editor completo — os primitives que
  eles vão consumir entram nesta implementação; a UX e o comportamento completo desses
  componentes complexos são definidos quando a tela que os usa for especificada.

## 2. Decisões de Design

| # | Decisão | Resolução |
|---|---|---|
| 1 | Base técnica de componentes | shadcn/ui + Radix Primitives. Componentes copiados pro repositório (não é dependência de pacote), construídos sobre Radix (acessível, sem estilo próprio) + Tailwind. |
| 2 | Tema | Light mode único na v1. Tokens 100% via CSS variables, nomes neutros (`--background`, `--foreground`, `--card`, `--primary`, etc.), sem hardcode de cor em componentes. |
| 3 | Paleta | "Electric Editorial" (ver §5) — violeta elétrico como primary, magenta vívido como accent, neutros de alto contraste. Escolhida entre 3 opções visuais comparadas lado a lado. |
| 4 | Tipografia | Inter, pesos 400/500/600/700. Escala compacta (corpo em 13px) — ver §5. |
| 5 | Ícones | Lucide — pareamento padrão do shadcn/ui, estilo de linha fina consistente com Linear/Attio/Vercel. |
| 6 | Radius | sm 6px, md 8px, lg 12px. |
| 7 | Spacing | múltiplos de 4px. |
| 8 | Responsividade | Desktop-priority + responsive-by-design — ver §4. Breakpoints Tailwind padrão (`sm` 640, `md` 768, `lg` 1024, `xl` 1280); mobile/tablet/desktop são categorias conceituais de design (`<768`, `768–1023`, `≥1024`), não uma regra rígida de implementação. |
| 9 | Touch targets | Mínimo 44×44px para qualquer alvo tocável em mobile/tablet, independente do tamanho visual do elemento. |
| 10 | Contexto de creator | Creator Switcher no header contextual, tratado como contexto global da operação (não filtro local por tela). Sidebar permanece fixa e independente do creator — "Sidebar = área do produto, Creator Switcher = contexto atual de trabalho". Estado persiste durante a navegação. V1: só creator individual, sem "todos os creators" (sem endpoint agregado no backend). |
| 11 | Escopo de dados por creator | Inbox, Leads, Pipeline/Opportunities, Services e Rate Cards são filtrados pelo creator selecionado. Companies e Contacts são sempre organization-wide (não respeitam o switcher). Proposals derivam seu contexto das Opportunities do creator selecionado. Dashboard deve deixar explícito quais métricas são creator-scoped e quais são organization-wide (a definir na spec do Dashboard). |
| 12 | Drawer vs Modal | Drawer é o padrão preferido para fluxos operacionais. Modal fica reservado para confirmações e ações destrutivas — não para fluxos longos. |
| 13 | Command Palette | Presente desde a v1 (`⌘K`/`Ctrl+K` em desktop; trigger por ícone + sheet full-screen em mobile, já que não há teclado físico). |
| 14 | DataTable | TanStack Table como base. |
| 15 | Kanban / ordenação | dnd-kit como base para drag-and-drop. |
| 16 | Busca/comandos | cmdk como base do Command Palette. |
| 17 | Rich Block Editor | Deliberadamente simples no MVP — sem colaboração em tempo real, sem recursos avançados estilo Notion. Escopo completo definido na spec do Proposal Builder; esta implementação não o inclui. |

## 3. Paleta de Cores — "Electric Editorial"

Escolhida entre 3 opções comparadas visualmente (Warm Premium/Attio-leaning, Cool
Precision/Stripe-leaning, Electric Editorial/Linear-light-leaning), priorizando contraste
AA e uma relação violeta+magenta+neutros mais nítida que as alternativas.

| Token | Valor | Papel |
|---|---|---|
| `--background` | `#F4F4F6` | Fundo da aplicação |
| `--card` / `--surface` | `#FFFFFF` | Superfície de cards, painéis, tabelas |
| `--foreground` | `#08090A` | Texto principal |
| `--muted-foreground` | `#71717A` | Texto secundário/legenda |
| `--border` | `#E4E4E7` | Bordas, divisores |
| `--primary` | `#6E56CF` | Ações primárias, estado selecionado, foco |
| `--primary-foreground` | `#FFFFFF` | Texto/ícone sobre `--primary` |
| `--accent` | `#E93D82` | Destaque, badges de atenção, elementos de marca |
| `--accent-foreground` | `#FFFFFF` | Texto/ícone sobre `--accent` |
| `--success` | `#30A46C` | Estados de sucesso, status positivos |
| `--warning` | `#F5A623` | Estados de atenção |
| `--error` | `#E5484D` | Estados de erro, ações destrutivas |
| `--info` | `#0091FF` | Estados informativos |

Todos os nomes são neutros (não descrevem a cor em si), permitindo que dark mode futuro
redefina os valores sem tocar em nenhum componente.

## 4. Sistema Responsivo — Desktop-Priority + Responsive-by-Design

**Princípio:** desktop define a densidade e a experiência operacional principal; mobile é
considerado desde o primeiro componente, não uma redução do desktop. O objetivo é preservar
as mesmas capacidades de negócio em qualquer dispositivo, adaptando apresentação, navegação e
interação — não replicar densidade/capacidade visual idêntica.

**Categorias de design** (convenção, não regra de implementação — a implementação usa os
breakpoints Tailwind normalmente): mobile `<768px`, tablet `768–1023px`, desktop `≥1024px`.

**Shell da aplicação:**

| Elemento | Desktop | Tablet | Mobile |
|---|---|---|---|
| Sidebar | Fixa, sempre visível | Fixa, colapsável para ícones | Drawer (off-canvas) |
| Header | Contextual + Creator Switcher completo | Igual desktop | Compacto |
| Command Palette | `⌘K`/`Ctrl+K`, overlay centralizado | Igual desktop | Trigger por ícone, sheet full-screen |
| Área principal | Largura confortável, múltiplas colunas quando fizer sentido | Reduz colunas | Coluna única |

**Regra por componente prioritário (fechada nesta spec, sem estratégia alternativa em
nenhum caso):**

- **DataTable**: desktop mostra as colunas relevantes; mobile prioriza campos essenciais + a
  ação principal, apresentando como lista de cards tocáveis com expansão/detalhe — nunca
  espreme todas as colunas.
- **Kanban Board**: desktop multi-coluna lado a lado; tablet reduz densidade/número de
  colunas visíveis conforme necessário; mobile usa **uma única estratégia**: uma coluna por
  vez, com navegação horizontal entre stages. Uma visão de lista agrupada por stage pode
  entrar futuramente como modo de visualização adicional — não faz parte da v1.
- **Side Panel**: desktop é painel lateral (conteúdo principal permanece visível ao lado);
  mobile vira Sheet full-screen (substitui a tela). O comportamento de foco, overlay e
  interação com o conteúdo subjacente deve ser definido explicitamente na implementação —
  não assumir que o padrão default do Radix Dialog já resolve isso corretamente para um
  painel não-modal.
- **Filters Bar**: desktop inline no topo da lista; mobile vira Drawer/Sheet de filtros
  acionado por botão.
- **Formulários**: desktop pode usar 2 colunas; mobile sempre colapsa para fluxo vertical de
  1 coluna.
- **Creator Switcher**: desktop no header completo (nome + avatar); mobile versão compacta
  (nome truncado/ícone).

## 5. Tipografia

Inter, pesos 400 (regular), 500 (medium), 600 (semibold), 700 (bold).

Escala compacta — o corpo padrão do produto é 13px, não 16px, seguindo a densidade que Linear
e Attio usam:

| Uso | Tamanho |
|---|---|
| Labels, badges, metadados | 12px |
| Corpo padrão (tabelas, listas, UI densa) | 13px |
| Corpo de leitura (descrições, textos longos) | 14px |
| Títulos de seção | 16–18px |
| Títulos de página | 20–24px |

## 6. Escopo de Implementação (Design System v1)

**Entra nesta implementação** (fundação + application shell, código real, não só spec):
- Tokens de cor, tipografia, spacing, radius via CSS variables, integrados ao Tailwind v4.
- Inter carregada e configurada como fonte padrão.
- Lucide configurado como biblioteca oficial de ícones.
- Primitives shadcn/ui: `Button`, `Badge`, `Input`, `Card`, `Dialog`, `Sheet`, `DropdownMenu`,
  `Popover`, `Table`.
- Application shell: Sidebar responsiva (fixa desktop/tablet, Drawer mobile), Header com
  Creator Switcher (usando `GET /api/creators`, já implementado), Command Palette básica
  (cmdk, `⌘K`/`Ctrl+K` desktop, trigger por ícone mobile).
- Comportamento responsivo do shell conforme §4.

**Não entra nesta implementação** (decisões prematuras seriam antecipação de UX ainda não
especificada):
- Kanban Board completo, DataTable avançado, Rich Block Editor completo — só os primitives
  que eles vão consumir (Table, drag-and-drop base) entram; comportamento e UX completos
  esperam a spec da tela que os usa.
- UX específica de Inbox, Pipeline, Opportunity Detail, Proposal Builder, Dashboard.

## 7. Próximo Passo

Gerar o plano de implementação em fases pequenas e verificáveis via skill `writing-plans`.
Depois de mergeado, seguir para a UX Spec do Inbox operacional da assessora.
