import { XMLParser } from 'fast-xml-parser';

export interface DanfeEmitente {
  cnpj: string;
  ie: string;
  im?: string;
  iest?: string;
  nome: string;
  nomeFantasia?: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  fone?: string;
  crt: string; // 1=SN, 2=SN excesso receita, 3=Regime Normal
}

export interface DanfeDestinatario {
  cnpj?: string;
  cpf?: string;
  ie?: string;
  nome: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  fone?: string;
  email?: string;
  indIEDest?: string;
}

export interface DanfeProduto {
  cProd: string;
  xProd: string;
  ncm: string;
  cfop: string;
  uCom: string;
  qCom: string;
  vUnCom: string;
  vProd: string;
  vDesc?: string;
  // ICMS
  cst?: string;
  vBC?: string;
  pICMS?: string;
  vICMS?: string;
  // IPI
  vIPI?: string;
  pIPI?: string;
}

export interface DanfeTotais {
  vBC: string;
  vICMS: string;
  vICMSDeson?: string;
  vBCST: string;
  vST: string;
  vProd: string;
  vFrete: string;
  vSeg: string;
  vDesc: string;
  vII: string;
  vIPI: string;
  vPIS: string;
  vCOFINS: string;
  vOutro: string;
  vNF: string;
  vFCPUFDest?: string;
  vICMSUFDest?: string;
  vICMSUFRem?: string;
  vTotTrib?: string;
}

export interface DanfeTransporte {
  modFrete: string;
  modFreteLabel: string;
  transportadoraNome?: string;
  transportadoraCnpj?: string;
  transportadoraIe?: string;
  transportadoraEndereco?: string;
  transportadoraMunicipio?: string;
  transportadoraUf?: string;
  veiculoPlaca?: string;
  veiculoUf?: string;
  veiculoRNTC?: string;
  volumes?: DanfeVolume[];
}

export interface DanfeVolume {
  qVol?: string;
  esp?: string;
  marca?: string;
  nVol?: string;
  pesoL?: string;
  pesoB?: string;
}

export interface DanfeDuplicata {
  nDup: string;
  dVenc: string;
  vDup: string;
}

export interface DanfeData {
  // Identificação
  chaveAcesso: string;     // formatted: 11 groups of 4 digits
  chaveAcessoRaw: string;  // raw 44 digits (for barcode)
  nNF: string;
  serie: string;
  dhEmissao: string;       // full datetime (for protocol area)
  dhEmissaoData: string;   // date only "dd/mm/aaaa"
  dhSaiEnt?: string;       // full datetime
  dhSaiEntData?: string;   // date only
  hSaiEnt?: string;        // time only "hh:mm:ss"
  tpNF: string; // 0=Entrada, 1=Saída
  tpEmis: string;
  natOp: string;
  tpAmb: string; // 1=Produção, 2=Homologação
  // Protocolo
  nProt?: string;
  dhRecbto?: string;
  // Emitente
  emitente: DanfeEmitente;
  // Destinatário
  destinatario: DanfeDestinatario;
  // Produtos
  produtos: DanfeProduto[];
  // Totais
  totais: DanfeTotais;
  // Transporte
  transporte: DanfeTransporte;
  // Cobrança
  duplicatas: DanfeDuplicata[];
  // Informações adicionais
  infCpl?: string;
  infFisco?: string;
}

const MOD_FRETE: Record<string, string> = {
  '0': '0 - Por conta do emitente',
  '1': '1 - Por conta do destinatário',
  '2': '2 - Por conta de terceiros',
  '3': '3 - Transporte próprio por conta do remetente',
  '4': '4 - Transporte próprio por conta do destinatário',
  '9': '9 - Sem ocorrência de transporte',
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['det', 'vol', 'dup', 'autXML'].includes(name),
});

function s(v: any): string {
  return v != null ? String(v).trim() : '';
}

function fmtCnpj(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v;
}

function fmtCep(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : v;
}

function fmtFone(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return v;
}

