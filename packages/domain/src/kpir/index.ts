import {
  assertValidIsoCalendarDate,
  buildLegalExplanation,
  getRequiredNumericParameter,
  getRequiredStringParameter,
  resolveRuleAtDate,
} from '../legal-rules/index.js';
import type {
  ExplanationStep,
  ExplanationWarning,
  LegalExplanation,
  LegalRule,
} from '../legal-rules/index.js';
import {
  addGrosze,
  assertNonNegativeGrosze,
  assertSafeGrosze,
  formatPlnFromGrosze,
  multiplyGroszeByBps,
  roundTaxAmountOrdynacjaArt63,
  subtractGrosze,
  sumGrosze,
  validatePolishNip,
} from '../money.js';

export type KpirExpenseQualificationKind =
  | 'none'
  | 'goods_and_materials_col10'
  | 'incidental_purchase_costs_col11'
  | 'remuneration_col12'
  | 'other_expenses_100_col13'
  | 'vehicle_mixed_75_col13'
  | 'research_development_col16'
  | 'nkup_excluded';

export type KpirRegulationVersion = 'pkpir_2019_17col' | 'pkpir_2026_ksef';

export interface KpirColumnDescriptor {
  readonly columnNumber: number;
  readonly semanticKey: string;
  readonly label: string;
}

export interface KpirColumnLayout {
  readonly regulationVersion: KpirRegulationVersion;
  readonly totalColumns: 17 | 19;
  readonly ordinalCol: number;
  readonly eventDateCol: number;
  readonly ksefReferenceCol?: number;
  readonly documentNumberCol: number;
  readonly counterpartyNipCol?: number;
  readonly counterpartyNameCol: number;
  readonly counterpartyAddressCol: number;
  readonly eventDescriptionCol: number;
  readonly salesRevenueCol: number;
  readonly otherRevenueCol: number;
  readonly totalRevenueCol: number;
  readonly goodsAndMaterialsCol: number;
  readonly incidentalCostsCol: number;
  readonly remunerationCol: number;
  readonly otherExpensesCol: number;
  readonly totalExpensesCol: number;
  readonly freeCol: number;
  readonly researchDevelopmentCol: number;
  readonly remarksCol: number;
  readonly columns: readonly KpirColumnDescriptor[];
}

const KPIR_2019_LAYOUT: KpirColumnLayout = {
  regulationVersion: 'pkpir_2019_17col',
  totalColumns: 17,
  ordinalCol: 1,
  eventDateCol: 2,
  documentNumberCol: 3,
  counterpartyNameCol: 4,
  counterpartyAddressCol: 5,
  eventDescriptionCol: 6,
  salesRevenueCol: 7,
  otherRevenueCol: 8,
  totalRevenueCol: 9,
  goodsAndMaterialsCol: 10,
  incidentalCostsCol: 11,
  remunerationCol: 12,
  otherExpensesCol: 13,
  totalExpensesCol: 14,
  freeCol: 15,
  researchDevelopmentCol: 16,
  remarksCol: 17,
  columns: [
    { columnNumber: 1, semanticKey: 'ordinalNumber', label: 'Lp.' },
    { columnNumber: 2, semanticKey: 'eventDate', label: 'Data zdarzenia gospodarczego' },
    { columnNumber: 3, semanticKey: 'documentNumber', label: 'Nr dowodu księgowego' },
    {
      columnNumber: 4,
      semanticKey: 'counterpartyName',
      label: 'Imię i nazwisko (firma) kontrahenta',
    },
    { columnNumber: 5, semanticKey: 'counterpartyAddress', label: 'Adres kontrahenta' },
    { columnNumber: 6, semanticKey: 'eventDescription', label: 'Opis zdarzenia gospodarczego' },
    {
      columnNumber: 7,
      semanticKey: 'col7SalesRevenueGrosze',
      label: 'Wartość sprzedanych towarów i usług',
    },
    { columnNumber: 8, semanticKey: 'col8OtherRevenueGrosze', label: 'Pozostałe przychody' },
    { columnNumber: 9, semanticKey: 'col9TotalRevenueGrosze', label: 'Razem przychód (7 + 8)' },
    {
      columnNumber: 10,
      semanticKey: 'col10GoodsAndMaterialsGrosze',
      label: 'Zakup towarów handlowych i materiałów wg cen zakupu',
    },
    { columnNumber: 11, semanticKey: 'col11IncidentalCostsGrosze', label: 'Koszty uboczne zakupu' },
    {
      columnNumber: 12,
      semanticKey: 'col12RemunerationGrosze',
      label: 'Wynagrodzenia w gotówce i w naturze',
    },
    { columnNumber: 13, semanticKey: 'col13OtherExpensesGrosze', label: 'Pozostałe wydatki' },
    { columnNumber: 14, semanticKey: 'col14TotalExpensesGrosze', label: 'Razem wydatki (12 + 13)' },
    { columnNumber: 15, semanticKey: 'col15FreeColumnNote', label: 'Kolumna wolna' },
    {
      columnNumber: 16,
      semanticKey: 'col16ResearchDevelopmentCostGrosze',
      label: 'Koszty działalności badawczo-rozwojowej',
    },
    { columnNumber: 17, semanticKey: 'col17Remarks', label: 'Uwagi' },
  ],
};

