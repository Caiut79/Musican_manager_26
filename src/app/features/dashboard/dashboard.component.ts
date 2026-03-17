import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EventDetail } from '../../models/event-detail';
import { AppNotification } from '../../models/notification';
import { SupabaseService } from '../../core/supabase.service';

type CalendarCell = {
  date: string;
  day: number;
  currentMonth: boolean;
  events: EventDetail[];
};

type QuickCreateKind = 'concert' | 'lesson';

type QuickCreateDraft = {
  kind: QuickCreateKind;
  title: string;
  contactId: string;
  timeStart: string;
  timeEnd: string;
  venue: string;
  address: string;
  grossFee: number;
  netFee: number;
  notes: string;
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
  notes: string;
  createdAt: string;
};

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  musicianName = '';
  todayEvents: EventDetail[] = [];
  upcomingEvents: EventDetail[] = [];
  allEvents: EventDetail[] = [];
  calendarView: 'table' | 'agenda' = 'table';
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  calendarWeeks: CalendarCell[][] = [];
  selectedDate: string | null = null;
  quickCreateDone = false;
  quickCreateLabel = '';
  quickCreateError = '';
  draft: QuickCreateDraft = this.createDefaultDraft('concert');
  contacts: ContactEntry[] = [];
  showNewContactInline = false;
  newContactDraft = {
    type: 'band' as 'band' | 'school' | 'student',
    displayName: '',
    priority: 3,
    averageFee: 0,
    billingMode: 'fuori_fattura' as 'in_fattura' | 'fuori_fattura',
    paymentCadence: 'prestazione' as 'prestazione' | 'mensile',
    monthlySettlement: 'acconto' as 'acconto' | 'bonifico'
  };
  notifications: AppNotification[] = [];
  unreadCount = 0;
  today = this.toLocalIsoDate(new Date());
  isTeacherProfile = false;
  addressSuggestions: string[] = [];
  addressFocused = false;
  private refundedConcertIds = new Set<string>();
  private addressTimer: ReturnType<typeof setTimeout> | null = null;
  private addressAborter: AbortController | null = null;

  dayHeaders = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  private baseQuickLinks = [
    { label: 'Nuovo Concerto', icon: 'ti-music',      route: '/concerts',  sub: 'Aggiungi serata' },
    { label: 'Nuova Lezione',  icon: 'ti-school',     route: '/teaching',  sub: 'Agenda lezioni' },
    { label: 'Calcola Spese',  icon: 'ti-map-pin',    route: '/expenses',  sub: 'Rimborsi km' },
    { label: 'Report',         icon: 'ti-chart-bar',  route: '/reports',   sub: 'Statistiche' },
    { label: 'Rubrica',        icon: 'ti-address-book', route: '/contacts', sub: 'Band e singoli' },
    { label: 'Archivio',       icon: 'ti-archive',    route: '/archive',   sub: 'Documenti' }
  ];

  constructor(private router: Router, private supabase: SupabaseService) {}

  ngOnInit() {
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName  = localStorage.getItem('mm_lastName') || '';
    this.musicianName = [firstName, lastName].filter(Boolean).join(' ');
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.isTeacherProfile = profile?.isTeacher === true;

    const storedEvents: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const cleanedEvents = this.cleanupDashboardDraftEvents(storedEvents);
    this.allEvents = [...cleanedEvents].sort((a, b) => a.date.localeCompare(b.date));
    const now = this.today;
    this.todayEvents    = cleanedEvents.filter(e => e.date === now);
    this.upcomingEvents = cleanedEvents
      .filter(e => e.date > now)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
    this.buildCalendar();
    this.refreshRefundedConcertIds();
    this.contacts = this.readContacts();

    const storedNotifications: AppNotification[] = JSON.parse(localStorage.getItem('mm_notifications') || '[]');
    this.notifications = storedNotifications.slice(0, 5);
    this.unreadCount   = storedNotifications.filter(n => !n.read).length;
    this.applyExpenseReturnContext();
  }

  ngOnDestroy(): void {
    if (this.addressTimer) clearTimeout(this.addressTimer);
    this.addressAborter?.abort();
  }

  get quickLinks() {
    if (this.isTeacherProfile) return this.baseQuickLinks;
    return this.baseQuickLinks.filter(link => link.route !== '/teaching');
  }

  markAllRead() {
    const all: AppNotification[] = JSON.parse(localStorage.getItem('mm_notifications') || '[]');
    all.forEach(n => n.read = true);
    localStorage.setItem('mm_notifications', JSON.stringify(all));
    this.notifications.forEach(n => n.read = true);
    this.unreadCount = 0;
  }

  go(route: string) { this.router.navigate([route]); }

  openUnpaidAlert(alert: { id: string; type: string }): void {
    if (alert.type === 'concert') {
      this.router.navigate(['/concerts'], { queryParams: { eventId: alert.id, source: 'dashboard' } });
      return;
    }
    this.router.navigate(['/accounting'], { queryParams: { eventId: alert.id, source: 'dashboard' } });
  }

  openCreatePicker(cell: CalendarCell): void {
    if (!cell.currentMonth) return;
    this.selectedDate = cell.date;
    this.quickCreateDone = false;
    this.quickCreateLabel = '';
    this.quickCreateError = '';
    this.draft = this.createDefaultDraft('concert');
  }

  closeCreatePicker(): void {
    this.selectedDate = null;
  }

  chooseCreate(kind: QuickCreateKind): void {
    this.quickCreateDone = false;
    this.quickCreateLabel = '';
    this.quickCreateError = '';
    this.draft = this.createDefaultDraft(kind);
  }

  get contactsByPriority(): ContactEntry[] {
    return [...this.contacts].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  onContactChange(): void {
    const selected = this.contacts.find(x => x.id === this.draft.contactId);
    if (!selected) return;
    if (!this.draft.venue) this.draft.venue = selected.displayName;
    if (!this.draft.notes) this.draft.notes = selected.notes || '';
    if (!this.draft.grossFee && selected.averageFee > 0) this.draft.grossFee = selected.averageFee;
    if (!this.draft.netFee && selected.averageFee > 0) this.draft.netFee = selected.averageFee;
  }

  onDraftAddressInput(rawValue: string): void {
    const value = `${rawValue || ''}`.trim();
    if (this.addressTimer) clearTimeout(this.addressTimer);
    if (value.length < 2) {
      this.addressSuggestions = [];
      return;
    }
    this.addressTimer = setTimeout(() => {
      void this.fetchDraftAddressSuggestions(value);
    }, 220);
  }

  onDraftAddressFocus(): void {
    this.addressFocused = true;
    const value = `${this.draft.address || ''}`.trim();
    if (value.length >= 2) this.onDraftAddressInput(value);
  }

  onDraftAddressBlur(): void {
    setTimeout(() => {
      this.addressFocused = false;
      this.addressSuggestions = [];
    }, 160);
  }

  selectDraftAddressSuggestion(value: string): void {
    this.draft.address = value;
    this.addressFocused = false;
    this.addressSuggestions = [];
  }

  launchExpenseCalculatorFromDraft(): void {
    const destination = `${this.draft.address || this.draft.venue || ''}`.trim();
    if (!destination) {
      this.quickCreateError = 'Inserisci prima almeno indirizzo o venue';
      return;
    }
    if (!this.selectedDate) {
      this.quickCreateError = 'Seleziona prima il giorno evento nel calendario';
      return;
    }
    localStorage.setItem('mm_dashboard_expense_context', JSON.stringify({
      from: 'dashboard',
      selectedDate: this.selectedDate,
      draft: this.draft,
      createdAt: new Date().toISOString()
    }));
    this.router.navigate(['/expenses'], { queryParams: { fromDashboard: '1' } });
  }

  toggleInlineContact(): void {
    this.showNewContactInline = !this.showNewContactInline;
  }

  saveInlineContact(): void {
    const name = `${this.newContactDraft.displayName || ''}`.trim();
    if (!name) {
      this.quickCreateError = 'Inserisci nome contatto rubrica';
      return;
    }
    const all = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const created = {
      id: crypto.randomUUID(),
      type: this.newContactDraft.type,
      displayName: name,
      positionCity: '',
      positionAddress: '',
      phone: '',
      email: '',
      priority: Math.max(1, Math.min(5, Number(this.newContactDraft.priority || 3))),
      averageFee: Number(this.newContactDraft.averageFee || 0),
      billingMode: this.newContactDraft.billingMode,
      paymentCadence: this.newContactDraft.paymentCadence,
      monthlySettlement: this.newContactDraft.monthlySettlement,
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
    this.draft.contactId = created.id;
    this.onContactChange();
    this.showNewContactInline = false;
    this.newContactDraft = {
      type: 'band',
      displayName: '',
      priority: 3,
      averageFee: 0,
      billingMode: 'fuori_fattura',
      paymentCadence: 'prestazione',
      monthlySettlement: 'acconto'
    };
    this.quickCreateError = '';
  }

  saveQuickCreate(): void {
    if (!this.selectedDate) return;
    const title = `${this.draft.title || ''}`.trim();
    if (!title) {
      this.quickCreateError = 'Inserisci un titolo';
      return;
    }
    if (!this.draft.timeStart) {
      this.quickCreateError = 'Inserisci ora inizio';
      return;
    }
    const now = new Date().toISOString();
    const isLesson = this.draft.kind === 'lesson';
    const billing = this.resolveBillingForDraft(this.draft.kind);
    const event: EventDetail = {
      id: crypto.randomUUID(),
      title,
      date: this.selectedDate,
      timeStart: this.draft.timeStart,
      timeEnd: this.draft.timeEnd || undefined,
      venue: this.draft.venue,
      address: this.draft.address,
      type: isLesson ? 'lesson' : 'concert',
      band: [],
      grossFee: Number(this.draft.grossFee || 0),
      netFee: Number(this.draft.netFee || 0),
      compensoType: billing.compensoType,
      notes: this.draft.notes || '',
      status: 'pending',
      createdAt: now
    };
    const selected = this.contacts.find(x => x.id === this.draft.contactId);
    if (selected) {
      const stamp = `[Rubrica: ${selected.displayName} | Priorità ${selected.priority} | Medio €${selected.averageFee}]`;
      event.notes = `${event.notes ? `${event.notes} • ` : ''}${stamp}`;
      const paymentStamp = selected.paymentCadence === 'mensile'
        ? `Pagamento: mensile (${selected.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconti'})`
        : 'Pagamento: a prestazione (saldo immediato)';
      event.notes = `${event.notes ? `${event.notes} • ` : ''}${paymentStamp}`;
    }
    if (billing.note) {
      event.notes = `${event.notes ? `${event.notes} • ` : ''}${billing.note}`;
    }
    const all: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    all.push(event);
    localStorage.setItem('mm_events', JSON.stringify(all));
    void this.syncSupabaseEvents();
    this.refreshEventCollections(all);
    this.buildCalendar();
    this.quickCreateDone = true;
    this.quickCreateLabel = isLesson ? 'Lezione inserita' : 'Concerto inserito';
    this.quickCreateError = '';
    setTimeout(() => {
      this.closeCreatePicker();
    }, 900);
  }

  eventsForSelectedDate(): EventDetail[] {
    if (!this.selectedDate) return [];
    return this.allEvents.filter(e => e.date === this.selectedDate);
  }

  deleteEventFromDashboard(eventId: string): void {
    const all = JSON.parse(localStorage.getItem('mm_events') || '[]') as EventDetail[];
    const filtered = all.filter(e => e.id !== eventId);
    localStorage.setItem('mm_events', JSON.stringify(filtered));
    void this.syncSupabaseEvents();
    this.refreshEventCollections(filtered);
    this.buildCalendar();
  }

  goToday(): void {
    this.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    this.buildCalendar();
  }

  chipClasses(event: EventDetail): string[] {
    if (this.refundedConcertIds.has(event.id)) return ['chip-refunded'];
    if (event.status === 'cancelled') return ['chip-cancelled'];
    if (this.isEventCompleted(event)) return ['chip-done'];
    return ['chip-todo'];
  }

  private isEventCompleted(event: EventDetail): boolean {
    if (event.status === 'cancelled') return false;
    if (event.status === 'confirmed' && event.date < this.today) return true;
    return event.date < this.today;
  }

  private refreshRefundedConcertIds(): void {
    const raw = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    const refunded = Array.isArray(raw) ? raw.filter((c: any) => c?.executionStatus === 'rimborsato') : [];
    this.refundedConcertIds = new Set(refunded.map((c: any) => `${c?.id || ''}`).filter(Boolean));
  }

  eventGroupLabel(event: EventDetail): string {
    if (event.type !== 'concert') return '';
    const venue = `${event.venue || ''}`.trim();
    if (venue) return venue;
    const names = Array.isArray(event.band) ? event.band.map(x => `${x?.name || ''}`.trim()).filter(Boolean) : [];
    if (!names.length) return '';
    return names[0];
  }

  notifIconClass(type: string): string {
    const map: Record<string, string> = {
      booking_request: 'ni-orange', booking_accepted: 'ni-green',
      booking_rejected: 'ni-red', event_reminder: 'ni-blue', info: 'ni-gray'
    };
    return map[type] || 'ni-gray';
  }

  get monthLabel(): string {
    return this.calendarMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  }

  get agendaEvents(): EventDetail[] {
    const m = this.calendarMonth.getMonth();
    const y = this.calendarMonth.getFullYear();
    return this.allEvents.filter(e => {
      const d = new Date(`${e.date}T00:00:00`);
      return d.getMonth() === m && d.getFullYear() === y;
    });
  }

  prevMonth(): void {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() - 1, 1);
    this.buildCalendar();
  }

  nextMonth(): void {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 1);
    this.buildCalendar();
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('it-IT', {
      weekday: 'short', day: 'numeric', month: 'short'
    });
  }

  formatDayLabel(dateStr: string): string {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  eventTypeLabel(type: string): string {
    const map: Record<string, string> = {
      concert: 'Concerto', lesson: 'Lezione',
      rehearsal: 'Prova', other: 'Altro'
    };
    return map[type] || type;
  }

  private buildCalendar(): void {
    const y = this.calendarMonth.getFullYear();
    const m = this.calendarMonth.getMonth();
    const first = new Date(y, m, 1);
    const startDay = first.getDay(); // Sunday=0 first column
    const firstCellDate = new Date(y, m, 1 - startDay);
    const weeks: CalendarCell[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: CalendarCell[] = [];
      for (let d = 0; d < 7; d++) {
        const cur = new Date(firstCellDate.getFullYear(), firstCellDate.getMonth(), firstCellDate.getDate() + (w * 7 + d));
        const iso = this.toLocalIsoDate(cur);
        row.push({
          date: iso,
          day: cur.getDate(),
          currentMonth: cur.getMonth() === m,
          events: this.allEvents.filter(e => e.date === iso)
        });
      }
      weeks.push(row);
    }
    // Remove trailing all-out-of-month rows
    while (weeks.length > 1 && weeks[weeks.length - 1].every(c => !c.currentMonth)) {
      weeks.pop();
    }
    this.calendarWeeks = weeks;
  }

  private refreshEventCollections(storedEvents: EventDetail[]): void {
    this.refreshRefundedConcertIds();
    const sorted = [...storedEvents].sort((a, b) => a.date.localeCompare(b.date));
    this.allEvents = sorted;
    this.todayEvents = sorted.filter(e => e.date === this.today);
    this.upcomingEvents = sorted
      .filter(e => e.date > this.today)
      .slice(0, 5);
  }

  private createDefaultDraft(kind: QuickCreateKind): QuickCreateDraft {
    return {
      kind,
      title: kind === 'lesson' ? 'Lezione' : 'Concerto',
      contactId: '',
      timeStart: kind === 'lesson' ? '16:00' : '21:00',
      timeEnd: '',
      venue: '',
      address: '',
      grossFee: 0,
      netFee: 0,
      notes: ''
    };
  }

  private resolveBillingForDraft(kind: QuickCreateKind): { compensoType: 'fuori_fattura' | 'in_fattura'; note: string } {
    const snapshot = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const lessonMode = snapshot.lessonBillingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura';
    const musicMode = snapshot.musicBillingMode === 'in_fattura' ? 'in_fattura' : 'fuori_fattura';
    const workerType = `${snapshot.workerType || ''}`;
    if (kind === 'lesson') {
      return {
        compensoType: lessonMode,
        note: lessonMode === 'in_fattura' ? 'Fatturazione lezioni: in fattura' : 'Fatturazione lezioni: fuori fattura'
      };
    }
    const mixed = workerType === 'misto_piva_lezioni_cooperativa_musica';
    const note = mixed
      ? 'Fatturazione musica: cooperativa'
      : (musicMode === 'in_fattura' ? 'Fatturazione musica: in fattura' : 'Fatturazione musica: fuori fattura');
    return { compensoType: musicMode, note };
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
        notes: `${x.notes || ''}`.trim(),
        paymentCadence: x.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
        monthlySettlement: x.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
        createdAt: `${x.createdAt || ''}`
      }))
      .filter(x => !!x.id && !!x.displayName);
  }

  // ─── Payment alerts ────────────────────────────────────────────────────────
  /** Events in the last 7 days + next 3 days with no payment recorded */
  get unpaidAlerts(): { id: string; title: string; date: string; type: string; counterpart: string }[] {
    const payments: { eventId: string }[] = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
    const paidIds = new Set(payments.map(p => p.eventId));
    const past7  = new Date(); past7.setDate(past7.getDate() - 7);
    const next3  = new Date(); next3.setDate(next3.getDate() + 3);
    const from = this.toLocalIsoDate(past7);
    const to   = this.toLocalIsoDate(next3);
    return this.allEvents
      .filter(e => (e.type === 'concert' || e.type === 'lesson'))
      .filter(e => e.date >= from && e.date <= this.today)
      .filter(e => !paidIds.has(e.id))
      .map(e => ({
        id: e.id,
        title: e.title,
        date: e.date,
        type: e.type,
        counterpart: this.eventCounterpartLabel(e)
      }));
  }

  /** Events that have only acconto payments (saldo still pending) */
  get pendingBalanceAlerts(): { id: string; title: string; date: string; acconto: number; agreed: number; counterpart: string }[] {
    const payments: { eventId: string; paymentType: string; receivedAmount: number }[] =
      JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
    const byEvent: Record<string, typeof payments> = {};
    for (const p of payments) {
      if (!byEvent[p.eventId]) byEvent[p.eventId] = [];
      byEvent[p.eventId].push(p);
    }
    const results: { id: string; title: string; date: string; acconto: number; agreed: number; counterpart: string }[] = [];
    for (const [eventId, evPayments] of Object.entries(byEvent)) {
      const onlyAcconto = evPayments.every(p => p.paymentType === 'acconto');
      const event = this.allEvents.find(e => e.id === eventId);
      if (onlyAcconto && event) {
        if (event.date > this.today) continue;
        const acconto = evPayments.reduce((s, p) => s + p.receivedAmount, 0);
        results.push({
          id: event.id,
          title: event.title,
          date: event.date,
          acconto,
          agreed: event.grossFee,
          counterpart: this.eventCounterpartLabel(event)
        });
      }
    }
    return results;
  }

  private applyExpenseReturnContext(): void {
    const contextRaw = localStorage.getItem('mm_dashboard_expense_context');
    if (!contextRaw) return;
    const resultRaw = localStorage.getItem('mm_dashboard_expense_result');
    const context = JSON.parse(contextRaw || '{}');
    const draft = context?.draft || {};
    this.selectedDate = `${context?.selectedDate || this.today}`;
    this.quickCreateError = '';
    this.quickCreateDone = false;
    this.quickCreateLabel = '';
    this.draft = {
      kind: draft.kind === 'lesson' ? 'lesson' : 'concert',
      title: `${draft.title || (draft.kind === 'lesson' ? 'Lezione' : 'Concerto')}`,
      contactId: `${draft.contactId || ''}`,
      timeStart: `${draft.timeStart || (draft.kind === 'lesson' ? '16:00' : '21:00')}`,
      timeEnd: `${draft.timeEnd || ''}`,
      venue: `${draft.venue || ''}`,
      address: `${draft.address || ''}`,
      grossFee: Number(draft.grossFee || 0),
      netFee: Number(draft.netFee || 0),
      notes: `${draft.notes || ''}`
    };
    if (resultRaw) {
      const result = JSON.parse(resultRaw || '{}');
      const totalExpense = Number(result?.totalExpense || 0);
      if (Number.isFinite(totalExpense) && totalExpense > 0) {
        const gross = Number(this.draft.grossFee || 0);
        const currentNet = Number(this.draft.netFee || gross);
        this.draft.netFee = +(currentNet + totalExpense).toFixed(2);
        const currentNotes = `${this.draft.notes || ''}`.replace(/\s*\[Spese viaggio:[^\]]+\]/gi, '').trim();
        const routeText = `${result?.origin || ''} → ${result?.destination || ''}`.trim();
        const noteAddon = `[Spese viaggio: ${totalExpense.toFixed(2)}€${routeText ? ` • ${routeText}` : ''}]`;
        this.draft.notes = `${currentNotes}${currentNotes ? ' ' : ''}${noteAddon}`.trim();
      }
    }
    localStorage.removeItem('mm_dashboard_expense_context');
    localStorage.removeItem('mm_dashboard_expense_result');
  }

  private eventCounterpartLabel(event: EventDetail): string {
    const venue = `${event.venue || ''}`.trim();
    if (venue) return venue;
    const firstBand = `${event.band?.[0]?.name || ''}`.trim();
    if (firstBand) return firstBand;
    return event.type === 'lesson' ? 'allievo da definire' : 'destinazione da definire';
  }

  private async fetchDraftAddressSuggestions(query: string): Promise<void> {
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
      const current = `${this.draft.address || ''}`.trim();
      if (this.normalizeAddress(current) !== this.normalizeAddress(query)) return;
      this.addressSuggestions = this.rankAddressRows(rows, query).slice(0, 7).map(x => x.label);
    } catch (error: any) {
      if (error?.name !== 'AbortError') this.addressSuggestions = [];
    }
  }

  private rankAddressRows(rows: any[], query: string): Array<{ label: string; score: number }> {
    const normalizedQuery = this.normalizeAddress(query);
    const seen = new Set<string>();
    const ranked: Array<{ label: string; score: number }> = [];
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

  private toLocalIsoDate(date: Date): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private cleanupDashboardDraftEvents(events: EventDetail[]): EventDetail[] {
    const filtered = events.filter(event => {
      const title = `${event.title || ''}`.trim().toLowerCase();
      const notes = `${event.notes || ''}`.toLowerCase();
      const isDashboardDraftTitle = title === 'nuovo concerto' || title === 'proposta concerto (bozza)';
      const isDraftNote = notes.includes('bozza creata da calendario dashboard') || notes.includes('bozza da dashboard');
      return !(isDashboardDraftTitle || isDraftNote);
    });
    if (filtered.length !== events.length) {
      localStorage.setItem('mm_events', JSON.stringify(filtered));
      void this.syncSupabaseEvents();
    }
    return filtered;
  }

  private async syncSupabaseEvents(): Promise<void> {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const musicianId = `${profile.id || ''}`.trim();
    if (!musicianId) return;
    try {
      await this.supabase.syncEventsFromLocalStorage(musicianId);
    } catch {}
  }
}
