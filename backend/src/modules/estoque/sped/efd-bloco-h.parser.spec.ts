/**
 * Testes do parser do Bloco H + análise do inventário.
 *
 * Funções puras (sem efeitos colaterais). A fixture é montada fielmente ao leiaute
 * v3.2.2 do Guia Prático EFD-ICMS/IPI: 0000 → 0150 → 0200 → H001/H005/H010(/H020) → H990.
 */
import {
  parseEfdBlocoH, parseNum, isoData, InventarioBlocoH,
} from './efd-bloco-h.parser';
import { analisarInventario } from './efd-bloco-h.analise';

function buf(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'latin1');
}

// EFD de exemplo: 3 itens, um de cada IND_PROP, VL_INV = 5.400,00 (= Σ VL_ITEM).
//   A1 NESCAFE   100 × 50,00 = 5.000,00   IND_PROP 0 (próprio em meu poder)
//   B1 PAPEL      10 × 30,00 =   300,00   IND_PROP 1 (próprio em poder de terceiro)  → COD_PART FORN001
//   C1 GELO        5 × 20,00 =   100,00   IND_PROP 2 (de terceiro em meu poder)      → COD_PART FORN001
const EFD_OK = buf([
  '|0000|017|0|01122024|31122024|EMPRESA TESTE LTDA|12345678000195||SP|123||3550308||A|1|',
  '|0150|FORN001|Fornecedor Beta SA|1058|98765432000111|||||||',
  '|0200|A1|NESCAFE Cappuccino Latte|||CX|00|21011200||21||0||',
  '|0200|B1|PAPEL REPORT PREMIUM A4|||PC|00|48025610||48||0||',
  '|0200|C1|GELO EM CUBOS 5KG|||PC|00|22019000||22||0||',
  '|H001|0|',
  '|H005|31122024|5400,00|01|',
  '|H010|A1|CX|100|50,00|5000,00|0||||5000,00|',
  '|H010|B1|PC|10|30,00|300,00|1|FORN001|||300,00|',
  '|H010|C1|PC|5|20,00|100,00|2|FORN001||||',
  '|H990|7|',
]);

// ─── helpers de parse ─────────────────────────────────────────────────────────

describe('parseNum', () => {
  it('vírgula decimal sem milhar', () => expect(parseNum('5000,00')).toBeCloseTo(5000, 2));
  it('valor unitário com 2 casas', () => expect(parseNum('50,00')).toBeCloseTo(50, 2));
  it('string vazia → 0', () => expect(parseNum('')).toBe(0));
  it('não numérico → 0', () => expect(parseNum('abc')).toBe(0));
  it('já com ponto', () => expect(parseNum('100.5')).toBeCloseTo(100.5, 4));
});

describe('isoData', () => {
  it('ddmmaaaa → ISO', () => expect(isoData('31122024')).toBe('2024-12-31'));
  it('inválida → vazia', () => expect(isoData('3112')).toBe(''));
});

// ─── parse do Bloco H ─────────────────────────────────────────────────────────

describe('parseEfdBlocoH — cabeçalho e estrutura', () => {
  let r: InventarioBlocoH;
  beforeAll(() => { r = parseEfdBlocoH(EFD_OK); });

  it('extrai CNPJ do 0000 com 14 dígitos', () => expect(r.cnpj).toBe('12345678000195'));
  it('extrai DT_INI/DT_FIN em ISO', () => {
    expect(r.dtIni).toBe('2024-12-01');
    expect(r.dtFin).toBe('2024-12-31');
  });
  it('H001 IND_MOV=0 → temBlocoH', () => expect(r.temBlocoH).toBe(true));
  it('um inventário (1 H005)', () => expect(r.inventarios).toHaveLength(1));
  it('DT_INV e MOT_INV do H005', () => {
    expect(r.inventarios[0].dtInv).toBe('2024-12-31');
    expect(r.inventarios[0].motInv).toBe('01');
  });
  it('3 itens no inventário', () => expect(r.inventarios[0].itens).toHaveLength(3));
});

