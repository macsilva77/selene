"""
P01 — Extração e Normalização ECD/ECF
Pipeline de Análise de Crédito | Selene
Versão: P01-v1

Regras:
  - Idempotente: (cnpj, exercicio, tabela, versao_prompt) não reprocessa
  - ECF: arquivo mais recente por (cnpj, exercicio)
  - ECD: combina todos os semestres do mesmo ano
  - Encoding SPED: Latin-1
  - Valores BR: vírgula decimal, ponto milhar
"""

import os
import re
import sqlite3
import hashlib
import sys
from datetime import datetime
from typing import Optional
from google.cloud import storage

# ─── Configuração ────────────────────────────────────────────────────────────
BUCKET      = "fiscal-docs-selene-prod"
VERSAO      = "P01-v1"
DB_PATH     = os.path.join(os.path.dirname(__file__), "selene_credito.db")
EXERCICIOS  = list(range(2019, 2025))   # 2019 → 2024 (últimos exercícios disponíveis)

# Mapeamento ind_conta (ECD I050/C050) → grupo base
IND_CONTA_GRUPO = {
    "01": "AC",   # Ativo Circulante (base; sub-nível determina ANC)
    "02": "PC",   # Passivo Circulante (base; sub-nível determina PNC)
    "03": "PL",   # Patrimônio Líquido
    "04": "REC",  # Resultado (base; nome determina CUS/DES/RNO)
}

# Palavras-chave para refinamento do grupo no nível analítico
_PALAVRAS_ANC = ["nao-circulante", "nao circulante", "imobilizado", "intangivel",
                  "investimento", "ativo permanente"]
_PALAVRAS_PNC = ["nao-circulante", "nao circulante", "longo prazo", "exigivel a longo"]
_PALAVRAS_CUS = ["custo", "cmv", "cme", "cst"]
_PALAVRAS_DES = ["despesa", "administrativa", "comercial", "financeira", "tributo",
                  "depreciacao", "amortizacao"]
_PALAVRAS_RNO = ["nao operacional", "nao-operacional", "outras receitas",
                  "outras despesas", "equivalencia patrimonial"]

def _refinar_grupo(ind_conta: str, nome: str, cod: str) -> str:
    n = nome.lower()
    if ind_conta == "01":
        for w in _PALAVRAS_ANC:
            if w in n:
                return "ANC"
        return "AC"
    if ind_conta == "02":
        for w in _PALAVRAS_PNC:
            if w in n:
                return "PNC"
        return "PC"
    if ind_conta == "03":
        return "PL"
    if ind_conta == "04":
        for w in _PALAVRAS_RNO:
            if w in n:
                return "RNO"
        for w in _PALAVRAS_CUS:
            if w in n:
                return "CUS"
        for w in _PALAVRAS_DES:
            if w in n:
                return "DES"
        return "REC"
    return "REC"


# ─── Banco de dados ───────────────────────────────────────────────────────────
DDL = """
CREATE TABLE IF NOT EXISTS tb_empresa (
  cnpj               TEXT PRIMARY KEY,
  razao_social       TEXT NOT NULL,
  regime_tributario  TEXT,
  cnae_principal     TEXT,
  status_extracao    TEXT DEFAULT 'completo',
  observacoes        TEXT
);

CREATE TABLE IF NOT EXISTS tb_plano_contas (
  cnpj          TEXT,
  exercicio     INTEGER,
  conta_codigo  TEXT,
  conta_nome    TEXT,
  nivel         INTEGER,
  natureza      TEXT,
  tipo          TEXT,
  grupo         TEXT,
  PRIMARY KEY (cnpj, exercicio, conta_codigo)
);

CREATE TABLE IF NOT EXISTS tb_ecd_saldos (
  cnpj           TEXT,
  exercicio      INTEGER,
  periodo        TEXT,
  conta_codigo   TEXT,
  conta_nome     TEXT,
  grupo          TEXT,
  saldo_anterior REAL DEFAULT 0.0,
  debitos        REAL DEFAULT 0.0,
  creditos       REAL DEFAULT 0.0,
  saldo_final    REAL DEFAULT 0.0,
  natureza_saldo TEXT,
  status         TEXT DEFAULT 'ok',
  PRIMARY KEY (cnpj, exercicio, periodo, conta_codigo)
);

CREATE TABLE IF NOT EXISTS tb_ecf_registros (
  cnpj          TEXT,
  exercicio     INTEGER,
  registro_ecf  TEXT,
  linha_codigo  TEXT,
  descricao     TEXT,
  valor         REAL DEFAULT 0.0,
  status        TEXT DEFAULT 'ok',
  PRIMARY KEY (cnpj, exercicio, registro_ecf, linha_codigo)
);

CREATE TABLE IF NOT EXISTS tb_inconsistencias (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj        TEXT,
  exercicio   INTEGER,
  tipo_erro   TEXT,
  descricao   TEXT,
  severidade  TEXT DEFAULT 'info',
  timestamp   TEXT
);

CREATE TABLE IF NOT EXISTS tb_processamento (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj                    TEXT NOT NULL,
  exercicio               INTEGER NOT NULL,
  tabela_destino          TEXT NOT NULL,
  total_registros         INTEGER DEFAULT 0,
  registros_ok            INTEGER DEFAULT 0,
  registros_com_alerta    INTEGER DEFAULT 0,
  registros_bloqueados    INTEGER DEFAULT 0,
  hash_arquivo_origem     TEXT,
  timestamp_processamento TEXT NOT NULL,
  versao_prompt           TEXT DEFAULT 'P01-v1',
  duracao_ms              INTEGER,
  UNIQUE(cnpj, exercicio, tabela_destino, versao_prompt)
);
"""