const KPIR_2026_LAYOUT: KpirColumnLayout = {
  regulationVersion: 'pkpir_2026_ksef',
  totalColumns: 19,
  ordinalCol: 1,
  eventDateCol: 2,
  ksefReferenceCol: 3,
  documentNumberCol: 4,
  counterpartyNipCol: 5,
  counterpartyNameCol: 6,
  counterpartyAddressCol: 7,
  eventDescriptionCol: 8,
  salesRevenueCol: 9,
  otherRevenueCol: 10,
  totalRevenueCol: 11,
  goodsAndMaterialsCol: 12,
  incidentalCostsCol: 13,
  remunerationCol: 14,
  otherExpensesCol: 15,
  totalExpensesCol: 16,
  freeCol: 17,
  researchDevelopmentCol: 18,
  remarksCol: 19,
  columns: [
    { columnNumber: 1, semanticKey: 'ordinalNumber', label: 'Lp.' },
    { columnNumber: 2, semanticKey: 'eventDate', label: 'Data zdarzenia gospodarczego' },
    {
      columnNumber: 3,
      semanticKey: 'ksefReferenceNumber',
      label: 'Nr identyfikujący fakturę wystawioną przy użyciu KSeF',
    },
    { columnNumber: 4, semanticKey: 'documentNumber', label: 'Nr dowodu księgowego' },
    {
      columnNumber: 5,
      semanticKey: 'counterpartyNip',
      label: 'Identyfikator podatkowy kontrahenta (NIP)',
    },
    {
      columnNumber: 6,
      semanticKey: 'counterpartyName',
      label: 'Imię i nazwisko (firma) kontrahenta',
    },
    { columnNumber: 7, semanticKey: 'counterpartyAddress', label: 'Adres kontrahenta' },
    { columnNumber: 8, semanticKey: 'eventDescription', label: 'Opis zdarzenia gospodarczego' },
    {
      columnNumber: 9,
      semanticKey: 'col7SalesRevenueGrosze',
      label: 'Wartość sprzedanych towarów i usług',
    },
    { columnNumber: 10, semanticKey: 'col8OtherRevenueGrosze', label: 'Pozostałe przychody' },
    { columnNumber: 11, semanticKey: 'col9TotalRevenueGrosze', label: 'Razem przychód (9 + 10)' },
    {
      columnNumber: 12,
      semanticKey: 'col10GoodsAndMaterialsGrosze',
      label: 'Zakup towarów handlowych i materiałów wg cen zakupu',
    },
    { columnNumber: 13, semanticKey: 'col11IncidentalCostsGrosze', label: 'Koszty uboczne zakupu' },
    {
      columnNumber: 14,
      semanticKey: 'col12RemunerationGrosze',
      label: 'Wynagrodzenia w gotówce i w naturze',
    },
    { columnNumber: 15, semanticKey: 'col13OtherExpensesGrosze', label: 'Pozostałe wydatki' },
    { columnNumber: 16, semanticKey: 'col14TotalExpensesGrosze', label: 'Razem wydatki (14 + 15)' },
    { columnNumber: 17, semanticKey: 'col15FreeColumnNote', label: 'Kolumna wolna' },
    {
      columnNumber: 18,
      semanticKey: 'col16ResearchDevelopmentCostGrosze',
      label: 'Koszty działalności badawczo-rozwojowej',
    },
    { columnNumber: 19, semanticKey: 'col17Remarks', label: 'Uwagi' },
  ],
};

/**
 * Zwraca oficjalny układ numerów i etykiet kolumn PKPiR zależnie od obowiązującego rozporządzenia:
 * - `pkpir_2019_17col` / `pkpir_2019` (do 2025-12-31, `Dz.U. 2019 poz. 2544`): kolumny 1..17
 * - `pkpir_2026_ksef` (od 2026-01-01, `Dz.U. 2025 poz. 1299`): kolumny 1..19 (kol. 3 = Nr KSeF, kol. 5 = NIP kontrahenta).
 */
export function getKpirColumnLayout(
  layoutVersion: KpirRegulationVersion | 'pkpir_2019',
): KpirColumnLayout {
  return layoutVersion === 'pkpir_2026_ksef' ? KPIR_2026_LAYOUT : KPIR_2019_LAYOUT;
}

