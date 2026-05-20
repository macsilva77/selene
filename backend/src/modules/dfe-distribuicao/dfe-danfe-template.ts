import type { DanfeData } from './dfe-danfe-xml-mapper';

export function gerarHtmlDanfe(d: DanfeData, barcodeDataUrl: string): string {
  const isHomologacao = d.tpAmb === '2';
  const isEntrada = d.tpNF === '0';
  const hasDups = d.duplicatas.length > 0;

  const infCplFinal = isHomologacao
    ? `SEM VALOR FISCAL – EMITIDA EM HOMOLOGAÇÃO\n${d.infCpl ?? ''}`
    : (d.infCpl ?? '');

  const produtosHtml = d.produtos
    .map(
      (p) => `
    <tr>
      <td>${p.cProd}</td>
      <td class="desc">${p.xProd}</td>
      <td class="c">${p.ncm}</td>
      <td class="c">${p.cst ?? ''}</td>
      <td class="c">${p.cfop}</td>
      <td class="c">${p.uCom}</td>
      <td class="r">${p.qCom}</td>
      <td class="r">${p.vUnCom}</td>
      <td class="r">${p.vProd}</td>
      <td class="r">${p.vDesc ?? ''}</td>
      <td class="r">${p.vBC ?? ''}</td>
      <td class="r">${p.vICMS ?? ''}</td>
      <td class="r">${p.vIPI ?? ''}</td>
      <td class="r">${p.pICMS ?? ''}</td>
      <td class="r">${p.pIPI ?? ''}</td>
    </tr>`,
    )
    .join('');

  const duplicatasHtml = hasDups
    ? d.duplicatas
        .map(
          (dup) => `
        <div style="border:0.3pt solid #888;padding:1.5pt 3pt;font-size:6pt;line-height:1.5">
          <span style="font-size:4.5pt;display:block;text-transform:uppercase">Nº ${dup.nDup}</span>
          <span style="display:block">Venc: ${dup.dVenc}</span>
          <span style="display:block;font-weight:bold">R$&nbsp;${dup.vDup}</span>
        </div>`,
        )
        .join('')
    : '';

  // Canhoto: endereço resumido do destinatário
  const destEndResumo = [
    d.destinatario.logradouro,
    d.destinatario.numero,
    d.destinatario.bairro,
    `${d.destinatario.municipio}-${d.destinatario.uf}`,
  ]
    .filter(Boolean)
    .join(', ');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 7pt;
    color: #000;
    background: #fff;
  }
  .page { width: 190mm; margin: 0 auto; }

  /* Grid */
  .row { display: flex; }
  .row + .row { border-top: 0.5pt solid #000; }
  .cell { padding: 1.5pt 2.5pt; }
  .cell + .cell { border-left: 0.5pt solid #000; }

  /* Label / value */
  .lbl { font-size: 5pt; text-transform: uppercase; display: block; }
  .val { font-size: 7pt; font-weight: bold; display: block; }
  .r { text-align: right; }
  .c { text-align: center; }

  /* Sections */
  .bloco { border: 0.5pt solid #000; }
  .bloco + .bloco { border-top: none; }
  .sec-title {
    font-size: 5pt; font-weight: bold; text-align: center;
    padding: 1pt; text-transform: uppercase; border-bottom: 0.5pt solid #000;
  }

  /* Products table */
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 0.3pt solid #555; padding: 1pt 1.5pt; vertical-align: top; font-size: 5.5pt; }
  th { font-size: 4.5pt; text-align: center; font-weight: bold; background: #f5f5f5; }
  td.desc { word-break: break-word; }

  /* Watermark */
  ${
    isHomologacao
      ? `.watermark {
    position: fixed; top: 50%; left: 0; right: 0; text-align: center;
    transform: translateY(-50%) rotate(-35deg);
    font-size: 56pt; font-weight: bold; color: rgba(200,0,0,0.07);
    pointer-events: none; z-index: 0; white-space: nowrap;
  }`
      : ''
  }
</style>
</head>
<body>
${isHomologacao ? '<div class="watermark">SEM VALOR FISCAL</div>' : ''}
<div class="page">

<!-- ══ CANHOTO ══ -->
<div style="border:0.5pt solid #000;padding:2pt 3pt;font-size:6pt;line-height:1.5;margin-bottom:1pt">
  <div>RECEBEMOS DE <strong>${d.emitente.nome}</strong> OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO.
  EMISSÃO: ${d.dhEmissaoData} &nbsp; VALOR TOTAL: R$&nbsp;${d.totais.vNF} &nbsp; DESTINATÁRIO: ${d.destinatario.nome} - ${destEndResumo}</div>
  <div style="display:flex;margin-top:3pt;border-top:0.3pt dashed #888;padding-top:2pt;gap:6pt">
    <div style="flex:0;white-space:nowrap"><strong>NF-e</strong><br>Nº. ${d.nNF.replace(/^0+/, '') || d.nNF}<br>Série ${d.serie}</div>
    <div style="flex:1;border-left:0.3pt solid #888;padding-left:6pt">
      <span style="font-size:5pt;display:block;text-transform:uppercase">Data de Recebimento</span>
      <div style="height:8pt"></div>
    </div>
    <div style="flex:3;border-left:0.3pt solid #888;padding-left:6pt">
      <span style="font-size:5pt;display:block;text-transform:uppercase">Identificação e Assinatura do Recebedor</span>
      <div style="height:8pt"></div>
    </div>
  </div>
</div>
<div style="border-top:0.5pt dashed #666;margin:2pt 0"></div>

<!-- ══ CABEÇALHO ══ -->
<div class="bloco">
  <div class="row">
    <!-- Emitente (≈28%) -->
    <div class="cell" style="flex:28">
      <div style="font-size:5pt;text-transform:uppercase;margin-bottom:2pt">Identificação do Emitente</div>
      <div style="font-size:10pt;font-weight:bold;font-style:italic;line-height:1.2;margin-bottom:2pt">${d.emitente.nome}</div>
      ${d.emitente.nomeFantasia ? `<div style="font-size:6.5pt;font-style:italic">${d.emitente.nomeFantasia}</div>` : ''}
      <div style="font-size:6.5pt;font-style:italic">${d.emitente.logradouro}, ${d.emitente.numero}${d.emitente.complemento ? ' - ' + d.emitente.complemento : ''} - ${d.emitente.bairro}</div>
      <div style="font-size:6.5pt;font-style:italic">${d.emitente.municipio} - ${d.emitente.uf} &nbsp; ${d.emitente.cep}${d.emitente.fone ? ' &nbsp; Fone/Fax: ' + d.emitente.fone : ''}</div>
    </div>

    <!-- DANFE title (≈13%) -->
    <div class="cell" style="flex:13;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:1pt">
      <div style="font-size:13pt;font-weight:bold;letter-spacing:1pt">DANFE</div>
      <div style="font-size:5pt;line-height:1.3">Documento Auxiliar da<br>Nota Fiscal Eletrônica</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:3pt;margin:2pt 0">
        <div style="font-size:6pt;text-align:left;line-height:1.6">0 - ENTRADA<br>1 - SAÍDA</div>
        <div style="border:0.8pt solid #000;width:13pt;height:13pt;display:flex;align-items:center;justify-content:center;font-size:9pt;font-weight:bold">${isEntrada ? '0' : '1'}</div>
      </div>
      <div style="font-size:5.5pt">Nº.&nbsp;<strong>${d.nNF.replace(/^0+/, '') || d.nNF}</strong></div>
      <div style="font-size:5.5pt">Série&nbsp;<strong>${parseInt(d.serie, 10)}</strong></div>
      <div style="font-size:5.5pt">Folha 1/1</div>
    </div>

    <!-- Chave + barcode (≈59%) -->
    <div class="cell" style="flex:59;display:flex;flex-direction:column;align-items:center;padding:2pt 4pt">
      ${
        barcodeDataUrl
          ? `<img src="${barcodeDataUrl}" style="height:15mm;max-width:100%;object-fit:contain;margin-bottom:2pt" alt="">`
          : '<div style="height:15mm;border:0.3pt dashed #bbb;width:100%;margin-bottom:2pt"></div>'
      }
      <span class="lbl" style="margin-bottom:1pt">Chave de Acesso</span>
      <div style="font-family:'Courier New',Courier,monospace;font-size:7pt;letter-spacing:0.5pt;margin-bottom:2pt;text-align:center;word-break:break-all">${d.chaveAcesso}</div>
      <div style="font-size:4.5pt;text-align:center;line-height:1.5">
        Consulta de autenticidade no portal nacional da NF-e<br>
        www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora
      </div>
    </div>
  </div>
</div>

<!-- ══ NATUREZA / PROTOCOLO ══ -->
<div class="bloco">
  <div class="row">
    <div class="cell" style="flex:2">
      <span class="lbl">Natureza da Operação</span>
      <span class="val">${d.natOp}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Protocolo de Autorização de Uso</span>
      <span class="val">${d.nProt ? `${d.nProt} - ${d.dhRecbto ?? ''}` : '<span style="color:#c00;font-size:6pt;font-weight:normal">SEM PROTOCOLO</span>'}</span>
    </div>
  </div>
</div>

<!-- ══ IE / IM / IE ST / CNPJ ══ -->
<div class="bloco">
  <div class="row">
    <div class="cell" style="flex:2">
      <span class="lbl">Inscrição Estadual</span>
      <span class="val">${d.emitente.ie}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Inscrição Municipal</span>
      <span class="val">${d.emitente.im ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Inscrição Estadual do Subst. Tributário</span>
      <span class="val">${d.emitente.iest ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">CNPJ / CPF</span>
      <span class="val">${d.emitente.cnpj}</span>
    </div>
  </div>
</div>

<!-- ══ DESTINATÁRIO / REMETENTE ══ -->
<div class="bloco">
  <div class="sec-title">Destinatário / Remetente</div>
  <div class="row">
    <div class="cell" style="flex:4">
      <span class="lbl">Nome / Razão Social</span>
      <span class="val">${d.destinatario.nome}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">CNPJ / CPF</span>
      <span class="val">${d.destinatario.cnpj ?? d.destinatario.cpf ?? ''}</span>
    </div>
    <div class="cell" style="flex:1">
      <span class="lbl">Data da Emissão</span>
      <span class="val">${d.dhEmissaoData}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell" style="flex:4">
      <span class="lbl">Endereço</span>
      <span class="val">${d.destinatario.logradouro}, ${d.destinatario.numero}${d.destinatario.complemento ? ' - ' + d.destinatario.complemento : ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Bairro / Distrito</span>
      <span class="val">${d.destinatario.bairro}</span>
    </div>
    <div class="cell" style="flex:1">
      <span class="lbl">CEP</span>
      <span class="val">${d.destinatario.cep}</span>
    </div>
    <div class="cell" style="flex:1">
      <span class="lbl">Data da Saída/Entrada</span>
      <span class="val">${d.dhSaiEntData ?? ''}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell" style="flex:3">
      <span class="lbl">Município</span>
      <span class="val">${d.destinatario.municipio}</span>
    </div>
    <div class="cell" style="max-width:14mm">
      <span class="lbl">UF</span>
      <span class="val">${d.destinatario.uf}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Fone / Fax</span>
      <span class="val">${d.destinatario.fone ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Inscrição Estadual</span>
      <span class="val">${d.destinatario.ie ?? ''}</span>
    </div>
    <div class="cell" style="flex:1">
      <span class="lbl">Hora da Saída/Entrada</span>
      <span class="val">${d.hSaiEnt ?? ''}</span>
    </div>
  </div>
</div>

<!-- ══ FATURA ══ -->
${
  hasDups
    ? `<div class="bloco">
  <div class="sec-title">Fatura</div>
  <div style="display:flex;flex-wrap:wrap;gap:3pt;padding:2pt 4pt">
    ${duplicatasHtml}
  </div>
</div>`
    : ''
}

<!-- ══ CÁLCULO DO IMPOSTO ══ -->
<div class="bloco">
  <div class="sec-title">Cálculo do Imposto</div>
  <div class="row">
    <div class="cell r" style="flex:1">
      <span class="lbl">Base de Cálc. do ICMS</span>
      <span class="val">${d.totais.vBC}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Valor do ICMS</span>
      <span class="val">${d.totais.vICMS}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Base de Cálc. ICMS S.T.</span>
      <span class="val">${d.totais.vBCST}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Valor do ICMS Subst.</span>
      <span class="val">${d.totais.vST}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">V. Imp. Importação</span>
      <span class="val">${d.totais.vII}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">V. ICMS UF Remet.</span>
      <span class="val">${d.totais.vICMSUFRem ?? '0,00'}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">V. FCP UF Dest.</span>
      <span class="val">${d.totais.vFCPUFDest ?? '0,00'}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">V. Total Produtos</span>
      <span class="val">${d.totais.vProd}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell r" style="flex:1">
      <span class="lbl">Valor do Frete</span>
      <span class="val">${d.totais.vFrete}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Valor do Seguro</span>
      <span class="val">${d.totais.vSeg}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Desconto</span>
      <span class="val">${d.totais.vDesc}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Outras Despesas</span>
      <span class="val">${d.totais.vOutro}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Valor Total IPI</span>
      <span class="val">${d.totais.vIPI}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">V. ICMS UF Dest.</span>
      <span class="val">${d.totais.vICMSUFDest ?? '0,00'}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">V. Tot. Trib.</span>
      <span class="val">${d.totais.vTotTrib ?? '0,00'}</span>
    </div>
    <div class="cell r" style="flex:1;background:#f5f5f5">
      <span class="lbl" style="font-weight:bold">V. Total da Nota</span>
      <span class="val" style="font-size:9pt">R$&nbsp;${d.totais.vNF}</span>
    </div>
  </div>
</div>

<!-- ══ TRANSPORTADOR ══ -->
<div class="bloco">
  <div class="sec-title">Transportador / Volumes Transportados</div>
  <div class="row">
    <div class="cell" style="flex:3">
      <span class="lbl">Nome / Razão Social</span>
      <span class="val">${d.transporte.transportadoraNome ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Frete</span>
      <span class="val" style="font-size:6pt">${d.transporte.modFreteLabel}</span>
    </div>
    <div class="cell" style="flex:1">
      <span class="lbl">Código ANTT</span>
      <span class="val">${d.transporte.veiculoRNTC ?? ''}</span>
    </div>
    <div class="cell" style="flex:1">
      <span class="lbl">Placa do Veículo</span>
      <span class="val">${d.transporte.veiculoPlaca ?? ''}</span>
    </div>
    <div class="cell" style="max-width:14mm">
      <span class="lbl">UF</span>
      <span class="val">${d.transporte.veiculoUf ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">CNPJ / CPF</span>
      <span class="val">${d.transporte.transportadoraCnpj ?? ''}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell" style="flex:4">
      <span class="lbl">Endereço</span>
      <span class="val">${d.transporte.transportadoraEndereco ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Município</span>
      <span class="val">${d.transporte.transportadoraMunicipio ?? ''}</span>
    </div>
    <div class="cell" style="max-width:14mm">
      <span class="lbl">UF</span>
      <span class="val">${d.transporte.transportadoraUf ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Inscrição Estadual</span>
      <span class="val">${d.transporte.transportadoraIe ?? ''}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell c" style="flex:1">
      <span class="lbl">Quantidade</span>
      <span class="val">${d.transporte.volumes?.map((v) => v.qVol).join(', ') ?? ''}</span>
    </div>
    <div class="cell c" style="flex:2">
      <span class="lbl">Espécie</span>
      <span class="val">${d.transporte.volumes?.map((v) => v.esp).join(', ') ?? ''}</span>
    </div>
    <div class="cell" style="flex:2">
      <span class="lbl">Marca</span>
      <span class="val">${d.transporte.volumes?.map((v) => v.marca ?? '').join(', ') ?? ''}</span>
    </div>
    <div class="cell c" style="flex:1">
      <span class="lbl">Numeração</span>
      <span class="val">${d.transporte.volumes?.map((v) => v.nVol ?? '').join(', ') ?? ''}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Peso Bruto</span>
      <span class="val">${d.transporte.volumes?.map((v) => v.pesoB).join(', ') ?? ''}</span>
    </div>
    <div class="cell r" style="flex:1">
      <span class="lbl">Peso Líquido</span>
      <span class="val">${d.transporte.volumes?.map((v) => v.pesoL).join(', ') ?? ''}</span>
    </div>
  </div>
</div>

<!-- ══ DADOS DOS PRODUTOS / SERVIÇOS ══ -->
<div class="bloco">
  <div class="sec-title">Dados dos Produtos / Serviços</div>
  <table>
    <thead>
      <tr>
        <th style="width:16mm">Código<br>Produto</th>
        <th style="min-width:30mm">Descrição do Produto / Serviço</th>
        <th style="width:11mm">NCM/SH</th>
        <th style="width:7mm">O/CST</th>
        <th style="width:8mm">CFOP</th>
        <th style="width:7mm">UN</th>
        <th style="width:12mm">Quant</th>
        <th style="width:13mm">Valor<br>Unit</th>
        <th style="width:13mm">Valor<br>Total</th>
        <th style="width:11mm">Valor<br>Desc</th>
        <th style="width:13mm">B.Cálc<br>ICMS</th>
        <th style="width:12mm">Valor<br>ICMS</th>
        <th style="width:10mm">Valor<br>IPI</th>
        <th style="width:9mm">Alíq.<br>ICMS</th>
        <th style="width:9mm">Alíq.<br>IPI</th>
      </tr>
    </thead>
    <tbody>
      ${produtosHtml}
    </tbody>
  </table>
</div>

<!-- ══ DADOS ADICIONAIS ══ -->
<div class="bloco">
  <div class="sec-title">Dados Adicionais</div>
  <div class="row">
    <div class="cell" style="flex:3;min-height:20mm">
      <span class="lbl">Informações Complementares</span>
      <div style="font-size:6.5pt;white-space:pre-wrap;margin-top:2pt">${infCplFinal}</div>
    </div>
    <div class="cell" style="flex:1;min-height:20mm">
      <span class="lbl">Reservado ao Fisco</span>
      <div style="font-size:6.5pt;white-space:pre-wrap;margin-top:2pt">${d.infFisco ?? ''}</div>
    </div>
  </div>
</div>

</div>
</body>
</html>`;
}
