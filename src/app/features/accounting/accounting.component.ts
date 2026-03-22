import { Component, OnInit } from '@angular/core';
import { EventDetail } from '../../models/event-detail';
import { Expense } from '../../models/expense';
import { ActivatedRoute } from '@angular/router';

type Period = { value: string; label: string };

type ConcertBandGroup = {
  key: string;
  name: string;
  paymentCadence: 'prestazione' | 'mensile';
  monthlySettlement: 'acconto' | 'bonifico';
  events: EventDetail[];
  agreed: number;
  received: number;
};

// ─── Payment types ──────────────────────────────────────────────────────────
export type PaymentMode   = 'pattuito_extra' | 'pattuito_fattura' | 'fattura_diretta';
export type PaymentMethod = 'contanti' | 'bonifico' | 'assegno' | 'pos';
export type PaymentType   = 'acconto' | 'saldo' | 'mensile';
export type PaymentCategory = 'concerto' | 'lezione';
export type CooperativeSettlementState = 'none' | 'pending_transfer_to_musician' | 'pending_transfer_to_coop' | 'settled';

export type ServicePayment = {
  id: string;
  category: PaymentCategory;
  eventId: string;
  serviceTitle: string;
  serviceDate: string;
  agreedFee: number;
  receivedAmount: number;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  paymentMode: PaymentMode;
  ivaPercent: number;
  ivaAmount: number;
  invoiceTotal: number;
  taxableBase: number;
  reimbursableExpenses: number;
  includeExpensesInInvoice: boolean;
  enpalsExempt: boolean;
  groupInvoiceNote: string;
  cooperativeManaged: boolean;
  cooperativeFeePercent: number;
  cooperativeFixedFee: number;
  cooperativeFeeAmount: number;
  cooperativeNetAmount: number;
  cooperativeSettlementState: CooperativeSettlementState;
  cooperativeSettledAt: string;
  confirmed: boolean;
  confirmedAt: string;
  notes: string;
  createdAt: string;
};

type PaymentDraft = {
  eventId: string;
  category: PaymentCategory;
  serviceTitle: string;
  serviceDate: string;
  agreedFee: number;
  receivedAmount: number;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  paymentMode: PaymentMode;
  ivaPercent: number;
  reimbursableExpenses: number;
  includeExpensesInInvoice: boolean;
  enpalsExempt: boolean;
  groupInvoiceNote: string;
  cooperativeFeePercent: number;
  cooperativeFixedFee: number;
  notes: string;
};

type SerataTaxInput = {
  imponibile: number;
  componentCount: number;
  exEnpalsRequired: boolean;
  outsideResidenceComune: boolean;
  deductionAlreadyUsedToday: boolean;
};

type IrpefInput = {
  annualTaxableIncome: number;
  regionalMunicipalRate: number;
};

type MiniTaxDraft = {
  gross: number;
  fiscalMode: 'cooperativa' | 'piva' | 'associazione';
  taxRegime: 'ordinario' | 'forfettario' | 'esente_eaps';
  irpefBracket: '23' | '33' | '43';
  substituteTaxPercent: number;
  irapPercent: number;
  inailPercent: number;
  cooperativeFeePercent: number;
  cooperativeTaxPercent: number;
};

@Component({
  selector: 'app-accounting',
  templateUrl: './accounting.component.html',
  styleUrls: ['./accounting.component.scss']
})
export class AccountingComponent implements OnInit {
  events: EventDetail[]  = [];
  expenses: Expense[]    = [];
  selectedPeriod         = '';
  periods: Period[]      = [];

  // ─── Payments ──────────────────────────────────────────────────────────────
  payments: ServicePayment[] = [];
  paymentTab: 'concerti' | 'lezioni' | 'totali' = 'concerti';
  isTeacher             = false;
  enpalsExemptProfile   = false;
  showPaymentForm       = false;
  draft: PaymentDraft   = this.emptyDraft();
  selectedBandFilter = '';
  focusedEventId = '';
  showTaxTool = false;
  annualInvoicedConcertIncome = 0;
  cooperativeProfileForConcerts = false;
  private profileSnapshot: any = {};
  private concertCadenceByEventId = new Map<string, 'mensile' | 'prestazione'>();
  private concertBandByEventId = new Map<string, string>();
  private concertMonthlySettlementByEventId = new Map<string, 'acconto' | 'bonifico'>();
  private contactCadenceByBandName = new Map<string, 'mensile' | 'prestazione'>();
  private contactMonthlySettlementByBandName = new Map<string, 'acconto' | 'bonifico'>();
  showBandMonthlyPaymentForm = false;
  bandMonthlyBandName = '';
  bandMonthlyKind: 'acconto' | 'bonifico' = 'acconto';
  bandMonthlyAmount = 0;
  bandMonthlySaved = false;
  concertViewMode: 'band' | 'list' = 'band';
  expandedConcertBandKey: string | null = null;
  miniTaxEventId = '';
  miniTaxDraft: MiniTaxDraft = this.emptyMiniTaxDraft();
  serataTaxInput: SerataTaxInput = {
    imponibile: 150,
    componentCount: 1,
    exEnpalsRequired: false,
    outsideResidenceComune: true,
    deductionAlreadyUsedToday: false
  };
  irpefInput: IrpefInput = {
    annualTaxableIncome: 0,
    regionalMunicipalRate: 0
  };

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.events   = JSON.parse(localStorage.getItem('mm_events')   || '[]');
    this.expenses = JSON.parse(localStorage.getItem('mm_expenses') || '[]');
    this.payments = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');

    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.profileSnapshot = profile || {};
    this.isTeacher = profile?.isTeacher === true;
    this.enpalsExemptProfile = this.resolveEnpalsExemptionByRole(profile);
    this.cooperativeProfileForConcerts = this.detectCooperativeProfileForConcerts(profile);
    this.payments = this.normalizePayments(this.payments);
    this.annualInvoicedConcertIncome = this.computeAnnualInvoicedConcertIncome();
    this.irpefInput.annualTaxableIncome = this.annualInvoicedConcertIncome;
    this.loadConcertMetaMaps();