export interface QualifyKpirExpenseInput {
  readonly eventDate: string;
  readonly qualificationKind: Exclude<KpirExpenseQualificationKind, 'none'>;
  readonly netGrosze: number;
  readonly vatGrosze: number;
  readonly taxpayerVatActive: boolean;
  readonly deductibleVatGrosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

export interface QualifiedKpirExpenseResult {
  readonly qualificationKind: Exclude<KpirExpenseQualificationKind, 'none'>;
  readonly expenseBaseForKupGrosze: number;
  readonly deductibleKupGrosze: number;
  readonly nonDeductibleNkupGrosze: number;
  readonly col10GoodsAndMaterialsGrosze: number;
  readonly col11IncidentalCostsGrosze: number;
  readonly col12RemunerationGrosze: number;
  readonly col13OtherExpensesGrosze: number;
  readonly col16ResearchDevelopmentCostGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Kwalifikuje wydatek do odpowiedniej kolumny KPiR (10, 11, 12, 13 lub 16), uwzględniając:
 * - czynnego podatnika VAT (koszt od netto + ewentualnego nieodliczonego 50% VAT wg art. 23 ust. 1 pkt 43 PIT)
 * - podatnika zwolnionego z VAT (koszt od kwoty brutto)
 * - ograniczenie 75% KUP dla samochodu osobowego w użytku mieszanym (art. 23 ust. 1 pkt 46a PIT)
 * - wyłączenia NKUP (art. 23 ust. 1 PIT).
 */
export function qualifyKpirExpense(input: QualifyKpirExpenseInput): QualifiedKpirExpenseResult {
  assertValidIsoCalendarDate(input.eventDate, 'eventDate');
  assertSafeGrosze(input.netGrosze, 'netGrosze');
  assertSafeGrosze(input.vatGrosze, 'vatGrosze');

  if (
    (input.netGrosze > 0 && input.vatGrosze < 0) ||
    (input.netGrosze < 0 && input.vatGrosze > 0)
  ) {
    throw new Error(
      `Niezgodny znak kwoty netto (${String(input.netGrosze)} gr) i kwoty VAT (${String(input.vatGrosze)} gr) w kwalifikacji kosztu KPiR.`,
    );
  }

  if (input.deductibleVatGrosze !== undefined) {
    assertSafeGrosze(input.deductibleVatGrosze, 'deductibleVatGrosze');
    if (input.vatGrosze >= 0 && input.deductibleVatGrosze < 0) {
      throw new Error(
        `Kwota odliczanego VAT (deductibleVatGrosze = ${String(input.deductibleVatGrosze)} gr) nie może być ujemna przy nieujemnej kwocie VAT (${String(input.vatGrosze)} gr).`,
      );
    }
    if (input.vatGrosze < 0 && input.deductibleVatGrosze > 0) {
      throw new Error(
        `Niezgodny znak odliczanego VAT (deductibleVatGrosze = ${String(input.deductibleVatGrosze)} gr) względem korekty VAT in minus (${String(input.vatGrosze)} gr).`,
      );
    }
    if (Math.abs(input.deductibleVatGrosze) > Math.abs(input.vatGrosze)) {
      throw new Error(
        `Kwota odliczanego VAT (${String(input.deductibleVatGrosze)} gr) nie może przekraczać kwoty VAT na dokumencie (${String(input.vatGrosze)} gr).`,
      );
    }
  }

  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const kpirRule = resolveRuleAtDate('KPIR_REGULATION_COLUMNS', input.eventDate, ruleOptions);
  const rawRegVersion = getRequiredStringParameter(kpirRule, 'regulationVersion');
  const layout = getKpirColumnLayout(
    rawRegVersion === 'pkpir_2026_ksef' ? 'pkpir_2026_ksef' : 'pkpir_2019_17col',
  );
  const appliedRules: LegalRule[] = [kpirRule];

  const grossGrosze = addGrosze(input.netGrosze, input.vatGrosze);
  let nonDeductibleVat = 0;

  if (!input.taxpayerVatActive) {
    nonDeductibleVat = input.vatGrosze;
  } else if (input.deductibleVatGrosze !== undefined) {
    nonDeductibleVat = subtractGrosze(input.vatGrosze, input.deductibleVatGrosze);
  } else if (input.qualificationKind === 'vehicle_mixed_75_col13') {
    const vatVehicleRule = resolveRuleAtDate(
      'VAT_VEHICLE_DEDUCTION_ART_86A',
      input.eventDate,
      ruleOptions,
    );
    appliedRules.push(vatVehicleRule);
    const deductible50 = multiplyGroszeByBps(input.vatGrosze, 5000, 'half_up');
    nonDeductibleVat = subtractGrosze(input.vatGrosze, deductible50);
  }

  const expenseBaseForKupGrosze = input.taxpayerVatActive
    ? addGrosze(input.netGrosze, nonDeductibleVat)
    : grossGrosze;

  let deductibleKupGrosze = expenseBaseForKupGrosze;
  if (input.qualificationKind === 'vehicle_mixed_75_col13') {
    const carRule = resolveRuleAtDate(
      'PIT_CAR_MIXED_EXPENSE_75_ART_23',
      input.eventDate,
      ruleOptions,
    );
    appliedRules.push(carRule);
    const kupBps = getRequiredNumericParameter(carRule, 'deductibleExpenseBps');
    deductibleKupGrosze = multiplyGroszeByBps(expenseBaseForKupGrosze, kupBps, 'half_up');
  } else if (input.qualificationKind === 'nkup_excluded') {
    const nkupRule = resolveRuleAtDate('PIT_NKUP_EXCLUSIONS_ART_23', input.eventDate, ruleOptions);
    appliedRules.push(nkupRule);
    deductibleKupGrosze = 0;
  }

  const nonDeductibleNkupGrosze = subtractGrosze(expenseBaseForKupGrosze, deductibleKupGrosze);

  let col10 = 0;
  let col11 = 0;
  let col12 = 0;
  let col13 = 0;
  let col16 = 0;
  let targetColumnNumber = 0;

  switch (input.qualificationKind) {
    case 'goods_and_materials_col10':
      col10 = deductibleKupGrosze;
      targetColumnNumber = layout.goodsAndMaterialsCol;
      break;
    case 'incidental_purchase_costs_col11':
      col11 = deductibleKupGrosze;
      targetColumnNumber = layout.incidentalCostsCol;
      break;
    case 'remuneration_col12':
      col12 = deductibleKupGrosze;
      targetColumnNumber = layout.remunerationCol;
      break;
    case 'other_expenses_100_col13':
    case 'vehicle_mixed_75_col13':
      col13 = deductibleKupGrosze;
      targetColumnNumber = layout.otherExpensesCol;
      break;
    case 'research_development_col16':
      col16 = deductibleKupGrosze;
      targetColumnNumber = layout.researchDevelopmentCol;
      break;
    case 'nkup_excluded':
      targetColumnNumber = 0;
      break;
  }

  const targetColSuffix =
    targetColumnNumber > 0
      ? ` — ujęcie w kolumnie ${String(targetColumnNumber)} PKPiR`
      : ' — poza kolumnami KUP';

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Ustalenie bazy kosztowej z uwzględnieniem nieodliczonego podatku VAT',
      formula: input.taxpayerVatActive
        ? 'expenseBase = netGrosze + nonDeductibleVatGrosze'
        : 'expenseBase = grossGrosze (podatnik zwolniony z VAT)',
      inputs: {
        netGrosze: input.netGrosze,
        vatGrosze: input.vatGrosze,
        nonDeductibleVatGrosze: nonDeductibleVat,
        taxpayerVatActive: input.taxpayerVatActive,
      },
      resultFormatted: formatPlnFromGrosze(expenseBaseForKupGrosze),
      resultGrosze: expenseBaseForKupGrosze,
    },
    {
      stepNumber: 2,
      label: `Wyliczenie kwoty stanowiącej koszt uzyskania przychodów (KUP${targetColSuffix})`,
      formula:
        input.qualificationKind === 'vehicle_mixed_75_col13'
          ? 'deductibleKup = round_half_up(expenseBase * 75%)'
          : input.qualificationKind === 'nkup_excluded'
            ? 'deductibleKup = 0 (wydatek wyłączony na mocy art. 23 ust. 1 PIT)'
            : 'deductibleKup = 100% * expenseBase',
      inputs: {
        qualificationKind: input.qualificationKind,
        expenseBaseForKupGrosze,
        targetColumnNumber,
        regulationVersion: layout.regulationVersion,
      },
      resultFormatted: formatPlnFromGrosze(deductibleKupGrosze),
      resultGrosze: deductibleKupGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'kpir_expense_qualification',
    summary: `Kwalifikacja kosztu KPiR (${input.qualificationKind}${targetColumnNumber > 0 ? `, kol. ${String(targetColumnNumber)}` : ''}): KUP = ${formatPlnFromGrosze(deductibleKupGrosze)}, NKUP = ${formatPlnFromGrosze(nonDeductibleNkupGrosze)}.`,
    eventDate: input.eventDate,
    rules: appliedRules,
    steps,
    inputs: {
      qualificationKind: input.qualificationKind,
      netGrosze: input.netGrosze,
      vatGrosze: input.vatGrosze,
      taxpayerVatActive: input.taxpayerVatActive,
    },
    outputs: {
      expenseBaseForKupGrosze,
      deductibleKupGrosze,
      nonDeductibleNkupGrosze,
      targetColumnNumber,
      regulationVersion: layout.regulationVersion,
    },
  });

