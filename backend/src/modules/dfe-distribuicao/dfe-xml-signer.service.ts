import { Injectable, Logger } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';

/**
 * Assina XML de evento NF-e com xmldsig conforme xmldsig-core-schema_v1.01.xsd da SEFAZ.
 *
 * O XSD customizado da SEFAZ fixa algoritmos específicos:
 *  - Canonicalização SignedInfo: C14N 1.0 inclusive (REC-xml-c14n-20010315)
 *  - Digest:                     SHA-1 (xmldsig#sha1)
 *  - Assinatura:                 RSA-SHA1 (xmldsig#rsa-sha1)
 *  - Transforms (obrigatoriamente 2): enveloped-signature + C14N 1.0
 *
 * O bloco <Signature> é inserido imediatamente após <infEvento>
 * (irmão dentro de <evento>), conforme exigido pela SEFAZ para
 * NFeRecepcaoEvento (MOC 7.0 seção 5.8).
 */
@Injectable()
export class DfeXmlSignerService {
  private readonly logger = new Logger(DfeXmlSignerService.name);

  /** URI do algoritmo de canonicalização C14N 1.0 inclusiva (exigido pela SEFAZ). */
  private readonly C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315' as const;

  /** URI da transform enveloped-signature (exigida como 1º transform pela SEFAZ). */
  private readonly ENVELOPED_SIG = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature' as const;

  /** URI do algoritmo de digest SHA-1 (fixo no XSD SEFAZ). */
  private readonly SHA1_DIGEST = 'http://www.w3.org/2000/09/xmldsig#sha1' as const;

  /** URI do algoritmo de assinatura RSA-SHA1 (fixo no XSD SEFAZ). */
  private readonly RSA_SHA1_SIG = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' as const;

  // ────────────────────────────────────────────────────────────────────────────
  // API pública
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Assina um XML de evento NF-e conforme xmldsig.
   *
   * O XML de entrada deve conter o elemento `<infEvento Id="...">` sem
   * assinatura. Este método retorna o XML com o bloco `<Signature>`
   * inserido após `<infEvento>`, dentro do elemento `<evento>`.
   *
   * @param xmlString XML do envelope de evento (sem assinatura)
   * @param pemKey    Chave privada PEM (do DfeCertLoaderService)
   * @param pemCert   Certificado público PEM (do DfeCertLoaderService)
   * @returns XML com o bloco <Signature> inserido
   * @throws Error se o XML não contiver o atributo Id em <infEvento>
   */
  assinarEvento(xmlString: string, pemKey: string, pemCert: string): string {
    const infEventoId = this.extrairInfEventoId(xmlString);

    const sig = new SignedXml({
      privateKey: pemKey,
      publicCert: pemCert,
      signatureAlgorithm: this.RSA_SHA1_SIG,
      canonicalizationAlgorithm: this.C14N,
    });

    sig.addReference({
      xpath: `//*[@Id='${infEventoId}']`,
      // SEFAZ XSD exige exatamente 2 transforms nesta ordem
      transforms: [this.ENVELOPED_SIG, this.C14N],
      digestAlgorithm: this.SHA1_DIGEST,
    });

    sig.computeSignature(xmlString, {
      location: {
        reference: `//*[@Id='${infEventoId}']`,
        action: 'after',
      },
    });

    this.logger.debug(`Evento assinado — infEvento Id="${infEventoId}"`);

    return sig.getSignedXml();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Extrai o valor do atributo `Id` do elemento `<infEvento>`.
   *
   * Formato esperado (MOC 7.0 seção 5.8.1):
   *   ID{tpEvento}{chNFe}{nSeqEvento_2dígitos}
   * Exemplo:
   *   ID21020044444444444444444444444444444444444400108901
   */
  private extrairInfEventoId(xmlString: string): string {
    // Regex tolerante a espaços e atributos extras antes de Id
    const match = xmlString.match(/<infEvento[^>]*\sId="([^"]+)"/);
    if (!match) {
      throw new Error(
        'XML de evento inválido: elemento <infEvento> não encontrado ou não possui atributo Id.',
      );
    }
    return match[1];
  }
}
