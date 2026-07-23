# Bella Bets — Roteiro Fase 3 (congelado)

> Anotações de features futuras. **Não implementar enquanto o congelamento vigente durar.**

## GUARDA DE CONTRADIÇÃO

Ao registrar uma aposta que **trava contra outra já aberta** (dois lados da mesma
linha, mesmo jogo — ex.: over 2.5 e under 2.5 do mesmo jogo), avisar em **1 linha** o
prejuízo garantido e sugerir encerrar a primeira. **Registrar continua livre** — o
dedo é do Maikon; é aviso, não bloqueio.

- **Origem:** caso real Operário-PR x Ponte Preta, 23/07 — over 2.5 (R$5) e under 2.5
  (R$15) no mesmo jogo, prejuízo travado de **−R$10,75** (ganhou R$4,25 no over,
  perdeu R$15 no under). Erro reconhecido, pré-simplificação.
- **Escopo:** detecção por (jogo, linha) com lados opostos entre apostas em aberto.
  Mensagem no momento do registro. Sem tela extra, sem sermão.