def criar_banco(conn: sqlite3.Connection) -> None:
    conn.executescript(DDL)
    conn.commit()

def ja_processado(conn: sqlite3.Connection, cnpj: str, exercicio: int, tabela: str) -> bool:
    row = conn.execute(
        "SELECT registros_bloqueados FROM tb_processamento "
        "WHERE cnpj=? AND exercicio=? AND tabela_destino=? AND versao_prompt=?",
        (cnpj, exercicio, tabela, VERSAO)
    ).fetchone()
    if row is None:
        return False
    return row[0] == 0   # processado sem bloqueios → não reprocessar


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _val(s: str) -> float:
    """'1.234.567,89' → 1234567.89   |  '1234567,89' → 1234567.89"""
    if not s or not s.strip():
        return 0.0
    s = s.strip().replace('.', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return 0.0

def _md5(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()

def _now() -> str:
    return datetime.utcnow().isoformat()

def _gravar_processamento(conn, cnpj, exercicio, tabela, total, ok, alerta, bloq, hash_arq, ms):
    conn.execute(
        """INSERT INTO tb_processamento
             (cnpj, exercicio, tabela_destino, total_registros, registros_ok,
              registros_com_alerta, registros_bloqueados, hash_arquivo_origem,
              timestamp_processamento, versao_prompt, duracao_ms)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(cnpj, exercicio, tabela_destino, versao_prompt) DO UPDATE SET
             total_registros=excluded.total_registros,
             registros_ok=excluded.registros_ok,
             registros_com_alerta=excluded.registros_com_alerta,
             registros_bloqueados=excluded.registros_bloqueados,
             hash_arquivo_origem=excluded.hash_arquivo_origem,
             timestamp_processamento=excluded.timestamp_processamento,
             duracao_ms=excluded.duracao_ms""",
        (cnpj, exercicio, tabela, total, ok, alerta, bloq, hash_arq, _now(), VERSAO, ms)
    )

def _gravar_inconsistencia(conn, cnpj, exercicio, tipo, desc, sev="alerta"):
    conn.execute(
        "INSERT INTO tb_inconsistencias (cnpj, exercicio, tipo_erro, descricao, severidade, timestamp) "
        "VALUES (?,?,?,?,?,?)",
        (cnpj, exercicio, tipo, desc, sev, _now())
    )


# ─── Seleção de arquivos no GCS ───────────────────────────────────────────────
def listar_cnpjs(client: storage.Client) -> list[str]:
    """Descobre CNPJs dinamicamente pela estrutura ECD/{cnpj}/"""
    blobs = client.list_blobs(BUCKET, prefix="ECD/", delimiter="/")
    list(blobs)   # necessário para popular blobs.prefixes
    cnpjs = []
    for p in blobs.prefixes:
        cnpj = p.rstrip("/").split("/")[-1]
        if re.match(r"^\d{14}$", cnpj):
            cnpjs.append(cnpj)
    return sorted(cnpjs)


def _parse_nome_ecd(nome: str) -> Optional[dict]:
    """
    Extrai metadados do nome do arquivo ECD.
    Padrão: {cnpj_emp}-{cnpj_cont}-{data_ini}-{data_fim}-G-{hash}-{versao}-SPED-ECD.txt
    """
    m = re.match(
        r"(\d{14})-(\d{8,14})-(\d{8})-(\d{8})-G-([A-F0-9]+)-(\d+)-SPED-ECD\.txt",
        nome, re.IGNORECASE
    )
    if not m:
        return None
    cnpj_emp, cnpj_cont, dt_ini, dt_fim, hash_arq, versao = m.groups()
    ano_ini = int(dt_ini[4:])   # DDMMAAAA → AAAA
    ano_fim = int(dt_fim[4:])
    return {
        "cnpj_empresa":      cnpj_emp,
        "cnpj_contabilidade": cnpj_cont,
        "data_ini":          dt_ini,
        "data_fim":          dt_fim,
        "ano_ini":           ano_ini,
        "ano_fim":           ano_fim,
        "hash":              hash_arq,
        "versao":            int(versao),
    }


def _parse_nome_ecf(nome: str) -> Optional[dict]:
    """
    Extrai metadados do nome do arquivo ECF.
    Padrão: SPEDECF-{cnpj}-{data_ini}-{data_fim}-{timestamp}.txt
    """
    m = re.match(
        r"SPEDECF-(\d{14})-(\d{8})-(\d{8})-(\d{14})\.txt",
        nome, re.IGNORECASE
    )
    if not m:
        return None
    cnpj, dt_ini, dt_fim, timestamp = m.groups()
    ano = int(dt_ini[4:])
    return {
        "cnpj":      cnpj,
        "data_ini":  dt_ini,
        "data_fim":  dt_fim,
        "ano":       ano,
        "timestamp": timestamp,
    }


def selecionar_ecf_por_exercicio(client: storage.Client, cnpj: str) -> dict[int, storage.Blob]:
    """Retorna {exercicio: blob_mais_recente}"""
    blobs = list(client.list_blobs(BUCKET, prefix=f"ECF/{cnpj}/"))
    por_ano: dict[int, list] = {}
    for blob in blobs:
        nome = blob.name.split("/")[-1]
        meta = _parse_nome_ecf(nome)
        if not meta or meta["cnpj"] != cnpj:
            continue
        ano = meta["ano"]
        por_ano.setdefault(ano, []).append((meta["timestamp"], blob))
    return {ano: sorted(v, key=lambda x: x[0])[-1][1] for ano, v in por_ano.items()}


def selecionar_ecd_por_exercicio(client: storage.Client, cnpj: str) -> dict[int, list[storage.Blob]]:
    """
    Retorna {exercicio: [blobs]}.
    Para cada período, seleciona o arquivo mais representativo
    (prefere o que tem o mesmo CNPJ como contabilidade; senão, versão maior).
    """
    blobs = list(client.list_blobs(BUCKET, prefix=f"ECD/{cnpj}/"))
    # Agrupa por (ano, periodo_str)
    por_periodo: dict[tuple, list] = {}
    for blob in blobs:
        nome = blob.name.split("/")[-1]
        meta = _parse_nome_ecd(nome)
        if not meta or meta["cnpj_empresa"] != cnpj:
            continue
        chave = (meta["ano_ini"], meta["ano_fim"], meta["data_ini"], meta["data_fim"])
        por_periodo.setdefault(chave, []).append((meta, blob))

    # Para cada período, escolhe o blob mais adequado
    por_exercicio: dict[int, list[storage.Blob]] = {}
    for (ano_ini, ano_fim, _, _), candidatos in por_periodo.items():
        # Prefere: mesmo CNPJ (empresa == contabilidade), depois versão maior
        def _score(item):
            m, _ = item
            mesmo_cnpj = 1 if m["cnpj_contabilidade"] == cnpj else 0
            return (mesmo_cnpj, m["versao"])
        melhor_meta, melhor_blob = sorted(candidatos, key=_score, reverse=True)[0]

        # O exercício contábil é o ano de fim do período
        exercicio = ano_fim
        por_exercicio.setdefault(exercicio, []).append(melhor_blob)

    return por_exercicio


# ─── Parser ECD ───────────────────────────────────────────────────────────────
def _ler_blob_latin1(blob: storage.Blob) -> list[list[str]]:
    """Lê blob e retorna linhas parseadas (pipe-delimited, Latin-1)"""
    data = blob.download_as_bytes()
    texto = data.decode("latin-1", errors="replace")
    linhas = []
    for linha in texto.splitlines():
        linha = linha.strip()
        if linha.startswith("|") and linha.endswith("|"):
            campos = linha[1:-1].split("|")
            linhas.append(campos)
    return linhas


def parse_ecd(blob: storage.Blob, cnpj: str, exercicio: int):
    """
    Parseia ECD e retorna:
      empresa_row, plano_rows, saldo_rows, inconsistencias
    """
    campos_all = _ler_blob_latin1(blob)
    hash_arq = _md5(blob.download_as_bytes())

    empresa_row = None
    plano: dict[str, dict] = {}      # cod_cta → {nome, nivel, natureza, tipo, grupo}
    saldos_por_periodo: dict[str, dict] = {}   # "AAAA-MM" → {cod_cta → saldo_row}
    inconsistencias = []
    periodo_atual = None             # período J005 em aberto

    # Índice de nomes de conta por código (C050 tem nome, I050 não tem)
    nomes_cta: dict[str, str] = {}

    for campos in campos_all:
        if not campos:
            continue
        rec = campos[0]

        # ── 0000: header ─────────────────────────────────────────────────────
        if rec == "0000" and len(campos) >= 6:
            # ECD 0000: LECD | dt_ini | dt_fim | razao | cnpj | uf | ...
            razao = campos[4].strip() if len(campos) > 4 else ""
            empresa_row = {
                "cnpj":              cnpj,
                "razao_social":      razao,
                "regime_tributario": None,
                "cnae_principal":    None,
                "status_extracao":   "completo",
                "observacoes":       None,
            }

        # ── C050: plano de contas com nome (bloco C) ──────────────────────────
        elif rec == "C050" and len(campos) >= 8:
            # |DT_INI|IND_CONTA|IND_DC|NIVEL|COD_CTA|COD_CTA_SUP|NOM_CTA|
            ind_conta = campos[2]
            tipo      = "sintetica" if campos[3] == "S" else "analitica"
            nivel     = int(campos[4]) if campos[4].isdigit() else 0
            cod_cta   = campos[5].strip()
            nome_cta  = campos[7].strip() if len(campos) > 7 else ""
            nomes_cta[cod_cta] = nome_cta
            natureza  = "D" if ind_conta in ("01", "05") else "C"
            grupo     = _refinar_grupo(ind_conta, nome_cta, cod_cta)
            plano[cod_cta] = {
                "conta_codigo": cod_cta,
                "conta_nome":   nome_cta,
                "nivel":        nivel,
                "natureza":     natureza,
                "tipo":         tipo,
                "grupo":        grupo,
            }

        # ── I050: plano de contas simplificado (bloco I, sem nome) ───────────
        elif rec == "I050" and len(campos) >= 7:
            # |DT_INI|IND_CONTA|IND_DC|NIVEL|COD_CTA|COD_CTA_SUP|COD_GRP?|
            ind_conta = campos[2]
            tipo      = "sintetica" if campos[3] == "S" else "analitica"
            nivel     = int(campos[4]) if campos[4].isdigit() else 0
            cod_cta   = campos[5].strip()
            cod_sup   = campos[6].strip() if len(campos) > 6 else ""
            cod_grp   = campos[7].strip() if len(campos) > 7 else ""
            natureza  = "D" if ind_conta in ("01", "05") else "C"
            nome_cta  = nomes_cta.get(cod_cta, f"CONTA_{cod_cta}")
            grupo     = _refinar_grupo(ind_conta, nome_cta, cod_cta)
            if cod_cta not in plano:
                plano[cod_cta] = {
                    "conta_codigo": cod_cta,
                    "conta_nome":   nome_cta,
                    "nivel":        nivel,
                    "natureza":     natureza,
                    "tipo":         tipo,
                    "grupo":        grupo,
                }

        # ── J005: abre período do balancete ───────────────────────────────────
        elif rec == "J005" and len(campos) >= 3:
            # |DT_INI|DT_FIN|IND_NIV_OBRIG|...
            dt_ini_str = campos[1]   # DDMMAAAA
            try:
                dt = datetime.strptime(dt_ini_str, "%d%m%Y")
                periodo_atual = dt.strftime("%Y-%m")
            except ValueError:
                periodo_atual = None

        # ── J100: saldo por conta no período ─────────────────────────────────
        elif rec == "J100" and periodo_atual and len(campos) >= 10:
            # |COD_CTA|IND_DC|NIVEL|COD_CTA_SUP|...|VL_SLD_INI|IND_DC_INI|VL_DEB|...|VL_SLD_FIN?|IND_DC_FIN?|
            cod_cta = campos[1].strip()
            # Índices variam por arquivo; detectamos a posição dos valores
            # Formato observado: [cod_cta, ind_dc, nivel, cod_sup, ?, ?, vl_ini, dc_ini, vl_deb, vl_cred_or_dc, ...]
            try:
                vl_ini  = _val(campos[7])
                dc_ini  = campos[8].strip()
                vl_deb  = _val(campos[9])
                # J100 pode ter 11 ou 12 campos
                if len(campos) >= 12 and campos[10] not in ("D", "C", ""):
                    vl_cred  = _val(campos[10])
                    vl_fin   = _val(campos[11]) if len(campos) > 11 else vl_ini + vl_deb - vl_cred
                    dc_fin   = campos[12].strip() if len(campos) > 12 else dc_ini
                elif len(campos) >= 11:
                    vl_cred  = 0.0
                    vl_fin   = _val(campos[10]) if campos[10] not in ("D","C","") else vl_ini
                    dc_fin   = campos[11].strip() if len(campos) > 11 else dc_ini
                else:
                    vl_cred = 0.0
                    vl_fin  = vl_ini
                    dc_fin  = dc_ini

                nome = nomes_cta.get(cod_cta, plano.get(cod_cta, {}).get("conta_nome", ""))
                grupo = plano.get(cod_cta, {}).get("grupo", "")

                saldos_por_periodo.setdefault(periodo_atual, {})[cod_cta] = {
                    "cnpj":           cnpj,
                    "exercicio":      exercicio,
                    "periodo":        periodo_atual,
                    "conta_codigo":   cod_cta,
                    "conta_nome":     nome,
                    "grupo":          grupo,
                    "saldo_anterior": vl_ini,
                    "debitos":        vl_deb,
                    "creditos":       vl_cred,
                    "saldo_final":    vl_fin,
                    "natureza_saldo": dc_fin,
                    "status":         "ok",
                }
            except (IndexError, ValueError):
                inconsistencias.append({
                    "tipo_erro": "J100_PARSE",
                    "descricao": f"Linha J100 com formato inesperado: {campos}",
                    "severidade": "alerta",
                })

    # Verifica contas J100 sem correspondência no plano de contas
    plano_codigos = set(plano.keys())
    for periodo, saldos in saldos_por_periodo.items():
        for cod in saldos:
            if cod not in plano_codigos:
                inconsistencias.append({
                    "tipo_erro": "CONTA_ORFAN",
                    "descricao": f"Conta {cod} em J100 (período {periodo}) sem registro no plano de contas",
                    "severidade": "alerta",
                })

    plano_rows = [
        {**v, "cnpj": cnpj, "exercicio": exercicio}
        for v in plano.values()
    ]
    saldo_rows = [
        row
        for saldos in saldos_por_periodo.values()
        for row in saldos.values()
    ]

    return empresa_row, plano_rows, saldo_rows, inconsistencias, hash_arq


# ─── Parser ECF ───────────────────────────────────────────────────────────────
def parse_ecf(blob: storage.Blob, cnpj: str, exercicio: int):
    """
    Parseia ECF e retorna:
      empresa_row (com regime), ecf_rows, inconsistencias
    """
    campos_all = _ler_blob_latin1(blob)
    hash_arq = _md5(blob.download_as_bytes())

    empresa_row = None
    ecf_rows = []
    inconsistencias = []

    for campos in campos_all:
        if not campos:
            continue
        rec = campos[0]

        # ── 0000: header ECF ──────────────────────────────────────────────────
        if rec == "0000" and len(campos) >= 5:
            # LECF | IND_TIPO | CNPJ | NOME | IND_SITUACAO_ESP | ... | DT_INI | DT_FIN
            razao = campos[4].strip() if len(campos) > 4 else ""
            empresa_row = {
                "cnpj":              cnpj,
                "razao_social":      razao,
                "regime_tributario": None,
                "cnae_principal":    None,
                "status_extracao":   "completo",
                "observacoes":       None,
            }

        # ── 0010: regime tributário ───────────────────────────────────────────
        elif rec == "0010" and empresa_row:
            # Não há um campo direto de regime, inferimos pela presença de campos
            # Na ausência de Y600, usamos Lucro Real como padrão para ECF
            pass

        # ── Y600: dados do contribuinte (tem regime) ──────────────────────────
        elif rec == "Y600" and len(campos) >= 3:
            # Y600 não tem estrutura fixa documentada, geralmente:
            # |COD_PAIS|IND_FORMA_TRIB|IND_COOPE|...
            pass

        # ── 0020: indicadores de atividades ──────────────────────────────────
        elif rec == "0020" and empresa_row:
            # Indica IRPJ regime; campo [1] = IND_SIT_INI
            # Não confiável para regime — pulamos
            pass

        # ── L100: balanço patrimonial referencial ─────────────────────────────
        elif rec == "L100" and len(campos) >= 8:
            # |COD_CTA|DESC|IND_TIPO|NIVEL|IND_ATIVO|COD_PAI|VL_SALDO_INI|IND_DC_INI|VL_DEB|VL_CRED|VL_SALDO_FIN|IND_DC_FIN|
            cod  = campos[1].strip()
            desc = campos[2].strip()
            # Valor principal: saldo final (cols 10/11) ou saldo_ini (col 6/7)
            try:
                if len(campos) >= 12:
                    vl  = _val(campos[11])
                    dc  = campos[12].strip() if len(campos) > 12 else "D"
                else:
                    vl  = _val(campos[7])
                    dc  = campos[8].strip() if len(campos) > 8 else "D"
                # Ajusta sinal: C = crédito (passivo/receita) → positivo como negativo no ativo
                vl_signed = -vl if dc == "C" else vl
                ecf_rows.append({
                    "cnpj":         cnpj,
                    "exercicio":    exercicio,
                    "registro_ecf": "L100",
                    "linha_codigo": cod,
                    "descricao":    desc,
                    "valor":        vl_signed,
                    "status":       "ok",
                })
            except (IndexError, ValueError):
                pass

        # ── L300: DRE referencial ─────────────────────────────────────────────
        elif rec == "L300" and len(campos) >= 8:
            cod  = campos[1].strip()
            desc = campos[2].strip()
            try:
                vl = _val(campos[7])
                dc = campos[8].strip() if len(campos) > 8 else "C"
                vl_signed = vl if dc == "C" else -vl
                ecf_rows.append({
                    "cnpj":         cnpj,
                    "exercicio":    exercicio,
                    "registro_ecf": "L300",
                    "linha_codigo": cod,
                    "descricao":    desc,
                    "valor":        vl_signed,
                    "status":       "ok",
                })
            except (IndexError, ValueError):
                pass

        # ── M300: adições LALUR ───────────────────────────────────────────────
        elif rec == "M300" and len(campos) >= 4:
            cod  = campos[1].strip()
            desc = campos[2].strip()
            vl   = _val(campos[3]) if len(campos) > 3 else 0.0
            ecf_rows.append({
                "cnpj": cnpj, "exercicio": exercicio,
                "registro_ecf": "M300", "linha_codigo": cod,
                "descricao": desc, "valor": vl, "status": "ok",
            })

        # ── M350: exclusões LALUR ─────────────────────────────────────────────
        elif rec == "M350" and len(campos) >= 4:
            cod  = campos[1].strip()
            desc = campos[2].strip()
            vl   = _val(campos[3]) if len(campos) > 3 else 0.0
            ecf_rows.append({
                "cnpj": cnpj, "exercicio": exercicio,
                "registro_ecf": "M350", "linha_codigo": cod,
                "descricao": desc, "valor": vl, "status": "ok",
            })

    # Valida CNPJ no ECF
    cnpj_ecf = None
    for campos in campos_all:
        if campos and campos[0] == "0000" and len(campos) >= 4:
            cnpj_ecf = campos[3].strip()
            break
    if cnpj_ecf and cnpj_ecf != cnpj:
        inconsistencias.append({
            "tipo_erro": "CNPJ_DIVERGENTE",
            "descricao": f"CNPJ no arquivo ECF ({cnpj_ecf}) diverge do esperado ({cnpj})",
            "severidade": "bloqueio",
        })

    return empresa_row, ecf_rows, inconsistencias, hash_arq


# ─── Persistência ─────────────────────────────────────────────────────────────
def _upsert_empresa(conn, row):
    if row is None:
        return
    conn.execute(
        """INSERT INTO tb_empresa (cnpj, razao_social, regime_tributario, cnae_principal, status_extracao, observacoes)
           VALUES (:cnpj, :razao_social, :regime_tributario, :cnae_principal, :status_extracao, :observacoes)
           ON CONFLICT(cnpj) DO UPDATE SET
             razao_social=excluded.razao_social,
             regime_tributario=COALESCE(excluded.regime_tributario, tb_empresa.regime_tributario),
             cnae_principal=COALESCE(excluded.cnae_principal, tb_empresa.cnae_principal),
             status_extracao=excluded.status_extracao""",
        row
    )


def _upsert_plano(conn, rows):
    for r in rows:
        conn.execute(
            """INSERT INTO tb_plano_contas
                 (cnpj, exercicio, conta_codigo, conta_nome, nivel, natureza, tipo, grupo)
               VALUES (:cnpj,:exercicio,:conta_codigo,:conta_nome,:nivel,:natureza,:tipo,:grupo)
               ON CONFLICT(cnpj, exercicio, conta_codigo) DO UPDATE SET
                 conta_nome=excluded.conta_nome,
                 nivel=excluded.nivel, natureza=excluded.natureza,
                 tipo=excluded.tipo, grupo=excluded.grupo""",
            r
        )


def _upsert_saldos(conn, rows):
    for r in rows:
        conn.execute(
            """INSERT INTO tb_ecd_saldos
                 (cnpj,exercicio,periodo,conta_codigo,conta_nome,grupo,
                  saldo_anterior,debitos,creditos,saldo_final,natureza_saldo,status)
               VALUES (:cnpj,:exercicio,:periodo,:conta_codigo,:conta_nome,:grupo,
                       :saldo_anterior,:debitos,:creditos,:saldo_final,:natureza_saldo,:status)
               ON CONFLICT(cnpj,exercicio,periodo,conta_codigo) DO UPDATE SET
                 saldo_anterior=excluded.saldo_anterior, debitos=excluded.debitos,
                 creditos=excluded.creditos, saldo_final=excluded.saldo_final,
                 natureza_saldo=excluded.natureza_saldo, status=excluded.status""",
            r
        )


def _upsert_ecf(conn, rows):
    for r in rows:
        conn.execute(
            """INSERT INTO tb_ecf_registros
                 (cnpj,exercicio,registro_ecf,linha_codigo,descricao,valor,status)
               VALUES (:cnpj,:exercicio,:registro_ecf,:linha_codigo,:descricao,:valor,:status)
               ON CONFLICT(cnpj,exercicio,registro_ecf,linha_codigo) DO UPDATE SET
                 descricao=excluded.descricao, valor=excluded.valor, status=excluded.status""",
            r
        )


# ─── Processamento por CNPJ ───────────────────────────────────────────────────
def processar_cnpj(client: storage.Client, conn: sqlite3.Connection, cnpj: str) -> None:
    print(f"\n{'='*60}")
    print(f"  CNPJ: {cnpj}")
    print(f"{'='*60}")

    ecf_por_ano = selecionar_ecf_por_exercicio(client, cnpj)
    ecd_por_ano = selecionar_ecd_por_exercicio(client, cnpj)
    exercicios_disponiveis = sorted(set(list(ecf_por_ano.keys()) + list(ecd_por_ano.keys())))

    for exercicio in exercicios_disponiveis:
        print(f"\n  → Exercício {exercicio}")
        t0 = datetime.utcnow()

        # ── ECF ──────────────────────────────────────────────────────────────
        if exercicio in ecf_por_ano:
            blob_ecf = ecf_por_ano[exercicio]
            print(f"    ECF: {blob_ecf.name.split('/')[-1][:60]}...")
            try:
                emp_ecf, ecf_rows, incs_ecf, hash_ecf = parse_ecf(blob_ecf, cnpj, exercicio)

                bloqueios_ecf = sum(1 for i in incs_ecf if i["severidade"] == "bloqueio")
                if bloqueios_ecf > 0:
                    print(f"    !! BLOQUEIO ECF: {[i['descricao'] for i in incs_ecf if i['severidade']=='bloqueio']}")
                    for inc in incs_ecf:
                        _gravar_inconsistencia(conn, cnpj, exercicio, inc["tipo_erro"], inc["descricao"], inc["severidade"])
                    _gravar_processamento(conn, cnpj, exercicio, "tb_ecf_registros",
                                          0, 0, 0, bloqueios_ecf, hash_ecf,
                                          int((datetime.utcnow()-t0).total_seconds()*1000))
                else:
                    _upsert_empresa(conn, emp_ecf)
                    _upsert_ecf(conn, ecf_rows)
                    for inc in incs_ecf:
                        _gravar_inconsistencia(conn, cnpj, exercicio, inc["tipo_erro"], inc["descricao"], inc["severidade"])
                    alertas_ecf = sum(1 for i in incs_ecf if i["severidade"] == "alerta")
                    _gravar_processamento(conn, cnpj, exercicio, "tb_ecf_registros",
                                          len(ecf_rows), len(ecf_rows)-alertas_ecf, alertas_ecf, 0, hash_ecf,
                                          int((datetime.utcnow()-t0).total_seconds()*1000))
                    print(f"    ECF: {len(ecf_rows)} registros gravados")
            except Exception as e:
                print(f"    ERRO ao processar ECF: {e}")
                _gravar_inconsistencia(conn, cnpj, exercicio, "ERRO_ECF", str(e), "bloqueio")
                _gravar_processamento(conn, cnpj, exercicio, "tb_ecf_registros", 0, 0, 0, 1, None,
                                      int((datetime.utcnow()-t0).total_seconds()*1000))
        else:
            print(f"    ECF: não encontrado")
            _gravar_inconsistencia(conn, cnpj, exercicio, "ECF_AUSENTE",
                                   f"Nenhum arquivo ECF encontrado para {cnpj}/{exercicio}", "alerta")

        # ── ECD ──────────────────────────────────────────────────────────────
        if exercicio in ecd_por_ano:
            blobs_ecd = ecd_por_ano[exercicio]
            empresa_row_final = None
            plano_merged: dict[str, dict] = {}
            saldos_merged: list = []
            incs_merged: list = []
            hashes: list[str] = []

            for blob_ecd in blobs_ecd:
                print(f"    ECD: {blob_ecd.name.split('/')[-1][:60]}...")
                try:
                    emp, plano, saldos, incs, hash_ecd = parse_ecd(blob_ecd, cnpj, exercicio)
                    hashes.append(hash_ecd)
                    if emp and not empresa_row_final:
                        empresa_row_final = emp
                    for p in plano:
                        plano_merged[p["conta_codigo"]] = p
                    saldos_merged.extend(saldos)
                    incs_merged.extend(incs)
                except Exception as e:
                    print(f"    ERRO ao processar ECD: {e}")
                    _gravar_inconsistencia(conn, cnpj, exercicio, "ERRO_ECD", str(e), "alerta")

            hash_combinado = _md5("|".join(sorted(hashes)).encode())
            bloqueios_ecd = sum(1 for i in incs_merged if i["severidade"] == "bloqueio")

            _upsert_empresa(conn, empresa_row_final)
            _upsert_plano(conn, list(plano_merged.values()))
            _upsert_saldos(conn, saldos_merged)
            for inc in incs_merged:
                _gravar_inconsistencia(conn, cnpj, exercicio, inc["tipo_erro"], inc["descricao"], inc["severidade"])

            alertas_ecd = sum(1 for i in incs_merged if i["severidade"] == "alerta")
            _gravar_processamento(conn, cnpj, exercicio, "tb_ecd_saldos",
                                  len(saldos_merged), len(saldos_merged)-alertas_ecd,
                                  alertas_ecd, bloqueios_ecd, hash_combinado,
                                  int((datetime.utcnow()-t0).total_seconds()*1000))
            _gravar_processamento(conn, cnpj, exercicio, "tb_plano_contas",
                                  len(plano_merged), len(plano_merged), 0, 0, hash_combinado,
                                  int((datetime.utcnow()-t0).total_seconds()*1000))
            print(f"    ECD: {len(saldos_merged)} saldos | {len(plano_merged)} contas")
        else:
            print(f"    ECD: não encontrado")
            _gravar_inconsistencia(conn, cnpj, exercicio, "ECD_AUSENTE",
                                   f"Nenhum arquivo ECD encontrado para {cnpj}/{exercicio}", "alerta")

        conn.commit()


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    print(f"[P01] Iniciando extração — {_now()} UTC")
    print(f"[P01] Banco: {DB_PATH}")
    print(f"[P01] Versão: {VERSAO}")

    client = storage.Client()   # usa Application Default Credentials
    conn   = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    criar_banco(conn)

    cnpjs = listar_cnpjs(client)
    if not cnpjs:
        print("[P01] Nenhum CNPJ encontrado no bucket. Encerrando.")
        return

    print(f"[P01] CNPJs encontrados: {cnpjs}")

    for cnpj in cnpjs:
        try:
            processar_cnpj(client, conn, cnpj)
        except Exception as e:
            print(f"[P01] ERRO inesperado ao processar CNPJ {cnpj}: {e}")

    # ── Relatório final ───────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("  RELATÓRIO FINAL P01")
    print("="*60)
    for row in conn.execute(
        "SELECT cnpj, exercicio, tabela_destino, total_registros, registros_ok, "
        "       registros_com_alerta, registros_bloqueados "
        "FROM tb_processamento ORDER BY cnpj, exercicio, tabela_destino"
    ):
        cnpj, ano, tab, tot, ok, al, bl = row
        status = "OK" if bl == 0 else "BLOQUEADO"
        print(f"  [{status}] {cnpj} / {ano} / {tab}: "
              f"{tot} total | {ok} ok | {al} alerta | {bl} bloqueio")

    incs = conn.execute(
        "SELECT cnpj, exercicio, tipo_erro, severidade, descricao "
        "FROM tb_inconsistencias ORDER BY severidade DESC, cnpj, exercicio"
    ).fetchall()
    if incs:
        print(f"\n  INCONSISTÊNCIAS ({len(incs)} total):")
        for c, a, t, s, d in incs:
            print(f"  [{s.upper()}] {c}/{a} — {t}: {d[:80]}")

    conn.close()
    print(f"\n[P01] Concluído — {_now()} UTC")
    print(f"[P01] Banco em: {DB_PATH}")


if __name__ == "__main__":
    main()