function fmtData(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtDataHora(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtSomenteData(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function fmtSomenteHora(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtValor(v: any, decimais = 2): string {
  const n = Number.parseFloat(String(v ?? '0'));
  if (isNaN(n)) return '0,' + '0'.repeat(decimais);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
}

function fmtChave(chave: string): string {
  return chave.replace(/(\d{4})/g, '$1 ').trim();
}

function fmtChaveComTracos(chave: string): string {
  // Formata em grupos de 4 dígitos
  return chave.match(/.{1,4}/g)?.join(' ') ?? chave;
}

export function mapXmlParaDanfe(xmlBuffer: Buffer): DanfeData {
  const xmlStr = xmlBuffer.toString('utf8');
  const parsed = xmlParser.parse(xmlStr);

  const nfeProc = parsed?.nfeProc ?? parsed;
  const nfe = nfeProc?.NFe ?? nfeProc;
  const infNFe = nfe?.infNFe ?? nfe;
  const prot = nfeProc?.protNFe?.infProt ?? {};

  const ide = infNFe?.ide ?? {};
  const emit = infNFe?.emit ?? {};
  const endEmit = emit?.enderEmit ?? {};
  const dest = infNFe?.dest ?? {};
  const endDest = dest?.enderDest ?? {};
  const total = infNFe?.total?.ICMSTot ?? {};
  const transp = infNFe?.transp ?? {};
  const cobr = infNFe?.cobr ?? {};
  const infAdic = infNFe?.infAdic ?? {};

  const rawId = s(infNFe?.['@_Id'] ?? '');
  const chaveAcesso = rawId.replace(/^NFe/, '');

  // Emitente
  const emitente: DanfeEmitente = {
    cnpj: fmtCnpj(s(emit?.CNPJ ?? emit?.CPF ?? '')),
    ie: s(emit?.IE ?? ''),
    im: s(emit?.IM ?? '') || undefined,
    iest: s(emit?.IEST ?? '') || undefined,
    nome: s(emit?.xNome ?? ''),
    nomeFantasia: s(emit?.xFant ?? '') || undefined,
    logradouro: s(endEmit?.xLgr ?? ''),
    numero: s(endEmit?.nro ?? ''),
    complemento: s(endEmit?.xCpl ?? '') || undefined,
    bairro: s(endEmit?.xBairro ?? ''),
    municipio: s(endEmit?.xMun ?? ''),
    uf: s(endEmit?.UF ?? ''),
    cep: fmtCep(s(endEmit?.CEP ?? '')),
    fone: endEmit?.fone ? fmtFone(s(endEmit.fone)) : undefined,
    crt: s(emit?.CRT ?? '3'),
  };

  // Destinatário
  const destinatario: DanfeDestinatario = {
    cnpj: dest?.CNPJ ? fmtCnpj(s(dest.CNPJ)) : undefined,
    cpf: dest?.CPF ? fmtCnpj(s(dest.CPF)) : undefined,
    ie: s(dest?.IE ?? '') || undefined,
    nome: s(dest?.xNome ?? ''),
    logradouro: s(endDest?.xLgr ?? ''),
    numero: s(endDest?.nro ?? ''),
    complemento: s(endDest?.xCpl ?? '') || undefined,
    bairro: s(endDest?.xBairro ?? ''),
    municipio: s(endDest?.xMun ?? ''),
    uf: s(endDest?.UF ?? ''),
    cep: fmtCep(s(endDest?.CEP ?? '')),
    fone: endDest?.fone ? fmtFone(s(endDest.fone)) : undefined,
    email: s(dest?.email ?? '') || undefined,
    indIEDest: s(dest?.indIEDest ?? '') || undefined,
  };

  // Produtos
  const detArr: any[] = Array.isArray(infNFe?.det)
    ? infNFe.det
    : infNFe?.det
    ? [infNFe.det]
    : [];

  const produtos: DanfeProduto[] = detArr.map((det: any) => {
    const prod = det?.prod ?? {};
    const imposto = det?.imposto ?? {};
    const icms = imposto?.ICMS ?? {};
    const icmsGrupo = Object.values(icms)[0] as any ?? {};
    const ipi = imposto?.IPI ?? {};
    const ipiTrib = ipi?.IPITrib ?? ipi?.IPINT ?? {};

    return {
      cProd: s(prod?.cProd ?? ''),
      xProd: s(prod?.xProd ?? ''),
      ncm: s(prod?.NCM ?? ''),
      cfop: s(prod?.CFOP ?? ''),
      uCom: s(prod?.uCom ?? ''),
      qCom: fmtValor(prod?.qCom, 4),
      vUnCom: fmtValor(prod?.vUnCom, 4),
      vProd: fmtValor(prod?.vProd),
      vDesc: prod?.vDesc ? fmtValor(prod.vDesc) : undefined,
      cst: s(icmsGrupo?.CST ?? icmsGrupo?.CSOSN ?? ''),
      vBC: fmtValor(icmsGrupo?.vBC),
      pICMS: fmtValor(icmsGrupo?.pICMS),
      vICMS: fmtValor(icmsGrupo?.vICMS),
      vIPI: fmtValor(ipiTrib?.vIPI),
      pIPI: fmtValor(ipiTrib?.pIPI),
    };
  });

  // Totais
  const totais: DanfeTotais = {
    vBC: fmtValor(total?.vBC),
    vICMS: fmtValor(total?.vICMS),
    vICMSDeson: total?.vICMSDeson ? fmtValor(total.vICMSDeson) : undefined,
    vBCST: fmtValor(total?.vBCST),
    vST: fmtValor(total?.vST),
    vProd: fmtValor(total?.vProd),
    vFrete: fmtValor(total?.vFrete),
    vSeg: fmtValor(total?.vSeg),
    vDesc: fmtValor(total?.vDesc),
    vII: fmtValor(total?.vII),
    vIPI: fmtValor(total?.vIPI),
    vPIS: fmtValor(total?.vPIS),
    vCOFINS: fmtValor(total?.vCOFINS),
    vOutro: fmtValor(total?.vOutro),
    vNF: fmtValor(total?.vNF),
    vFCPUFDest: fmtValor(total?.vFCPUFDest),
    vICMSUFDest: fmtValor(total?.vICMSUFDest),
    vICMSUFRem: fmtValor(total?.vICMSUFRem),
    vTotTrib: fmtValor(total?.vTotTrib),
  };

  // Transporte
  const modFrete = s(transp?.modFrete ?? '9');
  const transportadora = transp?.transporta ?? {};
  const veic = transp?.veicTransp ?? {};
  const vols: any[] = Array.isArray(transp?.vol)
    ? transp.vol
    : transp?.vol
    ? [transp.vol]
    : [];

  const transporte: DanfeTransporte = {
    modFrete,
    modFreteLabel: MOD_FRETE[modFrete] ?? modFrete,
    transportadoraNome: s(transportadora?.xNome ?? '') || undefined,
    transportadoraCnpj: transportadora?.CNPJ ? fmtCnpj(s(transportadora.CNPJ)) : undefined,
    transportadoraIe: s(transportadora?.IE ?? '') || undefined,
    transportadoraEndereco: s(transportadora?.xEnder ?? '') || undefined,
    transportadoraMunicipio: s(transportadora?.xMun ?? '') || undefined,
    transportadoraUf: s(transportadora?.UF ?? '') || undefined,
    veiculoPlaca: s(veic?.placa ?? '') || undefined,
    veiculoUf: s(veic?.UF ?? '') || undefined,
    veiculoRNTC: s(veic?.RNTC ?? '') || undefined,
    volumes: vols.map((v: any) => ({
      qVol: s(v?.qVol ?? ''),
      esp: s(v?.esp ?? ''),
      marca: s(v?.marca ?? '') || undefined,
      nVol: s(v?.nVol ?? '') || undefined,
      pesoL: fmtValor(v?.pesoL, 3),
      pesoB: fmtValor(v?.pesoB, 3),
    })),
  };

  // Duplicatas (cobrança)
  const dups: any[] = Array.isArray(cobr?.dup)
    ? cobr.dup
    : cobr?.dup
    ? [cobr.dup]
    : [];

  const duplicatas: DanfeDuplicata[] = dups.map((d: any) => ({
    nDup: s(d?.nDup ?? ''),
    dVenc: fmtData(s(d?.dVenc ?? '')),
    vDup: fmtValor(d?.vDup),
  }));

  const dhEmiRaw = s(ide?.dhEmi ?? ide?.dEmi ?? '');
  const dhSaiEntRaw = s(ide?.dhSaiEnt ?? ide?.dSaiEnt ?? '');

  return {
    chaveAcesso: fmtChaveComTracos(chaveAcesso),
    chaveAcessoRaw: chaveAcesso,
    nNF: s(ide?.nNF ?? '').padStart(9, '0'),
    serie: s(ide?.serie ?? '').padStart(3, '0'),
    dhEmissao: fmtDataHora(dhEmiRaw),
    dhEmissaoData: fmtSomenteData(dhEmiRaw),
    dhSaiEnt: dhSaiEntRaw ? fmtDataHora(dhSaiEntRaw) : undefined,
    dhSaiEntData: dhSaiEntRaw ? fmtSomenteData(dhSaiEntRaw) : undefined,
    hSaiEnt: dhSaiEntRaw ? fmtSomenteHora(dhSaiEntRaw) : undefined,
    tpNF: s(ide?.tpNF ?? '1'),
    tpEmis: s(ide?.tpEmis ?? '1'),
    natOp: s(ide?.natOp ?? ''),
    tpAmb: s(ide?.tpAmb ?? '1'),
    nProt: s(prot?.nProt ?? '') || undefined,
    dhRecbto: prot?.dhRecbto ? fmtDataHora(s(prot.dhRecbto)) : undefined,
    emitente,
    destinatario,
    produtos,
    totais,
    transporte,
    duplicatas,
    infCpl: s(infAdic?.infCpl ?? '') || undefined,
    infFisco: s(infAdic?.infAdFisco ?? '') || undefined,
  };
}
