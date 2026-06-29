import { Injectable, Logger } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';

/**
 * Assina XML de evento do CT-e com xmldsig conforme o padrão da SEFAZ.
 *
 * Algoritmos fixados pelo XSD da SEFAZ (mesmos da NF-e):
 *  - Canonicalização SignedInfo: C14N 1.0 inclusive (REC-xml-c14n-20010315)
 *  - Digest:                     SHA-1 (xmldsig#sha1)
 *  - Assinatura:                 RSA-SHA1 (xmldsig#rsa-sha1)
 *  - Transforms (obrigatoriamente 2): enveloped-signature + C14N 1.0
 *
 * O bloco <Signature> é inserido imediatamente após <infEvento>
 * (irmão dentro de <eventoCTe>), conforme exigido pela SEFAZ para
 * CTeRecepcaoEventoV4.
 */
@Injectable()
export class CteXmlSignerService {
  private readonly logger = new Logger(CteXmlSignerService.name);

  private readonly C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315' as const;
  private readonly ENVELOPED_SIG = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature' as const;
  private readonly SHA1_DIGEST = 'http://www.w3.org/2000/09/xmldsig#sha1' as const;
  private readonly RSA_SHA1_SIG = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' as const;

  /**
   * Assina um XML de evento do CT-e conforme xmldsig.
   *
   * O XML de entrada deve conter o elemento `<infEvento Id="...">` sem
   * assinatura. Retorna o XML com o bloco `<Signature>` inserido após
   * `<infEvento>`, dentro do elemento `<eventoCTe>`.
   *
   * @param xmlString XML do evento (sem assinatura)
   * @param pemKey    Chave privada PEM
   * @param pemCert   Certificado público PEM
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

    this.logger.debug(`Evento CT-e assinado — infEvento Id="${infEventoId}"`);

    return sig.getSignedXml();
  }

  /**
   * Extrai o valor do atributo `Id` do elemento `<infEvento>`.
   * Formato: ID{tpEvento}{chCTe}{nSeqEvento_2dígitos}
   */
  private extrairInfEventoId(xmlString: string): string {
    const match = xmlString.match(/<infEvento[^>]*\sId="([^"]+)"/);
    if (!match) {
      throw new Error(
        'XML de evento inválido: elemento <infEvento> não encontrado ou não possui atributo Id.',
      );
    }
    return match[1];
  }
}
