import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type OfficialMfSchemaCode =
  | 'FA(2)'
  | 'FA(3)'
  | 'JPK_V7M(2)'
  | 'JPK_V7M(3)'
  | 'JPK_V7K(3)'
  | 'JPK_PKPIR(3)'
  | 'JPK_EWP(4)'
  | 'JPK_ST(1)'
  | 'JPK_KR_PD(1)'
  | 'JPK_ST_KR(1)'
  | 'KSEF_UPO(4-3)';

export interface OfficialMfSchemaManifestEntry {
  readonly schemaCode: OfficialMfSchemaCode;
  readonly fileName: string;
  readonly targetNamespace: string;
  readonly rootElement: string;
  readonly formCode: string;
  readonly systemCode: string;
  readonly schemaVersion: string;
  readonly formVariant: number;
  readonly officialSourceUrl: string;
  readonly mirrorSourceUrl?: string;
  readonly catalogPageUrl?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly applicableProfiles: readonly string[];
  readonly limitations: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface OfficialMfSchemaDependencyEntry {
  readonly canonicalUrl: string;
  readonly localPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface OfficialMfXsdManifest {
  readonly manifestVersion: string;
  readonly verifiedAt: string;
  readonly ksefOpenApi: {
    readonly version: string;
    readonly build: string;
    readonly testOpenApiUrl: string;
    readonly testBaseUrl: string;
    readonly demoBaseUrl: string;
    readonly officialDocsRepo: string;
    readonly sha256AtVerification: string;
  };
  readonly schemas: readonly OfficialMfSchemaManifestEntry[];
  readonly dependencies: readonly OfficialMfSchemaDependencyEntry[];
}

export interface XsdValidationIssue {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface OfflineXsdValidationResult {
  readonly valid: boolean;
  readonly schemaCode: OfficialMfSchemaCode;
  readonly targetNamespace: string;
  readonly schemaSha256: string;
  readonly officialSourceUrl: string;
  readonly issues: readonly XsdValidationIssue[];
}

export type XsdValidationResult = OfflineXsdValidationResult;

const MAX_XML_VALIDATION_BYTES = 16 * 1024 * 1024;

function resolveDefaultFixturesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../../test/fixtures/xsd'),
    resolve(process.cwd(), 'test/fixtures/xsd'),
    resolve(process.cwd(), '../../test/fixtures/xsd'),
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'manifest.json'))) {
      return candidate;
    }
  }
  throw new Error(
    'Nie odnaleziono katalogu oficjalnych schematów XSD MF (test/fixtures/xsd/manifest.json).',
  );
}

let cachedManifest: { readonly dir: string; readonly manifest: OfficialMfXsdManifest } | null =
  null;
const verifiedSchemaHashes = new Set<string>();

export function getOfficialMfXsdManifest(customFixturesDir?: string): OfficialMfXsdManifest {
  const dir = customFixturesDir ?? resolveDefaultFixturesDir();
  if (cachedManifest && cachedManifest.dir === dir) {
    return cachedManifest.manifest;
  }
  const raw = readFileSync(resolve(dir, 'manifest.json'), 'utf8');
  const parsed = JSON.parse(raw) as OfficialMfXsdManifest;
  cachedManifest = { dir, manifest: parsed };
  return parsed;
}

export function verifyOfficialMfXsdIntegrity(customFixturesDir?: string): {
  readonly verifiedSchemasCount: number;
  readonly verifiedDependenciesCount: number;
} {
  const dir = customFixturesDir ?? resolveDefaultFixturesDir();
  const manifest = getOfficialMfXsdManifest(dir);

  for (const entry of manifest.schemas) {
    const key = `${dir}:${entry.fileName}`;
    if (!verifiedSchemaHashes.has(key)) {
      const fullPath = resolve(dir, entry.fileName);
      const bytes = readFileSync(fullPath);
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      if (actualSha !== entry.sha256) {
        throw new Error(
          `Niezgodność skrótu SHA-256 oficjalnej schemy XSD "${entry.schemaCode}" (${entry.fileName}): oczekiwano ${entry.sha256}, otrzymano ${actualSha}.`,
        );
      }
      verifiedSchemaHashes.add(key);
    }
  }

  for (const dep of manifest.dependencies) {
    const key = `${dir}:${dep.localPath}`;
    if (!verifiedSchemaHashes.has(key)) {
      const fullPath = resolve(dir, dep.localPath);
      const bytes = readFileSync(fullPath);
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      if (actualSha !== dep.sha256) {
        throw new Error(
          `Niezgodność skrótu SHA-256 słownika XSD MF (${dep.localPath}): oczekiwano ${dep.sha256}, otrzymano ${actualSha}.`,
        );
      }
      verifiedSchemaHashes.add(key);
    }
  }

  return {
    verifiedSchemasCount: manifest.schemas.length,
    verifiedDependenciesCount: manifest.dependencies.length,
  };
}

