import { Component, HostListener, OnInit } from '@angular/core';
import { provinceCodeFromAddressLabel, regionNameFromProvinceCode } from '../../core/italian-geo';

// ─── Types ────────────────────────────────────────────────────────────────────

type ConcertRecord = {
  id: string; date: string; agreedFee: number; reimbursement: number;
  title?: string; venue?: string; address?: string; bands?: string[];
  contactId?: string | null;
  paymentCadence?: 'prestazione' | 'mensile';
  monthlySettlement?: 'acconto' | 'bonifico';
};

type TeachingSession = {
  id: string; date: string; compensation: number;
  studentId?: string | null; schoolId?: string | null;
  paymentCadence?: 'prestazione' | 'mensile';
  monthlySettlement?: 'acconto' | 'bonifico';
};

type ExpenseRecord = {
  date: string; totalExpense: number;
  description?: string; from?: string; to?: string;
};

type ContactRecord  = { id: string; displayName: string; type: 'band' | 'school' | 'student' };
type StudentRecord  = { id: string; fullName: string };
type SchoolRecord   = { id: string; name: string };

type ServicePayment = {
  eventId: string;
  category: 'concerto' | 'lezione';
  receivedAmount: number;
  cooperativeManaged?: boolean;
  cooperativeNetAmount?: number;
  cooperativeSettlementState?: string;
  createdAt?: string;
  serviceDate?: string;
  paymentType?: string;   // acconto | saldo | unica | mensile
  paymentMethod?: string; // contanti | bonifico | assegno | pos | altro
  notes?: string;
};

type AggregateRow  = { label: string; count: number; total: number; average: number };
type Period        = { value: string; label: string };
type TrendPoint    = { ym: string; label: string; received: number; expenses: number; net: number };

type PaymentTimingRow = {
  concertId: string; concertDate: string; concertTitle: string;
  fee: number; received: number; pending: number; paymentCount: number;
  firstPaymentDate: string | null; daysToFirstPayment: number | null;
  lastPaymentDate: string | null; methods: string; types: string;
  isPaid: boolean; isPartial: boolean;
};

type PaymentBreakdownRow = { label: string; count: number; total: number; pct: number };

export type PopupType = 'band' | 'venue' | 'province' | 'region';

type PopupRow = {
  id: string; date: string; title: string; location: string;
  fee: number; received: number; pending: number;
};

type PopupData = {
  type: PopupType; title: string; subtitle: string;
  rows: PopupRow[];
  totalDue: number; totalReceived: number; totalPending: number; avgFee: number;
};

type SearchResultRow = {
  kind: 'concert' | 'payment' | 'expense';
  icon: string; title: string; subtitle: string; amount: number; date: string;
};

type BookingStatsPoint = { ym: string; label: string; views: number };

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.scss']
})
export class ReportsComponent implements OnInit {

  // ─── Navigation
  activeTab: 'overview' | 'payments' | 'territory' | 'search' = 'overview';

  // ─── Filters
  selectedPeriod = '';
  periods: Period[] = [];
  viewBasis: 'evento' | 'incasso' = 'evento';

  // ─── Raw data (kept on instance for popup / search)
  concerts:  ConcertRecord[]  = [];
  teaching:  TeachingSession[] = [];
  expenses:  ExpenseRecord[]   = [];
  payments:  ServicePayment[]  = [];
  contacts:  ContactRecord[]   = [];
  students:  StudentRecord[]   = [];
  schools:   SchoolRecord[]    = [];
  eventTypeById = new Map<string, 'concert' | 'dj_set' | 'lesson' | 'other'>();

  // ─── KPIs
  concertDue = 0; concertReceived = 0;
  teachingDue = 0; teachingReceived = 0;
  expenseTotal = 0; grossTotal = 0; netTotal = 0; cashNet = 0; pendingReceivables = 0;
  isTeacherProfile = false;

  // ─── Aggregates
  concertCompByGroup:  AggregateRow[] = [];
  lessonCompByStudent: AggregateRow[] = [];
  lessonCompBySchool:  AggregateRow[] = [];
  topVenues:           AggregateRow[] = [];
  eventByProvince:     AggregateRow[] = [];
  eventByRegion:       AggregateRow[] = [];
  totalConcertSessions = 0; totalLessonSessions = 0;
  maxGroupTotal = 0; maxVenueTotal = 0; maxProvinceTotal = 0;
  maxRegionTotal = 0; maxStudentTotal = 0; maxSchoolTotal = 0;

  // ─── Cadence / type
  cadenceRows: { label: string; count: number; due: number; received: number; pending: number }[] = [];
  typeRows:    { label: string; count: number; due: number; received: number }[] = [];

  // ─── Trend
  trend: TrendPoint[] = [];

  // ─── Payment analysis
  paymentMethodRows:   PaymentBreakdownRow[] = [];
  paymentTypeRows:     PaymentBreakdownRow[] = [];
  paymentTimingRows:   PaymentTimingRow[]    = [];
  timingFilterStatus: 'all' | 'paid' | 'partial' | 'unpaid' = 'all';

