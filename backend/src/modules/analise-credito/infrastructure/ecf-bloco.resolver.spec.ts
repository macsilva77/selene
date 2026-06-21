import { detectarBlocoEcf } from './ecf-bloco.resolver';

const set = (...regs: string[]) => new Set(regs);

describe('detectarBlocoEcf', () => {
  it('Lucro Real: L300 presente → L100/L300', () => {
    expect(detectarBlocoEcf(set('L300', 'L100', 'M300'))).toEqual({
      regime: 'lucro_real', bp: 'L100', dre: 'L300',
    });
  });

  it('Presumido: só bloco P → P100/P150 (SESSION BRASIL)', () => {
    expect(detectarBlocoEcf(set('P150', 'P100', 'P030'))).toEqual({
      regime: 'lucro_presumido', bp: 'P100', dre: 'P150',
    });
  });

  it('Imune/Isenta: só bloco U → U100/U150', () => {
    expect(detectarBlocoEcf(set('U150', 'U100'))).toEqual({
      regime: 'imune_isenta', bp: 'U100', dre: 'U150',
    });
  });

  it('precedência L → P → U quando há mais de um bloco', () => {
    expect(detectarBlocoEcf(set('L300', 'P150', 'U150'))?.regime).toBe('lucro_real');
    expect(detectarBlocoEcf(set('P150', 'U150'))?.regime).toBe('lucro_presumido');
  });

  it('detecta pelo BP quando só o registro de balanço está presente', () => {
    expect(detectarBlocoEcf(set('P100'))?.regime).toBe('lucro_presumido');
    expect(detectarBlocoEcf(set('U100'))?.regime).toBe('imune_isenta');
  });

  it('nenhum bloco demonstrativo → null', () => {
    expect(detectarBlocoEcf(set())).toBeNull();
    expect(detectarBlocoEcf(set('M300', '0000', 'J100'))).toBeNull();
  });
});