  return {
    qualificationKind: input.qualificationKind,
    expenseBaseForKupGrosze,
    deductibleKupGrosze,
    nonDeductibleNkupGrosze,
    col10GoodsAndMaterialsGrosze: col10,
    col11IncidentalCostsGrosze: col11,
    col12RemunerationGrosze: col12,
    col13OtherExpensesGrosze: col13,
    col16ResearchDevelopmentCostGrosze: col16,
    explanation,
  };
}

export interface KpirEntry {
  readonly id: string;
  readonly ordinalNumber: number;
  readonly period: string;
  readonly eventDate: string;
  readonly documentNumber: string;
  readonly ksefReferenceNumber?: string;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string;
  readonly counterpartyAddress: string;
  readonly eventDescription: string;
  readonly col7SalesRevenueGrosze: number;
  readonly col8OtherRevenueGrosze: number;
  readonly col9TotalRevenueGrosze: number;
  readonly col10GoodsAndMaterialsGrosze: number;
  readonly col11IncidentalCostsGrosze: number;
  readonly col12RemunerationGrosze: number;
  readonly col13OtherExpensesGrosze: number;
  readonly col14TotalExpensesGrosze: number;
  readonly col15FreeColumnNote?: string;
  readonly col16ResearchDevelopmentDescription?: string;
  readonly col16ResearchDevelopmentCostGrosze: number;
  readonly col17Remarks?: string;
  readonly qualificationKind: KpirExpenseQualificationKind;
  readonly isCorrection: boolean;
  readonly correctedEntryId?: string;
  readonly correctionReason?: string;
  readonly regulationVersion: 'pkpir_2019_17col' | 'pkpir_2026_ksef';
  readonly explanation: LegalExplanation;
}

export interface CreateKpirEntryInput {
  readonly id: string;
  readonly ordinalNumber: number;
  readonly eventDate: string;
  readonly documentNumber: string;
  readonly ksefReferenceNumber?: string;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string;
  readonly counterpartyAddress: string;
  readonly eventDescription: string;
  readonly col7SalesRevenueGrosze?: number;
  readonly col8OtherRevenueGrosze?: number;
  readonly col10GoodsAndMaterialsGrosze?: number;
  readonly col11IncidentalCostsGrosze?: number;
  readonly col12RemunerationGrosze?: number;
  readonly col13OtherExpensesGrosze?: number;
  readonly col15FreeColumnNote?: string;
  readonly col16ResearchDevelopmentDescription?: string;
  readonly col16ResearchDevelopmentCostGrosze?: number;
  readonly col17Remarks?: string;
  readonly qualificationKind?: KpirExpenseQualificationKind;
  readonly isCorrection?: boolean;
  readonly correctedEntryId?: string;
  readonly correctionReason?: string;
  readonly customRegistry?: readonly LegalRule[];
}

