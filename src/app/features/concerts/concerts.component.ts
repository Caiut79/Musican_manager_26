import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormArray, FormBuilder, Validators } from '@angular/forms';
import { EventDetail } from '../../models/event-detail';
import { SupabaseService } from '../../core/supabase.service';
import { ActivatedRoute, Router } from '@angular/router';

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

type ConcertAddressSuggestion = {
  label: string;
  score: number;
};

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
  filterBand = '';
  filterDateFrom = '';
  filterDateTo = '';
  filterPaymentCadence: 'all' | 'prestazione' | 'mensile' = 'all';
  filterPaymentState: 'all' | 'da_pagare' | 'parziale' | 'pagato' = 'all';
  filterExecutionStatus: 'all' | 'da_fare' | 'effettuato' | 'annullato' | 'rimborsato' = 'all';
  servicePayments: ServicePayment[] = [];
  expandedConcertId: string | null = null;
  focusedConcertId: string | null = null;
  inpsExemptProfile = false;
  addressSuggestions: string[] = [];
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

  ngOnInit(): void {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.inpsExemptProfile = profile?.inpsExempt === true;
    this.concerts = this.readConcerts();
    this.servicePayments = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
    this.contacts = this.readContacts();
    this.concerts = this.mergeConcertsFromAgenda(this.concerts);
    this.persistConcerts();
    this.applyRouteContext();
    this.applyExpenseReturnContext();
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
      band: record.musicians.map(name => ({ name })),
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

  get filteredConcerts(): ConcertRecord[] {
    return this.concerts
      .filter(concert => {
        if (this.filterBand) {
          const band = this.concertBandLabel(concert).toLowerCase();
          if (!band.includes(this.filterBand.toLowerCase())) return false;
        }
        if (this.filterDateFrom && concert.date < this.filterDateFrom) return false;
        if (this.filterDateTo && concert.date > this.filterDateTo) return false;
        if (this.filterPaymentCadence !== 'all' && concert.paymentCadence !== this.filterPaymentCadence) return false;
        if (this.filterExecutionStatus !== 'all' && concert.executionStatus !== this.filterExecutionStatus) return false;
        const state = this.concertPaymentState(concert);
        if (this.filterPaymentState !== 'all' && state !== this.filterPaymentState) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  get availableBandFilters(): string[] {
    const unique = new Set<string>();
    this.concerts.forEach(c => unique.add(this.concertBandLabel(c)));
    return [...unique].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  concertBandLabel(concert: ConcertRecord): string {
    const byContact = this.contactName(concert.contactId);
    if (byContact) return byContact;
    if (concert.bands.length) return concert.bands.join(', ');
    if (concert.venue) return concert.venue;
    return 'Band non definita';
  }

  concertPaidAmount(concert: ConcertRecord): number {
    return this.servicePayments
      .filter(p => p.eventId === concert.id)
      .reduce((sum, p) => sum + Number(p.receivedAmount || 0), 0);
  }

  concertDueAmount(concert: ConcertRecord): number {
    if (concert.executionStatus === 'rimborsato' && Number(concert.reimbursedAmount || 0) > 0) {
      return Number(concert.reimbursedAmount || 0);
    }
    return Number(concert.agreedFee || 0) + Number(concert.reimbursement || 0);
  }

  concertPaymentState(concert: ConcertRecord): 'da_pagare' | 'parziale' | 'pagato' {
    const due = this.concertDueAmount(concert);
    const paid = this.concertPaidAmount(concert);
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

  goToAccountingForConcert(concert: ConcertRecord, monthlyAction: 'acconto' | 'bonifico' | '' = ''): void {
    this.router.navigate(['/accounting'], {
      queryParams: {
        eventId: concert.id,
        band: this.concertBandLabel(concert),
        paymentCadence: concert.paymentCadence,
        monthlySettlement: concert.monthlySettlement,
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
    if (status === 'effettuato' && concert.paymentCadence === 'prestazione' && this.concertPaymentState(concert) !== 'pagato') {
      const shouldRegister = window.confirm('Concerto effettuato con pagamento a serata. Vuoi registrare subito il saldo in Contabilità?');
      if (shouldRegister) {
        this.goToAccountingForConcert(concert);
      }
    }
  }

  toggleConcertExpanded(concertId: string): void {
    this.expandedConcertId = this.expandedConcertId === concertId ? null : concertId;
  }

  openExemptionModule(concert: ConcertRecord): void {
    window.open(`${window.location.origin}/confirm/${concert.id}`, '_blank');
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
    this.concerts = [...this.concerts].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    localStorage.setItem('mm_concerts', JSON.stringify(this.concerts));
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
    const address = row?.address || {};
    const place = `${address.city || address.town || address.village || address.municipality || address.hamlet || row?.name || ''}`.trim();
    const province = `${address.county || ''}`.replace(/^Città metropolitana di\s+/i, '').trim();
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

  private normalizeAddress(value: string): string {
    return `${value || ''}`.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private addressTypeScore(addresstype: string): number {
    if (['city', 'town', 'village', 'municipality', 'hamlet', 'locality'].includes(addresstype)) return 60;
    if (['county', 'province', 'state_district', 'state'].includes(addresstype)) return 45;
    if (['suburb', 'neighbourhood', 'quarter'].includes(addresstype)) return 35;
    if (['road', 'house', 'residential'].includes(addresstype)) return 25;
    return 20;
  }

  private readConcerts(): ConcertRecord[] {
    const parsed = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x: any): ConcertRecord => ({
      id: `${x.id || crypto.randomUUID()}`,
      title: `${x.title || 'Concerto'}`.trim(),
      date: `${x.date || ''}`,
      timeStart: `${x.timeStart || ''}`,
      venue: `${x.venue || ''}`.trim(),
      address: `${x.address || ''}`.trim(),
      lineupType: `${x.lineupType || 'band'}`,
      agreedFee: Number(x.agreedFee || 0),
      reimbursement: Number(x.reimbursement || 0),
      notes: `${x.notes || ''}`.trim(),
      bands: Array.isArray(x.bands) ? x.bands.map((b: any) => `${b || ''}`.trim()).filter(Boolean) : [],
      musicians: Array.isArray(x.musicians) ? x.musicians.map((m: any) => `${m || ''}`.trim()).filter(Boolean) : [],
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
          date: event.date || existing.date,
          timeStart: event.timeStart || existing.timeStart,
          venue: event.venue || existing.venue,
          address: event.address || existing.address,
          executionStatus: keepRefund ? 'rimborsato' : agendaStatus
        });
        return;
      }
      const paymentCadence = `${event.notes || ''}`.toLowerCase().includes('pagamento mensile') ? 'mensile' : 'prestazione';
      const monthlySettlement = `${event.notes || ''}`.toLowerCase().includes('bonifico') ? 'bonifico' : 'acconto';
      const extraExpensesOutsideInvoice = `${event.notes || ''}`.toLowerCase().includes('[spese extra:in_fattura]') ? false : true;
      const contactName = this.extractContactName(event.notes || '');
      const contact = this.contacts.find(c => c.displayName.toLowerCase() === contactName.toLowerCase());
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
        bands: [],
        musicians: (event.band || []).map(x => `${x.name || ''}`.trim()).filter(Boolean),
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
