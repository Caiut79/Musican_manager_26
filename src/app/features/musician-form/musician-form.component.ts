import { Component, ViewChild, ElementRef } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';
import { Musician } from '../../models/musician';
import { Router } from '@angular/router';

const INSTRUMENTS = ['Chitarra', 'Basso', 'Batteria', 'Pianoforte', 'Voce', 'Sax', 'Violino', 'Tromba'];
const LEVELS = ['Principiante', 'Intermedio', 'Avanzato', 'Professionista'];
const STYLES = ['Rock', 'Pop', 'Jazz', 'Blues', 'Classica', 'Metal', 'Funk', 'Soul', 'R&B', 'Hip Hop', 'Elettronica', 'Folk'];
const ENPALS_CATEGORIES = [
  { value: '',       label: '— Seleziona categoria —' },
  { value: 'A1',    label: 'A1 – Artista lirico' },
  { value: 'A2',    label: 'A2 – Orchestrale / Strumentista / Bandista' },
  { value: 'A3',    label: 'A3 – Cantante (pop, rock, jazz…)' },
  { value: 'A4',    label: 'A4 – Musicista solista professionista' },
  { value: 'B1',    label: 'B1 – Insegnante di musica (con esibizioni)' },
  { value: 'altro', label: 'Altra categoria' },
];

type ProfileAddressField = 'birthPlace' | 'residence' | 'homeBase';
type MonthlyTaxPlanRow = {
  month: string;
  revenue: number;
  costs: number;
  taxReserve: number;
  netCash: number;
  cumulativeTaxReserve: number;
};
type RoleSimulation = {
  gross: number;
  cooperativeCosts: number;
  taxReserve: number;
  netImmediate: number;
  netAfterTaxes: number;
  mode: string;
};

@Component({
  selector: 'app-musician-form',
  templateUrl: './musician-form.component.html',
  styleUrls: ['./musician-form.component.scss']
})
export class MusicianFormComponent {
  instruments = INSTRUMENTS;
  levels      = LEVELS;
  styles      = STYLES;
  enpalsCategories = ENPALS_CATEGORIES;

  steps = ['Anagrafica', 'Profilo musicale', 'Social', 'ENPALS & Fiscale', 'Colori agenda'];
  currentStep = 0;
  submitting  = false;
  resultCode: string | null = null;
  savedOk = false;
  error: string | null = null;
  hasSavedProfile = false;
  incompleteStepIndexes: number[] = [];
  signatureSaved = false;
  annualInvoicedMusicIncome = 0;
  birthPlaceSuggestions: string[] = [];
  residenceSuggestions: string[] = [];
  homeBaseSuggestions: string[] = [];
  private addressSearchTimers: Partial<Record<ProfileAddressField, ReturnType<typeof setTimeout>>> = {};
  private addressSearchAborters: Partial<Record<ProfileAddressField, AbortController>> = {};

  // ── Signature pad ──────────────────────────────────────────
  private _sigCanvas?: ElementRef<HTMLCanvasElement>;
  private _sigCtx?: CanvasRenderingContext2D;
  private _signing = false;

  @ViewChild('sigCanvas')
  set sigCanvas(el: ElementRef<HTMLCanvasElement> | undefined) {
    this._sigCanvas = el;
    if (el) {
      setTimeout(() => this.initSignatureCanvas(el.nativeElement), 50);
    }
  }
  // ───────────────────────────────────────────────────────────