export function createKpirEntry(input: CreateKpirEntryInput): KpirEntry {
  assertValidIsoCalendarDate(input.eventDate, 'eventDate');
  if (!Number.isInteger(input.ordinalNumber) || input.ordinalNumber <= 0) {
    throw new Error('Liczba porządkowa wpisu KPiR (kol. 1) musi być dodatnią liczbą całkowitą.');
  }
  if (input.documentNumber.trim().length === 0) {
    throw new Error('Numer dowodu księgowego KPiR nie może być pusty.');
  }
  if (input.eventDescription.trim().length === 0) {
    throw new Error('Opis zdarzenia gospodarczego KPiR (kol. 6) nie może być pusty.');
  }

  let normalizedNip: string | undefined;
  if (input.counterpartyNip !== undefined) {
    const nipResult = validatePolishNip(input.counterpartyNip);
    if (!nipResult.valid || nipResult.normalizedNip === undefined) {
      throw new Error(
        `Nieprawidłowy NIP kontrahenta we wpisie KPiR: ${nipResult.reason ?? input.counterpartyNip}`,
      );
    }
    normalizedNip = nipResult.normalizedNip;
  }

  const isCorrection = input.isCorrection === true;
  if (isCorrection) {
    if (
      !input.correctedEntryId ||
      !input.correctionReason ||
      input.correctionReason.trim().length === 0
    ) {
      throw new Error(
        'Zapis korygujący / storno w KPiR wymaga wskazania correctedEntryId oraz niepustego uzasadnienia correctionReason.',
      );
    }
  }

  const col7 = assertSafeGrosze(input.col7SalesRevenueGrosze ?? 0, 'col7SalesRevenueGrosze');
  const col8 = assertSafeGrosze(input.col8OtherRevenueGrosze ?? 0, 'col8OtherRevenueGrosze');
  const col10 = assertSafeGrosze(
    input.col10GoodsAndMaterialsGrosze ?? 0,
    'col10GoodsAndMaterialsGrosze',
  );
  const col11 = assertSafeGrosze(
    input.col11IncidentalCostsGrosze ?? 0,
    'col11IncidentalCostsGrosze',
  );
  const col12 = assertSafeGrosze(input.col12RemunerationGrosze ?? 0, 'col12RemunerationGrosze');
  const col13 = assertSafeGrosze(input.col13OtherExpensesGrosze ?? 0, 'col13OtherExpensesGrosze');
  const col16 = assertSafeGrosze(
    input.col16ResearchDevelopmentCostGrosze ?? 0,
    'col16ResearchDevelopmentCostGrosze',
  );

  if (
    !isCorrection &&
    (col7 < 0 || col8 < 0 || col10 < 0 || col11 < 0 || col12 < 0 || col13 < 0 || col16 < 0)
  ) {
    throw new Error(
      'Ujemne kwoty w KPiR są dopuszczalne wyłącznie dla jawnie oznaczonych wpisów korygujących / storna (isCorrection = true).',
    );
  }

  const col9 = addGrosze(col7, col8);
  const col14 = addGrosze(col12, col13);
  const period = input.eventDate.slice(0, 7);

  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const kpirRule = resolveRuleAtDate('KPIR_REGULATION_COLUMNS', input.eventDate, ruleOptions);
  const rawRegVersion = getRequiredStringParameter(kpirRule, 'regulationVersion');
  const regulationVersion: KpirRegulationVersion =
    rawRegVersion === 'pkpir_2026_ksef' ? 'pkpir_2026_ksef' : 'pkpir_2019_17col';
  const layout = getKpirColumnLayout(regulationVersion);

  const totalKupEntry = sumGrosze([col10, col11, col14]);

  const explanation = buildLegalExplanation({
    calculationType: 'kpir_entry_creation',
    summary: `Zapis KPiR poz. ${String(input.ordinalNumber)} (${period}, wzór ${String(layout.totalColumns)}-kolumnowy): przychód razem kol. ${String(layout.totalRevenueCol)} = ${formatPlnFromGrosze(col9)}, koszty KUP (kol. ${String(layout.goodsAndMaterialsCol)}+${String(layout.incidentalCostsCol)}+${String(layout.totalExpensesCol)}) = ${formatPlnFromGrosze(totalKupEntry)}.`,
    eventDate: input.eventDate,
    rules: [kpirRule],
    steps: [
      {
        stepNumber: 1,
        label: `Sumowanie przychodów (kolumna ${String(layout.totalRevenueCol)} = kolumna ${String(layout.salesRevenueCol)} + kolumna ${String(layout.otherRevenueCol)})`,
        formula: `col${String(layout.totalRevenueCol)} = col${String(layout.salesRevenueCol)} + col${String(layout.otherRevenueCol)}`,
        inputs: {
          salesRevenueGrosze: col7,
          otherRevenueGrosze: col8,
          salesRevenueCol: layout.salesRevenueCol,
          otherRevenueCol: layout.otherRevenueCol,
          totalRevenueCol: layout.totalRevenueCol,
        },
        resultFormatted: formatPlnFromGrosze(col9),
        resultGrosze: col9,
      },
      {
        stepNumber: 2,
        label: `Sumowanie wydatków (kolumna ${String(layout.totalExpensesCol)} = kolumna ${String(layout.remunerationCol)} + kolumna ${String(layout.otherExpensesCol)}) oraz łącznie KUP (kol. ${String(layout.goodsAndMaterialsCol)} + ${String(layout.incidentalCostsCol)} + ${String(layout.totalExpensesCol)})`,
        formula: `col${String(layout.totalExpensesCol)} = col${String(layout.remunerationCol)} + col${String(layout.otherExpensesCol)}; totalKup = col${String(layout.goodsAndMaterialsCol)} + col${String(layout.incidentalCostsCol)} + col${String(layout.totalExpensesCol)}`,
        inputs: {
          goodsAndMaterialsGrosze: col10,
          incidentalCostsGrosze: col11,
          remunerationGrosze: col12,
          otherExpensesGrosze: col13,
          totalColumns: layout.totalColumns,
        },
        resultFormatted: formatPlnFromGrosze(totalKupEntry),
        resultGrosze: totalKupEntry,
      },
    ],
    inputs: {
      ordinalNumber: input.ordinalNumber,
      eventDate: input.eventDate,
      isCorrection,
    },
    outputs: {
      col9TotalRevenueGrosze: col9,
      col14TotalExpensesGrosze: col14,
      totalKupGrosze: totalKupEntry,
      regulationVersion,
      totalColumns: layout.totalColumns,
    },
  });

  return {
    id: input.id,
    ordinalNumber: input.ordinalNumber,
    period,
    eventDate: input.eventDate,
    documentNumber: input.documentNumber,
    ...(input.ksefReferenceNumber !== undefined
      ? { ksefReferenceNumber: input.ksefReferenceNumber }
      : {}),
    counterpartyName: input.counterpartyName,
    ...(normalizedNip !== undefined ? { counterpartyNip: normalizedNip } : {}),
    counterpartyAddress: input.counterpartyAddress,
    eventDescription: input.eventDescription,
    col7SalesRevenueGrosze: col7,
    col8OtherRevenueGrosze: col8,
    col9TotalRevenueGrosze: col9,
    col10GoodsAndMaterialsGrosze: col10,
    col11IncidentalCostsGrosze: col11,
    col12RemunerationGrosze: col12,
    col13OtherExpensesGrosze: col13,
    col14TotalExpensesGrosze: col14,
    ...(input.col15FreeColumnNote !== undefined
      ? { col15FreeColumnNote: input.col15FreeColumnNote }
      : {}),
    ...(input.col16ResearchDevelopmentDescription !== undefined
      ? { col16ResearchDevelopmentDescription: input.col16ResearchDevelopmentDescription }
      : {}),
    col16ResearchDevelopmentCostGrosze: col16,
    ...(input.col17Remarks !== undefined ? { col17Remarks: input.col17Remarks } : {}),
    qualificationKind: input.qualificationKind ?? 'none',
    isCorrection,
    ...(input.correctedEntryId !== undefined ? { correctedEntryId: input.correctedEntryId } : {}),
    ...(input.correctionReason !== undefined ? { correctionReason: input.correctionReason } : {}),
    regulationVersion,
    explanation,
  };
}