export function getOfficialMfSchemaEntry(
  schemaCode: OfficialMfSchemaCode,
  customFixturesDir?: string,
): OfficialMfSchemaManifestEntry {
  const manifest = getOfficialMfXsdManifest(customFixturesDir);
  const found = manifest.schemas.find((s) => s.schemaCode === schemaCode);
  if (!found) {
    throw new Error(`Brak zarejestrowanej schemy XSD MF o kodzie "${schemaCode}".`);
  }
  return found;
}

export function assertXmlSafeAgainstXxe(rawXml: string): void {
  const byteLength = Buffer.byteLength(rawXml, 'utf8');
  if (byteLength === 0) {
    throw new Error('Przekazany dokument XML jest pusty.');
  }
  if (byteLength > MAX_XML_VALIDATION_BYTES) {
    throw new Error(
      `Dokument XML przekracza maksymalny dozwolony rozmiar walidacji (${String(MAX_XML_VALIDATION_BYTES)} bajtów).`,
    );
  }
  if (/<!DOCTYPE/i.test(rawXml) || /<!ENTITY/i.test(rawXml) || /<!ELEMENT/i.test(rawXml)) {
    throw new Error(
      'Dokument XML zawiera zabronione deklaracje DTD/ENTITY/ELEMENT (ochrona przed XXE i ekspansją encji).',
    );
  }
  if (/<\?(?!xml[\s?])/i.test(rawXml)) {
    throw new Error(
      'Dokument XML zawiera zabronione instrukcje przetwarzania (Processing Instructions poza prologiem <?xml ...?>).',
    );
  }
}

const PYTHON_BATCH_VALIDATOR_SCRIPT = `
import json, os, sys, urllib.parse
from lxml import etree

payload = json.loads(sys.stdin.read())
fixtures_dir = payload["fixturesDir"]
dep_map = payload["depMap"]
items = payload["items"]

class OfflineCatalogResolver(etree.Resolver):
    def resolve(self, url, pubid, context):
        if not url:
            return None
        if os.path.isabs(url) and os.path.exists(url):
            return self.resolve_filename(url, context)
        candidate_rel = os.path.join(fixtures_dir, url)
        if os.path.exists(candidate_rel):
            return self.resolve_filename(os.path.abspath(candidate_rel), context)
        if url in dep_map:
            return self.resolve_filename(os.path.abspath(os.path.join(fixtures_dir, dep_map[url])), context)
        bname = os.path.basename(urllib.parse.urlparse(url).path)
        for k, rel in dep_map.items():
            if k.endswith("/" + bname) or k == bname:
                return self.resolve_filename(os.path.abspath(os.path.join(fixtures_dir, rel)), context)
        raise RuntimeError(f"Zablokowano zewnętrzne odwołanie XSD w trybie offline: {url}")

compiled_schemas = {}

def get_schema(file_name):
    if file_name not in compiled_schemas:
        xsd_parser = etree.XMLParser(no_network=True, resolve_entities=False, load_dtd=False, huge_tree=False)
        xsd_parser.resolvers.add(OfflineCatalogResolver())
        xsd_doc = etree.parse(os.path.join(fixtures_dir, file_name), xsd_parser)
        compiled_schemas[file_name] = etree.XMLSchema(xsd_doc)
    return compiled_schemas[file_name]

results = []
for item in items:
    xml_text = item["xml"]
    file_name = item["schemaFileName"]
    expected_ns = item["targetNamespace"]
    try:
        xml_parser = etree.XMLParser(
            no_network=True,
            resolve_entities=False,
            load_dtd=False,
            dtd_validation=False,
            huge_tree=False,
        )
        doc = etree.fromstring(xml_text.encode("utf-8"), xml_parser)
        actual_ns = etree.QName(doc.tag).namespace or ""
        if actual_ns != expected_ns:
            results.append({
                "valid": False,
                "issues": [{
                    "line": doc.sourceline or 1,
                    "column": 1,
                    "message": f"Niezgodna przestrzeń nazw (xmlns): oczekiwano '{expected_ns}', otrzymano '{actual_ns or 'brak'}'."
                }]
            })
            continue
        schema = get_schema(file_name)
        is_valid = schema.validate(doc)
        if is_valid:
            results.append({"valid": True, "issues": []})
        else:
            issues = [
                {"line": int(err.line or 1), "column": int(err.column or 1), "message": str(err.message)}
                for err in schema.error_log
            ]
            results.append({"valid": False, "issues": issues})
    except etree.XMLSyntaxError as exc:
        line_no, col_no = (exc.position if getattr(exc, "position", None) else (1, 1))
        results.append({
            "valid": False,
            "issues": [{"line": int(line_no or 1), "column": int(col_no or 1), "message": f"Błąd składni XML: {exc}"}]
        })
    except Exception as exc:
        results.append({
            "valid": False,
            "issues": [{"line": 1, "column": 1, "message": str(exc)}]
        })

sys.stdout.write(json.dumps(results, ensure_ascii=False))
`;