describe('parseEfdBlocoH — item e enriquecimento', () => {
  let r: InventarioBlocoH;
  beforeAll(() => { r = parseEfdBlocoH(EFD_OK); });

  it('item A1: qtd/vlUnit/vlItem e IND_PROP 0', () => {
    const a = r.inventarios[0].itens.find(i => i.codItem === 'A1')!;
    expect(a.qtd).toBeCloseTo(100, 2);
    expect(a.vlUnit).toBeCloseTo(50, 2);
    expect(a.vlItem).toBeCloseTo(5000, 2);
    expect(a.indProp).toBe('0');
    expect(a.codPart).toBeNull();
  });

  it('descrição e NCM vêm do 0200', () => {
    const a = r.inventarios[0].itens.find(i => i.codItem === 'A1')!;
    expect(a.descricao).toBe('NESCAFE Cappuccino Latte');
    expect(a.ncm).toBe('21011200');
    expect(a.semCatalogo).toBe(false);
  });

  it('item B1 (próprio em terceiro): COD_PART e nome do 0150', () => {
    const b = r.inventarios[0].itens.find(i => i.codItem === 'B1')!;
    expect(b.indProp).toBe('1');
    expect(b.codPart).toBe('FORN001');
    expect(b.participante).toBe('Fornecedor Beta SA');
  });

  it('item C1 (de terceiro): IND_PROP 2 com participante', () => {
    const c = r.inventarios[0].itens.find(i => i.codItem === 'C1')!;
    expect(c.indProp).toBe('2');
    expect(c.participante).toBe('Fornecedor Beta SA');
  });
});

describe('parseEfdBlocoH — integridade VL_INV', () => {
  it('VL_INV declarado = Σ VL_ITEM → integridadeOk', () => {
    const r = parseEfdBlocoH(EFD_OK);
    const inv = r.inventarios[0];
    expect(inv.vlInvDeclarado).toBeCloseTo(5400, 2);
    expect(inv.somaVlItem).toBeCloseTo(5400, 2);
    expect(inv.integridadeOk).toBe(true);
  });

  it('divergência em VL_INV → integridadeOk=false', () => {
    const efdRuim = buf([
      '|0000|017|0|01122024|31122024|EMPRESA|12345678000195||SP||||A|1|',
      '|0200|A1|ITEM|||UN|00|21011200||||||',
      '|H001|0|',
      '|H005|31122024|9999,00|01|',                 // declara errado
      '|H010|A1|UN|100|50,00|5000,00|0||||5000,00|',
      '|H990|5|',
    ]);
    const inv = parseEfdBlocoH(efdRuim).inventarios[0];
    expect(inv.integridadeOk).toBe(false);
  });
});

describe('parseEfdBlocoH — H020 (MOT_INV 02-05)', () => {
  it('anexa CST/BC/VL_ICMS ao item', () => {
    const efd = buf([
      '|0000|017|0|01122024|31122024|EMPRESA|12345678000195||SP||||A|1|',
      '|0200|A1|ITEM|||UN|00|21011200||||||',
      '|H001|0|',
      '|H005|31122024|5000,00|02|',                 // mudança de tributação
      '|H010|A1|UN|100|50,00|5000,00|0||||5000,00|',
      '|H020|00|45,00|7,65|',
      '|H990|6|',
    ]);
    const item = parseEfdBlocoH(efd).inventarios[0].itens[0];
    expect(item.cstIcms).toBe('00');
    expect(item.bcIcms).toBeCloseTo(45, 2);
    expect(item.vlIcms).toBeCloseTo(7.65, 2);
  });
});

describe('parseEfdBlocoH — bloco vazio (H001 IND_MOV=1)', () => {
  it('temBlocoH=false e sem inventários', () => {
    const efd = buf([
      '|0000|017|0|01122024|31122024|EMPRESA|12345678000195||SP||||A|1|',
      '|H001|1|',
      '|H990|2|',
    ]);
    const r = parseEfdBlocoH(efd);
    expect(r.temBlocoH).toBe(false);
    expect(r.inventarios).toHaveLength(0);
  });
});

