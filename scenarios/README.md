# Cenários incrementais de Kanban

Este diretório é uma **especificação versionada**, não uma suíte executável pelo
Harness. `catalog.json` fixa sete tarefas independentes, cada uma começando no
commit anterior e buscando o comportamento do próximo. A implementação de
referência não precisa ser reproduzida linha por linha.

| Caso | Base | Referência | Incremento |
| --- | --- | --- | --- |
| C1 | `3d50910` | `2475d92` | Fundação standalone, iii, Compose e configuração |
| C2 | `2475d92` | `35a6999` | Persistência e identificadores |
| C3 | `35a6999` | `6f22064` | Board de cinco colunas |
| C4 | `6f22064` | `9a6dced` | Criação, detalhes e exclusão lógica |
| C5 | `9a6dced` | `c654557` | Edição parcial e drag-and-drop |
| C6 | `c654557` | `9a39938` | Comentários, respostas e timeline |
| C7 | `9a39938` | `f24040d` | Sincronização reativa |

A cadeia atual declara `config_name: kanban` no `worker-compose.yaml` desde C1, para que o
Compose nunca migre o id da configuração; a cadeia anterior (`6bfb939`..`573f523`) segue no
histórico para catálogos antigos. Os hashes completos no JSON são a fonte de verdade. O commit que introduz este
catálogo não é uma oitava tarefa de produto. Não reescrever os commits de referência.

## Verificação e prompt

Na raiz deste repositório, com Node >=22 e Git:

```bash
node scenarios/check.mjs
node scenarios/check.mjs --prompt kanban_c6_discussion
```

O primeiro comando verifica IDs, referências existentes e parentesco linear.
O segundo emite apenas as instruções e critérios públicos da tarefa, sem o hash
de referência. Não prepara sandbox, não executa o Harness e não mede desempenho.

## Unidade de execução

Cada caso começa com um snapshot limpo da sua base, não com o resultado produzido
pelo modelo no caso anterior. Isso permite comparar implementações da mesma tarefa
sem contaminação por falhas acumuladas. Uma campanha sequencial usando os patches
do modelo seria outro experimento e deve ter identidade e resultados separados.

Uma execução tem as seguintes etapas, sem fabricar divisões de tempo que o runner
não consiga observar:

1. **Preparação, fora do tempo do sujeito:** verificar isolamento, versões e
   recursos; materializar somente a base; preparar engine, portas e dados isolados.
2. **Planejamento:** pedir plano curto com riscos e estratégia de validação.
3. **Construção:** implementar o incremento e seus testes na mesma sessão.
4. **Teste:** sujeito executa seus checks e pode corrigir a implementação dentro
   do orçamento original. Depois, o avaliador executa checks independentes.
5. **Evolução:** a próxima transição do catálogo é uma nova execução independente.
   Não dar feedback dos testes privados ao sujeito na mesma amostra de one-shot.

O orçamento de tempo/tokens ainda deve ser calibrado em um piloto e congelado por
caso antes da comparação. Não inferir limites a partir das durações de autoria.

## Isolamento da referência

O avaliador recebe catálogo, commit-base e referência. O sujeito recebe apenas o
snapshot-base, o prompt emitido e a documentação pública congelada para o caso.

- Não entregar este diretório ao sujeito nem clonar o histórico completo e apenas
  fazer checkout da base: commits futuros ainda podem estar nos objetos do Git.
- Exportar a árvore da base e inicializar um Git novo dentro do sandbox, se o
  runner precisar de Git. Registrar o SHA original separadamente no controlador.
- Não compartilhar remotes, bundles, refs, objetos, patches de referência,
  capturas-resposta ou testes privados com o ambiente do sujeito.
- Validar que os recursos privados são realmente ilegíveis e que o sujeito não
  pode buscar o repositório completo pela rede. Falha de isolamento invalida a execução.
- Documentação/skills, quando fornecidas, devem ter versão e digest fixos. Os
  anexos usados na autoria não estão automaticamente presentes nos commits-base.
  Não modificar skills nem comparar com `tasklist/` nesta campanha.

## Avaliação