/**
 * Tworzy pełne storno czerwone wskazanego wpisu KPiR bez nadpisywania zatwierdzonego oryginału.
 */
export function createKpirStornoEntry(input: {
  readonly id: string;
  readonly ordinalNumber: number;
  readonly correctionDate: string;
  readonly originalEntry: KpirEntry;
  readonly correctionDocumentNumber: string;
  readonly correctionReason: string;
  readonly customRegistry?: readonly LegalRule[];
}): KpirEntry {
  return createKpirEntry({
    id: input.id,
    ordinalNumber: input.ordinalNumber,
    eventDate: input.correctionDate,
    documentNumber: input.correctionDocumentNumber,
    counterpartyName: input.originalEntry.counterpartyName,
    ...(input.originalEntry.counterpartyNip !== undefined
      ? { counterpartyNip: input.originalEntry.counterpartyNip }
      : {}),
    counterpartyAddress: input.originalEntry.counterpartyAddress,
    eventDescription: `STORNO poz. ${String(input.originalEntry.ordinalNumber)}: ${input.correctionReason}`,
    col7SalesRevenueGrosze: -input.originalEntry.col7SalesRevenueGrosze,
    col8OtherRevenueGrosze: -input.originalEntry.col8OtherRevenueGrosze,
    col10GoodsAndMaterialsGrosze: -input.originalEntry.col10GoodsAndMaterialsGrosze,
    col11IncidentalCostsGrosze: -input.originalEntry.col11IncidentalCostsGrosze,
    col12RemunerationGrosze: -input.originalEntry.col12RemunerationGrosze,
    col13OtherExpensesGrosze: -input.originalEntry.col13OtherExpensesGrosze,
    col16ResearchDevelopmentCostGrosze: -input.originalEntry.col16ResearchDevelopmentCostGrosze,
    col17Remarks: `Korekta do wpisu ${input.originalEntry.id}: ${input.correctionReason}`,
    qualificationKind: input.originalEntry.qualificationKind,
    isCorrection: true,
    correctedEntryId: input.originalEntry.id,
    correctionReason: input.correctionReason,
    ...(input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : {}),
  });
}

export interface KpirColumnsTotals {
  readonly col7SalesRevenueGrosze: number;
  readonly col8OtherRevenueGrosze: number;
  readonly col9TotalRevenueGrosze: number;
  readonly col10GoodsAndMaterialsGrosze: number;
  readonly col11IncidentalCostsGrosze: number;
  readonly col12RemunerationGrosze: number;
  readonly col13OtherExpensesGrosze: number;
  readonly col14TotalExpensesGrosze: number;
  readonly col16ResearchDevelopmentCostGrosze: number;
  readonly totalTaxDeductibleCostsGrosze: number;
  readonly accountingIncomeGrosze: number;
}

export interface KpirPeriodSummary {
  readonly period: string;
  readonly monthTotals: KpirColumnsTotals;
  readonly yearToDateTotals: KpirColumnsTotals;
}

function aggregateKpirEntries(entries: readonly KpirEntry[]): KpirColumnsTotals {
  const col7 = sumGrosze(entries.map((e) => e.col7SalesRevenueGrosze));
  const col8 = sumGrosze(entries.map((e) => e.col8OtherRevenueGrosze));
  const col9 = addGrosze(col7, col8);
  const col10 = sumGrosze(entries.map((e) => e.col10GoodsAndMaterialsGrosze));
  const col11 = sumGrosze(entries.map((e) => e.col11IncidentalCostsGrosze));
  const col12 = sumGrosze(entries.map((e) => e.col12RemunerationGrosze));
  const col13 = sumGrosze(entries.map((e) => e.col13OtherExpensesGrosze));
  const col14 = addGrosze(col12, col13);
  const col16 = sumGrosze(entries.map((e) => e.col16ResearchDevelopmentCostGrosze));
  const totalTaxDeductibleCostsGrosze = sumGrosze([col10, col11, col14]);
  const accountingIncomeGrosze = subtractGrosze(col9, totalTaxDeductibleCostsGrosze);

  return {
    col7SalesRevenueGrosze: col7,
    col8OtherRevenueGrosze: col8,
    col9TotalRevenueGrosze: col9,
    col10GoodsAndMaterialsGrosze: col10,
    col11IncidentalCostsGrosze: col11,
    col12RemunerationGrosze: col12,
    col13OtherExpensesGrosze: col13,
    col14TotalExpensesGrosze: col14,
    col16ResearchDevelopmentCostGrosze: col16,
    totalTaxDeductibleCostsGrosze,
    accountingIncomeGrosze,
  };
}

export function summarizeKpirPeriod(
  entries: readonly KpirEntry[],
  period: string,
): KpirPeriodSummary {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(`Nieprawidłowy okres podsumowania KPiR: "${period}"`);
  }
  const yearPrefix = period.slice(0, 4);
  const monthEntries = entries.filter((e) => e.period === period);
  const ytdEntries = entries.filter(
    (e) => e.period.startsWith(`${yearPrefix}-`) && e.period <= period,
  );

  return {
    period,
    monthTotals: aggregateKpirEntries(monthEntries),
    yearToDateTotals: aggregateKpirEntries(ytdEntries),
  };
}