  form = this.fb.group({
    // Step 0 – Anagrafica
    firstName:  ['', Validators.required],
    lastName:   ['', Validators.required],
    phone:      [''],
    licenseEmail:[''],
    birthDate:  [''],
    birthPlace: [''],
    fiscalCode: [''],
    residence:  [''],
    homeBase:   [''],
    isMusician: [true],
    // Step 1 – Profilo musicale
    instrument:      [''],
    level:           [''],
    stylesPlayed:    [[] as string[]],
    searchableStyles:[[] as string[]],
    // Step 2 – Social
    instagram: [''],
    facebook:  [''],
    youtube:   [''],
    tiktok:    [''],
    website:   [''],
    // Step 3 – ENPALS & Fiscale
    empalsPosition:     [''],
    workerType:         [''],
    lessonBillingMode:  ['fuori_fattura'],
    musicBillingMode:   ['fuori_fattura'],
    taxRegime:          ['ordinario'],
    vatMode:            ['iva_ordinaria'],
    irpefBracket:       ['23'],
    substituteTaxPercent:[15],
    estimatedAnnualRevenue:[0],
    estimatedAnnualCosts:[0],
    inpsExempt:         [false],
    exemptReasonUnder18: [false],
    exemptReasonStudentUnder25: [false],
    exemptReasonPensionerOver65: [false],
    exemptReasonEmployee: [false],
    exemptReasonBusinessOwner: [false],
    exemptReasonProfessionalFund: [false],
    exemptEmployer:     [''],
    exemptEmployerType: ['dipendente'],
    inpsNumber:         [''],
    inpsStartDate:      [''],
    inpsEndDate:        [''],
    // Step 3 – Setup separato per ruolo
    musicianRoleCode: [''],
    djRoleCode:       [''],
    musicianFiscalMode: ['cooperativa'],
    djFiscalMode:       ['cooperativa'],
    teacherFiscalMode:  ['associazione'],
    musicianSupportEntity: [''],
    djSupportEntity:       [''],
    teacherSupportEntity:  [''],
    musicianVatNumber: [''],
    djVatNumber:       [''],
    teacherVatNumber:  [''],
    musicianTaxRegime: ['ordinario'],
    djTaxRegime:       ['ordinario'],
    teacherTaxRegime:  ['forfettario'],
    musicianIrpefBracket: ['23'],
    djIrpefBracket:       ['23'],
    teacherIrpefBracket:  ['23'],
    musicianSubstituteTaxPercent: [15],
    djSubstituteTaxPercent:       [15],
    teacherSubstituteTaxPercent:  [15],
    musicianIrapPercent: [3.9],
    djIrapPercent:       [3.9],
    teacherIrapPercent:  [3.9],
    musicianInailPercent: [0],
    djInailPercent:       [0],
    teacherInailPercent:  [0],
    musicianCoopFeePercent: [12],
    djCoopFeePercent:       [12],
    teacherCoopFeePercent:  [8],
    musicianCoopTaxPercent: [9.19],
    djCoopTaxPercent:       [9.19],
    teacherCoopTaxPercent:  [5],
    musicianEventGrossEstimate: [0],
    djEventGrossEstimate:       [0],
    teacherEventGrossEstimate:  [0],
    musicianInpsExemptRole: [false],
    djInpsExemptRole:       [false],
    teacherInpsExemptRole:  [false],
    // Step 4 – Ruolo
    isTeacher:   [false],
    isDj:        [false],
    lessonColor: ['#2e7d32'],
    concertColor:['#1565c0'],
    djColor:     ['#8b5cf6'],
  });

  constructor(private fb: FormBuilder, private supabase: SupabaseService, private router: Router) {
    this.loadSavedProfile();
    void this.restoreProfileFromDemo();
    void this.ensureLicenseEmailAuto();
    this.annualInvoicedMusicIncome = this.computeAnnualInvoicedMusicIncome();
  }

  private loadSavedProfile() {
    this.hasSavedProfile = !!localStorage.getItem('musicianId') || !!localStorage.getItem('mm_profile_snapshot');
    const snapshotRaw = localStorage.getItem('mm_profile_snapshot');
    if (snapshotRaw) {
      try {
        const snapshot = JSON.parse(snapshotRaw);
        if (snapshot && typeof snapshot === 'object') {
          this.form.patchValue(this.normalizeIrpefBracketsPatch(snapshot));
        }
      } catch {
      }
    }
    const pairs: [string, string][] = [
      ['mm_firstName', 'firstName'], ['mm_lastName', 'lastName'],
      ['mm_homeBase',  'homeBase'],  ['mm_phone',    'phone'],
      ['mm_fiscalCode','fiscalCode'],
    ];
    const patch: Record<string, string> = {};
    pairs.forEach(([lk, fk]) => { const v = localStorage.getItem(lk); if (v) patch[fk] = v; });
    if (Object.keys(patch).length) this.form.patchValue(patch);
    const savedLicenseEmail = localStorage.getItem('mm_user_email');
    if (savedLicenseEmail) this.form.patchValue({ licenseEmail: savedLicenseEmail });
    this.onRolesChanged();
    this.refreshIncompleteSteps();
  }

  private async restoreProfileFromDemo(): Promise<void> {
    const hasLocalProfile = this.hasValue(this.form.get('firstName')?.value) && this.hasValue(this.form.get('lastName')?.value);
    if (hasLocalProfile) return;
    try {
      const restored = await this.supabase.loadRegistryProfileForCurrentContext();
      if (!restored) return;
      this.form.patchValue(this.normalizeIrpefBracketsPatch(restored));
      this.onRolesChanged();
      localStorage.setItem('mm_profile_snapshot', JSON.stringify({ ...restored, licenseEmail: this.form.get('licenseEmail')?.value || '' }));
      if (restored['firstName']) localStorage.setItem('mm_firstName', restored['firstName']);
      if (restored['lastName']) localStorage.setItem('mm_lastName', restored['lastName']);
      if (restored['phone']) localStorage.setItem('mm_phone', restored['phone']);
      if (restored['homeBase']) localStorage.setItem('mm_homeBase', restored['homeBase']);
      if (restored['licenseEmail']) localStorage.setItem('mm_user_email', restored['licenseEmail']);
      this.hasSavedProfile = true;
      this.refreshIncompleteSteps();
    } catch {
    }
  }

  private async ensureLicenseEmailAuto(): Promise<void> {
    const current = `${this.form.get('licenseEmail')?.value || ''}`.trim();
    if (current) return;
    const localEmail = `${localStorage.getItem('mm_user_email') || ''}`.trim();
    if (localEmail) {
      this.form.patchValue({ licenseEmail: localEmail });
      return;
    }
    try {
      const restored = await this.supabase.loadRegistryProfileForCurrentContext();
      const restoredEmail = `${restored?.['licenseEmail'] || ''}`.trim();
      if (!restoredEmail) return;
      this.form.patchValue({ licenseEmail: restoredEmail });
      localStorage.setItem('mm_user_email', restoredEmail);
      localStorage.setItem('mm_profile_snapshot', JSON.stringify({ ...this.form.value, licenseEmail: restoredEmail }));
    } catch {
    }
  }

