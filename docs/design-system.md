# Selene — Design System & Padrões de UI

> Documento de referência para manter consistência visual em todo o sistema.
> Sempre consulte antes de criar novos componentes ou páginas.

---

## Tabelas (`components/ui/table.tsx`)

O componente global fica em `apps/web/components/ui/table.tsx`.
**Nunca sobrescrever esses estilos diretamente nas páginas.**

| Elemento | Classe Tailwind | Valor efetivo |
|---|---|---|
| Cabeçalho `<th>` | `text-[11px] font-semibold tracking-wider uppercase text-muted-foreground` | **11 px** |
| Célula `<td>` | `text-sm text-foreground` | **14 px** |
| Padding cabeçalho | `px-4 py-3` | — |
| Padding célula | `px-4 py-3.5` | — |
| Fundo cabeçalho | `bg-muted/30` | — |
| Hover linha | `hover:bg-muted/30` | cursor-pointer quando `onRowClick` presente |
| Separador linha | `border-b border-border/50` | — |
| Skeleton loading | `h-12 bg-muted/50 animate-pulse` | 5 linhas por padrão |

### Badges dentro de células

```
text-xs font-medium px-2 py-0.5 rounded-full border
```

Paleta padrão de situações:
- **ATIVA / sucesso** → `bg-emerald-50 text-emerald-700 border-emerald-200`
- **INAPTA / erro** → `bg-red-50 text-red-700 border-red-200`
- **SUSPENSA / aviso** → `bg-amber-50 text-amber-700 border-amber-200`
- **Neutro** → `bg-muted text-muted-foreground border-border`

### Valores mono (CNPJ, CEP, datas)

```
font-mono text-xs
```

---

## Formulários

Helper `FormField` (inline em páginas, candidato a extração):

```tsx
// Label
text-xs font-medium text-muted-foreground mb-1

// Input / Select
rounded-lg border border-input bg-background px-3 py-1.5 text-sm
focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-colors

// Textarea
(igual ao input) + resize-none
```

Grid padrão do formulário de empresa (referência):

| Linha | Layout |
|---|---|
| Razão Social \| Nome Fantasia | `grid-cols-3` — 2+1 |
| E-mail \| Telefone \| Situação | `grid-cols-3` |
| Logradouro \| Número \| Complemento | `grid-cols-6` — 3+2+1 |
| CEP \| Bairro \| Município \| UF | `grid-cols-8` — 2+2+3+1 |
| Campos fiscais (3 por linha) | `grid-cols-3` |
| CNAE Principal | largura total |
| CNAE Secundário \| Quadro Societário | `grid-cols-2` lado a lado |

---

## Modais de visualização (somente leitura)

Helper `Field`:

```tsx
// Label
text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5

// Valor texto normal
text-sm font-medium text-foreground

// Valor mono (CNPJ, CEP...)
text-sm font-mono text-foreground

// Box para texto longo (CNAEs, quadro societário)
bg-muted/40 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed
```

Cabeçalho do modal de detalhe:
```
-mx-6 -mt-4 px-6 pt-5 pb-5 mb-4
bg-gradient-to-br from-primary/8 via-primary/5 to-transparent
border-b border-border/50
```

---

## Tipografia geral

| Uso | Classe |
|---|---|
| Título de página (h1) | `text-xl font-bold text-foreground` |
| Subtítulo / seção de modal | `text-[11px] font-bold text-primary uppercase tracking-widest` |
| Texto corpo padrão | `text-sm text-foreground` |
| Texto secundário / helper | `text-xs text-muted-foreground` |
| Código / identificadores | `font-mono` |

---

## Ícones

Biblioteca: **@phosphor-icons/react v2.1.10**

Sempre usar o sufixo `Icon`:
```tsx
// ✅ correto
import { BuildingsIcon, PlusIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'

// ❌ deprecated
import { Buildings, Plus } from '@phosphor-icons/react'
```

Tamanhos padrão:
- Ícone em botão primário: `size={16}`
- Ícone em botão compacto / célula: `size={14}`
- Ícone decorativo pequeno: `size={12}`

---

## Botões

| Tipo | Classes |
|---|---|
| Primário | `bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all` |
| Secundário / outline | `border border-input text-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted transition-colors` |
| Compacto (dentro de modais) | substituir `py-2` → `py-1.5` |
| Desabilitado | `disabled:opacity-50` |

---

## Espaçamentos de modal

| Tamanho | Uso |
|---|---|
| `size="sm"` | confirmações simples |
| `size="lg"` | formulários médios |
| `size="3xl"` | formulários completos (empresa, contratos) |

Espaçamento interno do conteúdo: `space-y-2.5` com `gap-2.5` nos grids.
