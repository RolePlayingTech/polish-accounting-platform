# 06. Model danych

## Kluczowe agregaty
| Agregat | Przykładowe pola | Zasady |
| --- | --- | --- |
| tenant | id, nazwa, plan, status | Niezależna organizacja i granica uprawnień |
| user, membership | user_id, tenant_id, role, status | MFA, wygaśnięcie i audyt |
| legal_entity | id, tenant_id, NIP, REGON, KRS, forma | Jednostka nie musi być podatnikiem |
| tax_subject | id, legal_entity_id?, rola, identyfikatory | Obsługa wspólników i reprezentantów |
| entity_profile_version | entity_id, valid_from/to, VAT, PIT/CIT, typ_ksiąg | Bez retroaktywnego nadpisania |
| document | id, entity_id, sha256, storage_key, type, status | Oryginał write-once |
| document_revision | doc_id, version, fields, source, approved_by | Pochodzenie ekstrakcji i korekt |
| invoice | supplier/buyer, dates, totals, KSeF_no?, currency | Kontrole spójności kwot |
| bank_transaction | account, direction, amount, booked_at, external_ref | Import idempotentny |
| ledger_entry | period_id, debit, credit, amount, source_doc, rule_version | Double-entry dla pełnych ksiąg |
| tax_rule | version, effective_from/to, official_source, reviewer | Testowana reguła |
| operation_draft | intent, diff, actor, hash, status, expires_at | Rozdział przygotowanie/akceptacja |
| audit_event | actor, entity, event, before/after hash, timestamp | Append-only |
| integration_sync | provider, cursor, status, checksum, retries | Bez utraty checkpointu |

## Integralność
Kwoty jako decimal o jawnej skali i walucie. Daty zdarzenia, wystawienia, rozliczenia i wersji przepisów jako odrębne pola; timestampy w UTC. Żadnych float do rachunkowości. Unikalność numerów jest kontekstowa (podmiot, kontrahent, typ, rok) — nie globalna.

## Księgi
Osobne modele dla KPiR i ewidencji przychodów. Pełne księgi wymagają atomowych zapisów Wn/Ma, sumy debetów = sumie kredytów oraz kont, dokumentów źródłowych, dzienników i okresów.

## Modyfikacje
Zmiana zaksięgowanego dokumentu nie zastępuje wpisu historycznego: tworzona jest korekta i ślad pochodzenia. Zatwierdzone operacje i zamknięcia okresów są chronione przed edycją wsteczną.

## Retencja i RODO
Odseparuj metadane, przechowywany oryginał i pochodne OCR. Retencja zależy od typu dokumentu, obowiązku prawnego i zdarzeń zawieszających terminy. Implementacja usuwania musi respektować obowiązki prawne, politykę backupów i historię audytu.