Os critérios públicos do JSON descrevem comportamento e contratos, não seletores
CSS, organização interna ou exigência de um patch idêntico. Testes privados devem
usar APIs e controles acessíveis sempre que possível, e não obrigar o sujeito a
reproduzir IDs de DOM escolhidos durante a autoria.

Para cada critério, guardar `passed`, `failed` ou `unverified`, mais evidência.
Um caso só passa quando todos os critérios obrigatórios e a regressão passam.
Separar avaliação funcional da avaliação visual; sem execução visual, o critério
visual fica não verificado, mesmo que tipagem e build passem.

Checks comuns: instalação com lockfile, tipagem, testes e build. C1 também avalia
a criação desses comandos. Os testes herdados da base cobrem regressão, mas os
testes escritos pelo sujeito não são prova independente de qualidade. Não copiar
cegamente testes internos da referência: podem acoplar a avaliação à solução.

Protocolo do avaliador a implementar:

- C1: engine + Compose + formulário real, configuração preservada e hot reload.
- C2: funções iii reais, reinício, stores distintos e tentativas de entrada inválida.
- C3: dados criados via iii, board vazio/populado, contadores e recuperação de erro.
- C4: criar/abrir/excluir pelo navegador, histórico, UTF-8 e retenção no disco.
- C5: editar/cancelar, arraste real, falha de gravação e navegação pendente.
- C6: comentar/responder, pais entre tickets, rascunhos e respostas fora de ordem.
- C7: três sessões, iii direto, rascunhos concorrentes, offline, reconexão,
  reinício com SSE aberto, exclusão remota e troca de armazenamento.

Para UI, fixar versão do navegador, dados, timezone/locale e viewports (por exemplo
1440×1000 e 390×900), capturar evidência e conferir legibilidade, overflow, foco e
fluxos. Não usar igualdade de pixels como substituto da avaliação funcional.

Antes de publicar cada caso, executar os checks privados contra a referência
(controle positivo) e confirmar que ao menos o novo comportamento falha na base
(controle negativo). C1 começa sem aplicação: a ausência deve ser classificada
como capacidade ausente esperada, não como falha de infraestrutura do controle.

## Métricas e comparabilidade

Guardar por execução: ID e versão/digest do caso e prompt, SHA-base, SHA-referência
(privado), patch final e digest, modelo/provider e parâmetros, limites, política
de cache, versões do runner/iii/SDK/Compose/Node/pnpm/navegador, lockfiles, seed,
ports e identificador do store isolado, timestamps e tentativas.

Coletar duração de execução e avaliação separadamente; tokens de entrada/saída e
cache conforme o provider; custo disponível; chamadas/falhas de ferramentas;
resultados por critério; logs, transcript, screenshots e checks executados.
Métrica indisponível é `null`/não disponível, nunca zero. Só atribuir métricas a
planejamento/construção/teste se houver fronteiras de fase observáveis no runner.

Separar `infrastructure_failed`, `evaluation_failed`, falha do sujeito e sucesso.
Não concluir capacidade a partir de uma execução com engine indisponível,
isolamento quebrado ou avaliador inválido. Não misturar reruns com primeiras
tentativas nem casos/budgets/cache/stack distintos na mesma comparação.

## Estado e próxima integração

O histórico e os contratos foram conferidos na autoria. As etapas de produto
receberam testes locais e probes reais; isso **não** significa que os sete casos
tenham sido executados por um modelo no Harness. Os probes de autoria em `/tmp`
não são uma suíte privada versionada nem evidência portátil da campanha.

Na inspeção do Harness, `src/scenarios/swe_service/mod.rs` usa repositório e revisão
fixos, e `scripts/publish_swe_service.py` limita a publicação a outro repositório.
Portanto este catálogo não pode ser anunciado como importável diretamente naquele
fluxo. Não houve alteração nem publicação no Harness nesta etapa.

Próximo trabalho: escolher/adaptar o runner isolado, empacotar bases e documentação
sem referências futuras, implementar avaliadores privados e controles positivo/
negativo, congelar a stack e rodar um piloto. Publicação remota e campanhas com
custos externos devem ser autorizadas separadamente.
