import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  ClientesFornecedoresQueryService,
} from '../query/clientes-fornecedores-query.service';
import {
  RankingParticipanteRow,
  RaizRankingRow,
} from '../query/clientes-fornecedores-parquet.repository';

// ─── Cores ABC ────────────────────────────────────────────────────────────────

const COR_ABC: Record<'A' | 'B' | 'C', string> = {
  A: 'FF92D050', // verde claro
  B: 'FFFFEB9C', // amarelo
  C: 'FFFF9999', // vermelho claro
};

const COR_LINHA_PAR = 'FFF9F9F9';
const COR_LINHA_IMPAR = 'FFFFFFFF';

// ─── Parâmetros de entrada ────────────────────────────────────────────────────

export interface GerarExcelParams {
  tenantId: string;
  empresaId: string;
  cnpjEmpresa: string;
  anoInicio: number;
  mesInicio: number;
  anoFim: number;
  mesFim: number;
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

@Injectable()
export class ClientesFornecedoresExcelService {
  constructor(private readonly queryService: ClientesFornecedoresQueryService) {}

  async gerarExcel(params: GerarExcelParams): Promise<Buffer> {
    const { tenantId, empresaId, cnpjEmpresa, anoInicio, mesInicio, anoFim, mesFim } = params;

    const periodoBase = { tenantId, empresaId, cnpjEmpresa, anoInicio, mesInicio, anoFim, mesFim };

    // Busca em paralelo: top N para CLIENTES e FORNECEDORES + grupos por raiz
    const [rankingClientes, rankingFornecedores, gruposClientes, gruposFornecedores] =
      await Promise.all([
        this.queryService.consultarTopN({ ...periodoBase, tipoParticipante: 'CLIENTE' }),
        this.queryService.consultarTopN({ ...periodoBase, tipoParticipante: 'FORNECEDOR' }),
        this.queryService.consultarPorRaiz({ ...periodoBase, tipoParticipante: 'CLIENTE' }),
        this.queryService.consultarPorRaiz({ ...periodoBase, tipoParticipante: 'FORNECEDOR' }),
      ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Selene';
    workbook.created = new Date();

    // Aba 1 — Clientes (ranking individual)
    this.adicionarAbaRanking(workbook, 'Clientes', rankingClientes);

    // Aba 2 — Fornecedores (ranking individual)
    this.adicionarAbaRanking(workbook, 'Fornecedores', rankingFornecedores);

    // Aba 3 — Grupos Clientes (por raiz CNPJ)
    this.adicionarAbaRaiz(workbook, 'Grupos Clientes', gruposClientes);

    // Aba 4 — Grupos Fornecedores (por raiz CNPJ)
    this.adicionarAbaRaiz(workbook, 'Grupos Fornecedores', gruposFornecedores);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ─── Aba de ranking individual ──────────────────────────────────────────────

  private adicionarAbaRanking(
    workbook: ExcelJS.Workbook,
    nome: string,
    rows: RankingParticipanteRow[],
  ): void {
    const sheet = workbook.addWorksheet(nome);

    // Colunas
    sheet.columns = [
      { header: 'Pos.',        key: 'ranking',              width: 7  },
      { header: 'Razão Social',key: 'razaoSocial',          width: 40 },
      { header: 'CNPJ',        key: 'cnpj',                 width: 18 },
      { header: 'Raiz CNPJ',   key: 'cnpjRaiz',             width: 12 },
      { header: 'Valor R$',    key: 'valorTotal',            width: 18 },
      { header: '% Part.',     key: 'percentual',            width: 10 },
      { header: '% Acum.',     key: 'acumulado',             width: 10 },
      { header: 'Qtd Docs',    key: 'quantidadeDocumentos',  width: 11 },
      { header: 'ABC',         key: 'classeAbc',             width: 6  },
    ];

    this.estilizarCabecalho(sheet);

    rows.forEach((row, idx) => {
      const excelRow = sheet.addRow({
        ranking:              row.ranking,
        razaoSocial:          row.razaoSocial,
        cnpj:                 row.cnpj,
        cnpjRaiz:             row.cnpjRaiz,
        valorTotal:           row.valorTotal,
        percentual:           row.percentual,
        acumulado:            row.acumulado,
        quantidadeDocumentos: row.quantidadeDocumentos,
        classeAbc:            row.classeAbc,
      });
      this.estilizarLinha(excelRow, idx, row.classeAbc);
    });
  }

  // ─── Aba de grupos por raiz ─────────────────────────────────────────────────

  private adicionarAbaRaiz(
    workbook: ExcelJS.Workbook,
    nome: string,
    rows: RaizRankingRow[],
  ): void {
    const sheet = workbook.addWorksheet(nome);

    sheet.columns = [
      { header: 'Pos.',        key: 'ranking',              width: 7  },
      { header: 'Razão Social',key: 'razaoSocial',          width: 40 },
      { header: 'Raiz CNPJ',   key: 'cnpjRaiz',             width: 12 },
      { header: 'Valor R$',    key: 'valorTotal',            width: 18 },
      { header: '% Part.',     key: 'percentual',            width: 10 },
      { header: '% Acum.',     key: 'acumulado',             width: 10 },
      { header: 'Qtd Docs',    key: 'quantidadeDocumentos',  width: 11 },
      { header: 'Qtd CNPJs',   key: 'qtdCnpjs',             width: 11 },
      { header: 'ABC',         key: 'classeAbc',             width: 6  },
    ];

    this.estilizarCabecalho(sheet);

    rows.forEach((row, idx) => {
      const excelRow = sheet.addRow({
        ranking:              row.ranking,
        razaoSocial:          row.razaoSocial,
        cnpjRaiz:             row.cnpjRaiz,
        valorTotal:           row.valorTotal,
        percentual:           row.percentual,
        acumulado:            row.acumulado,
        quantidadeDocumentos: row.quantidadeDocumentos,
        qtdCnpjs:             row.qtdCnpjs,
        classeAbc:            row.classeAbc,
      });
      this.estilizarLinha(excelRow, idx, row.classeAbc);
    });
  }

  // ─── Helpers de estilo ──────────────────────────────────────────────────────

  private estilizarCabecalho(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9D9D9' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF999999' } },
      };
    });
    headerRow.commit();
  }

  private estilizarLinha(
    row: ExcelJS.Row,
    idx: number,          // 0-based
    classeAbc: 'A' | 'B' | 'C',
  ): void {
    const bgColor = idx % 2 === 1 ? COR_LINHA_PAR : COR_LINHA_IMPAR;
    const abcColor = COR_ABC[classeAbc];
    const lastColIdx = row.cellCount;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const isAbcCol = colNumber === lastColIdx;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isAbcCol ? abcColor : bgColor },
      };
    });
    row.commit();
  }
}