  // ─── Payment meta-stats
  totalPaymentCount      = 0;
  avgPaymentAmount       = 0;
  avgDaysToFirstPayment: number | null = null;
  paidConcertsPct        = 0;
  advancePaymentCount    = 0;

  // ─── Popup
  popup: PopupData | null = null;

  // ─── Search
  searchQuery  = '';
  searchFilter: 'all' | 'concert' | 'payment' | 'expense' = 'all';
  searchResults: SearchResultRow[] = [];

  // ─── Booking stats
  bookingStats:      BookingStatsPoint[] = [];
  totalBookingViews  = 0;
  maxBookingViews    = 1;

  // ─────────────────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.isTeacherProfile = profile?.isTeacher === true;
    this.eventTypeById    = this.buildEventTypeIndex();

    this.contacts = JSON.parse(localStorage.getItem('mm_contacts')           || '[]');
    this.students = JSON.parse(localStorage.getItem('mm_teaching_students')  || '[]');
    this.schools  = JSON.parse(localStorage.getItem('mm_teaching_schools')   || '[]');

    this.concerts = this.readConcerts();
    this.teaching = this.isTeacherProfile ? this.readTeachingSessions() : [];
    this.expenses = this.readExpenses();
    this.payments = this.normalizePayments(JSON.parse(localStorage.getItem('mm_service_payments') || '[]'));

