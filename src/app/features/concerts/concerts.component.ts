import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormArray, FormBuilder, Validators } from '@angular/forms';
import { EventDetail } from '../../models/event-detail';
import { SupabaseService } from '../../core/supabase.service';
import { ActivatedRoute, Router } from '@angular/router';
import { formatItalianAddressLabel, italianAddressTypeScore } from '../../core/italian-geo';

type ConcertRecord = {
  id: string;
  title: string;
  date: string;
  timeStart: string;
  venue: string;
  address: string;
  lineupType: string;
  agreedFee: number;
  reimbursement: number;
  notes: string;
  bands: string[];
  musicians: string[];
  contactId: string | null;
  billingMode: 'in_fattura' | 'fuori_fattura';
  paymentCadence: 'prestazione' | 'mensile';
  monthlySettlement: 'acconto' | 'bonifico';
  extraExpensesOutsideInvoice: boolean;
  executionStatus: 'da_fare' | 'effettuato' | 'annullato' | 'rimborsato';
  reimbursedAmount: number;
  createdAt: string;
};

type ContactEntry = {
  id: string;
  type: 'band' | 'school' | 'student';
  displayName: string;
  priority: number;
  averageFee: number;
  billingMode?: 'in_fattura' | 'fuori_fattura';
  paymentCadence?: 'prestazione' | 'mensile';
  monthlySettlement?: 'acconto' | 'bonifico';
};

type ServicePayment = {
  eventId: string;
  receivedAmount: number;
  paymentType: 'acconto' | 'saldo' | 'mensile';
};

type BandCreditEntry = {
  id: string;
  bandKey: string;
  bandName: string;
  kind: 'acconto' | 'bonifico';
  amount: number;
  createdAt: string;
};

type BandGroup = {
  key: string;
  name: string;
  paymentCadence: 'prestazione' | 'mensile';
  monthlySettlement: 'acconto' | 'bonifico';
  concerts: ConcertRecord[];
  dueExecuted: number;
  paidExecuted: number;
  creditRemaining: number;
};

type ConcertAddressSuggestion = {
  label: string;
  score: number;
};

type ImportConcertRow = {
  id: string;
  date: string;
  timeStart: string;
  eventTitle: string;
  bandName: string;
  venue: string;
  address: string;
  agreedFee: number | null;
  reimbursement: number | null;
  notes: string;
  billingMode: 'in_fattura' | 'fuori_fattura' | '';
  paymentCadence: 'prestazione' | 'mensile' | '';
  monthlySettlement: 'acconto' | 'bonifico' | '';
};

type ImportCol =
  | 'date'
  | 'timeStart'
  | 'eventTitle'
  | 'bandName'
  | 'venue'
  | 'address'
  | 'agreedFee'
  | 'reimbursement'
  | 'notes'
  | 'paymentCadence'
  | 'monthlySettlement'
  | 'billingMode';

@Component({
  selector: 'app-concerts',
  templateUrl: './concerts.component.html',
  styleUrls: ['./concerts.component.scss']
})
export class ConcertsComponent implements OnInit, OnDestroy {
  showForm = false;
  copiedId: string | null = null;
  concerts: ConcertRecord[] = [];
  contacts: ContactEntry[] = [];
  showInlineContact = false;
  showFilters = true;
  filterBand = '';
  filterDateFrom = '';
  filterDateTo = '';
  filterPaymentCadence: 'all' | 'prestazione' | 'mensile' = 'all';
  filterPaymentState: 'all' | 'da_pagare' | 'parziale' | 'pagato' = 'all';
  filterExecutionStatus: 'all' | 'da_fare' | 'effettuato' | 'annullato' | 'rimborsato' = 'all';
  servicePayments: ServicePayment[] = [];
  expandedConcertId: string | null = null;
  expandedBandKey: string | null = null;
  focusedConcertId: string | null = null;
  inpsExemptProfile = false;
  addressSuggestions: string[] = [];
  viewMode: 'band' | 'list' = 'band';
  concertSection: 'attivi' | 'svolti' = 'attivi';
  bandCredits: BandCreditEntry[] = [];
  private monthlyCreditAllocationsByBandKey = new Map<string, Record<string, number>>();
  private monthlyCreditRemainingByBandKey = new Map<string, number>();
  showImport = false;
  importRows: ImportConcertRow[] = [];
  importResolving = false;
  importFocus: { rowId: string; col: ImportCol } | null = null;
  newContact = {
    type: 'band' as 'band' | 'school' | 'student',
    displayName: '',
    priority: 3,
    averageFee: 0,
    billingMode: 'fuori_fattura' as 'in_fattura' | 'fuori_fattura',
    paymentCadence: 'prestazione' as 'prestazione' | 'mensile',
    monthlySettlement: 'acconto' as 'acconto' | 'bonifico'
  };

  form = this.fb.group({
    title: ['', Validators.required],
    date: ['', Validators.required],
    timeStart: ['', Validators.required],
    venue: [''],
    address: [''],
    lineupType: ['duo'],
    agreedFee: [0, Validators.min(0)],
    reimbursement: [0, Validators.min(0)],
    contactId: [''],
    billingMode: ['fuori_fattura'],
    paymentCadence: ['prestazione'],
    monthlySettlement: ['acconto'],
    extraExpensesOutsideInvoice: [true],
    notes: [''],
    bands: this.fb.array([]),
    musicians: this.fb.array([])
  });
  private addressTimer: ReturnType<typeof setTimeout> | null = null;
  private addressAborter: AbortController | null = null;

  constructor(private fb: FormBuilder, private supabase: SupabaseService, private router: Router, private route: ActivatedRoute) {}

  filteredConcerts: ConcertRecord[] = [];
  bandGroups: BandGroup[] = [];

  ngOnInit(): void {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.inpsExemptProfile = profile?.inpsExempt === true;
    if (typeof window !== 'undefined' && window.innerWidth <= 767) {
      this.showFilters = false;
    }
    this.syncDemoDataOnMobileIfNeeded().then(() => {
      this.concerts = this.readConcerts();
      this.servicePayments = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
      this.bandCredits = this.readBandCredits();
      this.contacts = this.readContacts();
      this.concerts = this.mergeConcertsFromAgenda(this.concerts);
      this.concerts = this.applyBandPaymentProfile(this.concerts);
      this.concerts = this.applyAverageFeeFromContacts(this.concerts);
      this.persistConcerts();
      this.rebuildMonthlyCreditAllocations();
      this.filterExecutionStatus = 'da_fare';
      this.applyFilters();
      this.applyRouteContext();
      this.applyExpenseReturnContext();
    });
  }

  ngOnDestroy(): void {
    if (this.addressTimer) clearTimeout(this.addressTimer);
    this.addressAborter?.abort();
  }

  get bandsArray(): FormArray {
    return this.form.get('bands') as FormArray;
  }

  get musiciansArray(): FormArray {
    return this.form.get('musicians') as FormArray;
  }

  addBand(): void {
    this.bandsArray.push(this.fb.control('', Validators.required));
  }

  addMusician(): void {
    this.musiciansArray.push(this.fb.control('', Validators.required));
  }

  removeBand(index: number): void {
    this.bandsArray.removeAt(index);
  }

  removeMusician(index: number): void {
    this.musiciansArray.removeAt(index);
  }

  setImportFocus(rowId: string, col: ImportCol): void {
    this.importFocus = { rowId, col };
  }

  openImport(): void {
    this.showImport = true;
    if (!this.importRows.length) {
      this.importRows = Array.from({ length: 8 }).map(() => this.emptyImportRow());
    }
  }

  closeImport(): void {
    this.showImport = false;
  }

  addImportRows(count = 5): void {
    const safe = Math.max(1, Math.min(50, Number(count || 0)));
    for (let i = 0; i < safe; i++) this.importRows.push(this.emptyImportRow());
  }

  removeImportRow(id: string): void {
    this.importRows = this.importRows.filter(r => r.id !== id);
    if (!this.importRows.length) this.importRows = [this.emptyImportRow()];
  }

  trackByImportRow(_: number, row: ImportConcertRow): string {
    return row.id;
  }

  onImportPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') || '';
    if (!text.trim()) return;
    event.preventDefault();
    const active = (event.target as any) as HTMLElement | null;
    const isCell = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (isCell && this.importFocus) {
      const ok = this.applyImportPasteAtFocusedCell(text, this.importFocus);
      if (ok) return;
    }
    this.applyImportPaste(text);
  }

  onImportBandChange(row: ImportConcertRow): void {
    const name = `${row.bandName || ''}`.trim();
    if (!name) return;
    const contact = this.findBandContactByName(name);
    if (!contact) return;
    if (!Number(row.agreedFee || 0) && Number(contact.averageFee || 0) > 0) {
      row.agreedFee = this.round2(Number(contact.averageFee || 0));
    }
    if (!row.paymentCadence) row.paymentCadence = contact.paymentCadence === 'mensile' ? 'mensile' : 'prestazione';
    if (!row.monthlySettlement) row.monthlySettlement = contact.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto';
    if (!row.billingMode) row.billingMode = contact.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura';
  }

  setConcertSection(section: 'attivi' | 'svolti'): void {
    if (this.concertSection === section) return;
    this.concertSection = section;
    this.filterExecutionStatus = section === 'attivi' ? 'da_fare' : 'all';
    this.applyFilters();
  }

  get activeConcertCount(): number {
    return this.concerts.filter(c => c.executionStatus === 'da_fare').length;
  }

  get pastConcertCount(): number {
    return this.concerts.filter(c => c.executionStatus !== 'da_fare').length;
  }

  get concertsEmptyLabel(): string {
    return this.concertSection === 'svolti'
      ? 'Nessun concerto svolto o annullato con i filtri selezionati'
      : 'Nessun concerto in programma con i filtri selezionati';
  }

  get canConfirmImport(): boolean {
    return this.importRows.some(r => !!`${r.date || ''}`.trim());
  }

  async resolveImportAddresses(): Promise<void> {
    if (this.importResolving) return;
    this.importResolving = true;
    try {
      for (const row of this.importRows) {
        const addr = `${row.address || ''}`.trim();
        const shouldResolve = !addr || (addr.length >= 2 && addr.length <= 28 && !addr.includes(','));
        if (!shouldResolve) continue;
        const query = addr || `${row.venue || ''}`.trim();
        if (!query) continue;
        const best = await this.fetchBestAddressLabel(query);
        if (best) row.address = best;
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    } finally {
      this.importResolving = false;
    }
  }

  confirmImport(): void {
    const createdAt = new Date().toISOString();
    let imported = 0;
    let skippedConflict = 0;

    const contactsChanged = this.ensureImportedBandContacts();
    if (contactsChanged) this.contacts = this.readContacts();

    const toImport: ConcertRecord[] = [];
    for (const row of this.importRows) {
      const date = this.normalizeIsoDate(`${row.date || ''}`.trim());
      const hasAny =
        !!date ||
        !!`${row.eventTitle || ''}`.trim() ||
        !!`${row.bandName || ''}`.trim() ||
        !!`${row.venue || ''}`.trim() ||
        !!`${row.address || ''}`.trim();
      if (!hasAny) continue;
      if (!date) continue;
      if (this.hasDjConflictOnDate(date)) {
        skippedConflict++;
        continue;
      }

      const bandName = `${row.bandName || ''}`.trim();
      const contactId = bandName ? (this.findBandContactByName(bandName)?.id || null) : null;
      const contactForImport = contactId ? (this.contacts.find(c => c.id === contactId) || null) : null;
      const paymentCadenceFromContact = contactForImport?.paymentCadence;
      const monthlySettlementFromContact = contactForImport?.monthlySettlement;
      const billingModeFromContact = contactForImport?.billingMode;

      const title = `${row.eventTitle || ''}`.trim() || `${row.venue || ''}`.trim() || (bandName ? `Concerto ${bandName}` : 'Concerto');
      const timeStart = this.normalizeTime(`${row.timeStart || ''}`.trim()) || '21:00';
      const venue = `${row.venue || ''}`.trim();
      const address = `${row.address || ''}`.trim();
      const agreedFeeBase = this.parseMoney(row.agreedFee);
      const agreedFee = agreedFeeBase > 0 ? agreedFeeBase : this.round2(Number(contactForImport?.averageFee || 0));
      const reimbursement = this.parseMoney(row.reimbursement);
      const notes = `${row.notes || ''}`.trim();

      const paymentCadence = (row.paymentCadence || paymentCadenceFromContact || 'prestazione') === 'mensile' ? 'mensile' : 'prestazione';
      const monthlySettlement = (row.monthlySettlement || monthlySettlementFromContact || 'acconto') === 'bonifico' ? 'bonifico' : 'acconto';
      const billingMode = (row.billingMode || billingModeFromContact || 'fuori_fattura') === 'in_fattura' ? 'in_fattura' : 'fuori_fattura';

      const record: ConcertRecord = {
        id: crypto.randomUUID(),
        title,
        date,
        timeStart,
        venue,
        address,
        lineupType: 'band',
        agreedFee,
        reimbursement,
        contactId,
        billingMode,
        paymentCadence,
        monthlySettlement,
        extraExpensesOutsideInvoice: true,
        executionStatus: 'da_fare',
        reimbursedAmount: 0,
        notes,
        bands: bandName ? [bandName] : [],
        musicians: [],
        createdAt
      };
      toImport.push(record);
    }

    if (!toImport.length) return;

    for (const record of toImport) {
      this.concerts.unshift(record);
      this.appendToAgenda(record);
      imported++;
    }
    this.persistConcerts();
    this.rebuildMonthlyCreditAllocations();
    this.applyFilters();
    void this.syncSupabaseEvents();

    this.closeImport();
    if (skippedConflict > 0) {
      window.alert(`Importati ${imported} concerti. Saltati ${skippedConflict} per conflitto con DJ set.`);
    } else {
      window.alert(`Importati ${imported} concerti.`);
    }
  }

  saveConcert(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.value;
    const selectedDate = `${v.date || ''}`.trim();
    if (this.hasDjConflictOnDate(selectedDate)) {
      window.alert('Data già occupata da un DJ set');
      return;
    }
    const record: ConcertRecord = {
      id: crypto.randomUUID(),
      title: `${v.title || ''}`.trim(),
      date: `${v.date || ''}`,
      timeStart: `${v.timeStart || ''}`,
      venue: `${v.venue || ''}`.trim(),
      address: `${v.address || ''}`.trim(),
      lineupType: `${v.lineupType || 'duo'}`,
      agreedFee: Number(v.agreedFee || 0),
      reimbursement: Number(v.reimbursement || 0),
      contactId: `${v.contactId || ''}` || null,
      billingMode: (v.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura'),
      paymentCadence: (v.paymentCadence === 'mensile' ? 'mensile' : 'prestazione'),
      monthlySettlement: (v.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'),
      extraExpensesOutsideInvoice: v.extraExpensesOutsideInvoice !== false,
      executionStatus: 'da_fare',
      reimbursedAmount: 0,
      notes: `${v.notes || ''}`.trim(),
      bands: (v.bands || []).map(x => `${x || ''}`.trim()).filter(Boolean),
      musicians: (v.musicians || []).map(x => `${x || ''}`.trim()).filter(Boolean),
      createdAt: new Date().toISOString()
    };
    this.concerts.unshift(record);
    this.persistConcerts();
    this.appendToAgenda(record);
    void this.syncSupabaseEvents();
    this.form.reset({
      title: '',
      date: '',
      timeStart: '',
      venue: '',
      address: '',
      lineupType: 'duo',
      agreedFee: 0,
      reimbursement: 0,
      contactId: '',
      billingMode: 'fuori_fattura',
      paymentCadence: 'prestazione',
      monthlySettlement: 'acconto',
      extraExpensesOutsideInvoice: true,
      notes: ''
    });
    while (this.bandsArray.length) this.bandsArray.removeAt(0);
    while (this.musiciansArray.length) this.musiciansArray.removeAt(0);
    this.showForm = false;
  }

  copyConfirmationLink(id: string): void {
    const url = `${window.location.origin}/confirm/${id}`;
    navigator.clipboard.writeText(url).then(() => {
      this.copiedId = id;
      setTimeout(() => this.copiedId = null, 1800);
    });
  }

  private appendToAgenda(record: ConcertRecord): void {
    const events: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const bandNames = record.bands.length ? record.bands : record.musicians;
    const event: EventDetail = {
      id: record.id,
      title: record.title,
      date: record.date,
      timeStart: record.timeStart,
      type: 'concert',
      venue: record.venue,
      address: record.address,
      grossFee: record.agreedFee,
      netFee: record.agreedFee + record.reimbursement,
      compensoType: record.billingMode,
      band: bandNames.map(name => ({ name })),
      status: 'pending',
      notes: `${record.notes || ''}${record.contactId ? ` • [Rubrica:${this.contactName(record.contactId)}]` : ''}${record.paymentCadence === 'mensile' ? ` • [Pagamento mensile: ${record.monthlySettlement}]` : ' • [Pagamento a prestazione: saldo immediato]'} • [Spese extra:${record.extraExpensesOutsideInvoice ? 'fuori_fattura' : 'in_fattura'}]`,
      createdAt: record.createdAt
    };
    const deduped = events.filter(e => e.id !== event.id);
    deduped.push(event);
    localStorage.setItem('mm_events', JSON.stringify(deduped));
  }

  private hasDjConflictOnDate(date: string): boolean {
    if (!date) return false;
    const events: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    return events.some(event => event.status !== 'cancelled' && event.type === 'dj_set' && event.date === date);
  }

  private async syncSupabaseEvents(): Promise<void> {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const musicianId = `${profile.id || ''}`.trim();
    if (!musicianId) return;
    try {
      await this.supabase.syncEventsFromLocalStorage(musicianId);
    } catch {}
  }

  onContactPick(): void {
    const id = `${this.form.get('contactId')?.value || ''}`;
    const selected = this.contacts.find(c => c.id === id);
    if (!selected) return;
    if (!(Number(this.form.get('agreedFee')?.value || 0)) && selected.averageFee > 0) {
      this.form.patchValue({ agreedFee: selected.averageFee });
    }
    this.form.patchValue({
      billingMode: selected.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
      paymentCadence: selected.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: selected.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
    });
  }

  onAddressInput(rawValue: string): void {
    const value = `${rawValue || ''}`.trim();
    if (this.addressTimer) clearTimeout(this.addressTimer);
    if (value.length < 2) {
      this.addressSuggestions = [];
      return;
    }
    this.addressTimer = setTimeout(() => {
      void this.fetchAddressSuggestions(value);
    }, 220);
  }

  selectAddressSuggestion(value: string): void {
    this.form.patchValue({ address: value });
    this.addressSuggestions = [];
  }

  launchExpenseCalculator(): void {
    const draft = this.form.getRawValue();
    const destination = `${draft.address || draft.venue || ''}`.trim();
    if (!destination) {
      window.alert('Inserisci prima almeno l’indirizzo o il venue del concerto');
      return;
    }
    localStorage.setItem('mm_concert_expense_context', JSON.stringify({
      from: 'concerts',
      draft,
      createdAt: new Date().toISOString()
    }));
    this.router.navigate(['/expenses'], { queryParams: { fromConcert: '1' } });
  }

  launchExpenseCalculatorForConcert(concert: ConcertRecord): void {
    const destination = `${concert.address || concert.venue || ''}`.trim();
    if (!destination) {
      window.alert('Inserisci prima almeno l’indirizzo o il venue del concerto');
      return;
    }
    const draft = {
      id: concert.id,
      title: concert.title,
      date: concert.date,
      timeStart: concert.timeStart,
      venue: concert.venue,
      address: concert.address,
      lineupType: concert.lineupType,
      agreedFee: concert.agreedFee,
      reimbursement: concert.reimbursement,
      contactId: concert.contactId || '',
      billingMode: concert.billingMode,
      paymentCadence: concert.paymentCadence,
      monthlySettlement: concert.monthlySettlement,
      extraExpensesOutsideInvoice: concert.extraExpensesOutsideInvoice,
      notes: concert.notes,
      bands: [...concert.bands],
      musicians: [...concert.musicians]
    };
    localStorage.setItem('mm_concert_expense_context', JSON.stringify({
      from: 'concerts',
      concertId: concert.id,
      draft,
      createdAt: new Date().toISOString()
    }));
    this.router.navigate(['/expenses'], { queryParams: { fromConcert: '1' } });
  }

  toggleInlineContact(): void {
    this.showInlineContact = !this.showInlineContact;
  }

  saveInlineContact(): void {
    const name = `${this.newContact.displayName || ''}`.trim();
    if (!name) return;
    const all = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const created = {
      id: crypto.randomUUID(),
      type: this.newContact.type,
      displayName: name,
      positionCity: '',
      positionAddress: '',
      phone: '',
      email: '',
      priority: Math.max(1, Math.min(5, Number(this.newContact.priority || 3))),
      averageFee: Number(this.newContact.averageFee || 0),
      billingMode: this.newContact.billingMode,
      paymentCadence: this.newContact.paymentCadence,
      monthlySettlement: this.newContact.monthlySettlement,
      billingName: '',
      billingVatNumber: '',
      billingFiscalCode: '',
      billingSdi: '',
      billingPec: '',
      billingAddress: '',
      billingCity: '',
      billingZip: '',
      billingCountry: 'Italia',
      billingNotes: '',
      isMinor: false,
      billedToParent: false,
      parentName: '',
      parentPhone: '',
      parentEmail: '',
      privacyConsentAccepted: false,
      consentDocumentName: '',
      consentDocumentDataUrl: '',
      notes: '',
      createdAt: new Date().toISOString()
    };
    all.unshift(created);
    localStorage.setItem('mm_contacts', JSON.stringify(all));
    this.contacts = this.readContacts();
    this.form.patchValue({
      contactId: created.id,
      billingMode: created.billingMode,
      paymentCadence: created.paymentCadence,
      monthlySettlement: created.monthlySettlement
    });
    this.onContactPick();
    this.showInlineContact = false;
    this.newContact = {
      type: 'band',
      displayName: '',
      priority: 3,
      averageFee: 0,
      billingMode: 'fuori_fattura',
      paymentCadence: 'prestazione',
      monthlySettlement: 'acconto'
    };
  }

  contactName(id: string | null): string {
    if (!id) return '';
    return this.contacts.find(c => c.id === id)?.displayName || '';
  }

  get contactsByPriority(): ContactEntry[] {
    return [...this.contacts].sort((a, b) => b.priority - a.priority || a.displayName.localeCompare(b.displayName));
  }

  applyFilters(): void {
    const baseConcerts = this.concerts.filter(c => this.concertSection === 'attivi' ? c.executionStatus === 'da_fare' : c.executionStatus !== 'da_fare');
    const filtered = baseConcerts
      .filter(concert => {
        if (this.filterBand) {
          const band = this.concertBandLabel(concert).toLowerCase();
          if (!band.includes(this.filterBand.toLowerCase())) return false;
        }
        if (this.filterDateFrom && concert.date < this.filterDateFrom) return false;
        if (this.filterDateTo && concert.date > this.filterDateTo) return false;
        if (this.filterPaymentCadence !== 'all' && this.concertPaymentCadence(concert) !== this.filterPaymentCadence) return false;
        if (this.filterExecutionStatus !== 'all' && concert.executionStatus !== this.filterExecutionStatus) return false;
        const state = this.concertPaymentState(concert);
        if (this.filterPaymentState !== 'all' && state !== this.filterPaymentState) return false;
        return true;
      });

    this.filteredConcerts = this.concertSection === 'attivi'
      ? [...filtered].sort((a, b) => this.compareConcertDateAsc(a, b) || a.createdAt.localeCompare(b.createdAt))
      : filtered;

    const byKey = new Map<string, ConcertRecord[]>();
    for (const concert of this.filteredConcerts) {
      const key = this.bandKeyForConcert(concert);
      const list = byKey.get(key) || [];
      list.push(concert);
      byKey.set(key, list);
    }
    const groups: BandGroup[] = [];
    for (const [key, concerts] of byKey.entries()) {
      const name = concerts[0] ? this.concertBandLabel(concerts[0]) : key;
      const paymentCadence = concerts[0] ? this.concertPaymentCadence(concerts[0]) : 'prestazione';
      const monthlySettlement = concerts[0] ? this.concertMonthlySettlement(concerts[0]) : 'acconto';
      const sorted = this.concertSection === 'attivi'
        ? [...concerts].sort((a, b) => this.compareConcertDateAsc(a, b) || a.createdAt.localeCompare(b.createdAt))
        : [...concerts];
      const dueExecuted = sorted
        .filter(c => c.executionStatus === 'effettuato')
        .reduce((sum, c) => sum + this.concertDueAmount(c), 0);
      const paidExecuted = sorted
        .filter(c => c.executionStatus === 'effettuato')
        .reduce((sum, c) => sum + this.concertEffectivePaidAmount(c), 0);
      const creditRemaining = this.monthlyCreditRemainingByBandKey.get(key) || 0;
      groups.push({
        key,
        name,
        paymentCadence,
        monthlySettlement,
        concerts: sorted,
        dueExecuted: this.round2(dueExecuted),
        paidExecuted: this.round2(paidExecuted),
        creditRemaining: this.round2(creditRemaining)
      });
    }
    this.bandGroups = this.concertSection === 'attivi'
      ? groups.sort((a, b) => {
          const ad = a.concerts[0]?.date || '';
          const bd = b.concerts[0]?.date || '';
          return ad.localeCompare(bd) || a.name.localeCompare(b.name);
        })
      : groups;
  }

  get availableBandFilters(): string[] {
    const unique = new Set<string>();
    this.concerts.forEach(c => unique.add(this.concertBandLabel(c)));
    return [...unique].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  get activeFilterChips(): string[] {
    const chips: string[] = [];
    if (this.filterBand) chips.push(this.filterBand);
    if (this.filterDateFrom || this.filterDateTo) {
      const from = this.filterDateFrom || '…';
      const to = this.filterDateTo || '…';
      chips.push(`${from} → ${to}`);
    }
    if (this.filterPaymentCadence !== 'all') chips.push(this.filterPaymentCadence === 'mensile' ? 'Mensile' : 'A serata');
    if (this.filterPaymentState !== 'all') {
      if (this.filterPaymentState === 'pagato') chips.push('Pagato');
      if (this.filterPaymentState === 'parziale') chips.push('Parziale');
      if (this.filterPaymentState === 'da_pagare') chips.push('Da pagare');
    }
    if (this.filterExecutionStatus !== 'all') {
      if (this.filterExecutionStatus === 'effettuato') chips.push('Effettuato');
      if (this.filterExecutionStatus === 'da_fare') chips.push('Da fare');
      if (this.filterExecutionStatus === 'annullato') chips.push('Annullato');
      if (this.filterExecutionStatus === 'rimborsato') chips.push('Rimborsato');
    }
    return chips;
  }

  resetFilters(): void {
    this.filterBand = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterPaymentCadence = 'all';
    this.filterPaymentState = 'all';
    this.filterExecutionStatus = 'all';
    this.applyFilters();
  }

  concertBandLabel(concert: ConcertRecord): string {
    const byContact = this.contactName(concert.contactId);
    if (byContact) return byContact;
    if (concert.bands.length) return concert.bands.join(', ');
    if (concert.venue) return concert.venue;
    return 'Band non definita';
  }

  concertMetaBandLabel(concert: ConcertRecord): string {
    const band = this.concertBandLabel(concert);
    const venue = `${concert.venue || ''}`.trim();
    if (!venue) return band;
    if (this.normalizeBandKey(band) === this.normalizeBandKey(venue)) return '';
    return band;
  }

  concertPlacePreview(concert: ConcertRecord): string {
    const address = `${concert.address || ''}`.trim();
    if (address) {
      const first = address.split(',').map(x => `${x || ''}`.trim()).find(Boolean) || '';
      if (first) return first;
    }
    return `${concert.venue || ''}`.trim() || 'Luogo da definire';
  }

  concertPaymentCadence(concert: ConcertRecord): 'prestazione' | 'mensile' {
    const contact = this.resolveConcertBandContact(concert);
    if (contact?.paymentCadence) return contact.paymentCadence === 'mensile' ? 'mensile' : 'prestazione';
    return concert.paymentCadence === 'mensile' ? 'mensile' : 'prestazione';
  }

  concertMonthlySettlement(concert: ConcertRecord): 'acconto' | 'bonifico' {
    const contact = this.resolveConcertBandContact(concert);
    if (contact?.monthlySettlement) return contact.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto';
    return concert.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto';
  }

  concertPaymentCadenceLabel(concert: ConcertRecord): string {
    if (this.concertPaymentCadence(concert) === 'prestazione') return 'A prestazione (saldo immediato)';
    return `Mensile - ${this.concertMonthlySettlement(concert)}`;
  }

  concertPaidAmount(concert: ConcertRecord): number {
    return this.concertEffectivePaidAmount(concert);
  }

  concertDueAmount(concert: ConcertRecord): number {
    if (concert.executionStatus === 'rimborsato' && Number(concert.reimbursedAmount || 0) > 0) {
      return Number(concert.reimbursedAmount || 0);
    }
    return Number(concert.agreedFee || 0) + Number(concert.reimbursement || 0);
  }

  concertDueAmountForDisplay(concert: ConcertRecord): number {
    if (this.concertPaymentCadence(concert) === 'mensile' && concert.executionStatus !== 'effettuato') {
      return 0;
    }
    return this.concertDueAmount(concert);
  }

  concertResidualAmountForDisplay(concert: ConcertRecord): number {
    return Math.max(0, this.concertDueAmountForDisplay(concert) - this.concertPaidAmount(concert));
  }

  concertPaymentState(concert: ConcertRecord): 'da_pagare' | 'parziale' | 'pagato' {
    const due = this.concertDueAmount(concert);
    const paid = this.concertEffectivePaidAmount(concert);
    if (this.concertPaymentCadence(concert) === 'mensile' && concert.executionStatus !== 'effettuato') {
      return 'da_pagare';
    }
    if (paid <= 0) return 'da_pagare';
    if (paid >= due) return 'pagato';
    return 'parziale';
  }

  concertPaymentStateLabel(concert: ConcertRecord): string {
    const state = this.concertPaymentState(concert);
    if (state === 'pagato') return 'Pagato';
    if (state === 'parziale') return 'Parzialmente pagato';
    return 'Da pagare';
  }

  concertPaymentStateClass(concert: ConcertRecord): string {
    const state = this.concertPaymentState(concert);
    if (state === 'pagato') return 'pay-done';
    if (state === 'parziale') return 'pay-partial';
    return 'pay-due';
  }

  showPaymentForConcert(concert: ConcertRecord): boolean {
    return concert.executionStatus !== 'annullato';
  }

  hasTravelExpenseCalculated(concert: ConcertRecord): boolean {
    const note = `${concert.notes || ''}`.toLowerCase();
    if (note.includes('[spese viaggio:')) return true;
    return Number(concert.reimbursement || 0) > 0;
  }

  goToAccountingForConcert(concert: ConcertRecord, monthlyAction: 'acconto' | 'bonifico' | '' = ''): void {
    const paymentCadence = this.concertPaymentCadence(concert);
    const monthlySettlement = this.concertMonthlySettlement(concert);
    this.router.navigate(['/accounting'], {
      queryParams: {
        eventId: concert.id,
        band: this.concertBandLabel(concert),
        paymentCadence,
        monthlySettlement,
        extraExpensesOutsideInvoice: concert.extraExpensesOutsideInvoice ? '1' : '0',
        monthlyAction,
        due: this.concertDueAmount(concert),
        state: this.concertPaymentState(concert)
      }
    });
  }

  isConcertPending(concert: ConcertRecord): boolean {
    return this.concertPaymentState(concert) !== 'pagato';
  }

  addMonthlyPayment(concert: ConcertRecord, type: 'acconto' | 'bonifico'): void {
    this.goToAccountingForConcert(concert, type);
  }

  executionStatusLabel(status: ConcertRecord['executionStatus']): string {
    if (status === 'effettuato') return 'Effettuato';
    if (status === 'annullato') return 'Annullato';
    if (status === 'rimborsato') return 'Rimborsato';
    return 'Da fare';
  }

  executionStatusClass(status: ConcertRecord['executionStatus']): string {
    if (status === 'effettuato') return 'status-done';
    if (status === 'annullato') return 'status-cancelled';
    if (status === 'rimborsato') return 'status-refunded';
    return 'status-planned';
  }

  setExecutionStatus(concert: ConcertRecord, status: ConcertRecord['executionStatus']): void {
    if (status === 'rimborsato') {
      const fallback = concert.reimbursedAmount > 0 ? `${concert.reimbursedAmount}` : `${concert.agreedFee}`;
      const value = window.prompt('Inserisci cifra rimborsata (€)', fallback);
      const amount = Number(`${value || ''}`.replace(',', '.'));
      if (!Number.isFinite(amount) || amount <= 0) return;
      concert.reimbursedAmount = amount;
    } else if (concert.executionStatus === 'rimborsato') {
      concert.reimbursedAmount = 0;
    }
    concert.executionStatus = status;
    this.persistConcerts();
    this.syncConcertToAgenda(concert);
    this.rebuildMonthlyCreditAllocations();
    if (status === 'effettuato' && this.concertPaymentCadence(concert) === 'prestazione' && this.concertPaymentState(concert) !== 'pagato') {
      const shouldRegister = window.confirm('Concerto effettuato con pagamento a serata. Vuoi registrare subito il saldo in Contabilità?');
      if (shouldRegister) {
        this.goToAccountingForConcert(concert);
      }
    }
  }

  toggleConcertExpanded(concertId: string): void {
    this.expandedConcertId = this.expandedConcertId === concertId ? null : concertId;
  }

  toggleBandExpanded(bandKey: string): void {
    this.expandedBandKey = this.expandedBandKey === bandKey ? null : bandKey;
  }

  trackByBandGroup(_: number, group: BandGroup): string {
    return group.key;
  }

  trackByConcert(_: number, concert: ConcertRecord): string {
    return concert.id;
  }

  addMonthlyPaymentForBand(bandName: string, type: 'acconto' | 'bonifico'): void {
    this.router.navigate(['/accounting'], {
      queryParams: {
        band: bandName,
        paymentCadence: 'mensile',
        monthlyAction: type
      }
    });
  }

  openExemptionModule(concert: ConcertRecord): void {
    window.open(`${window.location.origin}/confirm/${concert.id}?pdf=1`, '_blank');
  }

  private syncConcertToAgenda(concert: ConcertRecord): void {
    const events: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const mappedStatus = concert.executionStatus === 'annullato'
      ? 'cancelled'
      : (concert.executionStatus === 'da_fare' ? 'pending' : 'confirmed');
    const grossFee = concert.executionStatus === 'rimborsato' && concert.reimbursedAmount > 0
      ? concert.reimbursedAmount
      : concert.agreedFee;
    const next = events.map(event => event.id === concert.id ? {
      ...event,
      status: mappedStatus,
      grossFee,
      netFee: grossFee + Number(concert.reimbursement || 0)
    } : event);
    localStorage.setItem('mm_events', JSON.stringify(next));
    void this.syncSupabaseEvents();
  }

  private persistConcerts(): void {
    this.concerts = [...this.concerts].sort((a, b) => this.compareConcertDateDesc(a, b) || b.createdAt.localeCompare(a.createdAt));
    localStorage.setItem('mm_concerts', JSON.stringify(this.concerts));
    this.applyFilters();
  }

  private applyRouteContext(): void {
    const eventId = `${this.route.snapshot.queryParamMap.get('eventId') || ''}`.trim();
    if (!eventId) return;
    const target = this.concerts.find(concert => concert.id === eventId);
    if (!target) return;
    this.expandedConcertId = target.id;
    this.focusedConcertId = target.id;
    setTimeout(() => {
      const node = document.getElementById(`concert-${target.id}`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }

  private applyExpenseReturnContext(): void {
    const rawContext = localStorage.getItem('mm_concert_expense_context');
    if (!rawContext) return;
    const rawResult = localStorage.getItem('mm_concert_expense_result');
    const context = JSON.parse(rawContext || '{}');
    const contextConcertId = `${context?.concertId || ''}`.trim();
    if (contextConcertId && rawResult) {
      const result = JSON.parse(rawResult || '{}');
      const totalExpense = Number(result?.totalExpense || 0);
      if (Number.isFinite(totalExpense) && totalExpense >= 0) {
        const idx = this.concerts.findIndex(c => c.id === contextConcertId);
        if (idx >= 0) {
          const current = this.concerts[idx];
          const routeText = `${result?.origin || ''} → ${result?.destination || ''}`.trim();
          const baseNotes = `${current.notes || ''}`.replace(/\s*\[Spese viaggio:[^\]]+\]/gi, '').trim();
          const noteAddon = `[Spese viaggio: ${totalExpense.toFixed(2)}€${routeText ? ` • ${routeText}` : ''}]`;
          const updated: ConcertRecord = {
            ...current,
            reimbursement: this.round2(totalExpense),
            notes: `${baseNotes}${baseNotes ? ' ' : ''}${noteAddon}`.trim()
          };
          this.concerts[idx] = updated;
          this.persistConcerts();
          this.rebuildMonthlyCreditAllocations();
          this.syncConcertToAgenda(updated);
          this.expandedConcertId = updated.id;
          this.focusedConcertId = updated.id;
          setTimeout(() => {
            const node = document.getElementById(`concert-${updated.id}`);
            node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 120);
        }
      }
      localStorage.removeItem('mm_concert_expense_context');
      localStorage.removeItem('mm_concert_expense_result');
      return;
    }
    const draft = context?.draft || {};
    this.showForm = true;
    this.form.patchValue({
      title: `${draft.title || ''}`,
      date: `${draft.date || ''}`,
      timeStart: `${draft.timeStart || ''}`,
      venue: `${draft.venue || ''}`,
      address: `${draft.address || ''}`,
      lineupType: `${draft.lineupType || 'duo'}`,
      agreedFee: Number(draft.agreedFee || 0),
      reimbursement: Number(draft.reimbursement || 0),
      contactId: `${draft.contactId || ''}`,
      billingMode: draft.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
      paymentCadence: draft.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: draft.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
      extraExpensesOutsideInvoice: draft.extraExpensesOutsideInvoice !== false,
      notes: `${draft.notes || ''}`
    });
    while (this.bandsArray.length) this.bandsArray.removeAt(0);
    while (this.musiciansArray.length) this.musiciansArray.removeAt(0);
    const bands = Array.isArray(draft.bands) ? draft.bands : [];
    const musicians = Array.isArray(draft.musicians) ? draft.musicians : [];
    bands.forEach((name: any) => this.bandsArray.push(this.fb.control(`${name || ''}`)));
    musicians.forEach((name: any) => this.musiciansArray.push(this.fb.control(`${name || ''}`)));
    if (!rawResult) return;
    const result = JSON.parse(rawResult || '{}');
    const totalExpense = Number(result?.totalExpense || 0);
    if (Number.isFinite(totalExpense) && totalExpense > 0) {
      this.form.patchValue({ reimbursement: totalExpense });
      const currentNotes = `${this.form.get('notes')?.value || ''}`.replace(/\s*\[Spese viaggio:[^\]]+\]/gi, '').trim();
      const routeText = `${result?.origin || ''} → ${result?.destination || ''}`.trim();
      const noteAddon = `[Spese viaggio: ${totalExpense.toFixed(2)}€${routeText ? ` • ${routeText}` : ''}]`;
      this.form.patchValue({ notes: `${currentNotes}${currentNotes ? ' ' : ''}${noteAddon}`.trim() });
    }
    localStorage.removeItem('mm_concert_expense_context');
    localStorage.removeItem('mm_concert_expense_result');
  }

  private async syncDemoDataOnMobileIfNeeded(): Promise<void> {
    if (typeof window === 'undefined') return;
    const musicianId = `${localStorage.getItem('musicianId') || ''}`.trim();
    if (!musicianId) return;
    const localEvents = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const localContacts = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const localConcerts = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    const needsHydration = !Array.isArray(localEvents) || !localEvents.length || !Array.isArray(localConcerts) || !localConcerts.length;
    if (!needsHydration) return;
    try {
      const [remoteEvents, remoteContacts, remoteExpenses] = await Promise.all([
        this.supabase.loadEventsFromSupabase(musicianId),
        this.supabase.loadContactsFromSupabase(musicianId),
        this.supabase.loadExpensesFromSupabase(musicianId)
      ]);
      if (remoteEvents.length && (!Array.isArray(localEvents) || !localEvents.length)) {
        localStorage.setItem('mm_events', JSON.stringify(remoteEvents));
      }
      if (remoteExpenses.length) {
        const currentExpenses = JSON.parse(localStorage.getItem('mm_expenses') || '[]');
        if (!Array.isArray(currentExpenses) || !currentExpenses.length) {
          localStorage.setItem('mm_expenses', JSON.stringify(remoteExpenses));
        }
      }
      if (remoteContacts.length && (!Array.isArray(localContacts) || !localContacts.length)) {
        const mappedContacts = remoteContacts
          .map((row: any) => row?.payload || {
            id: `${row?.source_id || row?.id || crypto.randomUUID()}`,
            type: `${row?.type || 'band'}`,
            displayName: `${row?.display_name || ''}`.trim(),
            priority: Number(row?.priority || 3),
            averageFee: Number(row?.average_fee || 0),
            billingMode: row?.billing_mode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
            paymentCadence: row?.payment_cadence === 'mensile' ? 'mensile' : 'prestazione',
            monthlySettlement: row?.monthly_settlement === 'bonifico' ? 'bonifico' : 'acconto',
            notes: `${row?.notes || ''}`,
            createdAt: `${row?.created_at || new Date().toISOString()}`
          })
          .filter((x: any) => !!`${x?.displayName || ''}`.trim());
        if (mappedContacts.length) {
          localStorage.setItem('mm_contacts', JSON.stringify(mappedContacts));
        }
      }
    } catch {
      return;
    }
  }

  private async fetchAddressSuggestions(query: string): Promise<void> {
    this.addressAborter?.abort();
    const controller = new AbortController();
    this.addressAborter = controller;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=7&countrycodes=it&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'it' },
        signal: controller.signal
      });
      if (!res.ok) return;
      const rows = await res.json();
      const currentAddress = `${this.form.get('address')?.value || ''}`.trim();
      if (this.normalizeAddress(currentAddress) !== this.normalizeAddress(query)) return;
      this.addressSuggestions = this.rankAddressRows(rows, query).slice(0, 7).map(x => x.label);
    } catch (error: any) {
      if (error?.name !== 'AbortError') this.addressSuggestions = [];
    }
  }

  private rankAddressRows(rows: any[], query: string): ConcertAddressSuggestion[] {
    const normalizedQuery = this.normalizeAddress(query);
    const seen = new Set<string>();
    const ranked: ConcertAddressSuggestion[] = [];
    for (const row of rows) {
      const label = this.formatAddressLabel(row);
      const key = this.normalizeAddress(label);
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

  private formatAddressLabel(row: any): string {
    return formatItalianAddressLabel(row, value => this.normalizeAddress(value));
  }

  private normalizeAddress(value: string): string {
    return `${value || ''}`.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private addressTypeScore(addresstype: string): number {
    return italianAddressTypeScore(addresstype);
  }

  private async fetchBestAddressLabel(query: string): Promise<string | null> {
    const q = `${query || ''}`.trim();
    if (q.length < 2) return null;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=7&countrycodes=it&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'it' } });
      if (!res.ok) return null;
      const rows = await res.json();
      const ranked = this.rankAddressRows(Array.isArray(rows) ? rows : [], q);
      return ranked[0]?.label || null;
    } catch {
      return null;
    }
  }

  private emptyImportRow(): ImportConcertRow {
    return {
      id: crypto.randomUUID(),
      date: '',
      timeStart: '21:00',
      eventTitle: '',
      bandName: '',
      venue: '',
      address: '',
      agreedFee: null,
      reimbursement: null,
      notes: '',
      billingMode: '',
      paymentCadence: '',
      monthlySettlement: ''
    };
  }

  private applyImportPaste(text: string): void {
    const lines = `${text || ''}`.replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const maybeHeader = lines[0].toLowerCase();
    const contentLines = (maybeHeader.includes('data') && (maybeHeader.includes('luogo') || maybeHeader.includes('evento')))
      ? lines.slice(1)
      : lines;
    if (!contentLines.length) return;

    let startIndex = this.importRows.findIndex(r => this.isImportRowEmpty(r));
    if (startIndex < 0) startIndex = this.importRows.length;

    while (this.importRows.length < startIndex + contentLines.length) {
      this.importRows.push(this.emptyImportRow());
    }

    contentLines.forEach((line, i) => {
      const cols = this.splitPasteColumns(line);
      const row = this.importRows[startIndex + i];
      if (!row) return;
      const date = this.normalizeIsoDate(cols[0] || '');
      if (date) row.date = date;
      const time = this.normalizeTime(cols[1] || '');
      if (time) row.timeStart = time;
      row.eventTitle = `${cols[2] || ''}`.trim() || row.eventTitle;
      row.bandName = `${cols[3] || ''}`.trim() || row.bandName;
      row.venue = `${cols[4] || ''}`.trim() || row.venue;
      row.address = `${cols[5] || ''}`.trim() || row.address;
      const fee = this.parseMoney(cols[6] || '');
      if (fee > 0) row.agreedFee = fee;
      const reimb = this.parseMoney(cols[7] || '');
      if (reimb > 0) row.reimbursement = reimb;
      row.notes = `${cols[8] || ''}`.trim() || row.notes;

      const cadence = `${cols[9] || ''}`.toLowerCase().trim();
      if (cadence === 'mensile' || cadence === 'prestazione') row.paymentCadence = cadence as any;
      const settlement = `${cols[10] || ''}`.toLowerCase().trim();
      if (settlement === 'acconto' || settlement === 'bonifico') row.monthlySettlement = settlement as any;
      const billing = `${cols[11] || ''}`.toLowerCase().trim();
      if (billing === 'in_fattura' || billing === 'fuori_fattura') row.billingMode = billing as any;

      this.onImportBandChange(row);
    });
  }

  private splitPasteColumns(line: string): string[] {
    const raw = `${line || ''}`;
    if (raw.includes('\t')) return raw.split('\t').map(x => `${x || ''}`.trim());
    if (raw.includes(';')) return raw.split(';').map(x => `${x || ''}`.trim());
    return raw.split(',').map(x => `${x || ''}`.trim());
  }

  private isImportRowEmpty(row: ImportConcertRow): boolean {
    return !`${row.date || ''}`.trim()
      && !`${row.eventTitle || ''}`.trim()
      && !`${row.bandName || ''}`.trim()
      && !`${row.venue || ''}`.trim()
      && !`${row.address || ''}`.trim()
      && !Number(row.agreedFee || 0)
      && !Number(row.reimbursement || 0)
      && !`${row.notes || ''}`.trim();
  }

  private normalizeIsoDate(value: string): string {
    const v = `${value || ''}`.trim();
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
    if (!m) return '';
    const dd = `${m[1]}`.padStart(2, '0');
    const mm = `${m[2]}`.padStart(2, '0');
    const yy = `${m[3]}`.length === 2 ? `20${m[3]}` : `${m[3]}`;
    return `${yy}-${mm}-${dd}`;
  }

  private normalizeTime(value: string): string {
    const v = `${value || ''}`.trim();
    if (!v) return '';
    if (/^\d{2}:\d{2}$/.test(v)) return v;
    const m1 = v.match(/^(\d{1,2})$/);
    if (m1) return `${m1[1].padStart(2, '0')}:00`;
    const m2 = v.replace('.', ':').match(/^(\d{1,2}):(\d{1,2})$/);
    if (m2) return `${m2[1].padStart(2, '0')}:${m2[2].padStart(2, '0')}`;
    return '';
  }

  private parseMoney(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) return this.round2(value);
    const raw = `${value || ''}`.replace(/€/g, '').replace(/\s/g, '');
    const cleaned = raw.includes(',')
      ? raw.replace(/\./g, '').replace(/,/g, '.')
      : raw;
    const n = Number(cleaned);
    return Number.isFinite(n) ? this.round2(Math.max(0, n)) : 0;
  }

  private applyImportPasteAtFocusedCell(text: string, focus: { rowId: string; col: ImportCol }): boolean {
    const startRowIndex = this.importRows.findIndex(r => r.id === focus.rowId);
    if (startRowIndex < 0) return false;
    const order: ImportCol[] = [
      'date',
      'timeStart',
      'eventTitle',
      'bandName',
      'venue',
      'address',
      'agreedFee',
      'reimbursement',
      'notes',
      'paymentCadence',
      'monthlySettlement',
      'billingMode'
    ];
    const startColIndex = order.indexOf(focus.col);
    if (startColIndex < 0) return false;

    const matrix = this.parsePasteMatrix(text);
    if (!matrix.length) return false;

    while (this.importRows.length < startRowIndex + matrix.length) {
      this.importRows.push(this.emptyImportRow());
    }

    for (let r = 0; r < matrix.length; r++) {
      const row = this.importRows[startRowIndex + r];
      const cols = matrix[r];
      for (let c = 0; c < cols.length; c++) {
        const colKey = order[startColIndex + c];
        if (!colKey) continue;
        this.applyCellValue(row, colKey, cols[c]);
      }
      this.onImportBandChange(row);
    }
    return true;
  }

  private parsePasteMatrix(text: string): string[][] {
    const raw = `${text || ''}`.replace(/\r/g, '\n');
    const lines = raw.split('\n');
    while (lines.length && !`${lines[lines.length - 1]}`.trim()) lines.pop();
    if (!lines.length) return [];
    const hasTab = raw.includes('\t');
    const hasSemicolon = raw.includes(';');
    return lines
      .map(l => `${l || ''}`)
      .filter(l => l.length > 0 || lines.length === 1)
      .map(line => {
        if (hasTab) return line.split('\t').map(x => `${x || ''}`.trim());
        if (hasSemicolon) return line.split(';').map(x => `${x || ''}`.trim());
        return [`${line || ''}`.trim()];
      })
      .map(cols => cols.filter((_, idx) => idx === 0 || cols.some(x => `${x}`.trim().length > 0)));
  }

  private applyCellValue(row: ImportConcertRow, col: ImportCol, raw: string): void {
    const v = `${raw || ''}`.trim();
    if (!v) {
      if (col === 'agreedFee') row.agreedFee = null;
      if (col === 'reimbursement') row.reimbursement = null;
      return;
    }
    if (col === 'date') {
      const date = this.normalizeIsoDate(v);
      if (date) row.date = date;
      return;
    }
    if (col === 'timeStart') {
      const t = this.normalizeTime(v);
      if (t) row.timeStart = t;
      return;
    }
    if (col === 'agreedFee') {
      const n = this.parseMoney(v);
      row.agreedFee = n > 0 ? n : null;
      return;
    }
    if (col === 'reimbursement') {
      const n = this.parseMoney(v);
      row.reimbursement = n > 0 ? n : null;
      return;
    }
    if (col === 'paymentCadence') {
      const norm = this.normalizeCadenceInput(v);
      if (norm) row.paymentCadence = norm;
      return;
    }
    if (col === 'monthlySettlement') {
      const norm = this.normalizeMonthlySettlementInput(v);
      if (norm) row.monthlySettlement = norm;
      return;
    }
    if (col === 'billingMode') {
      const norm = this.normalizeBillingModeInput(v);
      if (norm) row.billingMode = norm;
      return;
    }
    (row as any)[col] = v;
  }

  private normalizeCadenceInput(value: string): 'prestazione' | 'mensile' | '' {
    const v = `${value || ''}`.toLowerCase().trim();
    if (!v) return '';
    if (v.includes('mens')) return 'mensile';
    if (v.includes('serat') || v.includes('prestaz') || v.includes('immedi')) return 'prestazione';
    if (v === 'mensile') return 'mensile';
    if (v === 'prestazione') return 'prestazione';
    return '';
  }

  private normalizeMonthlySettlementInput(value: string): 'acconto' | 'bonifico' | '' {
    const v = `${value || ''}`.toLowerCase().trim();
    if (!v) return '';
    if (v.includes('bonif')) return 'bonifico';
    if (v.includes('acc')) return 'acconto';
    if (v === 'acconto') return 'acconto';
    if (v === 'bonifico') return 'bonifico';
    return '';
  }

  private normalizeBillingModeInput(value: string): 'in_fattura' | 'fuori_fattura' | '' {
    const v = `${value || ''}`.toLowerCase().trim();
    if (!v) return '';
    if (v.includes('fuori')) return 'fuori_fattura';
    if (v.includes('in')) return 'in_fattura';
    if (v === 'in_fattura') return 'in_fattura';
    if (v === 'fuori_fattura') return 'fuori_fattura';
    return '';
  }

  private findBandContactByName(name: string): ContactEntry | null {
    const key = this.normalizeBandKey(`${name || ''}`.trim());
    if (!key) return null;
    return this.contacts.find(c => c.type === 'band' && this.normalizeBandKey(c.displayName) === key) || null;
  }

  private ensureImportedBandContacts(): boolean {
    const existing = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const list = Array.isArray(existing) ? existing : [];
    const byKey = new Map<string, any>();
    for (const item of list) {
      const type = `${item?.type || ''}`;
      if (type !== 'band') continue;
      const display = `${item?.displayName || item?.display_name || ''}`.trim();
      const key = this.normalizeBandKey(display);
      if (!key) continue;
      byKey.set(key, item);
    }

    let changed = false;
    for (const row of this.importRows) {
      const bandName = `${row.bandName || ''}`.trim();
      if (!bandName) continue;
      const key = this.normalizeBandKey(bandName);
      if (!key || byKey.has(key)) continue;
      list.unshift({
        id: crypto.randomUUID(),
        type: 'band',
        displayName: bandName,
        positionCity: '',
        positionAddress: '',
        phone: '',
        email: '',
        priority: 3,
        averageFee: 0,
        billingMode: row.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
        paymentCadence: row.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
        monthlySettlement: row.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
        billingName: '',
        billingVatNumber: '',
        billingFiscalCode: '',
        billingSdi: '',
        billingPec: '',
        billingAddress: '',
        billingCity: '',
        billingZip: '',
        billingCountry: 'Italia',
        billingNotes: '',
        isMinor: false,
        billedToParent: false,
        parentName: '',
        parentPhone: '',
        parentEmail: '',
        privacyConsentAccepted: false,
        consentDocumentName: '',
        consentDocumentDataUrl: '',
        notes: '',
        createdAt: new Date().toISOString()
      });
      byKey.set(key, true);
      changed = true;
    }
    if (changed) localStorage.setItem('mm_contacts', JSON.stringify(list));
    return changed;
  }

  private readConcerts(): ConcertRecord[] {
    const parsed = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x: any): ConcertRecord => ({
      id: `${x.id || crypto.randomUUID()}`,
      title: `${x.title || ''}`.trim() || `${x.venue || ''}`.trim() || 'Concerto',
      date: `${x.date || ''}`,
      timeStart: `${x.timeStart || ''}`,
      venue: `${x.venue || ''}`.trim(),
      address: `${x.address || ''}`.trim(),
      lineupType: `${x.lineupType || 'band'}`,
      agreedFee: Number(x.agreedFee || 0),
      reimbursement: Number(x.reimbursement || 0),
      notes: `${x.notes || ''}`.trim(),
      bands: Array.isArray(x.bands)
        ? x.bands.map((b: any) => `${b || ''}`.trim()).filter(Boolean)
        : (`${x.bands || ''}`.trim() ? [`${x.bands}`.trim()] : []),
      musicians: Array.isArray(x.musicians)
        ? x.musicians.map((m: any) => `${m || ''}`.trim()).filter(Boolean)
        : (`${x.musicians || ''}`.trim() ? [`${x.musicians}`.trim()] : []),
      contactId: `${x.contactId || ''}` || null,
      billingMode: x.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
      paymentCadence: x.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: x.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
      extraExpensesOutsideInvoice: x.extraExpensesOutsideInvoice !== false,
      executionStatus: x.executionStatus === 'effettuato' || x.executionStatus === 'annullato' || x.executionStatus === 'rimborsato' ? x.executionStatus : 'da_fare',
      reimbursedAmount: Number(x.reimbursedAmount || 0),
      createdAt: `${x.createdAt || new Date().toISOString()}`
    }));
  }

  private applyAverageFeeFromContacts(current: ConcertRecord[]): ConcertRecord[] {
    const byContactId = new Map<string, ContactEntry>();
    const byBandName = new Map<string, ContactEntry>();
    for (const contact of this.contacts) {
      if (`${contact.type || ''}` !== 'band') continue;
      if (`${contact.id || ''}`.trim()) byContactId.set(`${contact.id}`.trim(), contact);
      const key = this.normalizeBandKey(contact.displayName || '');
      if (key) byBandName.set(key, contact);
    }

    return current.map(concert => {
      const currentFee = Number(concert.agreedFee || 0);
      if (currentFee > 0) return concert;
      let contact: ContactEntry | undefined;
      if (`${concert.contactId || ''}`.trim()) contact = byContactId.get(`${concert.contactId}`.trim());
      if (!contact && concert.bands?.length) {
        const key = this.normalizeBandKey(`${concert.bands[0] || ''}`);
        if (key) contact = byBandName.get(key);
      }
      if (!contact && concert.venue) {
        const key = this.normalizeBandKey(concert.venue);
        if (key) contact = byBandName.get(key);
      }
      const avg = Number(contact?.averageFee || 0);
      if (!(avg > 0)) return concert;
      return { ...concert, agreedFee: this.round2(avg), contactId: concert.contactId || contact?.id || null };
    });
  }

  private compareConcertDateDesc(a: ConcertRecord, b: ConcertRecord): number {
    return this.concertDateSortKey(b.date) - this.concertDateSortKey(a.date);
  }

  private compareConcertDateAsc(a: ConcertRecord, b: ConcertRecord): number {
    return this.concertDateSortKey(a.date) - this.concertDateSortKey(b.date);
  }

  private concertDateSortKey(value: string): number {
    const raw = `${value || ''}`.trim();
    if (!raw) return 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Number(raw.replace(/-/g, ''));
    const m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
    if (m) {
      const dd = `${m[1]}`.padStart(2, '0');
      const mm = `${m[2]}`.padStart(2, '0');
      const yy = `${m[3]}`.length === 2 ? `20${m[3]}` : `${m[3]}`;
      return Number(`${yy}${mm}${dd}`);
    }
    return Number(raw.replace(/[^\d]/g, '').slice(0, 8)) || 0;
  }

  private mergeConcertsFromAgenda(current: ConcertRecord[]): ConcertRecord[] {
    const events: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const concertsFromEvents = events.filter(e => e.type !== 'lesson');
    const byId = new Map(current.map(c => [c.id, c]));
    concertsFromEvents.forEach(event => {
      const existing = byId.get(event.id);
      const agendaStatus: ConcertRecord['executionStatus'] =
        event.status === 'cancelled' ? 'annullato' : (event.status === 'confirmed' ? 'effettuato' : 'da_fare');
      if (existing) {
        const keepRefund = existing.executionStatus === 'rimborsato';
        byId.set(event.id, {
          ...existing,
          title: `${existing.title || ''}`.trim() || `${event.title || ''}`.trim() || 'Concerto',
          date: event.date || existing.date,
          timeStart: event.timeStart || existing.timeStart,
          venue: event.venue || existing.venue,
          address: event.address || existing.address,
          executionStatus: keepRefund ? 'rimborsato' : agendaStatus
        });
        return;
      }
      const contactName = this.extractContactName(event.notes || '');
      const normalizedContactName = this.normalizeBandKey(contactName);
      const contact = this.contacts.find(c => c.type === 'band' && this.normalizeBandKey(c.displayName) === normalizedContactName);
      const paymentCadence = contact
        ? (contact.paymentCadence === 'mensile' ? 'mensile' : 'prestazione')
        : (`${event.notes || ''}`.toLowerCase().includes('pagamento mensile') ? 'mensile' : 'prestazione');
      const monthlySettlement = contact
        ? (contact.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto')
        : (`${event.notes || ''}`.toLowerCase().includes('bonifico') ? 'bonifico' : 'acconto');
      const extraExpensesOutsideInvoice = `${event.notes || ''}`.toLowerCase().includes('[spese extra:in_fattura]') ? false : true;
      byId.set(event.id, {
        id: event.id,
        title: event.title || 'Evento',
        date: event.date || '',
        timeStart: event.timeStart || '',
        venue: event.venue || '',
        address: event.address || '',
        lineupType: event.type === 'rehearsal' ? 'rehearsal' : 'band',
        agreedFee: Number(event.grossFee || 0),
        reimbursement: Math.max(0, Number((event.netFee || 0) - (event.grossFee || 0))),
        notes: `${event.notes || ''}`.trim(),
        bands: contact?.displayName ? [contact.displayName] : (contactName ? [contactName] : []),
        musicians: [],
        contactId: contact?.id || null,
        billingMode: event.compensoType === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
        paymentCadence,
        monthlySettlement,
        extraExpensesOutsideInvoice,
        executionStatus: agendaStatus,
        reimbursedAmount: 0,
        createdAt: event.createdAt || new Date().toISOString()
      });
    });
    return [...byId.values()];
  }

  private applyBandPaymentProfile(concerts: ConcertRecord[]): ConcertRecord[] {
    const bandContacts = this.contacts.filter(c => c.type === 'band');
    const byId = new Map(bandContacts.map(c => [c.id, c]));
    const byName = new Map(
      bandContacts
        .filter(c => !!`${c.displayName || ''}`.trim())
        .map(c => [this.normalizeBandKey(c.displayName), c] as const)
    );

    return concerts.map(concert => {
      let contact: ContactEntry | undefined;
      if (concert.contactId) contact = byId.get(concert.contactId);
      if (!contact) {
        const key = this.normalizeBandKey(this.concertBandLabel(concert));
        contact = byName.get(key);
      }
      if (!contact) return concert;

      return {
        ...concert,
        contactId: contact.id,
        billingMode: contact.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
        paymentCadence: contact.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
        monthlySettlement: contact.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
      };
    });
  }

  private normalizeBandKey(value: string): string {
    return `${value || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private resolveConcertBandContact(concert: ConcertRecord): ContactEntry | undefined {
    if (concert.contactId) {
      const byId = this.contacts.find(c => c.type === 'band' && c.id === concert.contactId);
      if (byId) return byId;
    }
    const noteBand = this.extractContactName(concert.notes || '');
    const candidates = [
      `${noteBand || ''}`.trim(),
      ...(Array.isArray(concert.bands) ? concert.bands.map(x => `${x || ''}`.trim()) : []),
      `${concert.venue || ''}`.trim()
    ].filter(Boolean);
    for (const candidate of candidates) {
      const key = this.normalizeBandKey(candidate);
      const match = this.contacts.find(c => c.type === 'band' && this.normalizeBandKey(c.displayName) === key);
      if (match) return match;
    }
    return undefined;
  }

  private bandKeyForConcert(concert: ConcertRecord): string {
    const contact = this.resolveConcertBandContact(concert);
    if (contact?.displayName) return this.normalizeBandKey(contact.displayName);
    if (Array.isArray(concert.bands) && concert.bands.length) return this.normalizeBandKey(concert.bands[0]);
    const byNotes = this.extractContactName(concert.notes || '');
    if (byNotes) return this.normalizeBandKey(byNotes);
    if (concert.venue) return this.normalizeBandKey(concert.venue);
    return 'band-non-definita';
  }

  private concertDirectPaidAmount(concert: ConcertRecord): number {
    return this.servicePayments
      .filter(p => p.eventId === concert.id)
      .reduce((sum, p) => sum + Number(p.receivedAmount || 0), 0);
  }

  private concertAllocatedMonthlyCredit(concert: ConcertRecord): number {
    if (this.concertPaymentCadence(concert) !== 'mensile') return 0;
    if (concert.executionStatus !== 'effettuato') return 0;
    const key = this.bandKeyForConcert(concert);
    const alloc = this.monthlyCreditAllocationsByBandKey.get(key) || {};
    return Number(alloc[concert.id] || 0);
  }

  private concertEffectivePaidAmount(concert: ConcertRecord): number {
    return this.round2(this.concertDirectPaidAmount(concert) + this.concertAllocatedMonthlyCredit(concert));
  }

  private rebuildMonthlyCreditAllocations(): void {
    this.monthlyCreditAllocationsByBandKey.clear();
    this.monthlyCreditRemainingByBandKey.clear();
    const creditsByBand = new Map<string, number>();
    for (const entry of this.bandCredits) {
      const key = `${entry.bandKey || ''}`.trim();
      if (!key) continue;
      creditsByBand.set(key, (creditsByBand.get(key) || 0) + Number(entry.amount || 0));
    }

    const byBandConcerts = new Map<string, ConcertRecord[]>();
    for (const concert of this.concerts) {
      if (this.concertPaymentCadence(concert) !== 'mensile') continue;
      const key = this.bandKeyForConcert(concert);
      const list = byBandConcerts.get(key) || [];
      list.push(concert);
      byBandConcerts.set(key, list);
    }

    for (const [bandKey, concerts] of byBandConcerts.entries()) {
      let remaining = Math.max(0, Number(creditsByBand.get(bandKey) || 0));
      const allocations: Record<string, number> = {};
      const executed = concerts
        .filter(c => c.executionStatus === 'effettuato')
        .sort((a, b) => this.compareConcertDateAsc(a, b) || a.createdAt.localeCompare(b.createdAt));

      for (const concert of executed) {
        const due = this.concertDueAmount(concert);
        const directPaid = this.concertDirectPaidAmount(concert);
        const missing = Math.max(0, due - directPaid);
        if (missing <= 0) continue;
        const alloc = Math.min(remaining, missing);
        if (alloc > 0) {
          allocations[concert.id] = this.round2(alloc);
          remaining = this.round2(remaining - alloc);
        }
        if (remaining <= 0) break;
      }

      this.monthlyCreditAllocationsByBandKey.set(bandKey, allocations);
      this.monthlyCreditRemainingByBandKey.set(bandKey, remaining);
    }
  }

  private readBandCredits(): BandCreditEntry[] {
    const raw = JSON.parse(localStorage.getItem('mm_band_credits') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): BandCreditEntry => ({
      id: `${x?.id || crypto.randomUUID()}`,
      bandKey: `${x?.bandKey || ''}`,
      bandName: `${x?.bandName || ''}`,
      kind: x?.kind === 'bonifico' ? 'bonifico' : 'acconto',
      amount: Number(x?.amount || 0),
      createdAt: `${x?.createdAt || new Date().toISOString()}`
    }));
  }

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private extractContactName(notes: string): string {
    const match = `${notes || ''}`.match(/\[Rubrica:([^\]]+)\]/i);
    return `${match?.[1] || ''}`.trim();
  }

  private readContacts(): ContactEntry[] {
    const parsed = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x: any): ContactEntry => ({
        id: `${x.id || ''}`,
        type: x.type === 'school' || x.type === 'student' ? x.type : 'band',
        displayName: `${x.displayName || ''}`.trim(),
        priority: Number(x.priority || 3),
        averageFee: Number(x.averageFee || 0),
        billingMode: x.billingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura',
        paymentCadence: x.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
        monthlySettlement: x.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
      }))
      .filter(c => !!c.id && !!c.displayName);
  }
}