export interface ValidateOfficialMfXmlBatchItem {
  readonly xml: string;
  readonly schemaCode: OfficialMfSchemaCode;
}

/**
 * Waliduje wsadowo dokumenty XML względem oficjalnych schematów XSD Ministerstwa Finansów
 * w trybie 100% offline (`no_network=True`, `resolve_entities=False`, weryfikacja SHA-256).
 */
export function validateOfficialMfXmlBatch(
  items: readonly ValidateOfficialMfXmlBatchItem[],
  options?: { readonly customFixturesDir?: string },
): readonly OfflineXsdValidationResult[] {
  if (items.length === 0) {
    return [];
  }
  const dir = options?.customFixturesDir ?? resolveDefaultFixturesDir();
  verifyOfficialMfXsdIntegrity(dir);
  const manifest = getOfficialMfXsdManifest(dir);

  const depMap: Record<string, string> = {};
  for (const dep of manifest.dependencies) {
    depMap[dep.canonicalUrl] = dep.localPath;
  }

  const preflightFailures = new Map<number, OfflineXsdValidationResult>();
  const toRunIndices: number[] = [];
  const pythonItems: {
    readonly xml: string;
    readonly schemaFileName: string;
    readonly targetNamespace: string;
  }[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const entry = getOfficialMfSchemaEntry(item.schemaCode, dir);
    try {
      assertXmlSafeAgainstXxe(item.xml);
      toRunIndices.push(i);
      pythonItems.push({
        xml: item.xml.replace(/^\uFEFF/, ''),
        schemaFileName: entry.fileName,
        targetNamespace: entry.targetNamespace,
      });
    } catch (err) {
      preflightFailures.set(i, {
        valid: false,
        schemaCode: entry.schemaCode,
        targetNamespace: entry.targetNamespace,
        schemaSha256: entry.sha256,
        officialSourceUrl: entry.officialSourceUrl,
        issues: [
          {
            line: 1,
            column: 1,
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      });
    }
  }

  const pythonResultsByIdx = new Map<number, { valid: boolean; issues: XsdValidationIssue[] }>();
  if (pythonItems.length > 0) {
    const proc = spawnSync('python3', ['-c', PYTHON_BATCH_VALIDATOR_SCRIPT], {
      input: JSON.stringify({
        fixturesDir: dir,
        depMap,
        items: pythonItems,
      }),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
    });

    if (proc.error) {
      throw new Error(
        `Nie udało się uruchomić lokalnego walidatora XSD (libxml2/lxml): ${proc.error.message}`,
      );
    }
    if (proc.status !== 0) {
      throw new Error(
        `Lokalny walidator XSD zakończył się błędem (kod ${String(proc.status)}): ${proc.stderr || proc.stdout}`,
      );
    }

    const parsed = JSON.parse(proc.stdout) as {
      readonly valid: boolean;
      readonly issues: XsdValidationIssue[];
    }[];
    for (let j = 0; j < toRunIndices.length; j += 1) {
      const origIdx = toRunIndices[j]!;
      const pyRes = parsed[j];
      if (pyRes) {
        pythonResultsByIdx.set(origIdx, pyRes);
      }
    }
  }

  return items.map((item, idx) => {
    const preflight = preflightFailures.get(idx);
    if (preflight) {
      return preflight;
    }
    const entry = getOfficialMfSchemaEntry(item.schemaCode, dir);
    const pyRes = pythonResultsByIdx.get(idx) ?? {
      valid: false,
      issues: [{ line: 1, column: 1, message: 'Brak odpowiedzi walidatora XSD.' }],
    };
    return {
      valid: pyRes.valid,
      schemaCode: entry.schemaCode,
      targetNamespace: entry.targetNamespace,
      schemaSha256: entry.sha256,
      officialSourceUrl: entry.officialSourceUrl,
      issues: pyRes.issues,
    };
  });
}

export function validateOfficialMfXml(
  rawXml: string,
  schemaCode: OfficialMfSchemaCode,
  options?: { readonly customFixturesDir?: string },
): OfflineXsdValidationResult {
  const [single] = validateOfficialMfXmlBatch([{ xml: rawXml, schemaCode }], options);
  if (!single) {
    throw new Error('Brak wyniku walidacji XSD.');
  }
  return single;
}