    this.periods       = this.buildPeriods();
    this.selectedPeriod = this.periods[0]?.value || '';
    this.buildBookingStats();
    this.recompute();
  }

  onPeriodChanged(): void { this.recompute(); }

  // ─── Tab / filter helpers
  setTab(tab: ReportsComponent['activeTab']): void            { this.activeTab = tab; }
  setTimingFilter(f: ReportsComponent['timingFilterStatus']): void { this.timingFilterStatus = f; }

  get filteredTimingRows(): PaymentTimingRow[] {
    switch (this.timingFilterStatus) {
      case 'paid':    return this.paymentTimingRows.filter(r => r.isPaid);
      case 'partial': return this.paymentTimingRows.filter(r => r.isPartial);
      case 'unpaid':  return this.paymentTimingRows.filter(r => !r.isPaid && !r.isPartial);
      default:        return this.paymentTimingRows;
    }
  }

  get paidTimingCount():    number { return this.paymentTimingRows.filter(r => r.isPaid).length; }
  get partialTimingCount(): number { return this.paymentTimingRows.filter(r => r.isPartial).length; }
  get unpaidTimingCount():  number { return this.paymentTimingRows.filter(r => !r.isPaid && !r.isPartial).length; }

  // ─── Derived KPIs
  get totalEventsCount():   number { return this.totalConcertSessions + this.totalLessonSessions; }
  get totalReceived():      number { return this.round2(this.concertReceived + this.teachingReceived); }
  get collectionRatePct():  number { return this.safePct(this.totalReceived, this.grossTotal); }
  get expenseRatePct():     number { return this.safePct(this.expenseTotal, this.grossTotal); }
  get netRatePct():         number { return this.safePct(this.netTotal, this.grossTotal); }
  get averageDuePerEvent(): number {
    return this.totalEventsCount ? this.round2(this.grossTotal / this.totalEventsCount) : 0;
  }
  get averageNetPerEvent(): number {
    return this.totalEventsCount ? this.round2(this.netTotal / this.totalEventsCount) : 0;
  }

  // ─── Popup
  openPopup(type: PopupType, key: string): void {
    const concerts = this.filterByPeriod(this.concerts, x => x.date);
    const byId     = this.groupPaymentsByEventId();
    let rows: PopupRow[] = [];

    switch (type) {
      case 'band':
        rows = concerts
          .filter(c => this.resolveConcertGroups(c).includes(key))
          .map(c => this.toConcertPopupRow(c, byId));
        break;
      case 'venue':
        rows = concerts
          .filter(c => this.resolveConcertLocation(c) === key)
          .map(c => this.toConcertPopupRow(c, byId));
        break;
      case 'province':
        rows = concerts
          .filter(c => (provinceCodeFromAddressLabel(this.resolveConcertLocation(c)) || 'N/D') === key)
          .map(c => this.toConcertPopupRow(c, byId));
        break;
      case 'region':
        rows = concerts
          .filter(c => {
            const prov = provinceCodeFromAddressLabel(this.resolveConcertLocation(c)) || 'N/D';
            const reg  = prov !== 'N/D' ? (regionNameFromProvinceCode(prov) || 'N/D') : 'N/D';
            return reg === key;
          })
          .map(c => this.toConcertPopupRow(c, byId));
        break;
    }

    rows.sort((a, b) => b.date.localeCompare(a.date));
    const totalDue      = rows.reduce((s, r) => s + r.fee, 0);
    const totalReceived = rows.reduce((s, r) => s + r.received, 0);
    const subtitles: Record<PopupType, string> = {
      band: 'Gruppo / Band', venue: 'Location', province: 'Provincia', region: 'Regione'
    };

    this.popup = {
      type, title: key, subtitle: subtitles[type], rows,
      totalDue:      this.round2(totalDue),
      totalReceived: this.round2(totalReceived),
      totalPending:  this.round2(Math.max(0, totalDue - totalReceived)),
      avgFee:        rows.length ? this.round2(totalDue / rows.length) : 0
    };
  }

  closePopup(): void { this.popup = null; }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closePopup(); }

  // ─── Search
  onSearchChange(): void {
    const q = this.searchQuery.trim().toLowerCase();
    if (q.length < 2) { this.searchResults = []; return; }
    const results: SearchResultRow[] = [];

    if (this.searchFilter === 'all' || this.searchFilter === 'concert') {
      for (const c of this.concerts) {
        const h = [c.title, c.venue, c.address, ...(c.bands || [])].join(' ').toLowerCase();
        if (!h.includes(q)) continue;
        results.push({
          kind: 'concert', icon: '🎵',
          title:    c.title || c.venue || 'Serata',
          subtitle: `${this.formatDate(c.date)}${c.venue ? ' — ' + c.venue : ''}${c.address ? ' · ' + c.address : ''}`,
          amount:   Number(c.agreedFee || 0) + Number(c.reimbursement || 0),
          date:     c.date
        });
      }
    }

    if (this.searchFilter === 'all' || this.searchFilter === 'payment') {
      for (const p of this.payments) {
        const concert = this.concerts.find(c => c.id === p.eventId);
        const method  = this.formatMethodLabel(p.paymentMethod || '');
        const ptype   = this.formatTypeLabel(p.paymentType || '');
        const h       = [method, ptype, p.notes, concert?.title, concert?.venue].join(' ').toLowerCase();
        if (!h.includes(q)) continue;
        results.push({
          kind: 'payment', icon: '💶',
          title:    `${ptype || 'Pagamento'} — ${method}`,
          subtitle: concert
            ? `${concert.title || concert.venue || 'Serata'} del ${this.formatDate(concert.date)}`
            : `Evento ${p.eventId}`,
          amount: this.effectiveReceived(p),
          date:   p.createdAt || p.serviceDate || ''
        });
      }
    }

    if (this.searchFilter === 'all' || this.searchFilter === 'expense') {
      for (const e of this.expenses) {
        const h = [e.description, e.from, e.to].join(' ').toLowerCase();
        if (!h.includes(q)) continue;
        results.push({
          kind: 'expense', icon: '🚗',
          title:    e.description || `Spesa del ${this.formatDate(e.date)}`,
          subtitle: [e.from, e.to].filter(Boolean).join(' → ') || 'Spesa di viaggio',
          amount:   -e.totalExpense,
          date:     e.date
        });
      }
    }

    results.sort((a, b) => b.date.localeCompare(a.date));
    this.searchResults = results.slice(0, 60);
  }

  // ─── Display helpers
  trendMax(): number {
    return Math.max(1, ...this.trend.map(t => Math.max(t.received, t.expenses)));
  }

  barWidth(value: number, max: number): number {
    const v = Number(value || 0), m = Number(max || 0);
    if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return 0;
    return Math.max(0, Math.min(100, (v / m) * 100));
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return (y && m && d) ? `${d}/${m}/${y}` : dateStr;
  }

  formatDays(days: number | null): string {
    if (days === null) return '—';
    if (days < 0)  return `${Math.abs(days)}gg prima`;
    if (days === 0) return 'stesso gg';
    return `+${days}gg`;
  }

  formatMethodLabel(key: string): string {
    const MAP: Record<string, string> = {
      contanti: 'Contanti', bonifico: 'Bonifico',
      assegno: 'Assegno', pos: 'POS / Carta', altro: 'Altro'
    };
    return MAP[key] || key || 'N/D';
  }

  formatTypeLabel(key: string): string {
    const MAP: Record<string, string> = {
      acconto: 'Acconto', saldo: 'Saldo',
      unica: 'Soluzione unica', mensile: 'Rata mensile'
    };
    return MAP[key] || key || 'N/D';
  }

  // ─── Export / Print
  exportCsv(): void {
    const lines: string[] = [];
    const add = (cols: (string | number)[]) =>
      lines.push(cols.map(x => `"${`${x ?? ''}`.replaceAll('"', '""')}"`).join(','));

    add(['Report Musican Manager']);
    add(['Periodo', this.selectedPeriod || 'Tutto']);
    add(['Vista', this.viewBasis === 'incasso' ? 'Cassa' : 'Competenza']);
    add([]);
    add(['KPI']);
    add(['Serate pattuito', this.concertDue]);
    add(['Serate incassato', this.concertReceived]);
    add(['Lezioni pattuito', this.teachingDue]);
    add(['Lezioni incassato', this.teachingReceived]);
    add(['Spese', this.expenseTotal]);
    add(['Netto', this.netTotal]);
    add(['Saldo cassa', this.cashNet]);
    add(['Da incassare', this.pendingReceivables]);
    add([]);
    add(['Metodo di pagamento']); add(['Metodo', 'N', 'Totale', '%']);
    for (const r of this.paymentMethodRows) add([r.label, r.count, this.round2(r.total), this.round2(r.pct)]);
    add([]);
    add(['Tipo di pagamento']); add(['Tipo', 'N', 'Totale', '%']);
    for (const r of this.paymentTypeRows) add([r.label, r.count, this.round2(r.total), this.round2(r.pct)]);
    add([]);
    add(['Tempistica incasso']);
    add(['Data', 'Serata', 'Pattuito', 'Incassato', 'Residuo', 'N.pag', 'Giorni', 'Metodi', 'Stato']);
    for (const r of this.paymentTimingRows) {
      add([
        this.formatDate(r.concertDate), r.concertTitle,
        r.fee, r.received, r.pending, r.paymentCount,
        r.daysToFirstPayment ?? '', r.methods,
        r.isPaid ? 'Pagato' : r.isPartial ? 'Parziale' : 'Non pagato'
      ]);
    }
    add([]);
    add(['Per provincia']); add(['Provincia', 'Serate', 'Totale', 'Media']);
    for (const r of this.eventByProvince) add([r.label, r.count, this.round2(r.total), this.round2(r.average)]);
    add([]);
    add(['Per regione']); add(['Regione', 'Serate', 'Totale', 'Media']);
    for (const r of this.eventByRegion) add([r.label, r.count, this.round2(r.total), this.round2(r.average)]);
    add([]);
    add(['Per gruppo/band']); add(['Gruppo', 'Serate', 'Totale', 'Media']);
    for (const r of this.concertCompByGroup.slice(0, 30)) add([r.label, r.count, this.round2(r.total), this.round2(r.average)]);
    add([]);
    add(['Top location']); add(['Location', 'Serate', 'Totale']);
    for (const r of this.topVenues.slice(0, 30)) add([r.label, r.count, this.round2(r.total)]);

    if (this.isTeacherProfile) {
      add([]);
      add(['Top allievi']); add(['Allievo', 'Lezioni', 'Totale', 'Media']);
      for (const r of this.lessonCompByStudent.slice(0, 20)) add([r.label, r.count, this.round2(r.total), this.round2(r.average)]);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `report_${(this.selectedPeriod || 'tutto').replaceAll('/', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  print(): void { window.print(); }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────────

  private recompute(): void {
    const concerts = this.filterByPeriod(this.concerts, x => x.date);
    const teaching = this.filterByPeriod(this.teaching, x => x.date);
    const expenses = this.filterByPeriod(this.expenses, x => x.date);

    const concertIds = new Set(concerts.map(c => c.id));
    const lessonIds  = new Set(teaching.map(t => t.id));
    const byId       = this.groupPaymentsByEventId();

    const paidConcertsByEvent = this.sumPaymentsForIds(concertIds, byId);
    const paidLessonsByEvent  = this.sumPaymentsForIds(lessonIds, byId);
    const paidConcertsByCash  = this.sumPaymentsByCashPeriod('concerto');
    const paidLessonsByCash   = this.sumPaymentsByCashPeriod('lezione');

    const concertDue  = concerts.reduce((s, c) => s + Number(c.agreedFee || 0) + Number(c.reimbursement || 0), 0);
    const teachingDue = teaching.reduce((s, t) => s + Number(t.compensation || 0), 0);
    const expenseSum  = expenses.reduce((s, e) => s + Number(e.totalExpense || 0), 0);

    this.concertDue      = this.round2(concertDue);
    this.concertReceived = this.round2(this.viewBasis === 'incasso' ? paidConcertsByCash : paidConcertsByEvent);
    this.teachingDue     = this.round2(teachingDue);
    this.teachingReceived = this.round2(this.viewBasis === 'incasso' ? paidLessonsByCash : paidLessonsByEvent);
    this.expenseTotal    = this.round2(expenseSum);
    this.grossTotal      = this.round2(this.concertDue + this.teachingDue);
    this.netTotal        = this.round2(this.grossTotal - this.expenseTotal);
    this.cashNet         = this.round2((this.concertReceived + this.teachingReceived) - this.expenseTotal);
    this.pendingReceivables = this.round2(Math.max(0, (this.concertDue + this.teachingDue) - (paidConcertsByEvent + paidLessonsByEvent)));

    this.concertCompByGroup  = this.buildConcertAggregates(concerts);
    this.topVenues           = this.buildVenueAggregates(concerts);
    const territory          = this.buildTerritoryAggregates(concerts);
    this.eventByProvince     = territory.provinceRows;
    this.eventByRegion       = territory.regionRows;
    this.lessonCompByStudent = this.buildLessonByStudentAggregates(teaching);
    this.lessonCompBySchool  = this.buildLessonBySchoolAggregates(teaching);
    this.totalConcertSessions = concerts.length;
    this.totalLessonSessions  = teaching.length;

    this.cadenceRows = this.buildCadenceRows(concerts, teaching, byId);
    this.typeRows    = this.buildTypeRows(concerts, byId);
    this.trend       = this.buildTrendPoints();

    this.maxGroupTotal    = Math.max(0, ...this.concertCompByGroup.map(x => x.total));
    this.maxVenueTotal    = Math.max(0, ...this.topVenues.map(x => x.total));
    this.maxProvinceTotal = Math.max(0, ...this.eventByProvince.map(x => x.total));
    this.maxRegionTotal   = Math.max(0, ...this.eventByRegion.map(x => x.total));
    this.maxStudentTotal  = Math.max(0, ...this.lessonCompByStudent.map(x => x.total));
    this.maxSchoolTotal   = Math.max(0, ...this.lessonCompBySchool.map(x => x.total));

    const filteredPayments = this.filterPaymentsByPeriod();
    this.paymentMethodRows = this.buildPaymentBreakdown('paymentMethod', filteredPayments);
    this.paymentTypeRows   = this.buildPaymentBreakdown('paymentType', filteredPayments);
    this.paymentTimingRows = this.buildPaymentTimingRows(concerts, byId);
    this.computePaymentStats(filteredPayments);
  }

  private filterPaymentsByPeriod(): ServicePayment[] {
    if (!this.selectedPeriod) return this.payments;
    return this.payments.filter(p =>
      `${p.createdAt || p.serviceDate || ''}`.startsWith(this.selectedPeriod));
  }

  private computePaymentStats(payments: ServicePayment[]): void {
    this.totalPaymentCount = payments.length;
    const total = payments.reduce((s, p) => s + this.effectiveReceived(p), 0);
    this.avgPaymentAmount  = this.totalPaymentCount ? this.round2(total / this.totalPaymentCount) : 0;

    const withDays = this.paymentTimingRows.filter(r => r.daysToFirstPayment !== null);
    this.avgDaysToFirstPayment = withDays.length
      ? Math.round(withDays.reduce((s, r) => s + r.daysToFirstPayment!, 0) / withDays.length)
      : null;

    const paidCount        = this.paymentTimingRows.filter(r => r.isPaid).length;
    this.paidConcertsPct   = this.paymentTimingRows.length
      ? Math.round((paidCount / this.paymentTimingRows.length) * 100) : 0;
    this.advancePaymentCount = this.paymentTimingRows.filter(
      r => r.daysToFirstPayment !== null && r.daysToFirstPayment < 0).length;
  }

  private buildPaymentBreakdown(field: 'paymentMethod' | 'paymentType', payments: ServicePayment[]): PaymentBreakdownRow[] {
    const map   = new Map<string, { count: number; total: number }>();
    const grand = payments.reduce((s, p) => s + this.effectiveReceived(p), 0) || 1;

    for (const p of payments) {
      const raw = `${field === 'paymentMethod' ? (p.paymentMethod || '') : (p.paymentType || '')}`.trim();
      const key = raw || 'non_specificato';
      const cur = map.get(key) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += this.effectiveReceived(p);
      map.set(key, cur);
    }

    return [...map.entries()]
      .map(([key, v]) => ({
        label: field === 'paymentMethod' ? this.formatMethodLabel(key) : this.formatTypeLabel(key),
        count: v.count,
        total: this.round2(v.total),
        pct:   this.safePct(v.total, grand)
      }))
      .sort((a, b) => b.total - a.total);
  }

  private buildPaymentTimingRows(concerts: ConcertRecord[], byId: Map<string, ServicePayment[]>): PaymentTimingRow[] {
    const rows: PaymentTimingRow[] = [];

    for (const c of concerts) {
      const fee = Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      if (!fee) continue;

      const ps       = byId.get(c.id) || [];
      const received = ps.reduce((s, p) => s + this.effectiveReceived(p), 0);

      const sorted = ps
        .filter(p => p.createdAt || p.serviceDate)
        .map(p => p.createdAt || p.serviceDate || '')
        .sort();

      const concertMs = c.date ? new Date(c.date).getTime() : NaN;
      const calcDays  = (d: string): number | null => {
        if (!d || isNaN(concertMs)) return null;
        const ms = new Date(d).getTime();
        return isNaN(ms) ? null : Math.round((ms - concertMs) / 86400000);
      };

      const methodSet = new Set(ps.map(p => p.paymentMethod || '').filter(Boolean));
      const typeSet   = new Set(ps.map(p => p.paymentType   || '').filter(Boolean));
      const isPaid    = received >= fee * 0.99;
      const isPartial = !isPaid && received > 0;

      rows.push({
        concertId: c.id, concertDate: c.date,
        concertTitle: c.title || c.venue || 'Serata',
        fee:      this.round2(fee),
        received: this.round2(received),
        pending:  this.round2(Math.max(0, fee - received)),
        paymentCount:      ps.length,
        firstPaymentDate:  sorted[0] || null,
        daysToFirstPayment: calcDays(sorted[0] || ''),
        lastPaymentDate:   sorted[sorted.length - 1] || null,
        methods: [...methodSet].map(k => this.formatMethodLabel(k)).join(', ') || '—',
        types:   [...typeSet].map(k => this.formatTypeLabel(k)).join(', ')   || '—',
        isPaid, isPartial
      });
    }

    return rows.sort((a, b) => b.concertDate.localeCompare(a.concertDate));
  }

  private buildBookingStats(): void {
    const raw = JSON.parse(localStorage.getItem('mm_booking_link_views') || '[]');
    if (!Array.isArray(raw) || raw.length === 0) {
      this.bookingStats = []; this.totalBookingViews = 0; this.maxBookingViews = 1; return;
    }
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`);
    }
    this.bookingStats = months.map(ym => ({
      ym, label: this.formatMonth(ym),
      views: raw.filter((v: any) => `${v?.date || ''}`.startsWith(ym)).length
    }));
    this.totalBookingViews = raw.length;
    this.maxBookingViews   = Math.max(1, ...this.bookingStats.map(s => s.views));
  }

  private buildConcertAggregates(concerts: ConcertRecord[]): AggregateRow[] {
    const agg = new Map<string, { count: number; total: number }>();
    for (const c of concerts) {
      const fee    = Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      const groups = this.resolveConcertGroups(c);
      const quota  = groups.length ? fee / groups.length : fee;
      for (const g of groups) {
        const cur = agg.get(g) || { count: 0, total: 0 };
        cur.count += 1; cur.total += quota;
        agg.set(g, cur);
      }
    }
    return this.toAggregateRows(agg);
  }

  private resolveConcertGroups(c: ConcertRecord): string[] {
    const bands = (c.bands || []).map(x => `${x || ''}`.trim()).filter(Boolean);
    if (bands.length) return [...new Set(bands)];
    const contact = this.contacts.find(ct => ct.id === c.contactId && ct.type === 'band');
    if (contact?.displayName) return [contact.displayName];
    if (c.venue?.trim()) return [c.venue.trim()];
    if (c.title?.trim()) return [c.title.trim()];
    return ['Gruppo non definito'];
  }

  private resolveConcertLocation(c: ConcertRecord): string {
    const norm    = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
    const address = `${c.address || ''}`.trim();
    const venue   = `${c.venue || ''}`.trim();
    const bnames  = new Set((c.bands || []).map(x => norm(`${x || ''}`)).filter(Boolean));
    const bc      = this.contacts.find(ct => ct.type === 'band' && ct.id === c.contactId);
    if (bc?.displayName) bnames.add(norm(bc.displayName));
    if (address && !bnames.has(norm(address))) return address;
    if (venue   && !bnames.has(norm(venue)))   return venue;
    return 'Location non definita';
  }

  private buildLessonByStudentAggregates(teaching: TeachingSession[]): AggregateRow[] {
    const names = new Map(this.students.map(s => [s.id, s.fullName]));
    const agg   = new Map<string, { count: number; total: number }>();
    for (const s of teaching) {
      const label = names.get(`${s.studentId || ''}`) || 'Allievo non definito';
      const cur   = agg.get(label) || { count: 0, total: 0 };
      cur.count += 1; cur.total += Number(s.compensation || 0);
      agg.set(label, cur);
    }
    return this.toAggregateRows(agg);
  }

  private buildLessonBySchoolAggregates(teaching: TeachingSession[]): AggregateRow[] {
    const names = new Map(this.schools.map(s => [s.id, s.name]));
    const agg   = new Map<string, { count: number; total: number }>();
    for (const s of teaching) {
      const label = names.get(`${s.schoolId || ''}`) || 'Lezioni private';
      const cur   = agg.get(label) || { count: 0, total: 0 };
      cur.count += 1; cur.total += Number(s.compensation || 0);
      agg.set(label, cur);
    }
    return this.toAggregateRows(agg);
  }

  private toAggregateRows(source: Map<string, { count: number; total: number }>): AggregateRow[] {
    return [...source.entries()]
      .map(([label, v]) => ({
        label, count: v.count, total: v.total,
        average: v.count > 0 ? v.total / v.count : 0
      }))
      .sort((a, b) => b.total - a.total);
  }

  private toConcertPopupRow(c: ConcertRecord, byId: Map<string, ServicePayment[]>): PopupRow {
    const fee      = Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
    const received = this.sumPaymentsForIds(new Set([c.id]), byId);
    return {
      id: c.id, date: c.date,
      title:    c.title || c.venue || 'Serata',
      location: this.resolveConcertLocation(c),
      fee:      this.round2(fee),
      received: this.round2(received),
      pending:  this.round2(Math.max(0, fee - received))
    };
  }

  private buildCadenceRows(
    concerts: ConcertRecord[], teaching: TeachingSession[],
    byId: Map<string, ServicePayment[]>
  ): { label: string; count: number; due: number; received: number; pending: number }[] {
    const rows = [
      { key: 'prestazione', label: 'A serata / prestazione', count: 0, due: 0, received: 0 },
      { key: 'mensile',     label: 'Mensile',                count: 0, due: 0, received: 0 }
    ];
    for (const c of concerts) {
      const r = rows.find(x => x.key === (c.paymentCadence === 'mensile' ? 'mensile' : 'prestazione'))!;
      r.count += 1;
      r.due      += Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      r.received += this.sumPaymentsForIds(new Set([c.id]), byId);
    }
    for (const t of teaching) {
      const r = rows.find(x => x.key === (t.paymentCadence === 'mensile' ? 'mensile' : 'prestazione'))!;
      r.count += 1;
      r.due      += Number(t.compensation || 0);
      r.received += this.sumPaymentsForIds(new Set([t.id]), byId);
    }
    return rows.map(r => ({
      label: r.label, count: r.count,
      due:      this.round2(r.due),
      received: this.round2(r.received),
      pending:  this.round2(Math.max(0, r.due - r.received))
    }));
  }

  private buildTypeRows(
    concerts: ConcertRecord[], byId: Map<string, ServicePayment[]>
  ): { label: string; count: number; due: number; received: number }[] {
    const map = new Map<string, { count: number; due: number; received: number }>();
    for (const c of concerts) {
      const type  = this.eventTypeById.get(c.id) || 'concert';
      const label = type === 'dj_set' ? 'DJ Set' : 'Concerto';
      const cur   = map.get(label) || { count: 0, due: 0, received: 0 };
      cur.count += 1;
      cur.due      += Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      cur.received += this.sumPaymentsForIds(new Set([c.id]), byId);
      map.set(label, cur);
    }
    return [...map.entries()]
      .map(([label, v]) => ({ label, count: v.count, due: this.round2(v.due), received: this.round2(v.received) }))
      .sort((a, b) => b.due - a.due);
  }

  private buildVenueAggregates(concerts: ConcertRecord[]): AggregateRow[] {
    const agg = new Map<string, { count: number; total: number }>();
    for (const c of concerts) {
      const label = this.resolveConcertLocation(c);
      const fee   = Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      const cur   = agg.get(label) || { count: 0, total: 0 };
      cur.count += 1; cur.total += fee;
      agg.set(label, cur);
    }
    return this.toAggregateRows(agg);
  }

  private buildTerritoryAggregates(concerts: ConcertRecord[]): { provinceRows: AggregateRow[]; regionRows: AggregateRow[] } {
    const pm = new Map<string, { count: number; total: number }>();
    const rm = new Map<string, { count: number; total: number }>();
    for (const c of concerts) {
      const fee  = Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      const loc  = this.resolveConcertLocation(c);
      const prov = provinceCodeFromAddressLabel(loc) || 'N/D';
      const reg  = prov !== 'N/D' ? (regionNameFromProvinceCode(prov) || 'N/D') : 'N/D';
      const p    = pm.get(prov) || { count: 0, total: 0 }; p.count += 1; p.total += fee; pm.set(prov, p);
      const r    = rm.get(reg)  || { count: 0, total: 0 }; r.count += 1; r.total += fee; rm.set(reg, r);
    }
    return { provinceRows: this.toAggregateRows(pm), regionRows: this.toAggregateRows(rm) };
  }

  private buildPeriods(): Period[] {
    const set = new Set<string>();
    for (const c of this.concerts) if (c.date) set.add(c.date.substring(0, 7));
    for (const t of this.teaching) if (t.date) set.add(t.date.substring(0, 7));
    for (const e of this.expenses) if (e.date) set.add(e.date.substring(0, 7));
    return [...set].filter(Boolean).sort().reverse().map(ym => ({ value: ym, label: this.formatMonth(ym) }));
  }

  private buildTrendPoints(): TrendPoint[] {
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`);
    }
    const allPay = this.normalizePayments(JSON.parse(localStorage.getItem('mm_service_payments') || '[]'));
    const allExp = this.readExpenses();
    return months.map(ym => {
      const received = allPay
        .filter(p => `${p.createdAt || p.serviceDate || ''}`.startsWith(ym))
        .reduce((s, p) => s + this.effectiveReceived(p), 0);
      const out = allExp
        .filter(e => `${e.date || ''}`.startsWith(ym))
        .reduce((s, e) => s + Number(e.totalExpense || 0), 0);
      return { ym, label: this.formatMonth(ym), received: this.round2(received), expenses: this.round2(out), net: this.round2(received - out) };
    });
  }

  private groupPaymentsByEventId(): Map<string, ServicePayment[]> {
    const map = new Map<string, ServicePayment[]>();
    for (const p of this.payments) {
      const id = `${p.eventId || ''}`.trim();
      if (!id) continue;
      const list = map.get(id) || []; list.push(p); map.set(id, list);
    }
    return map;
  }

  private sumPaymentsForIds(ids: Set<string>, byId: Map<string, ServicePayment[]>): number {
    let total = 0;
    for (const id of ids) for (const p of byId.get(id) || []) total += this.effectiveReceived(p);
    return total;
  }

  private sumPaymentsByCashPeriod(category: ServicePayment['category']): number {
    const ps = this.payments.filter(p => p.category === category);
    if (!this.selectedPeriod) return ps.reduce((s, p) => s + this.effectiveReceived(p), 0);
    return ps
      .filter(p => `${p.createdAt || p.serviceDate || ''}`.startsWith(this.selectedPeriod))
      .reduce((s, p) => s + this.effectiveReceived(p), 0);
  }

  private effectiveReceived(p: ServicePayment): number {
    if (!p.cooperativeManaged) return Number(p.receivedAmount || 0);
    if (`${p.cooperativeSettlementState || ''}` === 'pending_transfer_to_musician') return 0;
    return Number(p.cooperativeNetAmount || 0);
  }

  private filterByPeriod<T>(items: T[], dateAccessor: (item: T) => string): T[] {
    if (!this.selectedPeriod) return items;
    return items.filter(x => `${dateAccessor(x) || ''}`.startsWith(this.selectedPeriod));
  }

  private readConcerts(): ConcertRecord[] {
    const raw = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): ConcertRecord => ({
      id:           `${x?.id || ''}` || crypto.randomUUID(),
      date:         `${x?.date || ''}`,
      agreedFee:    Number(x?.agreedFee || 0),
      reimbursement: Number(x?.reimbursement || 0),
      title:        `${x?.title || ''}`.trim(),
      venue:        `${x?.venue || ''}`.trim(),
      address:      `${x?.address || ''}`.trim(),
      bands:        Array.isArray(x?.bands) ? x.bands.map((b: any) => `${b || ''}`.trim()).filter(Boolean) : [],
      contactId:    `${x?.contactId || ''}` || null,
      paymentCadence: x?.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: x?.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
    }));
  }

  private readTeachingSessions(): TeachingSession[] {
    const raw = JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): TeachingSession => ({
      id:           `${x?.id || ''}` || crypto.randomUUID(),
      date:         `${x?.date || ''}`,
      compensation: Number(x?.compensation || 0),
      studentId:    x?.studentId ? `${x.studentId}` : null,
      schoolId:     x?.schoolId  ? `${x.schoolId}`  : null,
      paymentCadence: x?.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: x?.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
    }));
  }

  private readExpenses(): ExpenseRecord[] {
    const raw = JSON.parse(localStorage.getItem('mm_expenses') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): ExpenseRecord => ({
      date:         `${x?.date || ''}`,
      totalExpense: Number(x?.totalExpense || 0),
      description:  `${x?.description || ''}`.trim() || undefined,
      from:         `${x?.from || ''}`.trim() || undefined,
      to:           `${x?.to || ''}`.trim()   || undefined
    }));
  }

  private normalizePayments(raw: any[]): ServicePayment[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): ServicePayment => ({
      eventId:    `${x?.eventId || ''}`,
      category:   x?.category === 'lezione' ? 'lezione' : 'concerto',
      receivedAmount: Number(x?.receivedAmount || 0),
      cooperativeManaged: x?.cooperativeManaged === true,
      cooperativeNetAmount: Number(x?.cooperativeNetAmount || 0),
      cooperativeSettlementState: `${x?.cooperativeSettlementState || ''}`,
      createdAt:     `${x?.createdAt || ''}`,
      serviceDate:   `${x?.serviceDate || ''}`,
      paymentType:   `${x?.paymentType   || ''}`.trim() || undefined,
      paymentMethod: `${x?.paymentMethod || ''}`.trim() || undefined,
      notes:         `${x?.notes || ''}`.trim() || undefined
    }));
  }

  private buildEventTypeIndex(): Map<string, 'concert' | 'dj_set' | 'lesson' | 'other'> {
    const map    = new Map<string, 'concert' | 'dj_set' | 'lesson' | 'other'>();
    const events = JSON.parse(localStorage.getItem('mm_events') || '[]');
    if (!Array.isArray(events)) return map;
    for (const e of events) {
      const id = `${e?.id || ''}`.trim(); if (!id) continue;
      const t  = `${e?.type || ''}`.trim();
      map.set(id, (t === 'concert' || t === 'dj_set' || t === 'lesson') ? t : 'other');
    }
    return map;
  }

  private formatMonth(ym: string): string {
    const [y, m] = ym.split('-');
    const names  = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return `${names[+m - 1] || '?'} ${y}`;
  }

  private safePct(value: number, total: number): number {
    const v = Number(value || 0), t = Number(total || 0);
    if (!Number.isFinite(v) || !Number.isFinite(t) || t <= 0) return 0;
    return Math.max(0, Math.min(100, (v / t) * 100));
  }

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
