# Registro de Alterações e Pendências - 21/04/2026

## Alterações realizadas

- Refatoração do backend (board.service.ts) para mover itens por posição da coluna, não mais por nome.
- Padronização visual dos cards do board: label "P" (pendência) laranja, "I" (iniciativa) roxo.
- Status "Em andamento" padronizado em todas as telas (board, pendências, iniciativas).
- Status final padronizado como "Concluída" (nunca mais "Encerrada") em todas as telas e filtros.
- Badges de status agora seguem o mesmo padrão visual em board, pendências e iniciativas.
- Ambiente local do frontend reiniciado e atualizado após cada alteração.

## Pendências

- Validar visual em todos os navegadores/dispositivos (cross-browser).
- Confirmar se há outros pontos no sistema exibindo status ou labels fora do padrão.
- Ajustar possíveis traduções ou labels em componentes reutilizáveis, caso necessário.
- Validar com usuários finais se a experiência está adequada após as mudanças.

---

Alterações e pendências salvas para continuidade após reinicialização do agente.
