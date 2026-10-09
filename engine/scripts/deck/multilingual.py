"""Multilingual: the same pricing and invoice-extraction tasks written in six languages, with local formats."""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal

from .common import benchmark, rng_for
from .reasoning import money

MONTHS = {
    "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
    "fr": ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
    "de": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    "pt": ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
}


def local_date(d: date, lang: str) -> str:
    if lang in ("ja", "zh"):
        return f"{d.year}年{d.month}月{d.day}日"
    m = MONTHS[lang][d.month - 1]
    return {"es": f"{d.day} de {m} de {d.year}", "fr": f"{d.day} {m} {d.year}", "de": f"{d.day}. {m} {d.year}",
            "pt": f"{d.day} de {m} de {d.year}"}[lang]


def local_money(x: Decimal, lang: str) -> str:
    s = f"{x:,.2f}"
    if lang in ("es", "de", "pt"):
        return s.replace(",", "§").replace(".", ",").replace("§", ".")
    if lang == "fr":
        return s.replace(",", " ").replace(".", ",")
    return s


ITEMS = {
    "es": ["sillas de oficina", "lámparas de escritorio", "monitores"],
    "fr": ["chaises de bureau", "lampes de bureau", "écrans"],
    "de": ["Bürostühle", "Schreibtischlampen", "Monitore"],
    "pt": ["cadeiras de escritório", "candeeiros de secretária", "monitores"],
    "ja": ["オフィスチェア", "デスクライト", "モニター"],
    "zh": ["办公椅", "台灯", "显示器"],
}

PRICING = {
    "es": ("Una empresa compra {q} {item} a {p} € cada una. El proveedor aplica un descuento del {d} % sobre el total de la compra "
           "y después el IVA del {t} % sobre el importe con descuento. El envío cuesta {s} € (sin IVA). "
           "¿Cuál es el importe final en euros, redondeado al céntimo?"),
    "fr": ("Une entreprise achète {q} {item} à {p} € pièce. Le fournisseur accorde une remise de {d} % sur le total, puis applique "
           "une TVA de {t} % sur le montant remisé. La livraison coûte {s} € (hors TVA). Quel est le montant final en euros, arrondi au centime ?"),
    "de": ("Ein Unternehmen kauft {q} {item} zu je {p} €. Der Lieferant gewährt {d} % Rabatt auf den Gesamtbetrag und berechnet danach "
           "{t} % Mehrwertsteuer auf den rabattierten Betrag. Der Versand kostet {s} € (ohne MwSt.). "
           "Wie hoch ist der Endbetrag in Euro, auf den Cent gerundet?"),
    "pt": ("Uma empresa compra {q} {item} a {p} € cada. O fornecedor aplica um desconto de {d} % sobre o total e depois IVA de {t} % "
           "sobre o valor com desconto. O envio custa {s} € (sem IVA). Qual é o valor final em euros, arredondado ao cêntimo?"),
    "ja": ("ある会社が{item}を{q}台、1台あたり{p}ユーロで購入します。仕入先は合計金額から{d}%の値引きを行い、その後、値引き後の金額に"
           "{t}%の付加価値税をかけます。送料は{s}ユーロ（税なし）です。最終的な支払額は何ユーロですか？セント単位に四捨五入してください。"),
    "zh": ("一家公司购买{q}个{item}，每个{p}欧元。供应商对总额给予{d}%的折扣，然后对折后金额征收{t}%的增值税。运费为{s}欧元（不含税）。"
           "最终应付金额是多少欧元？请四舍五入到分。"),
}
ANSWER_INSTR = {
    "es": "Termina con una línea final con el formato `ANSWER: <número>`.",
    "fr": "Termine par une dernière ligne au format `ANSWER: <nombre>`.",
    "de": "Beende die Antwort mit einer letzten Zeile im Format `ANSWER: <Zahl>`.",
    "pt": "Termina com uma última linha no formato `ANSWER: <número>`.",
    "ja": "最後の行は `ANSWER: <数値>` の形式で書いてください。",
    "zh": "最后一行请使用 `ANSWER: <数字>` 的格式。",
}

INVOICE = {
    "es": ("Factura n.º {num}\nEmisor: {vendor}\nFecha de emisión: {issued}\nImporte total: {amount} {sym}\nFecha de vencimiento: {due}\n"
           "Nota: la factura anterior {old} ya está pagada."),
    "fr": ("Facture n° {num}\nÉmetteur : {vendor}\nDate d'émission : {issued}\nMontant total : {amount} {sym}\nDate d'échéance : {due}\n"
           "Remarque : la facture précédente {old} est déjà réglée."),
    "de": ("Rechnung Nr. {num}\nAussteller: {vendor}\nRechnungsdatum: {issued}\nGesamtbetrag: {amount} {sym}\nFällig am: {due}\n"
           "Hinweis: Die vorherige Rechnung {old} ist bereits bezahlt."),
    "pt": ("Fatura n.º {num}\nEmitente: {vendor}\nData de emissão: {issued}\nValor total: {amount} {sym}\nData de vencimento: {due}\n"
           "Nota: a fatura anterior {old} já foi paga."),
    "ja": ("請求書番号：{num}\n発行者：{vendor}\n発行日：{issued}\n合計金額：{amount}{sym}\n支払期日：{due}\n備考：前回の請求書 {old} は支払済みです。"),
    "zh": ("发票号码：{num}\n开票方：{vendor}\n开票日期：{issued}\n合计金额：{amount}{sym}\n付款截止日期：{due}\n备注：上一张发票 {old} 已付清。"),
}
VENDORS = {"es": "Hierros del Norte S.L.", "fr": "Maison Garnier SAS", "de": "Feldmann Werkzeuge GmbH", "pt": "Tecelagem Douro Lda.",
           "ja": "株式会社さくら精機", "zh": "上海明远科技有限公司"}
