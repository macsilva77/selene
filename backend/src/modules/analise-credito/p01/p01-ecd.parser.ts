/**
 * Parser SPED ECD — extrai plano de contas (C050/I050) e saldos (J100).
 * Suporta ambos os layouts: bloco C (diário completo) e bloco I (auxiliar).
 * Encoding esperado: Latin-1 (ISO-8859-1).
 */

export interface PlanoContaRow {
  contaCodigo: string;
  contaNome:   string;
  nivel:       number;
  natureza:    string;   // D | C
  tipo:        string;   // sintetica | analitica
  grupo:       string;   // AC | ANC | PC | PNC | PL | REC | CUS | DES | RNO
}

export interface EcdSaldoRow {
  periodo:       string;   // AAAA-MM
  contaCodigo:   string;
  contaNome:     string;
  grupo:         string;
  saldoAnterior: number;
  debitos:       number;
  creditos:      number;
  saldoFinal:    number;
  naturezaSaldo: string;   // D | C
  status:        string;
}

export interface EcdParseResult {
  razaoSocial:    string;
  planoContas:    PlanoContaRow[];
  saldos:         EcdSaldoRow[];
  inconsistencias: Array<{ tipoErro: string; descricao: string; severidade: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseValorBr(s: string): number {
  if (!s || !s.trim()) return 0;
  // Remove pontos de milhar, substitui vírgula decimal
  const cleaned = s.trim().replace(/\./g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : v;
}

function parseLinha(linha: string): string[] | null {
  const l = linha.trim();
  if (!l.startsWith('|') || !l.endsWith('|')) return null;
  return l.slice(1, -1).split('|');
}

// Mapeamento ind_conta (01=Ativo, 02=Passivo, 03=PL, 04=Resultado) → grupo base
const PALAVRAS_ANC = ['nao-circulante', 'nao circulante', 'imobilizado', 'intangivel',
  'investimento', 'ativo permanente'];
const PALAVRAS_PNC = ['nao-circulante', 'nao circulante', 'longo prazo', 'exigivel a longo'];
const PALAVRAS_CUS = ['custo', 'cmv', 'cme', 'cst'];
const PALAVRAS_DES = ['despesa', 'administrativa', 'comercial', 'financeira',
  'depreciacao', 'amortizacao'];
const PALAVRAS_RNO = ['nao operacional', 'nao-operacional', 'outras receitas',
  'outras despesas', 'equivalencia patrimonial'];

function refinarGrupo(indConta: string, nome: string): string {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (indConta === '01') {
    for (const w of PALAVRAS_ANC) if (n.includes(w)) return 'ANC';
    return 'AC';
  }
  if (indConta === '02') {
    for (const w of PALAVRAS_PNC) if (n.includes(w)) return 'PNC';
    return 'PC';
  }
  if (indConta === '03') return 'PL';
  if (indConta === '04') {
    for (const w of PALAVRAS_RNO) if (n.includes(w)) return 'RNO';
    for (const w of PALAVRAS_CUS) if (n.includes(w)) return 'CUS';
    for (const w of PALAVRAS_DES) if (n.includes(w)) return 'DES';
    return 'REC';
  }
  return 'REC';
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseEcd(buffer: Buffer): EcdParseResult {
  const texto   = buffer.toString('latin1');
  const linhas  = texto.split(/\r?\n/);

  let razaoSocial   = '';
  const planoMap    = new Map<string, PlanoContaRow>();
  const nomesMap    = new Map<string, string>(); // código → nome (C050 tem nome)
  // {periodo} → {contaCodigo → EcdSaldoRow}
  const saldosMap   = new Map<string, Map<string, EcdSaldoRow>>();
  const inconsistencias: EcdParseResult['inconsistencias'] = [];
  let periodoAtual  = '';

  for (const linha of linhas) {
    const campos = parseLinha(linha);
    if (!campos || campos.length === 0) continue;
    const rec = campos[0];

    // ── 0000: cabeçalho ───────────────────────────────────────────────────────
    if (rec === '0000' && campos.length >= 5) {
      // LECD | dt_ini | dt_fim | razao_social | cnpj | ...
      razaoSocial = (campos[4] ?? '').trim();
    }

    // ── C050: plano de contas com nome (bloco C — diário completo) ───────────
    // |DT_INI|IND_CONTA|IND_TIPO_CTA|NIVEL|COD_CTA|COD_CTA_SUP|NOM_CTA|
    else if (rec === 'C050' && campos.length >= 8) {
      const indConta  = campos[2] ?? '';
      const tipoRaw   = campos[3] ?? '';
      const nivel     = parseInt(campos[4] ?? '0', 10) || 0;
      const cod       = (campos[5] ?? '').trim();
      const nome      = (campos[7] ?? '').trim();
      nomesMap.set(cod, nome);
      planoMap.set(cod, {
        contaCodigo: cod,
        contaNome:   nome,
        nivel,
        natureza: ['01', '05'].includes(indConta) ? 'D' : 'C',
        tipo:     tipoRaw === 'S' ? 'sintetica' : 'analitica',
        grupo:    refinarGrupo(indConta, nome),
      });
    }

    // ── I050: plano simplificado (bloco I — sem nome de conta) ───────────────
    // |DT_INI|IND_CONTA|IND_TIPO_CTA|NIVEL|COD_CTA|COD_CTA_SUP|COD_GRP?|
    else if (rec === 'I050' && campos.length >= 6) {
      const indConta  = campos[2] ?? '';
      const tipoRaw   = campos[3] ?? '';
      const nivel     = parseInt(campos[4] ?? '0', 10) || 0;
      const cod       = (campos[5] ?? '').trim();
      if (!planoMap.has(cod)) {
        const nome = nomesMap.get(cod) ?? `CONTA_${cod}`;
        planoMap.set(cod, {
          contaCodigo: cod,
          contaNome:   nome,
          nivel,
          natureza: ['01', '05'].includes(indConta) ? 'D' : 'C',
          tipo:     tipoRaw === 'S' ? 'sintetica' : 'analitica',
          grupo:    refinarGrupo(indConta, nome),
        });
      }
    }

    // ── J005: abre período do balancete ───────────────────────────────────────
    // |DT_INI|DT_FIN|IND_NIV_OBRIG|...
    else if (rec === 'J005' && campos.length >= 2) {
      const dtIni = (campos[1] ?? '').trim(); // DDMMAAAA
      if (/^\d{8}$/.test(dtIni)) {
        const yyyy = dtIni.slice(4);
        const mm   = dtIni.slice(2, 4);
        periodoAtual = `${yyyy}-${mm}`;
        if (!saldosMap.has(periodoAtual)) {
          saldosMap.set(periodoAtual, new Map());
        }
      }
    }

    // ── J100: saldo por conta no período ─────────────────────────────────────
    // Layout observado: |COD_CTA|IND_DC|NIVEL|COD_CTA_SUP|...|VL_SLD_INI|IND_DC_INI|VL_DEB|...
    else if (rec === 'J100' && periodoAtual && campos.length >= 10) {
      try {
        const cod = (campos[1] ?? '').trim();

        // J100 tem layouts variados entre fornecedores. Localizamos os valores
        // pelos tipos: numeric fields estão a partir do índice 7.
        const vIni  = parseValorBr(campos[7]  ?? '');
        const dcIni = (campos[8]  ?? 'D').trim() || 'D';
        const vDeb  = parseValorBr(campos[9]  ?? '');

        let vCred = 0;
        let vFin  = vIni;
        let dcFin = dcIni;

        if (campos.length >= 12) {
          // Tenta ler crédito e saldo final
          const c10 = (campos[10] ?? '').trim();
          const c11 = (campos[11] ?? '').trim();
          const c12 = (campos[12] ?? '').trim();

          if (!['D', 'C', ''].includes(c10)) {
            // c10 é valor (crédito)
            vCred = parseValorBr(c10);
            vFin  = parseValorBr(c11);
            dcFin = c12 || dcIni;
          } else {
            // c10 é D/C (natureza do débito), c11 é valor final
            vFin  = parseValorBr(c11);
            dcFin = c12 || dcIni;
          }
        }

        const nome  = nomesMap.get(cod) ?? planoMap.get(cod)?.contaNome ?? '';
        const grupo = planoMap.get(cod)?.grupo ?? '';
        const periodoSaldos = saldosMap.get(periodoAtual)!;

        periodoSaldos.set(cod, {
          periodo:       periodoAtual,
          contaCodigo:   cod,
          contaNome:     nome,
          grupo,
          saldoAnterior: vIni,
          debitos:       vDeb,
          creditos:      vCred,
          saldoFinal:    vFin,
          naturezaSaldo: dcFin,
          status:        'ok',
        });
      } catch {
        inconsistencias.push({
          tipoErro:  'J100_PARSE',
          descricao: `J100 com formato inesperado na linha: ${linha.slice(0, 120)}`,
          severidade: 'alerta',
        });
      }
    }
  }

  // Valida contas J100 sem correspondência no plano
  const planoSet = new Set(planoMap.keys());
  for (const [periodo, saldos] of saldosMap) {
    for (const cod of saldos.keys()) {
      if (!planoSet.has(cod)) {
        inconsistencias.push({
          tipoErro:  'CONTA_ORFAN',
          descricao: `Conta ${cod} em J100 (período ${periodo}) sem registro no plano de contas`,
          severidade: 'alerta',
        });
      }
    }
  }

  const saldos: EcdSaldoRow[] = [];
  for (const periodoSaldos of saldosMap.values()) {
    saldos.push(...periodoSaldos.values());
  }

  return {
    razaoSocial,
    planoContas:    [...planoMap.values()],
    saldos,
    inconsistencias,
  };
}