    const monthSet = new Set([
      ...this.events.map(e => e.date.substring(0, 7)),
      ...this.expenses.map(e => e.date.substring(0, 7)),
    ]);
    this.periods = Array.from(monthSet)
      .sort().reverse()
      .map(m => ({ value: m, label: this.formatMonth(m) }));
    this.selectedPeriod = this.periods[0]?.value || '';
    this.applyRouteContext();
  }

  // ─── Existing accounting getters ───────────────────────────────────────────
  private formatMonth(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return `${names[+m - 1]} ${y}`;
  }

  get filteredEvents(): EventDetail[] {
    if (!this.selectedPeriod) return this.events;
    return this.events.filter(e => e.date.startsWith(this.selectedPeriod));
  }

  get filteredExpenses(): Expense[] {
    if (!this.selectedPeriod) return this.expenses;
    return this.expenses.filter(e => e.date.startsWith(this.selectedPeriod));
  }

  get totalGross(): number    { return this.filteredEvents.reduce((s, e) => s + (e.grossFee || 0), 0); }
  get totalNet(): number      { return this.filteredEvents.reduce((s, e) => s + (e.netFee || 0), 0); }
  get totalExpenses(): number { return this.filteredExpenses.reduce((s, e) => s + (e.totalExpense || 0), 0); }
  get balance(): number       { return this.totalNet - this.totalExpenses; }

  formatDate(d: string): string {
    return new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  }

  // ─── Payment: event lists ──────────────────────────────────────────────────
  get concertEvents(): EventDetail[] {
    return [...this.events]
      .filter(e => e.type === 'concert' || e.type === 'dj_set')
      .filter(e => !this.selectedBandFilter || this.eventBandLabel(e).toLowerCase().includes(this.selectedBandFilter.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  get concertBandGroups(): ConcertBandGroup[] {
    const byKey = new Map<string, EventDetail[]>();
    for (const ev of this.concertEvents) {
      const key = this.normalizeBandKey(this.eventBandLabel(ev)) || 'band-non-definita';
      const list = byKey.get(key) || [];
      list.push(ev);
      byKey.set(key, list);
    }
    const groups: ConcertBandGroup[] = [];
    for (const [key, events] of byKey.entries()) {
      const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
      const name = this.eventBandLabel(sorted[0]) || key;
      const paymentCadence = sorted.some(e => this.isMonthlyConcert(e)) ? 'mensile' : 'prestazione';
      const monthlySettlement = paymentCadence === 'mensile'
        ? this.monthlySettlementForEvent((sorted.find(e => this.isMonthlyConcert(e)) || sorted[0]).id)
        : 'acconto';
      const agreed = sorted.reduce((sum, e) => sum + Number(e.grossFee || 0), 0);
      const received = sorted.reduce((sum, e) => sum + this.totalReceivedForEvent(e.id), 0);
      groups.push({
        key,
        name,
        paymentCadence,
        monthlySettlement,
        events: sorted,
        agreed: this.round2(agreed),
        received: this.round2(received)
      });
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }

  get lessonEvents(): EventDetail[] {
    return [...this.events]
      .filter(e => e.type === 'lesson')
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  get availableBandFilters(): string[] {
    const unique = new Set(this.events.filter(e => e.type === 'concert' || e.type === 'dj_set').map(e => this.eventBandLabel(e)));
    return [...unique].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  get immediateBandNames(): string[] {
    const set = new Set<string>();
    for (const event of this.immediateConcertEvents) set.add(this.eventBandLabel(event));
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  get monthlyBandNames(): string[] {
    const set = new Set<string>();
    for (const event of this.monthlyConcertEvents) set.add(this.eventBandLabel(event));
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  get monthlyAccontoBandNames(): string[] {
    const set = new Set<string>();
    for (const event of this.monthlyConcertEvents) {
      if (this.monthlySettlementForEvent(event.id) === 'acconto') set.add(this.eventBandLabel(event));
    }
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  get monthlyBonificoBandNames(): string[] {
    const set = new Set<string>();
    for (const event of this.monthlyConcertEvents) {
      if (this.monthlySettlementForEvent(event.id) === 'bonifico') set.add(this.eventBandLabel(event));
    }
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  get immediateConcertEvents(): EventDetail[] {
    return this.concertEvents.filter(event => this.isImmediateConcert(event));
  }

  get monthlyConcertEvents(): EventDetail[] {
    return this.concertEvents.filter(event => this.isMonthlyConcert(event));
  }

  get immediateConcertAgreed(): number {
    return this.immediateConcertEvents.reduce((sum, event) => sum + Number(event.grossFee || 0), 0);
  }

  get monthlyConcertAgreed(): number {
    return this.monthlyConcertEvents.reduce((sum, event) => sum + Number(event.grossFee || 0), 0);
  }

  get immediateConcertReceived(): number {
    return this.immediateConcertEvents.reduce((sum, event) => sum + this.totalReceivedForEvent(event.id), 0);
  }

  get monthlyConcertReceived(): number {
    return this.monthlyConcertEvents.reduce((sum, event) => sum + this.totalReceivedForEvent(event.id), 0);
  }

  paymentsForEvent(eventId: string): ServicePayment[] {
    return this.payments.filter(p => p.eventId === eventId);
  }

  paymentStatusClass(eventId: string): string {
    const due = this.eventAgreedAmount(eventId);
    const received = this.totalReceivedForEvent(eventId);
    if (received <= 0) return 'status-none';
    if (due > 0 && received >= due) return 'status-paid';
    return 'status-acconto';
  }

  paymentStatusLabel(eventId: string): string {
    const due = this.eventAgreedAmount(eventId);
    const received = this.totalReceivedForEvent(eventId);
    if (received <= 0) return 'Da pagare';
    if (due > 0 && received >= due) return 'Pagato';
    return 'Parziale';
  }

  totalReceivedForEvent(eventId: string): number {
    return this.paymentsForEvent(eventId).reduce((s, p) => s + this.effectiveReceivedAmount(p), 0);
  }

  // ─── Payment form ──────────────────────────────────────────────────────────
  openPaymentForm(event: EventDetail): void {
    const category: PaymentCategory = event.type === 'lesson' ? 'lezione' : 'concerto';
    const roleSetup = this.getRoleSetupForEvent(event);
    const roleFiscalMode = `${roleSetup?.fiscalMode || ''}`.toLowerCase();
    const roleIsCoopManaged = roleFiscalMode === 'cooperativa' || roleFiscalMode === 'associazione';
    const defaultMode: PaymentMode = roleIsCoopManaged
      ? 'pattuito_fattura'
      : (event.compensoType === 'in_fattura' ? 'fattura_diretta' : 'pattuito_extra');
    this.draft = {
      eventId: event.id,
      category,
      serviceTitle: event.title,
      serviceDate:  event.date,
      agreedFee:    event.grossFee || 0,
      receivedAmount: event.grossFee || 0,
      paymentType:  'saldo',
      paymentMethod: 'contanti',
      paymentMode:  defaultMode,
      ivaPercent:   22,
      reimbursableExpenses: Math.max(0, Number((event.netFee || 0) - (event.grossFee || 0))),
      includeExpensesInInvoice: !this.eventExtraExpensesOutsideInvoice(event),
      enpalsExempt: roleSetup?.inpsExempt === true || (this.enpalsExemptProfile && event.type !== 'dj_set'),
      groupInvoiceNote: '',
      cooperativeFeePercent: Number(roleSetup?.cooperativeFeePercent || 12),
      cooperativeFixedFee: 0,
      notes: ''
    };
    this.showPaymentForm = true;
    this.focusedEventId = event.id;
  }

  openImmediateConcertPaymentForm(event: EventDetail): void {
    if (this.isMonthlyConcert(event)) {
      this.openMonthlyConcertPaymentForm(event, 'acconto');
      return;
    }
    this.openPaymentForm(event);
    this.draft.paymentType = 'saldo';
    this.draft.paymentMethod = 'contanti';
    this.enforceImmediateConcertRules();
  }

  openMonthlyConcertPaymentForm(event: EventDetail, mode: 'acconto' | 'bonifico'): void {
    this.openPaymentForm(event);
    this.draft.receivedAmount = 0;
    this.draft.includeExpensesInInvoice = false;
    if (mode === 'acconto') {
      this.draft.paymentType = 'acconto';
      this.draft.paymentMethod = 'contanti';
      this.draft.paymentMode = 'pattuito_extra';
      return;
    }
    this.draft.paymentType = 'mensile';
    this.draft.paymentMethod = 'bonifico';
    this.draft.paymentMode = 'pattuito_fattura';
  }

  toggleConcertBandExpanded(key: string): void {
    this.expandedConcertBandKey = this.expandedConcertBandKey === key ? null : key;
  }

  openBandMonthlyCreditForm(bandName: string, kind: 'acconto' | 'bonifico'): void {
    this.paymentTab = 'concerti';
    this.showBandMonthlyPaymentForm = true;
    this.bandMonthlyBandName = bandName;
    this.bandMonthlyKind = kind;
    this.bandMonthlyAmount = 0;
    this.bandMonthlySaved = false;
  }

  isMonthlyConcert(event: EventDetail): boolean {
    if (event.type !== 'concert' && event.type !== 'dj_set') return false;
    const bandCadence = this.contactCadenceByBandName.get(this.normalizeBandKey(this.eventBandLabel(event)));
    if (bandCadence) return bandCadence === 'mensile';
    const mappedCadence = this.concertCadenceByEventId.get(`${event.id || ''}`);
    if (mappedCadence) return mappedCadence === 'mensile';
    const notes = `${event.notes || ''}`.toLowerCase();
    if (notes.includes('[paymentcadence:mensile]')) return true;
    if (notes.includes('pagamento mensile')) return true;
    return false;
  }

  isImmediateConcert(event: EventDetail): boolean {
    return (event.type === 'concert' || event.type === 'dj_set') && !this.isMonthlyConcert(event);
  }

  isDraftMonthlyConcert(): boolean {
    const event = this.events.find(e => e.id === this.draft.eventId);
    return !!event && this.isMonthlyConcert(event);
  }

  isImmediateTrackedMethod(): boolean {
    if (this.isDraftMonthlyConcert()) return false;
    return this.draft.paymentMethod !== 'contanti';
  }

  isPattuitoExtraOnlyCash(): boolean {
    return this.draft.paymentMode === 'pattuito_extra';
  }

  isCooperativeProfileInCurrentDraft(): boolean {
    if (this.isDraftMonthlyConcert()) return true;
    return this.currentDraftUsesCooperativeProfile();
  }

  onPaymentModeChanged(): void {
    this.enforceImmediateConcertRules();
  }

  onConcertPaymentMethodChanged(): void {
    this.enforceImmediateConcertRules();
  }

  private enforceImmediateConcertRules(): void {
    if (this.isDraftMonthlyConcert()) return;
    if (this.draft.paymentMode === 'pattuito_extra') {
      this.draft.paymentMethod = 'contanti';
      return;
    }
    if (this.draft.paymentMethod !== 'contanti') {
      this.draft.paymentMode = 'fattura_diretta';
      return;
    }
    if (this.draft.paymentMode !== 'fattura_diretta') {
      this.draft.paymentMode = 'fattura_diretta';
    }
  }

  closePaymentForm(): void {
    this.showPaymentForm = false;
    this.focusedEventId = '';
    this.draft = this.emptyDraft();
  }

  toggleMiniTaxTool(event: EventDetail): void {
    if (this.miniTaxEventId === event.id) {
      this.miniTaxEventId = '';
      return;
    }
    this.miniTaxEventId = event.id;
    const roleSetup = this.getRoleSetupForEvent(event) || {};
    this.miniTaxDraft = {
      gross: Math.max(0, Number(event.grossFee || 0)),
      fiscalMode: this.resolveMiniFiscalMode(`${roleSetup?.fiscalMode || ''}`),
      taxRegime: this.resolveMiniTaxRegime(`${roleSetup?.taxRegime || ''}`),
      irpefBracket: this.resolveMiniIrpefBracket(`${roleSetup?.irpefBracket || ''}`),
      substituteTaxPercent: Number(roleSetup?.substituteTaxPercent || 15),
      irapPercent: Number(roleSetup?.irapPercent || 3.9),
      inailPercent: Number(roleSetup?.inailPercent || 0),
      cooperativeFeePercent: Number(roleSetup?.cooperativeFeePercent || 12),
      cooperativeTaxPercent: Number(roleSetup?.cooperativeTaxPercent || 9.19)
    };
  }

  get miniTaxCooperativeCosts(): number {
    if (this.miniTaxDraft.fiscalMode === 'piva') return 0;
    const gross = Math.max(0, Number(this.miniTaxDraft.gross || 0));
    const fee = Math.max(0, Number(this.miniTaxDraft.cooperativeFeePercent || 0));
    const coopTax = Math.max(0, Number(this.miniTaxDraft.cooperativeTaxPercent || 0));
    return this.round2(gross * (fee + coopTax) / 100);
  }

  get miniTaxDirectReserve(): number {
    if (this.miniTaxDraft.fiscalMode !== 'piva') return 0;
    const gross = Math.max(0, Number(this.miniTaxDraft.gross || 0));
    const irap = Math.max(0, Number(this.miniTaxDraft.irapPercent || 0));
    const inail = Math.max(0, Number(this.miniTaxDraft.inailPercent || 0));
    const directTax = this.miniTaxDraft.taxRegime === 'forfettario'
      ? Math.max(0, Number(this.miniTaxDraft.substituteTaxPercent || 0))
      : (this.miniTaxDraft.taxRegime === 'esente_eaps' ? 0 : Number(this.miniTaxDraft.irpefBracket || '23'));
    return this.round2(gross * (directTax + irap + inail) / 100);
  }

  get miniTaxImmediateNet(): number {
    const gross = Math.max(0, Number(this.miniTaxDraft.gross || 0));
    if (this.miniTaxDraft.fiscalMode === 'piva') return gross;
    return this.round2(Math.max(0, gross - this.miniTaxCooperativeCosts));
  }

  get miniTaxEstimatedNet(): number {
    const gross = Math.max(0, Number(this.miniTaxDraft.gross || 0));
    if (this.miniTaxDraft.fiscalMode !== 'piva') return this.miniTaxImmediateNet;
    return this.round2(Math.max(0, gross - this.miniTaxDirectReserve));
  }

  get draftIvaAmount(): number {
    if (this.draft.paymentMode !== 'fattura_diretta') return 0;
    return Math.round(this.draftTaxableBase * (this.draft.ivaPercent / 100) * 100) / 100;
  }

  get draftInvoiceTotal(): number {
    if (this.draft.paymentMode !== 'fattura_diretta') return 0;
    return this.draftTaxableBase + this.draftIvaAmount;
  }

  get draftTaxableBase(): number {
    const amount = Number(this.draft.receivedAmount || 0);
    if (this.draft.paymentMode !== 'fattura_diretta') return amount;
    const expenses = this.draft.includeExpensesInInvoice ? Number(this.draft.reimbursableExpenses || 0) : 0;
    return amount + expenses;
  }

  get draftCooperativeFeeAmount(): number {
    if (!this.isCooperativeManagedDraft()) return 0;
    const base = Number(this.draft.receivedAmount || 0);
    const percent = Math.max(0, Number(this.draft.cooperativeFeePercent || 0)) / 100;
    const fixed = Math.max(0, Number(this.draft.cooperativeFixedFee || 0));
    return this.round2(base * percent + fixed);
  }

  get draftCooperativeNetAmount(): number {
    if (!this.isCooperativeManagedDraft()) return Number(this.draft.receivedAmount || 0);
    return this.round2(Math.max(0, Number(this.draft.receivedAmount || 0) - this.draftCooperativeFeeAmount));
  }

  isCooperativeManagedDraft(): boolean {
    if (this.draft.category !== 'concerto') return false;
    if (this.draft.paymentMode === 'pattuito_fattura') return true;
    return this.draft.paymentMode === 'fattura_diretta' && this.currentDraftUsesCooperativeProfile();
  }

  get invoiced5000Counter(): number {
    return this.annualInvoicedConcertIncome;
  }

  get invoiced5000Residual(): number {
    return Math.max(0, 5000 - this.invoiced5000Counter);
  }

  get invoiced5000Over(): number {
    return Math.max(0, this.invoiced5000Counter - 5000);
  }

  get serataIrap(): number {
    return this.round2(this.serataTaxInput.imponibile * 0.039);
  }

  get serataDeductionPerComponent(): number {
    if (!this.serataTaxInput.outsideResidenceComune || this.serataTaxInput.deductionAlreadyUsedToday) return 0;
    const proportional = this.serataTaxInput.imponibile >= 120
      ? 46
      : (this.serataTaxInput.imponibile / 120) * 46;
    return this.round2(Math.max(0, Math.min(46, proportional)));
  }

  get serataContributionRate(): number {
    return this.serataTaxInput.exEnpalsRequired ? 0.271030763 : 0.040122864;
  }

  get serataContributionMin(): number {
    return this.serataTaxInput.exEnpalsRequired ? 21.61 : 2.4;
  }

  get serataContributionRawPerComponent(): number {
    const components = Math.max(1, Number(this.serataTaxInput.componentCount || 1));
    const basePerComponent = ((this.serataTaxInput.imponibile - this.serataIrap) / components) - this.serataDeductionPerComponent;
    return this.round2(Math.max(0, basePerComponent) * this.serataContributionRate);
  }

  get serataContributionPerComponent(): number {
    return Math.max(this.serataContributionMin, this.serataContributionRawPerComponent);
  }

  get serataContributionTotalBand(): number {
    return this.round2(this.serataContributionPerComponent * Math.max(1, Number(this.serataTaxInput.componentCount || 1)));
  }

  get serataTotalTaxesBand(): number {
    return this.round2(this.serataIrap + this.serataContributionTotalBand);
  }

  get serataImponibilePerComponent(): number {
    return this.round2(this.serataTaxInput.imponibile / Math.max(1, Number(this.serataTaxInput.componentCount || 1)));
  }

  get serataMinInvoiceWarning(): string {
    if (this.serataImponibilePerComponent >= 60) return '';
    return 'Attenzione: imponibile per componente sotto 60,00€ + IVA';
  }

  get irpefLorda(): number {
    let income = Math.max(0, Number(this.irpefInput.annualTaxableIncome || 0));
    let tax = 0;
    const brackets = [
      { limit: 28000, rate: 0.23 },
      { limit: 50000, rate: 0.33 },
      { limit: Infinity, rate: 0.43 }
    ];
    let previous = 0;
    for (const bracket of brackets) {
      const taxable = Math.max(0, Math.min(income, bracket.limit) - previous);
      tax += taxable * bracket.rate;
      previous = bracket.limit;
      if (income <= bracket.limit) break;
    }
    return this.round2(tax);
  }

  get irpefRegionalMunicipal(): number {
    const rate = Math.max(0, Number(this.irpefInput.regionalMunicipalRate || 0)) / 100;
    return this.round2(Math.max(0, Number(this.irpefInput.annualTaxableIncome || 0)) * rate);
  }

  get irpefTotalEstimated(): number {
    return this.round2(this.irpefLorda + this.irpefRegionalMunicipal);
  }

  get irpefBracketAmounts(): { first: number; second: number; third: number } {
    const income = Math.max(0, Number(this.irpefInput.annualTaxableIncome || 0));
    const first = Math.max(0, Math.min(income, 28000));
    const second = Math.max(0, Math.min(income, 50000) - 28000);
    const third = Math.max(0, income - 50000);
    return {
      first: this.round2(first * 0.23),
      second: this.round2(second * 0.33),
      third: this.round2(third * 0.43)
    };
  }

  savePayment(): void {
    if (!this.draft.receivedAmount || this.draft.receivedAmount <= 0) return;
    const cooperativeManaged = this.isCooperativeManagedDraft();
    const cooperativeSettlementState: CooperativeSettlementState = !cooperativeManaged
      ? 'none'
      : (this.draft.paymentMethod === 'contanti' ? 'pending_transfer_to_coop' : 'pending_transfer_to_musician');
    const payment: ServicePayment = {
      id:              crypto.randomUUID(),
      category:        this.draft.category,
      eventId:         this.draft.eventId,
      serviceTitle:    this.draft.serviceTitle,
      serviceDate:     this.draft.serviceDate,
      agreedFee:       this.draft.agreedFee,
      receivedAmount:  this.draft.receivedAmount,
      paymentType:     this.draft.paymentType,
      paymentMethod:   this.draft.paymentMethod,
      paymentMode:     this.draft.paymentMode,
      ivaPercent:      this.draft.ivaPercent,
      ivaAmount:       this.draftIvaAmount,
      invoiceTotal:    this.draftInvoiceTotal,
      taxableBase:     this.draftTaxableBase,
      reimbursableExpenses: this.draft.reimbursableExpenses,
      includeExpensesInInvoice: this.draft.includeExpensesInInvoice,
      enpalsExempt:    this.draft.enpalsExempt,
      groupInvoiceNote: this.draft.groupInvoiceNote,
      cooperativeManaged,
      cooperativeFeePercent: cooperativeManaged ? Math.max(0, Number(this.draft.cooperativeFeePercent || 0)) : 0,
      cooperativeFixedFee: cooperativeManaged ? Math.max(0, Number(this.draft.cooperativeFixedFee || 0)) : 0,
      cooperativeFeeAmount: cooperativeManaged ? this.draftCooperativeFeeAmount : 0,
      cooperativeNetAmount: cooperativeManaged ? this.draftCooperativeNetAmount : Number(this.draft.receivedAmount || 0),
      cooperativeSettlementState,
      cooperativeSettledAt: '',
      confirmed:       true,
      confirmedAt:     new Date().toISOString(),
      notes:           this.draft.notes,
      createdAt:       new Date().toISOString()
    };
    this.payments = [...this.payments, payment];
    localStorage.setItem('mm_service_payments', JSON.stringify(this.payments));
    this.closePaymentForm();
  }

  markCooperativeSettled(paymentId: string): void {
    this.payments = this.payments.map(payment => {
      if (payment.id !== paymentId) return payment;
      if (!payment.cooperativeManaged || payment.cooperativeSettlementState === 'settled') return payment;
      return {
        ...payment,
        cooperativeSettlementState: 'settled',
        cooperativeSettledAt: new Date().toISOString()
      };
    });
    localStorage.setItem('mm_service_payments', JSON.stringify(this.payments));
  }

  deletePayment(id: string): void {
    this.payments = this.payments.filter(p => p.id !== id);
    localStorage.setItem('mm_service_payments', JSON.stringify(this.payments));
  }

  // ─── Totali ────────────────────────────────────────────────────────────────
  get totalConcertiAgreed(): number   { return this.concertEvents.reduce((s, e) => s + (e.grossFee || 0), 0); }
  get totalConcertiReceived(): number { return this.payments.filter(p => p.category === 'concerto').reduce((s, p) => s + this.effectiveReceivedAmount(p), 0); }
  get totalLezioniAgreed(): number    { return this.lessonEvents.reduce((s, e) => s + (e.grossFee || 0), 0); }
  get totalLezioniReceived(): number  { return this.payments.filter(p => p.category === 'lezione').reduce((s, p) => s + this.effectiveReceivedAmount(p), 0); }
  get totalAllAgreed(): number        { return this.totalConcertiAgreed + this.totalLezioniAgreed; }
  get totalAllReceived(): number      { return this.totalConcertiReceived + this.totalLezioniReceived; }
  get totalAllPending(): number       { return this.totalAllAgreed - this.totalAllReceived; }

  // ─── Label helpers ─────────────────────────────────────────────────────────
  paymentModeLabel(mode: PaymentMode): string {
    const map: Record<PaymentMode, string> = {
      pattuito_extra:    'Fuori fattura',
      pattuito_fattura:  'Gestione cooperativa',
      fattura_diretta:   'In fattura diretta'
    };
    return map[mode] || mode;
  }

  paymentModeBadgeClass(mode: PaymentMode): string {
    const map: Record<PaymentMode, string> = {
      pattuito_extra:   'mode-extra',
      pattuito_fattura: 'mode-group',
      fattura_diretta:  'mode-fattura'
    };
    return map[mode] || '';
  }

  paymentTypeLabel(type: PaymentType): string {
    const map: Record<PaymentType, string> = { acconto: 'Acconto', saldo: 'Saldo', mensile: 'Mensile' };
    return map[type] || type;
  }

  paymentMethodLabel(method: PaymentMethod): string {
    const map: Record<PaymentMethod, string> = {
      contanti: 'Contanti', bonifico: 'Bonifico', assegno: 'Assegno', pos: 'POS'
    };
    return map[method] || method;
  }

  eventBandLabel(event: EventDetail): string {
    const mapped = this.concertBandByEventId.get(`${event.id || ''}`);
    if (mapped) return mapped;
    const notes = `${event.notes || ''}`;
    const match = notes.match(/\[Rubrica:([^\]]+)\]/i);
    if (match?.[1]) return match[1].trim();
    if (event.venue) return event.venue;
    return event.title;
  }

  eventExtraExpensesOutsideInvoice(event: EventDetail): boolean {
    const notes = `${event.notes || ''}`.toLowerCase();
    if (notes.includes('[spese extra:in_fattura]')) return false;
    return true;
  }

  eventAgreedAmount(eventId: string): number {
    return Number(this.events.find(e => e.id === eventId)?.grossFee || 0);
  }

  cooperativeSettlementLabel(payment: ServicePayment): string {
    if (!payment.cooperativeManaged) return '';
    if (payment.cooperativeSettlementState === 'pending_transfer_to_musician') return 'In attesa netto pulito da cooperativa';
    if (payment.cooperativeSettlementState === 'pending_transfer_to_coop') return 'Da versare a cooperativa (costi fattura)';
    if (payment.cooperativeSettlementState === 'settled') return 'Regolato con cooperativa';
    return '';
  }

  cooperativeActionLabel(payment: ServicePayment): string {
    if (payment.cooperativeSettlementState === 'pending_transfer_to_musician') return 'Netto pulito ricevuto';
    if (payment.cooperativeSettlementState === 'pending_transfer_to_coop') return 'Costi inviati a cooperativa';
    return '';
  }

  private applyRouteContext(): void {
    const qp = this.route.snapshot.queryParamMap;
    const eventId = `${qp.get('eventId') || ''}`.trim();
    const band = `${qp.get('band') || ''}`.trim();
    const paymentCadence = `${qp.get('paymentCadence') || ''}`.trim();
    const monthlyAction = `${qp.get('monthlyAction') || ''}`.trim();
    const extraExpensesOutsideInvoice = `${qp.get('extraExpensesOutsideInvoice') || ''}`.trim();
    if (band) this.selectedBandFilter = band;
    if (!eventId && band && paymentCadence === 'mensile') {
      this.paymentTab = 'concerti';
      this.showBandMonthlyPaymentForm = true;
      this.bandMonthlyBandName = band;
      this.bandMonthlyKind = monthlyAction === 'bonifico' ? 'bonifico' : 'acconto';
      this.bandMonthlyAmount = 0;
      this.bandMonthlySaved = false;
      return;
    }
    this.showBandMonthlyPaymentForm = false;
    if (!eventId) return;
    this.paymentTab = 'concerti';
    const target = this.events.find(e => e.id === eventId && (e.type === 'concert' || e.type === 'dj_set'));
    if (!target) return;
    if (paymentCadence === 'mensile') {
      this.openMonthlyConcertPaymentForm(target, monthlyAction === 'bonifico' ? 'bonifico' : 'acconto');
      if (extraExpensesOutsideInvoice === '1') this.draft.includeExpensesInInvoice = false;
      if (extraExpensesOutsideInvoice === '0') this.draft.includeExpensesInInvoice = true;
    } else {
      this.openImmediateConcertPaymentForm(target);
      if (extraExpensesOutsideInvoice === '1') this.draft.includeExpensesInInvoice = false;
      if (extraExpensesOutsideInvoice === '0') this.draft.includeExpensesInInvoice = true;
    }
  }

  saveBandMonthlyCredit(): void {
    const bandName = `${this.bandMonthlyBandName || ''}`.trim();
    const amount = Number(this.bandMonthlyAmount || 0);
    if (!bandName) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    const raw = JSON.parse(localStorage.getItem('mm_band_credits') || '[]');
    const list = Array.isArray(raw) ? raw : [];
    list.unshift({
      id: crypto.randomUUID(),
      bandKey: this.normalizeBandKey(bandName),
      bandName,
      kind: this.bandMonthlyKind,
      amount: this.round2(amount),
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('mm_band_credits', JSON.stringify(list));
    this.bandMonthlySaved = true;
    this.bandMonthlyAmount = 0;
  }

  private computeAnnualInvoicedConcertIncome(): number {
    const year = new Date().getFullYear();
    return this.payments
      .filter(p => p.category === 'concerto' && `${p.serviceDate || ''}`.startsWith(`${year}-`))
      .filter(p => p.paymentMode === 'fattura_diretta' || p.paymentMode === 'pattuito_fattura')
      .reduce((sum, p) => sum + Number(p.taxableBase || p.receivedAmount || 0), 0);
  }

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private resolveMiniFiscalMode(value: string): MiniTaxDraft['fiscalMode'] {
    const mode = value.toLowerCase();
    if (mode === 'piva') return 'piva';
    if (mode === 'associazione') return 'associazione';
    return 'cooperativa';
  }

  private resolveMiniTaxRegime(value: string): MiniTaxDraft['taxRegime'] {
    const regime = value.toLowerCase();
    if (regime === 'forfettario') return 'forfettario';
    if (regime === 'esente_eaps') return 'esente_eaps';
    return 'ordinario';
  }

  private resolveMiniIrpefBracket(value: string): MiniTaxDraft['irpefBracket'] {
    if (value === '33') return '33';
    if (value === '43') return '43';
    return '23';
  }

  private effectiveReceivedAmount(payment: ServicePayment): number {
    if (!payment.cooperativeManaged) return Number(payment.receivedAmount || 0);
    if (payment.cooperativeSettlementState === 'pending_transfer_to_musician') return 0;
    return Number(payment.cooperativeNetAmount || 0);
  }

  private normalizePayments(payments: ServicePayment[]): ServicePayment[] {
    return (payments || []).map(payment => {
      const cooperativeManaged = !!payment.cooperativeManaged || payment.paymentMode === 'pattuito_fattura';
      const feePercent = Number(payment.cooperativeFeePercent || 0);
      const fixed = Number(payment.cooperativeFixedFee || 0);
      const feeAmount = cooperativeManaged
        ? Number(payment.cooperativeFeeAmount || this.round2(Number(payment.receivedAmount || 0) * (feePercent / 100) + fixed))
        : 0;
      const net = cooperativeManaged
        ? Number(payment.cooperativeNetAmount || this.round2(Math.max(0, Number(payment.receivedAmount || 0) - feeAmount)))
        : Number(payment.receivedAmount || 0);
      const settlement = (payment.cooperativeSettlementState || (cooperativeManaged ? 'settled' : 'none')) as CooperativeSettlementState;
      return {
        ...payment,
        cooperativeManaged,
        cooperativeFeePercent: cooperativeManaged ? feePercent : 0,
        cooperativeFixedFee: cooperativeManaged ? fixed : 0,
        cooperativeFeeAmount: cooperativeManaged ? feeAmount : 0,
        cooperativeNetAmount: net,
        cooperativeSettlementState: cooperativeManaged ? settlement : 'none',
        cooperativeSettledAt: `${payment.cooperativeSettledAt || ''}`
      };
    });
  }

  private detectCooperativeProfileForConcerts(profile: any): boolean {
    const roleSettings = profile?.roleSettings || {};
    const musicianMode = `${roleSettings?.musician?.fiscalMode || ''}`.toLowerCase();
    const djMode = `${roleSettings?.dj?.fiscalMode || ''}`.toLowerCase();
    if (musicianMode || djMode) {
      const musicianCoop = musicianMode === 'cooperativa' || musicianMode === 'associazione';
      const djCoop = djMode === 'cooperativa' || djMode === 'associazione';
      return musicianCoop || djCoop;
    }
    const workerType = `${profile?.workerType || ''}`.toLowerCase();
    return workerType.includes('cooperativa');
  }

  private loadConcertMetaMaps(): void {
    this.concertCadenceByEventId.clear();
    this.concertBandByEventId.clear();
    this.concertMonthlySettlementByEventId.clear();
    this.contactCadenceByBandName.clear();
    this.contactMonthlySettlementByBandName.clear();

    const contacts = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    if (Array.isArray(contacts)) {
      for (const contact of contacts) {
        if (`${contact?.type || ''}` !== 'band') continue;
        const display = `${contact?.displayName || ''}`.trim();
        if (!display) continue;
        const key = this.normalizeBandKey(display);
        const cadence = `${contact?.paymentCadence || ''}`.toLowerCase() === 'mensile' ? 'mensile' : 'prestazione';
        const settlement = `${contact?.monthlySettlement || ''}`.toLowerCase() === 'bonifico' ? 'bonifico' : 'acconto';
        this.contactCadenceByBandName.set(key, cadence);
        this.contactMonthlySettlementByBandName.set(key, settlement);
      }
    }

    const concerts = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    if (!Array.isArray(concerts)) return;
    for (const concert of concerts) {
      const id = `${concert?.id || ''}`.trim();
      if (!id) continue;
      const cadence = `${concert?.paymentCadence || ''}`.toLowerCase() === 'mensile' ? 'mensile' : 'prestazione';
      this.concertCadenceByEventId.set(id, cadence);
      const monthlySettlement = `${concert?.monthlySettlement || ''}`.toLowerCase() === 'bonifico' ? 'bonifico' : 'acconto';
      this.concertMonthlySettlementByEventId.set(id, monthlySettlement);
      const band = this.resolveBandFromConcertRecord(concert);
      if (band) this.concertBandByEventId.set(id, band);
    }
  }

  private monthlySettlementForEvent(eventId: string): 'acconto' | 'bonifico' {
    const event = this.events.find(x => `${x?.id || ''}` === `${eventId || ''}`);
    if (event) {
      const byBand = this.contactMonthlySettlementByBandName.get(this.normalizeBandKey(this.eventBandLabel(event)));
      if (byBand) return byBand;
    }
    return this.concertMonthlySettlementByEventId.get(`${eventId || ''}`) || 'acconto';
  }

  private resolveBandFromConcertRecord(concert: any): string {
    const fromBands = Array.isArray(concert?.bands)
      ? concert.bands.map((x: any) => `${x || ''}`.trim()).filter(Boolean)
      : [];
    if (fromBands.length) return fromBands.join(', ');
    const venue = `${concert?.venue || ''}`.trim();
    if (venue) return venue;
    const title = `${concert?.title || ''}`.trim();
    return title;
  }

  private normalizeBandKey(value: string): string {
    return `${value || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private resolveEnpalsExemptionByRole(profile: any): boolean {
    const roleSettings = profile?.roleSettings || {};
    if (roleSettings?.musician && typeof roleSettings.musician.inpsExempt === 'boolean') {
      return roleSettings.musician.inpsExempt === true;
    }
    return profile?.inpsExempt === true;
  }

  private getRoleSetupForEvent(event: EventDetail): any {
    const roleSettings = this.profileSnapshot?.roleSettings || {};
    if (event.type === 'lesson') return roleSettings.teacher || null;
    if (event.type === 'dj_set') return roleSettings.dj || null;
    return roleSettings.musician || null;
  }

  private currentDraftUsesCooperativeProfile(): boolean {
    const event = this.events.find(e => e.id === this.draft.eventId);
    if (!event) return this.cooperativeProfileForConcerts;
    const roleSetup = this.getRoleSetupForEvent(event);
    const roleFiscalMode = `${roleSetup?.fiscalMode || ''}`.toLowerCase();
    if (!roleFiscalMode) return this.cooperativeProfileForConcerts;
    return roleFiscalMode === 'cooperativa' || roleFiscalMode === 'associazione';
  }

  private emptyDraft(): PaymentDraft {
    return {
      eventId: '', category: 'concerto', serviceTitle: '', serviceDate: '',
      agreedFee: 0, receivedAmount: 0,
      paymentType: 'saldo', paymentMethod: 'contanti', paymentMode: 'pattuito_extra',
      ivaPercent: 22, reimbursableExpenses: 0, includeExpensesInInvoice: false, enpalsExempt: false, groupInvoiceNote: '',
      cooperativeFeePercent: 12, cooperativeFixedFee: 0, notes: ''
    };
  }

  private emptyMiniTaxDraft(): MiniTaxDraft {
    return {
      gross: 0,
      fiscalMode: 'cooperativa',
      taxRegime: 'ordinario',
      irpefBracket: '23',
      substituteTaxPercent: 15,
      irapPercent: 3.9,
      inailPercent: 0,
      cooperativeFeePercent: 12,
      cooperativeTaxPercent: 9.19
    };
  }
}