export interface CalculateKpirPitAdvanceInput {
  readonly period: string;
  readonly taxForm: 'skala' | 'liniowy';
  readonly ytdRevenueGrosze: number;
  readonly ytdCostsGrosze: number;
  readonly paidSocialZusYtdGrosze?: number;
  readonly paidHealthInsuranceYtdGrosze?: number;
  readonly healthAlreadyIncludedInKupYtdGrosze?: number;
  readonly priorYearsLossDeductionGrosze?: number;
  readonly previousAdvancesPaidYtdGrosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

export interface KpirPitAdvanceResult {
  readonly period: string;
  readonly taxForm: 'skala' | 'liniowy';
  readonly ytdIncomeGrosze: number;
  readonly effectiveHealthDeductionFromIncomeGrosze: number;
  readonly taxableBaseBeforeRoundingGrosze: number;
  readonly roundedTaxBaseFullPln: number;
  readonly roundedTaxBaseGrosze: number;
  readonly cumulativeTaxGrosze: number;
  readonly advanceDueRoundedPln: number;
  readonly advanceDueGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Oblicza zaliczkę miesięczną/kwartalną na podatek dochodowy PIT dla KPiR (Skala 12%/32% z kwotą wolną 30 000 zł
 * albo Podatek Liniowy 19% z rocznym limitem odliczenia składki zdrowotnej 12 900 zł w 2025 r. / 14 100 zł w 2026 r.).
 */
export function calculateKpirPitAdvance(input: CalculateKpirPitAdvanceInput): KpirPitAdvanceResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    throw new Error(`Nieprawidłowy okres zaliczki PIT: "${input.period}"`);
  }
  assertSafeGrosze(input.ytdRevenueGrosze, 'ytdRevenueGrosze');
  assertSafeGrosze(input.ytdCostsGrosze, 'ytdCostsGrosze');

  const socialPaid = assertNonNegativeGrosze(
    input.paidSocialZusYtdGrosze ?? 0,
    'paidSocialZusYtdGrosze',
  );
  const healthPaid = assertNonNegativeGrosze(
    input.paidHealthInsuranceYtdGrosze ?? 0,
    'paidHealthInsuranceYtdGrosze',
  );
  const healthInKup = assertNonNegativeGrosze(
    input.healthAlreadyIncludedInKupYtdGrosze ?? 0,
    'healthAlreadyIncludedInKupYtdGrosze',
  );
  const lossDeduction = assertNonNegativeGrosze(
    input.priorYearsLossDeductionGrosze ?? 0,
    'priorYearsLossDeductionGrosze',
  );
  const prevAdvances = assertNonNegativeGrosze(
    input.previousAdvancesPaidYtdGrosze ?? 0,
    'previousAdvancesPaidYtdGrosze',
  );

  const eventDate = `${input.period}-01`;
  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const roundingRule = resolveRuleAtDate('ORDYNACJA_ART_63_TAX_ROUNDING', eventDate, ruleOptions);
  const deadlineRule = resolveRuleAtDate('PIT_ADVANCE_DEADLINE_ART_44', eventDate, ruleOptions);

  const appliedRules: LegalRule[] = [roundingRule, deadlineRule];
  const warnings: ExplanationWarning[] = [];

  const rawIncome = subtractGrosze(input.ytdRevenueGrosze, input.ytdCostsGrosze);
  const ytdIncomeGrosze = Math.max(0, rawIncome);

  let effectiveHealthDeduction = 0;
  if (input.taxForm === 'liniowy') {
    const healthLimitRule = resolveRuleAtDate(
      'PIT_FLAT_HEALTH_DEDUCTION_LIMIT',
      eventDate,
      ruleOptions,
    );
    appliedRules.push(healthLimitRule);
    const annualHealthCap = getRequiredNumericParameter(healthLimitRule, 'annualLimitGrosze');
    const remainingCapForIncomeDeduction = Math.max(
      0,
      subtractGrosze(annualHealthCap, healthInKup),
    );
    effectiveHealthDeduction = Math.min(healthPaid, remainingCapForIncomeDeduction);

    if (addGrosze(healthPaid, healthInKup) > annualHealthCap) {
      warnings.push({
        code: 'PIT_FLAT_HEALTH_CAP_APPLIED',
        severity: 'info',
        message: `Zastosowano roczny limit odliczenia składki zdrowotnej na podatku liniowym (${formatPlnFromGrosze(annualHealthCap)}).`,
      });
    }
  } else if (healthPaid > 0 || healthInKup > 0) {
    warnings.push({
      code: 'PIT_SCALE_NO_HEALTH_DEDUCTION',
      severity: 'info',
      message:
        'Na skali podatkowej (zasady ogólne) zapłacona składka zdrowotna nie podlega odliczeniu od dochodu ani zaliczeniu do KUP.',
    });
  }

  const afterDeductions = subtractGrosze(
    ytdIncomeGrosze,
    sumGrosze([socialPaid, effectiveHealthDeduction, lossDeduction]),
  );
  const taxableBaseBeforeRoundingGrosze = Math.max(0, afterDeductions);
  const roundedBase = roundTaxAmountOrdynacjaArt63(taxableBaseBeforeRoundingGrosze);

  let cumulativeTaxRawGrosze: number;