// ─── análise ──────────────────────────────────────────────────────────────────

describe('analisarInventario — composição por propriedade', () => {
  const r = parseEfdBlocoH(EFD_OK);
  const a = analisarInventario(r.inventarios[0]);

  it('valor total = 5.400,00', () => expect(a.valorTotal).toBeCloseTo(5400, 2));
  it('próprio em meu poder = 5.000,00', () => expect(a.propriedade.proprioEmPoder.valor).toBeCloseTo(5000, 2));
  it('próprio em terceiro = 300,00', () => expect(a.propriedade.proprioEmTerceiro.valor).toBeCloseTo(300, 2));
  it('de terceiro em meu poder = 100,00', () => expect(a.propriedade.terceiroEmPoder.valor).toBeCloseTo(100, 2));

  it('estoque conciliável = só IND_PROP 0', () => expect(a.estoqueConciliavel).toBeCloseTo(5000, 2));

  it('percentual de propriedade soma ~1', () => {
    const { proprioEmPoder, proprioEmTerceiro, terceiroEmPoder } = a.propriedade;
    const soma = proprioEmPoder.percValor + proprioEmTerceiro.percValor + terceiroEmPoder.percValor;
    expect(soma).toBeCloseTo(1, 4);
  });

  it('motInvLabel descritivo', () => expect(a.motInvLabel).toBe('No final do período'));
});

describe('analisarInventario — NCM, ABC e top itens', () => {
  const r = parseEfdBlocoH(EFD_OK);
  const a = analisarInventario(r.inventarios[0]);

  it('3 grupos de NCM distintos', () => expect(a.porNcm).toHaveLength(3));
  it('NCM de maior valor é o do NESCAFE', () => expect(a.porNcm[0].ncm).toBe('21011200'));
  it('top item é A1 (maior VL_ITEM)', () => {
    expect(a.topItens[0].codItem).toBe('A1');
    expect(a.topItens[0].indPropLabel).toBe('Próprio, em meu poder');
  });
  it('curva ABC: A concentra o item de maior valor', () => {
    expect(a.curvaAbc.a.qtdItens).toBeGreaterThanOrEqual(1);
    expect(a.curvaAbc.a.valor).toBeCloseTo(5000, 2);
  });
});

describe('analisarInventario — alertas de qualidade', () => {
  it('item sem 0200 e sem NCM gera alertas', () => {
    const efd = buf([
      '|0000|017|0|01122024|31122024|EMPRESA|12345678000195||SP||||A|1|',
      '|H001|0|',
      '|H005|31122024|1000,00|01|',
      '|H010|SEMCAT|UN|10|100,00|1000,00|0||||1000,00|', // sem 0200 correspondente
      '|H990|4|',
    ]);
    const a = analisarInventario(parseEfdBlocoH(efd).inventarios[0]);
    expect(a.alertas.some(s => s.includes('sem cadastro no 0200'))).toBe(true);
    expect(a.alertas.some(s => s.includes('sem NCM'))).toBe(true);
  });

  it('IND_PROP 2 sem COD_PART gera alerta', () => {
    const efd = buf([
      '|0000|017|0|01122024|31122024|EMPRESA|12345678000195||SP||||A|1|',
      '|0200|X|ITEM X|||UN|00|21011200||||||',
      '|H001|0|',
      '|H005|31122024|500,00|01|',
      '|H010|X|UN|5|100,00|500,00|2||||', // IND_PROP 2 mas sem COD_PART
      '|H990|5|',
    ]);
    const a = analisarInventario(parseEfdBlocoH(efd).inventarios[0]);
    expect(a.alertas.some(s => s.includes('sem COD_PART'))).toBe(true);
  });
});
