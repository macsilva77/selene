import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ClientesFornecedoresGcsService } from './gcs/clientes-fornecedores-gcs.service';
import { ClientesFornecedoresParquetWriter, FatoConsolidado } from './parquet/clientes-fornecedores-parquet.writer';
import { parseEfdIcmsIpi, FatoParticipante } from './sped/efd-icms-ipi.parser';
import { parseEfdContribuicoes } from './sped/efd-contribuicoes.parser';

export interface ProcessarSpedInput {
  tenantId: string;
  empresaId: string;
  cnpj: string;
  ano: number;
  mes: number;
  /** URI GCS da EFD ICMS/IPI — fonte exclusiva de Blocos C e D. */
  spedIcmsIpiGcsUri: string;
  /**
   * URI GCS da EFD Contribuições — Blocos A (serviços ISS) e F (demais operações).
   * Blocos C e D desta fonte são ignorados quando há EFD ICMS/IPI.
   */
  spedContribGcsUri: string;
}

@Injectable()
export class ClientesFornecedoresProcessamentoService {
  private readonly logger = new Logger(ClientesFornecedoresProcessamentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcs: ClientesFornecedoresGcsService,
    private readonly parquetWriter: ClientesFornecedoresParquetWriter,
  ) {}

  async processar(input: ProcessarSpedInput): Promise<void> {
    const { tenantId, empresaId, cnpj, ano, mes, spedIcmsIpiGcsUri, spedContribGcsUri } = input;
    const label = `[${cnpj} ${ano}-${String(mes).padStart(2, '0')}]`;
    this.logger.log(`${label} Processando EFD ICMS/IPI + Contribuições → Parquet`);

    // 1. Download paralelo das duas fontes
    const [bufIcms, bufContrib] = await Promise.all([
      this.gcs.downloadFromUri(spedIcmsIpiGcsUri),
      this.gcs.downloadFromUri(spedContribGcsUri),
    ]);
    this.logger.debug(`${label} Downloads: ICMS/IPI=${bufIcms.length}b, Contrib=${bufContrib.length}b`);

    // 2. Parse de cada fonte
    //    ICMS/IPI: Blocos C (NF-e) + D (CT-e) — primário para mercadorias e transporte
    //    Contribuições: Blocos A (ISS) + F (demais) — sempre complementar
    const fatosIcms   = parseEfdIcmsIpi(bufIcms);
    const fatosContrib = parseEfdContribuicoes(bufContrib);

    this.logger.log(
      `${label} Parse: ICMS/IPI=${fatosIcms.length} participante(s), ` +
      `Contrib=${fatosContrib.length} participante(s)`,
    );

    // 3. Merge: ambas as fontes são somadas (sem dedup — domínios distintos:
    //    C/D não se sobrepõem a A/F por tipo de documento fiscal)
    const fatosTotal = mergeFatos(fatosIcms, fatosContrib);
    this.logger.log(`${label} Merge: ${fatosTotal.length} participante(s) únicos`);

    const dataProcessamento = new Date().toISOString().slice(0, 10);
    const fatosConsolidados: FatoConsolidado[] = fatosTotal.map((f) => ({
      ...f,
      empresaId,
      ano,
      mes,
      dataProcessamento,
    }));

    const clientes     = fatosConsolidados.filter((f) => f.tipoParticipante === 'CLIENTE');
    const fornecedores = fatosConsolidados.filter((f) => f.tipoParticipante === 'FORNECEDOR');

    // 4. Grava partições Parquet com overwrite atômico
    const parquetPathCliente    = await this.gravarParticao(empresaId, ano, mes, 'CLIENTE',    clientes,    label);
    const parquetPathFornecedor = await this.gravarParticao(empresaId, ano, mes, 'FORNECEDOR', fornecedores, label);

    // 5. Registra competência no Prisma (upsert — reprocessamento não duplica)
    await this.prisma.clientesFornecedoresCompetencia.upsert({
      where: { tenantId_empresaId_ano_mes: { tenantId, empresaId, ano, mes } },
      create: {
        tenantId,
        empresaId,
        cnpj,
        ano,
        mes,
        spedGcsUri:          spedIcmsIpiGcsUri,
        parquetPathCliente,
        parquetPathFornecedor,
        qtdClientes:     clientes.length,
        qtdFornecedores: fornecedores.length,
        status:          'PROCESSADO',
      },
      update: {
        spedGcsUri:          spedIcmsIpiGcsUri,
        parquetPathCliente,
        parquetPathFornecedor,
        qtdClientes:     clientes.length,
        qtdFornecedores: fornecedores.length,
        status:          'PROCESSADO',
      },
    });

    this.logger.log(
      `${label} Concluído — clientes=${clientes.length}, fornecedores=${fornecedores.length}`,
    );
  }

  private async gravarParticao(
    empresaId: string,
    ano: number,
    mes: number,
    tipo: 'CLIENTE' | 'FORNECEDOR',
    fatos: FatoConsolidado[],
    label: string,
  ): Promise<string | null> {
    if (fatos.length === 0) {
      await this.gcs.limparParticao(empresaId, ano, mes, tipo);
      this.logger.debug(`${label} Partição ${tipo} limpa (sem participantes)`);
      return null;
    }
    const buf  = await this.parquetWriter.escrever(fatos);
    const gcsPath = await this.gcs.salvarParticao(empresaId, ano, mes, tipo, buf);
    this.logger.log(`${label} ${tipo}: ${fatos.length} participante(s) → ${gcsPath}`);
    return gcsPath;
  }
}

/**
 * Combina participantes das duas fontes.
 * Mesmo codPart pode aparecer nas duas EFDs com domínios distintos (ex.: fornecedor de
 * mercadoria no ICMS/IPI E de serviço ISS na Contribuições) → soma os valores.
 */
function mergeFatos(
  icms: FatoParticipante[],
  contrib: FatoParticipante[],
): FatoParticipante[] {
  const map = new Map<string, FatoParticipante>();

  for (const f of [...icms, ...contrib]) {
    // Chave de merge: CNPJ + tipo (para unir mesmo participante de fontes diferentes)
    const key = `${f.cnpj || f.codPart}|${f.tipoParticipante}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...f });
    } else {
      existing.valorTotal           += f.valorTotal;
      existing.quantidadeDocumentos += f.quantidadeDocumentos;
      // Mantém razão social se o merge veio de F100 sem nome
      if (!existing.razaoSocial && f.razaoSocial) existing.razaoSocial = f.razaoSocial;
    }
  }

  return [...map.values()];
}