  if (input.taxForm === 'skala') {
    const scaleRule = resolveRuleAtDate('PIT_TAX_SCALE_ART_27', eventDate, ruleOptions);
    appliedRules.push(scaleRule);
    const bracketLimit = getRequiredNumericParameter(scaleRule, 'firstBracketLimitGrosze');
    const rate1Bps = getRequiredNumericParameter(scaleRule, 'firstBracketRateBps');
    const rate2Bps = getRequiredNumericParameter(scaleRule, 'secondBracketRateBps');
    const reducingAmount = getRequiredNumericParameter(scaleRule, 'taxReducingAmountGrosze');
    const fullBracket1Tax = getRequiredNumericParameter(scaleRule, 'firstBracketFullTaxGrosze');

    if (roundedBase.roundedGrosze <= bracketLimit) {
      const grossTax1 = multiplyGroszeByBps(roundedBase.roundedGrosze, rate1Bps, 'half_up');
      cumulativeTaxRawGrosze = Math.max(0, subtractGrosze(grossTax1, reducingAmount));
    } else {
      const excessOver120k = subtractGrosze(roundedBase.roundedGrosze, bracketLimit);
      const excessTax2 = multiplyGroszeByBps(excessOver120k, rate2Bps, 'half_up');
      cumulativeTaxRawGrosze = addGrosze(fullBracket1Tax, excessTax2);
      warnings.push({
        code: 'PIT_SECOND_BRACKET_32_EXCEEDED',
        severity: 'warning',
        message: `Podstawa opodatkowania przekroczyła próg 120 000,00 zł (${formatPlnFromGrosze(roundedBase.roundedGrosze)}) — nadwyżka opodatkowana stawką 32%.`,
      });
    }
  } else {
    const flatRule = resolveRuleAtDate('PIT_FLAT_TAX_ART_30C', eventDate, ruleOptions);
    appliedRules.push(flatRule);
    const flatRateBps = getRequiredNumericParameter(flatRule, 'flatRateBps');
    cumulativeTaxRawGrosze = multiplyGroszeByBps(roundedBase.roundedGrosze, flatRateBps, 'half_up');
  }

  const advanceBeforeRounding = Math.max(0, subtractGrosze(cumulativeTaxRawGrosze, prevAdvances));
  const roundedAdvance = roundTaxAmountOrdynacjaArt63(advanceBeforeRounding);

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Wyliczenie dochodu narastająco od początku roku (przychody minus koszty KUP)',
      formula: 'ytdIncome = max(0, ytdRevenue - ytdCosts)',
      inputs: {
        ytdRevenueGrosze: input.ytdRevenueGrosze,
        ytdCostsGrosze: input.ytdCostsGrosze,
      },
      resultFormatted: formatPlnFromGrosze(ytdIncomeGrosze),
      resultGrosze: ytdIncomeGrosze,
    },
    {
      stepNumber: 2,
      label:
        'Pomniejszenie dochodu o zapłacone składki społeczne ZUS, stratę i (dla liniowego) składkę zdrowotną w limicie',
      formula:
        'taxableBase = round_ordynacja(max(0, ytdIncome - socialZus - deductibleHealth - loss))',
      inputs: {
        paidSocialZusYtdGrosze: socialPaid,
        effectiveHealthDeductionFromIncomeGrosze: effectiveHealthDeduction,
        priorYearsLossDeductionGrosze: lossDeduction,
      },
      resultFormatted: `${formatPlnFromGrosze(roundedBase.roundedGrosze)} (przed zaokr.: ${formatPlnFromGrosze(taxableBaseBeforeRoundingGrosze)})`,
      resultGrosze: roundedBase.roundedGrosze,
    },
    {
      stepNumber: 3,
      label:
        input.taxForm === 'skala'
          ? 'Obliczenie podatku narastająco wg skali podatkowej 12% / 32% z kwotą zmniejszającą 3 600 zł'
          : 'Obliczenie podatku narastająco wg stawki liniowej 19%',
      formula:
        input.taxForm === 'skala'
          ? 'if (base <= 120 000 zł) max(0, base * 12% - 3 600 zł) else 10 800 zł + (base - 120 000 zł) * 32%'
          : 'cumulativeTax = base * 19%',
      inputs: {
        taxForm: input.taxForm,
        roundedTaxBaseGrosze: roundedBase.roundedGrosze,
      },
      resultFormatted: formatPlnFromGrosze(cumulativeTaxRawGrosze),
      resultGrosze: cumulativeTaxRawGrosze,
    },
    {
      stepNumber: 4,
      label:
        'Pomniejszenie o zaliczki należne za poprzednie miesiące i zaokrąglenie zaliczki do pełnych złotych',
      formula: 'advanceDue = round_ordynacja(max(0, cumulativeTax - previousAdvances))',
      inputs: {
        cumulativeTaxGrosze: cumulativeTaxRawGrosze,
        previousAdvancesPaidYtdGrosze: prevAdvances,
      },
      resultFormatted: formatPlnFromGrosze(roundedAdvance.roundedGrosze),
      resultGrosze: roundedAdvance.roundedGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'kpir_pit_advance',
    summary: `Zaliczka PIT (${input.taxForm}) za okres ${input.period}: podstawa ${formatPlnFromGrosze(roundedBase.roundedGrosze)}, zaliczka do wpłaty ${formatPlnFromGrosze(roundedAdvance.roundedGrosze)}.`,
    eventDate,
    rules: appliedRules,
    steps,
    inputs: {
      period: input.period,
      taxForm: input.taxForm,
      ytdRevenueGrosze: input.ytdRevenueGrosze,
      ytdCostsGrosze: input.ytdCostsGrosze,
      paidSocialZusYtdGrosze: socialPaid,
      paidHealthInsuranceYtdGrosze: healthPaid,
      previousAdvancesPaidYtdGrosze: prevAdvances,
    },
    outputs: {
      roundedTaxBaseGrosze: roundedBase.roundedGrosze,
      cumulativeTaxGrosze: cumulativeTaxRawGrosze,
      advanceDueGrosze: roundedAdvance.roundedGrosze,
    },
    warnings,
  });

  return {
    period: input.period,
    taxForm: input.taxForm,
    ytdIncomeGrosze,
    effectiveHealthDeductionFromIncomeGrosze: effectiveHealthDeduction,
    taxableBaseBeforeRoundingGrosze,
    roundedTaxBaseFullPln: roundedBase.roundedFullPln,
    roundedTaxBaseGrosze: roundedBase.roundedGrosze,
    cumulativeTaxGrosze: cumulativeTaxRawGrosze,
    advanceDueRoundedPln: roundedAdvance.roundedFullPln,
    advanceDueGrosze: roundedAdvance.roundedGrosze,
    explanation,
  };
}