CURRENCY = {"es": ("€", "EUR"), "fr": ("€", "EUR"), "de": ("€", "EUR"), "pt": ("€", "EUR"), "ja": ("円", "JPY"), "zh": ("元", "CNY")}
EXTRACT_INSTR = {
    "es": "Extrae vendor, invoice_number, total, currency, issue_date y due_date.",
    "fr": "Extrais vendor, invoice_number, total, currency, issue_date et due_date.",
    "de": "Extrahiere vendor, invoice_number, total, currency, issue_date und due_date.",
    "pt": "Extrai vendor, invoice_number, total, currency, issue_date e due_date.",
    "ja": "vendor、invoice_number、total、currency、issue_date、due_date を抽出してください。",
    "zh": "请提取 vendor、invoice_number、total、currency、issue_date 和 due_date。",
}
ISO_DATE = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
SCHEMA = {"type": "object", "required": ["vendor", "invoice_number", "total", "currency", "issue_date", "due_date"], "properties": {
    "vendor": {"type": "string"}, "invoice_number": {"type": "string"}, "total": {"type": "number"},
    "currency": {"type": "string", "pattern": "^[A-Z]{3}$"}, "issue_date": ISO_DATE, "due_date": ISO_DATE}}


def pricing_case(rng, lang: str, i: int) -> dict:
    q = rng.randint(3, 40)
    p = Decimal(rng.randrange(1500, 45000)) / 100
    d, t = rng.choice([5, 8, 10, 12, 15]), rng.choice([16, 19, 20, 21, 23])
    s = Decimal(rng.choice(["9.90", "14.50", "25.00"]))
    total = money(q * p * (100 - d) / 100 * (100 + t) / 100 + s)
    fmt = (lambda x: local_money(x, lang)) if lang not in ("ja", "zh") else (lambda x: f"{x:,.2f}")
    text = PRICING[lang].format(q=q, item=rng.choice(ITEMS[lang]), p=fmt(p), d=d, t=t, s=fmt(s))
    return {"id": f"{lang}-price-{i}", "input": f"{text}\n{ANSWER_INSTR[lang]}", "expected": float(total), "tags": [lang, "pricing"],
            "scorers": [{"type": "numeric", "params": {"tolerance": 1e-9}}], "vars": {"reference": f"ANSWER: {total}"}}


def invoice_case(rng, lang: str, i: int) -> dict:
    sym, code = CURRENCY[lang]
    issued = date(2026, 1, 2) + timedelta(days=rng.randrange(330))
    due = issued + timedelta(days=rng.choice([15, 30, 60]))
    amount = Decimal(rng.randrange(10000, 9000000)) if code == "JPY" else Decimal(rng.randrange(5000, 5000000)) / 100
    shown = f"{int(amount):,}" if code == "JPY" else (local_money(amount, lang) if lang not in ("ja", "zh") else f"{amount:,.2f}")
    num = f"{rng.choice(['A', 'F', 'R'])}{issued.year}-{rng.randint(1000, 9999)}"
    old = f"{num[0]}{issued.year}-{rng.randint(1000, 9999)}"
    text = INVOICE[lang].format(num=num, vendor=VENDORS[lang], issued=local_date(issued, lang), amount=shown, sym=sym,
                                due=local_date(due, lang), old=old)
    expected = {"vendor": VENDORS[lang], "invoice_number": num, "total": float(amount), "currency": code,
                "issue_date": issued.isoformat(), "due_date": due.isoformat()}
    return {"id": f"{lang}-invoice-{i}", "input": f"{EXTRACT_INSTR[lang]}\n---\n{text}", "expected": expected, "tags": [lang, "extraction"],
            "scorers": [{"type": "json_schema"}], "vars": {"schema": SCHEMA, "reference": json.dumps(expected, ensure_ascii=False)}}


def build() -> dict[str, dict]:
    rng = rng_for("multilingual")
    cases = []
    for lang in PRICING:
        cases += [pricing_case(rng, lang, i) for i in range(5)]
        cases += [invoice_case(rng, lang, i) for i in range(5)]
    return {"multilingual/generated.yaml": benchmark(
        "std-multilingual-business", "multilingual",
        "Pricing maths and invoice extraction in Spanish, French, German, Portuguese, Japanese and Chinese, with local number and date formats.",
        cases,
        system_prompt=("For extraction tasks respond with only a JSON object: dates as ISO YYYY-MM-DD, currency as an ISO 4217 code, "
                       "numbers as JSON numbers, text values copied exactly as written. For calculations, follow the instruction about the final line."),
    )}