  onProfileAddressInput(field: ProfileAddressField, rawValue: string): void {
    const value = `${rawValue || ''}`.trim();
    const timer = this.addressSearchTimers[field];
    if (timer) clearTimeout(timer);
    if (value.length < 2) {
      this.setProfileAddressSuggestions(field, []);
      return;
    }
    this.addressSearchTimers[field] = setTimeout(() => {
      void this.fetchProfileAddressSuggestions(field, value);
    }, 220);
  }

  private async fetchProfileAddressSuggestions(field: ProfileAddressField, query: string): Promise<void> {
    this.addressSearchAborters[field]?.abort();
    const controller = new AbortController();
    this.addressSearchAborters[field] = controller;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=7&countrycodes=it&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'it' },
        signal: controller.signal
      });
      if (!res.ok) return;
      const rows = await res.json();
      const currentValue = `${this.form.get(field)?.value || ''}`.trim();
      if (this.normalizeAddressText(currentValue) !== this.normalizeAddressText(query)) return;
      const suggestions = this.rankNominatimRows(rows, query).slice(0, 7).map(x => x.label);
      this.setProfileAddressSuggestions(field, suggestions);
    } catch (error: any) {
      if (error?.name !== 'AbortError') this.setProfileAddressSuggestions(field, []);
    }
  }

  private setProfileAddressSuggestions(field: ProfileAddressField, values: string[]): void {
    if (field === 'birthPlace') this.birthPlaceSuggestions = values;
    if (field === 'residence') this.residenceSuggestions = values;
    if (field === 'homeBase') this.homeBaseSuggestions = values;
  }

  private normalizeAddressText(value: string): string {
    return `${value || ''}`.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private rankNominatimRows(rows: any[], query: string): Array<{ label: string; score: number }> {
    const normalizedQuery = this.normalizeAddressText(query);
    const seen = new Set<string>();
    const ranked: Array<{ label: string; score: number }> = [];
    for (const row of rows) {
      const label = this.formatNominatimLabel(row);
      const key = this.normalizeAddressText(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const addresstype = `${row?.addresstype || row?.type || ''}`.toLowerCase();
      const importance = Number(row?.importance || 0);
      let score = this.addressTypeScore(addresstype) + Math.max(0, Math.min(30, importance * 30));
      if (key.startsWith(normalizedQuery)) score += 40;
      else if (key.includes(normalizedQuery)) score += 20;
      ranked.push({ label, score });
    }
    return ranked.sort((a, b) => b.score - a.score);
  }

  private formatNominatimLabel(row: any): string {
    const address = row?.address || {};
    const place = `${address.city || address.town || address.village || address.municipality || address.hamlet || row?.name || ''}`.trim();
    const province = this.normalizeProvince(`${address.county || ''}`);
    const region = `${address.state || ''}`.trim();
    const country = `${address.country || 'Italia'}`.trim();
    const road = `${address.road || ''}`.trim();
    const number = `${address.house_number || ''}`.trim();
    const addresstype = `${row?.addresstype || row?.type || ''}`.toLowerCase();
    if (['road', 'house', 'residential'].includes(addresstype) && road) {
      const roadLabel = `${road}${number ? ` ${number}` : ''}`.trim();
      return [roadLabel, place, province, region, country].filter(Boolean).join(', ');
    }
    const compact = [place, province, region, country].filter(Boolean).join(', ');
    return compact || `${row?.display_name || ''}`.trim();
  }

  private normalizeProvince(value: string): string {
    return `${value || ''}`.replace(/^Città metropolitana di\s+/i, '').trim();
  }

  private normalizeIrpefBracketsPatch(source: any): any {
    if (!source || typeof source !== 'object') return source;
    const normalize = (value: any) => `${value || ''}` === '35' ? '33' : value;
    return {
      ...source,
      irpefBracket: normalize(source.irpefBracket),
      musicianIrpefBracket: normalize(source.musicianIrpefBracket),
      djIrpefBracket: normalize(source.djIrpefBracket),
      teacherIrpefBracket: normalize(source.teacherIrpefBracket)
    };
  }

  private addressTypeScore(addresstype: string): number {
    if (['city', 'town', 'village', 'municipality', 'hamlet', 'locality'].includes(addresstype)) return 60;
    if (['county', 'province', 'state_district', 'state'].includes(addresstype)) return 45;
    if (['suburb', 'neighbourhood', 'quarter'].includes(addresstype)) return 35;
    if (['road', 'house', 'residential'].includes(addresstype)) return 25;
    return 20;
  }

  get progressPercent(): number {
    return ((this.currentStep + 1) / this.steps.length) * 100;
  }

  get workerType(): string { return this.form.get('workerType')?.value || ''; }
  get inpsExempt(): boolean { return this.form.get('inpsExempt')?.value === true; }
  get isMusician(): boolean { return this.form.get('isMusician')?.value !== false; }
  get isTeacher(): boolean { return this.form.get('isTeacher')?.value === true; }
  get isDj(): boolean { return this.form.get('isDj')?.value === true; }
  get hasLiveRole(): boolean { return this.isMusician || this.isDj; }
  get hasLessonRole(): boolean { return this.isTeacher; }
  get musicianRoleCode(): string { return `${this.form.get('musicianRoleCode')?.value || ''}`; }
  get djRoleCode(): string { return `${this.form.get('djRoleCode')?.value || ''}`; }
  get musicianSimulation(): RoleSimulation { return this.computeRoleSimulation('musician'); }
  get djSimulation(): RoleSimulation { return this.computeRoleSimulation('dj'); }
  get teacherSimulation(): RoleSimulation { return this.computeRoleSimulation('teacher'); }
  get taxRegime(): string { return `${this.form.get('taxRegime')?.value || 'ordinario'}`; }
  get vatMode(): string { return `${this.form.get('vatMode')?.value || 'iva_ordinaria'}`; }
  get estimatedTaxableIncome(): number {
    const revenue = Number(this.form.get('estimatedAnnualRevenue')?.value || 0);
    const costs = Number(this.form.get('estimatedAnnualCosts')?.value || 0);
    return Math.max(0, revenue - costs);
  }
  get estimatedTaxAmount(): number {
    const taxable = this.estimatedTaxableIncome;
    if (this.taxRegime === 'forfettario') {
      const pct = Math.max(0, Number(this.form.get('substituteTaxPercent')?.value || 15));
      return (taxable * pct) / 100;
    }
    const bracket = Math.max(0, Number(this.form.get('irpefBracket')?.value || 23));
    return (taxable * bracket) / 100;
  }
  get estimatedNetAfterTaxes(): number {
    const revenue = Number(this.form.get('estimatedAnnualRevenue')?.value || 0);
    const costs = Number(this.form.get('estimatedAnnualCosts')?.value || 0);
    return Math.max(0, revenue - costs - this.estimatedTaxAmount);
  }
  get monthlyTaxPlan(): MonthlyTaxPlanRow[] {
    const monthLabels = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const annualRevenue = Number(this.form.get('estimatedAnnualRevenue')?.value || 0);
    const annualCosts = Number(this.form.get('estimatedAnnualCosts')?.value || 0);
    const annualTaxes = Number(this.estimatedTaxAmount || 0);
    const monthlyRevenue = this.round2(annualRevenue / 12);
    const monthlyCosts = this.round2(annualCosts / 12);
    const monthlyTaxes = this.round2(annualTaxes / 12);
    let cumulative = 0;
    return monthLabels.map(month => {
      cumulative = this.round2(cumulative + monthlyTaxes);
      const netCash = this.round2(Math.max(0, monthlyRevenue - monthlyCosts - monthlyTaxes));
      return {
        month,
        revenue: monthlyRevenue,
        costs: monthlyCosts,
        taxReserve: monthlyTaxes,
        netCash,
        cumulativeTaxReserve: cumulative
      };
    });
  }
  get exemptionReasons(): string[] {
    const reasons: string[] = [];
    if (this.form.get('exemptReasonUnder18')?.value) reasons.push('Giovani fino a 18 anni');
    if (this.form.get('exemptReasonStudentUnder25')?.value) reasons.push('Studenti fino a 25 anni');
    if (this.form.get('exemptReasonPensionerOver65')?.value) reasons.push('Pensionati oltre 65 anni');
    if (this.form.get('exemptReasonEmployee')?.value) reasons.push('Dipendente aziendale');
    if (this.form.get('exemptReasonBusinessOwner')?.value) reasons.push('Titolare ditta/società');
    if (this.form.get('exemptReasonProfessionalFund')?.value) reasons.push('Professionista con cassa previdenziale');
    return reasons;
  }
  get enpalsExemptionEligible(): boolean {
    return this.exemptionReasons.length > 0 && this.annualInvoicedMusicIncome <= 5000;
  }
  get enpalsThresholdResidual(): number {
    return Math.max(0, 5000 - this.annualInvoicedMusicIncome);
  }

  private computeRoleSimulation(role: 'musician' | 'dj' | 'teacher'): RoleSimulation {
    const gross = Math.max(0, Number(this.form.get(`${role}EventGrossEstimate`)?.value || 0));
    const mode = `${this.form.get(`${role}FiscalMode`)?.value || ''}`;
    const coopFeePct = Math.max(0, Number(this.form.get(`${role}CoopFeePercent`)?.value || 0));
    const coopTaxPct = Math.max(0, Number(this.form.get(`${role}CoopTaxPercent`)?.value || 0));
    const irapPct = Math.max(0, Number(this.form.get(`${role}IrapPercent`)?.value || 0));
    const inailPct = Math.max(0, Number(this.form.get(`${role}InailPercent`)?.value || 0));
    const taxRegime = `${this.form.get(`${role}TaxRegime`)?.value || 'ordinario'}`;
    const irpefBracket = Math.max(0, Number(this.form.get(`${role}IrpefBracket`)?.value || 23));
    const substitute = Math.max(0, Number(this.form.get(`${role}SubstituteTaxPercent`)?.value || 15));
    const directTaxPct = taxRegime === 'forfettario'
      ? substitute
      : (taxRegime === 'esente_eaps' ? 0 : irpefBracket);
    const cooperativeCosts = mode === 'cooperativa' || mode === 'associazione'
      ? this.round2(gross * (coopFeePct + coopTaxPct) / 100)
      : 0;
    const taxReserve = mode === 'piva'
      ? this.round2(gross * (directTaxPct + irapPct + inailPct) / 100)
      : 0;
    const netImmediate = mode === 'piva'
      ? gross
      : this.round2(Math.max(0, gross - cooperativeCosts));
    const netAfterTaxes = mode === 'piva'
      ? this.round2(Math.max(0, gross - taxReserve))
      : netImmediate;
    return { gross, cooperativeCosts, taxReserve, netImmediate, netAfterTaxes, mode };
  }

  onWorkerTypeChange(value: string): void {
    if (value === 'cooperativa') {
      this.form.patchValue({ lessonBillingMode: 'fuori_fattura', musicBillingMode: 'fuori_fattura' });
      return;
    }
    if (value === 'libero_professionista') {
      this.form.patchValue({ lessonBillingMode: 'in_fattura', musicBillingMode: 'in_fattura' });
      return;
    }
    if (value === 'insegnante_piva') {
      this.form.patchValue({ lessonBillingMode: 'in_fattura', musicBillingMode: 'in_fattura' });
      return;
    }
    if (value === 'misto_piva_lezioni_cooperativa_musica') {
      this.form.patchValue({ lessonBillingMode: 'in_fattura', musicBillingMode: 'fuori_fattura' });
    }
  }

  onRolesChanged(): void {
    if (this.isMusician) {
      this.form.patchValue({ musicianRoleCode: this.ensureMusicianRoleCode() });
    } else {
      this.form.patchValue({ musicianRoleCode: '' });
      localStorage.removeItem('mm_musician_role_code');
    }
    if (this.isDj) {
      this.form.patchValue({ djRoleCode: this.ensureDjCode(this.form.get('firstName')?.value || '', this.form.get('lastName')?.value || '') });
      this.form.patchValue({ djInpsExemptRole: false });
    } else {
      this.form.patchValue({ djRoleCode: '' });
      localStorage.removeItem('mm_dj_code');
    }
    if (this.isDj && this.form.get('musicianInpsExemptRole')?.value) {
      this.form.patchValue({ musicianInpsExemptRole: false });
    }
    this.form.patchValue({ inpsExempt: this.form.get('musicianInpsExemptRole')?.value === true });
    if (!this.hasLiveRole) {
      this.form.patchValue({
        workerType: '',
        musicBillingMode: 'fuori_fattura',
        inpsExempt: false,
        empalsPosition: ''
      });
      return;
    }
    if (!this.workerType) {
      const suggestedWorkerType = this.isDj ? 'cooperativa' : 'libero_professionista';
      this.form.patchValue({ workerType: suggestedWorkerType });
      this.onWorkerTypeChange(suggestedWorkerType);
    }
    if (!this.isMusician) {
      this.form.patchValue({
        instrument: '',
        level: '',
        stylesPlayed: [],
        searchableStyles: []
      });
    }
  }

  // ── Styles chip helpers ─────────────────────────────────────
  isStyleSelected(style: string, field: 'stylesPlayed' | 'searchableStyles'): boolean {
    const val: string[] = this.form.get(field)?.value || [];
    return val.includes(style);
  }

  toggleStyle(style: string, field: 'stylesPlayed' | 'searchableStyles'): void {
    const ctrl = this.form.get(field);
    if (!ctrl) return;
    const current: string[] = ctrl.value || [];
    const idx = current.indexOf(style);
    ctrl.setValue(idx >= 0 ? current.filter(s => s !== style) : [...current, style]);
  }
  // ────────────────────────────────────────────────────────────

  goToStep(i: number): void {
    if (i < 0 || i >= this.steps.length) return;
    if (i === 1 && !this.isMusician) {
      this.currentStep = 2;
      return;
    }
    this.currentStep = i;
  }

  goToFirstIncompleteStep(): void {
    if (!this.incompleteStepIndexes.length) return;
    this.currentStep = this.incompleteStepIndexes[0];
  }

  nextStep(): void {
    if (this.currentStep === 0) {
      ['firstName', 'lastName'].forEach(f => this.form.get(f)?.markAsTouched());
      if (this.form.get('firstName')?.invalid || this.form.get('lastName')?.invalid) return;
    }
    let next = Math.min(this.currentStep + 1, this.steps.length - 1);
    if (next === 1 && !this.isMusician) next = 2;
    this.currentStep = next;
  }

  prevStep(): void {
    let prev = Math.max(this.currentStep - 1, 0);
    if (prev === 1 && !this.isMusician) prev = 0;
    this.currentStep = prev;
  }

  controlInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  // ── Signature pad methods ───────────────────────────────────
  private initSignatureCanvas(canvas: HTMLCanvasElement) {
    this._sigCtx = canvas.getContext('2d') ?? undefined;
    if (!this._sigCtx) return;
    const ctx = this._sigCtx;
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = '#1e1b4b';
    this.drawSignatureLine(canvas);
    const saved = localStorage.getItem('mm_signature');
    if (saved) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = saved;
      this.signatureSaved = true;
    }
  }

  private drawSignatureLine(canvas: HTMLCanvasElement) {
    if (!this._sigCtx) return;
    const ctx = this._sigCtx;
    ctx.save();
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(24, canvas.height - 22);
    ctx.lineTo(canvas.width - 24, canvas.height - 22);
    ctx.stroke();
    ctx.restore();
  }

  private pos(canvas: HTMLCanvasElement, cX: number, cY: number) {
    const r = canvas.getBoundingClientRect();
    return { x: cX - r.left, y: cY - r.top };
  }

  onSigMouseDown(e: MouseEvent) {
    if (!this._sigCtx || !this._sigCanvas) return;
    this._signing = true;
    const p = this.pos(this._sigCanvas.nativeElement, e.clientX, e.clientY);
    this._sigCtx.beginPath(); this._sigCtx.moveTo(p.x, p.y);
  }
  onSigMouseMove(e: MouseEvent) {
    if (!this._signing || !this._sigCtx || !this._sigCanvas) return;
    const p = this.pos(this._sigCanvas.nativeElement, e.clientX, e.clientY);
    this._sigCtx.lineTo(p.x, p.y); this._sigCtx.stroke();
  }
  onSigMouseUp() { this._signing = false; }

  onSigTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (!this._sigCtx || !this._sigCanvas) return;
    this._signing = true;
    const t = e.touches[0];
    const p = this.pos(this._sigCanvas.nativeElement, t.clientX, t.clientY);
    this._sigCtx.beginPath(); this._sigCtx.moveTo(p.x, p.y);
  }
  onSigTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!this._signing || !this._sigCtx || !this._sigCanvas) return;
    const t = e.touches[0];
    const p = this.pos(this._sigCanvas.nativeElement, t.clientX, t.clientY);
    this._sigCtx.lineTo(p.x, p.y); this._sigCtx.stroke();
  }
  onSigTouchEnd() { this._signing = false; }

  clearSignature() {
    if (!this._sigCtx || !this._sigCanvas) return;
    const c = this._sigCanvas.nativeElement;
    this._sigCtx.clearRect(0, 0, c.width, c.height);
    this.drawSignatureLine(c);
    this.signatureSaved = false;
    localStorage.removeItem('mm_signature');
  }

  saveSignature() {
    if (!this._sigCanvas) return;
    localStorage.setItem('mm_signature', this._sigCanvas.nativeElement.toDataURL('image/png'));
    this.signatureSaved = true;
  }

  private refreshIncompleteSteps(): void {
    this.incompleteStepIndexes = this.steps
      .map((_, idx) => idx)
      .filter(idx => this.isStepIncomplete(idx));
  }

  private isStepIncomplete(stepIndex: number): boolean {
    if (stepIndex === 1 && !this.isMusician) return false;
    const fieldsByStep: Record<number, string[]> = {
      0: ['firstName', 'lastName', 'phone', 'licenseEmail', 'birthDate', 'birthPlace', 'fiscalCode', 'residence', 'homeBase'],
      1: ['instrument', 'level', 'stylesPlayed', 'searchableStyles'],
      2: ['instagram', 'facebook', 'youtube', 'tiktok', 'website'],
      3: ['empalsPosition', 'workerType', 'taxRegime', 'vatMode', 'irpefBracket', 'substituteTaxPercent', 'estimatedAnnualRevenue', 'estimatedAnnualCosts', 'exemptEmployer', 'inpsNumber', 'inpsStartDate', 'inpsEndDate'],
      4: ['lessonColor', 'concertColor', 'djColor']
    };
    const fields = fieldsByStep[stepIndex] || [];
    if (!fields.length) return false;
    return fields.every(field => !this.hasValue(this.form.get(field)?.value));
  }

  private hasValue(value: unknown): boolean {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'boolean') return value;
    return value !== null && value !== undefined;
  }
  // ────────────────────────────────────────────────────────────

  async submit(): Promise<void> {
    this.error = null;
    this.resultCode = null;
    this.savedOk = false;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      if (this.form.get('firstName')?.invalid || this.form.get('lastName')?.invalid) {
        this.currentStep = 0;
      }
      return;
    }
    const v = this.form.value;
    if (v.isMusician !== true && v.isTeacher !== true && v.isDj !== true) {
      this.error = 'Seleziona almeno un ruolo: Musicista, DJ o Insegnante';
      this.currentStep = 0;
      return;
    }
    this.submitting = true;
    try {
      const isExempt = !!v.musicianInpsExemptRole && v.isMusician === true;
      const musicianRoleCode = v.isMusician ? this.ensureMusicianRoleCode() : '';
      const djCodeDraft = v.isDj ? this.ensureDjCode(v.firstName || '', v.lastName || '') : '';
      this.form.patchValue({
        musicianRoleCode: musicianRoleCode || '',
        djRoleCode: djCodeDraft || ''
      });
      const persist: [string, string | null | undefined][] = [
        ['lessonColor',   v.lessonColor],  ['concertColor',  v.concertColor], ['djColor', v.djColor],
        ['mm_firstName',  v.firstName],    ['mm_lastName',   v.lastName],
        ['mm_homeBase',   v.homeBase],     ['mm_phone',      v.phone],
        ['mm_fiscalCode', v.fiscalCode],
      ];
      persist.forEach(([k, val]) => { if (val) localStorage.setItem(k, val); });
      if (v.licenseEmail) localStorage.setItem('mm_user_email', v.licenseEmail);
      localStorage.setItem('mm_profile_snapshot', JSON.stringify(this.form.value));

      const m: Musician = {
        firstName:      v.firstName!,
        lastName:       v.lastName!,
        phone:          v.phone || undefined,
        birthDate:      v.birthDate || undefined,
        birthPlace:     v.birthPlace || undefined,
        fiscalCode:     v.fiscalCode || undefined,
        residence:      v.residence || undefined,
        workerType:     (v.workerType as Musician['workerType']) || undefined,
        lessonBillingMode: (v.lessonBillingMode as Musician['lessonBillingMode']) || undefined,
        musicBillingMode: (v.musicBillingMode as Musician['musicBillingMode']) || undefined,
        taxRegime:      (v.taxRegime as Musician['taxRegime']) || undefined,
        vatMode:        (v.vatMode as Musician['vatMode']) || undefined,
        irpefBracket:   (v.irpefBracket as Musician['irpefBracket']) || undefined,
        substituteTaxPercent: Number(v.substituteTaxPercent || 0) || undefined,
        estimatedAnnualRevenue: Number(v.estimatedAnnualRevenue || 0),
        estimatedAnnualCosts: Number(v.estimatedAnnualCosts || 0),
        empalsPosition: v.empalsPosition || undefined,
        enpalsCategory: v.empalsPosition || undefined,
        exemptEmployer: v.exemptEmployer || undefined,
        exemptEmployerType: (v.exemptEmployerType as Musician['exemptEmployerType']) || undefined,
        homeBase:       v.homeBase || undefined,
        instrument:     v.isMusician ? (v.instrument || undefined) : undefined,
        level:          v.isMusician ? (v.level || undefined) : undefined,
        stylesPlayed:   v.isMusician ? (v.stylesPlayed || []) : [],
        searchableStyles: v.isMusician ? (v.searchableStyles || []) : [],
        social: {
          instagram: v.instagram || undefined,
          facebook:  v.facebook  || undefined,
          youtube:   v.youtube   || undefined,
          tiktok:    v.tiktok    || undefined,
          website:   v.website   || undefined,
        },
        inpsExempt: isExempt,
        inpsData: isExempt
          ? {
            number: v.inpsNumber || undefined,
            startDate: v.inpsStartDate || undefined,
            endDate: v.inpsEndDate || undefined
          }
          : null,
        isMusician:  v.isMusician !== false,
        isTeacher:   v.isTeacher   || false,
        isDj:        v.isDj        || false,
        lessonColor: v.lessonColor  || null,
        concertColor:v.concertColor || null,
        djColor:     v.djColor      || null,
        djCode:      djCodeDraft || undefined,
        roleSettings: {
          musician: v.isMusician ? {
            code: musicianRoleCode || undefined,
            fiscalMode: (v.musicianFiscalMode as any) || 'cooperativa',
            supportEntity: v.musicianSupportEntity || undefined,
            vatNumber: v.musicianVatNumber || undefined,
            taxRegime: (v.musicianTaxRegime as any) || 'ordinario',
            irpefBracket: (v.musicianIrpefBracket as any) || '23',
            substituteTaxPercent: Number(v.musicianSubstituteTaxPercent || 15),
            irapPercent: Number(v.musicianIrapPercent || 0),
            inailPercent: Number(v.musicianInailPercent || 0),
            cooperativeFeePercent: Number(v.musicianCoopFeePercent || 0),
            cooperativeTaxPercent: Number(v.musicianCoopTaxPercent || 0),
            eventGrossEstimate: Number(v.musicianEventGrossEstimate || 0),
            inpsExempt: !!v.musicianInpsExemptRole
          } : undefined,
          dj: v.isDj ? {
            code: djCodeDraft || undefined,
            fiscalMode: (v.djFiscalMode as any) || 'cooperativa',
            supportEntity: v.djSupportEntity || undefined,
            vatNumber: v.djVatNumber || undefined,
            taxRegime: (v.djTaxRegime as any) || 'ordinario',
            irpefBracket: (v.djIrpefBracket as any) || '23',
            substituteTaxPercent: Number(v.djSubstituteTaxPercent || 15),
            irapPercent: Number(v.djIrapPercent || 0),
            inailPercent: Number(v.djInailPercent || 0),
            cooperativeFeePercent: Number(v.djCoopFeePercent || 0),
            cooperativeTaxPercent: Number(v.djCoopTaxPercent || 0),
            eventGrossEstimate: Number(v.djEventGrossEstimate || 0),
            inpsExempt: false
          } : undefined,
          teacher: v.isTeacher ? {
            fiscalMode: (v.teacherFiscalMode as any) || 'associazione',
            supportEntity: v.teacherSupportEntity || undefined,
            vatNumber: v.teacherVatNumber || undefined,
            taxRegime: (v.teacherTaxRegime as any) || 'forfettario',
            irpefBracket: (v.teacherIrpefBracket as any) || '23',
            substituteTaxPercent: Number(v.teacherSubstituteTaxPercent || 15),
            irapPercent: Number(v.teacherIrapPercent || 0),
            inailPercent: Number(v.teacherInailPercent || 0),
            cooperativeFeePercent: Number(v.teacherCoopFeePercent || 0),
            cooperativeTaxPercent: Number(v.teacherCoopTaxPercent || 0),
            eventGrossEstimate: Number(v.teacherEventGrossEstimate || 0),
            inpsExempt: !!v.teacherInpsExemptRole
          } : undefined
        },
        signatureData: localStorage.getItem('mm_signature') || undefined,
      };

      const existingId = localStorage.getItem('musicianId') || undefined;
      const { id, code } = await this.supabase.saveMusician(m, existingId);
      const resolvedId = id || existingId || localStorage.getItem('musicianId') || undefined;
      if (resolvedId) localStorage.setItem('musicianId', resolvedId);
      const resolvedCode = code
        || localStorage.getItem('mm_affiliation_code')
        || localStorage.getItem('musicianCode')
        || await this.supabase.ensureMusicianCode(v.firstName || '', v.lastName || '');
      if (!resolvedCode) throw new Error('Codice musicista non assegnato');
      localStorage.setItem('musicianCode', resolvedCode);
      localStorage.setItem('mm_affiliation_code', resolvedCode);
      let resolvedDjCode = djCodeDraft || localStorage.getItem('mm_dj_code') || '';
      if (v.isDj) {
        resolvedDjCode = this.ensureDjCode(v.firstName || '', v.lastName || '');
      } else {
        localStorage.removeItem('mm_dj_code');
      }
      if (resolvedId) {
        await this.supabase.syncAllFromLocalStorage(resolvedId);
      }
      this.hasSavedProfile = true;
      this.refreshIncompleteSteps();
      this.savedOk = true;
      this.resultCode = v.isMusician && v.isDj
        ? `${musicianRoleCode || resolvedCode} · ${resolvedDjCode}`
        : (v.isDj ? `${resolvedDjCode}` : `${musicianRoleCode || resolvedCode}`);
      this.router.navigateByUrl('/dashboard');
    } catch (e: any) {
      this.error = e?.message ? `Salvataggio non riuscito: ${e.message}` : 'Salvataggio non riuscito';
    } finally {
      this.submitting = false;
    }
  }

  goAgenda(): void { this.router.navigateByUrl('/agenda'); }

  private computeAnnualInvoicedMusicIncome(): number {
    const payments = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
    if (!Array.isArray(payments)) return 0;
    const year = new Date().getFullYear();
    return payments
      .filter((p: any) => p?.category === 'concerto' && `${p?.serviceDate || ''}`.startsWith(`${year}-`))
      .filter((p: any) => p?.paymentMode === 'fattura_diretta' || p?.paymentMode === 'pattuito_fattura')
      .reduce((sum: number, p: any) => sum + Number(p?.taxableBase || p?.receivedAmount || 0), 0);
  }

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private ensureMusicianRoleCode(): string {
    const snapshot = `${this.form.get('musicianRoleCode')?.value || ''}`.trim().toUpperCase();
    if (/^MU\d{4}$/.test(snapshot)) {
      localStorage.setItem('mm_musician_role_code', snapshot);
      return snapshot;
    }
    const existing = `${localStorage.getItem('mm_musician_role_code') || ''}`.trim().toUpperCase();
    if (/^MU\d{4}$/.test(existing)) return existing;
    const affiliation = `${localStorage.getItem('mm_affiliation_code') || localStorage.getItem('musicianCode') || ''}`.trim().toUpperCase();
    if (/^MU\d{4}$/.test(affiliation)) {
      localStorage.setItem('mm_musician_role_code', affiliation);
      return affiliation;
    }
    const seed = `${this.form.get('firstName')?.value || ''}${this.form.get('lastName')?.value || ''}${Date.now()}`.toUpperCase();
    let hash = 0;
    for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 10000;
    const code = `MU${`${hash}`.padStart(4, '0')}`;
    localStorage.setItem('mm_musician_role_code', code);
    return code;
  }

  private ensureDjCode(firstName: string, lastName: string): string {
    const snapshot = `${this.form.get('djRoleCode')?.value || ''}`.trim().toUpperCase();
    if (/^DJ\d{4}$/.test(snapshot)) {
      localStorage.setItem('mm_dj_code', snapshot);
      return snapshot;
    }
    const existing = `${localStorage.getItem('mm_dj_code') || ''}`.trim().toUpperCase();
    if (/^DJ\d{4}$/.test(existing)) return existing;
    const seed = `${firstName}${lastName}${Date.now()}`.toUpperCase();
    let hash = 0;
    for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 10000;
    const code = `DJ${`${hash}`.padStart(4, '0')}`;
    localStorage.setItem('mm_dj_code', code);
    return code;
  }
}
