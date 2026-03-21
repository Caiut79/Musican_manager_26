import { Component, OnInit } from '@angular/core';

type ConcertRecord = {
  id: string;
  date: string;
  timeStart?: string;
  agreedFee: number;
  reimbursement: number;
  title?: string;
  venue?: string;
  address?: string;
  bands?: string[];
  contactId?: string | null;
  paymentCadence?: 'prestazione' | 'mensile';
  monthlySettlement?: 'acconto' | 'bonifico';
};

type TeachingSession = {
  id: string;
  date: string;
  compensation: number;
  studentId?: string | null;
  schoolId?: string | null;
  paymentCadence?: 'prestazione' | 'mensile';
  monthlySettlement?: 'acconto' | 'bonifico';
};

type ExpenseRecord = {
  date: string;
  totalExpense: number;
};

type ContactRecord = {
  id: string;
  displayName: string;
  type: 'band' | 'school' | 'student';
};

type StudentRecord = {
  id: string;
  fullName: string;
};

type SchoolRecord = {
  id: string;
  name: string;
};

type AggregateRow = {
  label: string;
  count: number;
  total: number;
  average: number;
};

type Period = { value: string; label: string };

type ServicePayment = {
  eventId: string;
  category: 'concerto' | 'lezione';
  receivedAmount: number;
  cooperativeManaged?: boolean;
  cooperativeNetAmount?: number;
  cooperativeSettlementState?: string;
  createdAt?: string;
  serviceDate?: string;
};

type TrendPoint = { ym: string; label: string; received: number; expenses: number; net: number };

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.scss']
})
export class ReportsComponent implements OnInit {
  selectedPeriod = '';
  periods: Period[] = [];
  viewBasis: 'evento' | 'incasso' = 'evento';

  concerts: ConcertRecord[] = [];
  teaching: TeachingSession[] = [];
  expenses: ExpenseRecord[] = [];
  payments: ServicePayment[] = [];
  eventTypeById = new Map<string, 'concert' | 'dj_set' | 'lesson' | 'other'>();

  concertDue = 0;
  concertReceived = 0;
  teachingDue = 0;
  teachingReceived = 0;
  expenseTotal = 0;
  grossTotal = 0;
  netTotal = 0;
  cashNet = 0;
  pendingReceivables = 0;

  isTeacherProfile = false;
  concertCompByGroup: AggregateRow[] = [];
  lessonCompByStudent: AggregateRow[] = [];
  lessonCompBySchool: AggregateRow[] = [];
  totalConcertSessions = 0;
  totalLessonSessions = 0;

  cadenceRows: { label: string; count: number; due: number; received: number; pending: number }[] = [];
  typeRows: { label: string; count: number; due: number; received: number }[] = [];
  topVenues: AggregateRow[] = [];
  trend: TrendPoint[] = [];

  ngOnInit(): void {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.isTeacherProfile = profile?.isTeacher === true;
    this.eventTypeById = this.buildEventTypeIndex();

    const contacts: ContactRecord[] = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const students: StudentRecord[] = JSON.parse(localStorage.getItem('mm_teaching_students') || '[]');
    const schools: SchoolRecord[] = JSON.parse(localStorage.getItem('mm_teaching_schools') || '[]');

    this.concerts = this.readConcerts();
    this.teaching = this.isTeacherProfile ? this.readTeachingSessions() : [];
    this.expenses = this.readExpenses();
    this.payments = this.normalizePayments(JSON.parse(localStorage.getItem('mm_service_payments') || '[]'));

    this.periods = this.buildPeriods();
    this.selectedPeriod = this.periods[0]?.value || '';
    this.recompute(contacts, students, schools);
  }

  onPeriodChanged(): void {
    const contacts: ContactRecord[] = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const students: StudentRecord[] = JSON.parse(localStorage.getItem('mm_teaching_students') || '[]');
    const schools: SchoolRecord[] = JSON.parse(localStorage.getItem('mm_teaching_schools') || '[]');
    this.recompute(contacts, students, schools);
  }

  exportCsv(): void {
    const lines: string[] = [];
    const add = (cols: (string | number)[]) => lines.push(cols.map(x => `"${`${x ?? ''}`.replaceAll('"', '""')}"`).join(','));
    add(['Report Musican Manager']);
    add(['Periodo', this.selectedPeriod || 'Tutto']);
    add(['Vista', this.viewBasis === 'incasso' ? 'Cassa (data incasso)' : 'Competenza (data evento)']);
    add([]);
    add(['KPI']);
    add(['Serate pattuito', this.concertDue]);
    add(['Serate incassato', this.concertReceived]);
    add(['Lezioni pattuito', this.teachingDue]);
    add(['Lezioni incassato', this.teachingReceived]);
    add(['Spese', this.expenseTotal]);
    add(['Netto (competenza)', this.netTotal]);
    add(['Saldo cassa', this.cashNet]);
    add(['Da incassare', this.pendingReceivables]);
    add([]);
    add(['Breakdown cadenza']);
    add(['Cadenza', 'Eventi', 'Pattuito', 'Incassato', 'Da incassare']);
    for (const r of this.cadenceRows) add([r.label, r.count, r.due, r.received, r.pending]);
    add([]);
    add(['Breakdown tipo']);
    add(['Tipo', 'Eventi', 'Pattuito', 'Incassato']);
    for (const r of this.typeRows) add([r.label, r.count, r.due, r.received]);
    add([]);
    add(['Top gruppi/band']);
    add(['Gruppo', 'Serate', 'Totale', 'Media']);
    for (const r of this.concertCompByGroup.slice(0, 20)) add([r.label, r.count, this.round2(r.total), this.round2(r.average)]);
    if (this.isTeacherProfile) {
      add([]);
      add(['Top allievi']);
      add(['Allievo', 'Lezioni', 'Totale', 'Media']);
      for (const r of this.lessonCompByStudent.slice(0, 20)) add([r.label, r.count, this.round2(r.total), this.round2(r.average)]);
      add([]);
      add(['Top scuole']);
      add(['Scuola', 'Lezioni', 'Totale', 'Media']);
      for (const r of this.lessonCompBySchool.slice(0, 20)) add([r.label, r.count, this.round2(r.total), this.round2(r.average)]);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${(this.selectedPeriod || 'tutto').replaceAll('/', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  print(): void {
    window.print();
  }

  trendMax(): number {
    const max = Math.max(0, ...this.trend.map(t => Math.max(t.received, t.expenses)));
    return max || 1;
  }

  private buildConcertAggregates(concerts: ConcertRecord[], contacts: ContactRecord[]): AggregateRow[] {
    const aggregates = new Map<string, { count: number; total: number }>();
    concerts.forEach(concert => {
      const fee = Number(concert.agreedFee || 0) + Number(concert.reimbursement || 0);
      const groups = this.resolveConcertGroups(concert, contacts);
      const quota = groups.length ? fee / groups.length : fee;
      groups.forEach(group => {
        const current = aggregates.get(group) || { count: 0, total: 0 };
        current.count += 1;
        current.total += quota;
        aggregates.set(group, current);
      });
    });
    return this.toAggregateRows(aggregates);
  }

  private resolveConcertGroups(concert: ConcertRecord, contacts: ContactRecord[]): string[] {
    const fromBands = (concert.bands || []).map(x => `${x || ''}`.trim()).filter(Boolean);
    if (fromBands.length) return [...new Set(fromBands)];
    const contact = contacts.find(c => c.id === concert.contactId && c.type === 'band');
    if (contact?.displayName) return [contact.displayName];
    const fromVenue = `${concert.venue || ''}`.trim();
    if (fromVenue) return [fromVenue];
    const fromTitle = `${concert.title || ''}`.trim();
    if (fromTitle) return [fromTitle];
    return ['Gruppo non definito'];
  }

  private buildLessonByStudentAggregates(teaching: TeachingSession[], students: StudentRecord[]): AggregateRow[] {
    const studentNames = new Map(students.map(s => [s.id, s.fullName]));
    const aggregates = new Map<string, { count: number; total: number }>();
    teaching.forEach(session => {
      const fee = Number(session.compensation || 0);
      const studentName = studentNames.get(`${session.studentId || ''}`) || 'Allievo non definito';
      const current = aggregates.get(studentName) || { count: 0, total: 0 };
      current.count += 1;
      current.total += fee;
      aggregates.set(studentName, current);
    });
    return this.toAggregateRows(aggregates);
  }

  private buildLessonBySchoolAggregates(teaching: TeachingSession[], schools: SchoolRecord[]): AggregateRow[] {
    const schoolNames = new Map(schools.map(s => [s.id, s.name]));
    const aggregates = new Map<string, { count: number; total: number }>();
    teaching.forEach(session => {
      const fee = Number(session.compensation || 0);
      const schoolName = schoolNames.get(`${session.schoolId || ''}`) || 'Lezioni private';
      const current = aggregates.get(schoolName) || { count: 0, total: 0 };
      current.count += 1;
      current.total += fee;
      aggregates.set(schoolName, current);
    });
    return this.toAggregateRows(aggregates);
  }

  private toAggregateRows(source: Map<string, { count: number; total: number }>): AggregateRow[] {
    return [...source.entries()]
      .map(([label, value]) => ({
        label,
        count: value.count,
        total: value.total,
        average: value.count > 0 ? value.total / value.count : 0
      }))
      .sort((a, b) => b.total - a.total);
  }

  private recompute(contacts: ContactRecord[], students: StudentRecord[], schools: SchoolRecord[]): void {
    const concerts = this.filterByPeriod(this.concerts, x => x.date);
    const teaching = this.filterByPeriod(this.teaching, x => x.date);
    const expenses = this.filterByPeriod(this.expenses, x => x.date);

    const concertIds = new Set(concerts.map(c => c.id));
    const lessonIds = new Set(teaching.map(t => t.id));

    const paymentsByEventId = this.groupPaymentsByEventId();
    const paidForConcertsByEvent = this.sumPaymentsForIds(concertIds, paymentsByEventId);
    const paidForLessonsByEvent = this.sumPaymentsForIds(lessonIds, paymentsByEventId);
    const paidForConcertsByCash = this.sumPaymentsByCashPeriod('concerto');
    const paidForLessonsByCash = this.sumPaymentsByCashPeriod('lezione');

    const concertDue = concerts.reduce((sum, c) => sum + Number(c.agreedFee || 0) + Number(c.reimbursement || 0), 0);
    const teachingDue = teaching.reduce((sum, t) => sum + Number(t.compensation || 0), 0);
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.totalExpense || 0), 0);

    this.concertDue = this.round2(concertDue);
    this.concertReceived = this.round2(this.viewBasis === 'incasso' ? paidForConcertsByCash : paidForConcertsByEvent);
    this.teachingDue = this.round2(teachingDue);
    this.teachingReceived = this.round2(this.viewBasis === 'incasso' ? paidForLessonsByCash : paidForLessonsByEvent);
    this.expenseTotal = this.round2(expenseTotal);

    this.grossTotal = this.round2(this.concertDue + this.teachingDue);
    this.netTotal = this.round2(this.grossTotal - this.expenseTotal);
    this.cashNet = this.round2((this.concertReceived + this.teachingReceived) - this.expenseTotal);
    this.pendingReceivables = this.round2(Math.max(0, (this.concertDue + this.teachingDue) - (paidForConcertsByEvent + paidForLessonsByEvent)));

    this.concertCompByGroup = this.buildConcertAggregates(concerts, contacts);
    this.topVenues = this.buildVenueAggregates(concerts, contacts);
    this.lessonCompByStudent = this.buildLessonByStudentAggregates(teaching, students);
    this.lessonCompBySchool = this.buildLessonBySchoolAggregates(teaching, schools);
    this.totalConcertSessions = concerts.length;
    this.totalLessonSessions = teaching.length;

    this.cadenceRows = this.buildCadenceRows(concerts, teaching, paymentsByEventId);
    this.typeRows = this.buildTypeRows(concerts, paymentsByEventId);
    this.trend = this.buildTrendPoints();
  }

  private sumPaymentsByCashPeriod(category: ServicePayment['category']): number {
    if (!this.selectedPeriod) {
      return this.payments
        .filter(p => p.category === category)
        .reduce((sum, p) => sum + this.effectiveReceived(p), 0);
    }
    return this.payments
      .filter(p => p.category === category)
      .filter(p => `${p.createdAt || p.serviceDate || ''}`.startsWith(this.selectedPeriod))
      .reduce((sum, p) => sum + this.effectiveReceived(p), 0);
  }

  private buildCadenceRows(concerts: ConcertRecord[], teaching: TeachingSession[], paymentsByEventId: Map<string, ServicePayment[]>): { label: string; count: number; due: number; received: number; pending: number }[] {
    const rows: { key: string; label: string; count: number; due: number; received: number }[] = [
      { key: 'prestazione', label: 'A serata / prestazione', count: 0, due: 0, received: 0 },
      { key: 'mensile', label: 'Mensile', count: 0, due: 0, received: 0 }
    ];
    for (const c of concerts) {
      const cadence = c.paymentCadence === 'mensile' ? 'mensile' : 'prestazione';
      const row = rows.find(r => r.key === cadence)!;
      row.count += 1;
      row.due += Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      row.received += this.sumPaymentsForIds(new Set([c.id]), paymentsByEventId);
    }
    for (const t of teaching) {
      const cadence = t.paymentCadence === 'mensile' ? 'mensile' : 'prestazione';
      const row = rows.find(r => r.key === cadence)!;
      row.count += 1;
      row.due += Number(t.compensation || 0);
      row.received += this.sumPaymentsForIds(new Set([t.id]), paymentsByEventId);
    }
    return rows.map(r => ({
      label: r.label,
      count: r.count,
      due: this.round2(r.due),
      received: this.round2(r.received),
      pending: this.round2(Math.max(0, r.due - r.received))
    }));
  }

  private buildTypeRows(concerts: ConcertRecord[], paymentsByEventId: Map<string, ServicePayment[]>): { label: string; count: number; due: number; received: number }[] {
    const map = new Map<string, { count: number; due: number; received: number }>();
    for (const c of concerts) {
      const type = this.eventTypeById.get(c.id) || 'concert';
      const label = type === 'dj_set' ? 'DJ Set' : 'Concerto';
      const current = map.get(label) || { count: 0, due: 0, received: 0 };
      current.count += 1;
      current.due += Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      current.received += this.sumPaymentsForIds(new Set([c.id]), paymentsByEventId);
      map.set(label, current);
    }
    return [...map.entries()]
      .map(([label, v]) => ({ label, count: v.count, due: this.round2(v.due), received: this.round2(v.received) }))
      .sort((a, b) => b.due - a.due);
  }

  private buildVenueAggregates(concerts: ConcertRecord[], contacts: ContactRecord[]): AggregateRow[] {
    const aggregates = new Map<string, { count: number; total: number }>();
    for (const c of concerts) {
      const label = this.resolveConcertLocation(c, contacts);
      const fee = Number(c.agreedFee || 0) + Number(c.reimbursement || 0);
      const current = aggregates.get(label) || { count: 0, total: 0 };
      current.count += 1;
      current.total += fee;
      aggregates.set(label, current);
    }
    return this.toAggregateRows(aggregates);
  }

  private buildPeriods(): Period[] {
    const set = new Set<string>();
    for (const c of this.concerts) if (c.date) set.add(c.date.substring(0, 7));
    for (const t of this.teaching) if (t.date) set.add(t.date.substring(0, 7));
    for (const e of this.expenses) if (e.date) set.add(e.date.substring(0, 7));
    return [...set].filter(Boolean).sort().reverse().map(ym => ({ value: ym, label: this.formatMonth(ym) }));
  }

  private formatMonth(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return `${names[+m - 1]} ${y}`;
  }

  private filterByPeriod<T>(items: T[], dateAccessor: (item: T) => string): T[] {
    if (!this.selectedPeriod) return items;
    return items.filter(x => `${dateAccessor(x) || ''}`.startsWith(this.selectedPeriod));
  }

  private groupPaymentsByEventId(): Map<string, ServicePayment[]> {
    const map = new Map<string, ServicePayment[]>();
    for (const p of this.payments) {
      const id = `${p.eventId || ''}`.trim();
      if (!id) continue;
      const list = map.get(id) || [];
      list.push(p);
      map.set(id, list);
    }
    return map;
  }

  private sumPaymentsForIds(ids: Set<string>, paymentsByEventId: Map<string, ServicePayment[]>): number {
    let total = 0;
    for (const id of ids) {
      const list = paymentsByEventId.get(id) || [];
      for (const p of list) total += this.effectiveReceived(p);
    }
    return total;
  }

  private effectiveReceived(payment: ServicePayment): number {
    const cooperativeManaged = !!payment.cooperativeManaged;
    if (!cooperativeManaged) return Number(payment.receivedAmount || 0);
    const state = `${payment.cooperativeSettlementState || ''}`;
    if (state === 'pending_transfer_to_musician') return 0;
    return Number(payment.cooperativeNetAmount || 0);
  }

  private readConcerts(): ConcertRecord[] {
    const raw = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): ConcertRecord => ({
      id: `${x?.id || ''}` || crypto.randomUUID(),
      date: `${x?.date || ''}`,
      timeStart: `${x?.timeStart || ''}`,
      agreedFee: Number(x?.agreedFee || 0),
      reimbursement: Number(x?.reimbursement || 0),
      title: `${x?.title || ''}`.trim(),
      venue: `${x?.venue || ''}`.trim(),
      address: `${x?.address || ''}`.trim(),
      bands: Array.isArray(x?.bands) ? x.bands.map((b: any) => `${b || ''}`.trim()).filter(Boolean) : [],
      contactId: `${x?.contactId || ''}` || null,
      paymentCadence: x?.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: x?.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
    }));
  }

  private resolveConcertLocation(concert: ConcertRecord, contacts: ContactRecord[]): string {
    const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();
    const address = `${concert.address || ''}`.trim();
    const venue = `${concert.venue || ''}`.trim();
    const bandNames = new Set((concert.bands || []).map(x => normalize(`${x || ''}`)).filter(Boolean));
    const bandContact = contacts.find(c => c.type === 'band' && c.id === concert.contactId);
    if (bandContact?.displayName) bandNames.add(normalize(bandContact.displayName));

    if (address && !bandNames.has(normalize(address))) return address;
    if (venue && !bandNames.has(normalize(venue))) return venue;
    return 'Location non definita';
  }

  private readTeachingSessions(): TeachingSession[] {
    const raw = JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): TeachingSession => ({
      id: `${x?.id || ''}` || crypto.randomUUID(),
      date: `${x?.date || ''}`,
      compensation: Number(x?.compensation || 0),
      studentId: x?.studentId ? `${x.studentId}` : null,
      schoolId: x?.schoolId ? `${x.schoolId}` : null,
      paymentCadence: x?.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: x?.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
    }));
  }

  private readExpenses(): ExpenseRecord[] {
    const raw = JSON.parse(localStorage.getItem('mm_expenses') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): ExpenseRecord => ({
      date: `${x?.date || ''}`,
      totalExpense: Number(x?.totalExpense || 0)
    }));
  }

  private normalizePayments(raw: any[]): ServicePayment[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): ServicePayment => ({
      eventId: `${x?.eventId || ''}`,
      category: x?.category === 'lezione' ? 'lezione' : 'concerto',
      receivedAmount: Number(x?.receivedAmount || 0),
      cooperativeManaged: x?.cooperativeManaged === true,
      cooperativeNetAmount: Number(x?.cooperativeNetAmount || 0),
      cooperativeSettlementState: `${x?.cooperativeSettlementState || ''}`,
      createdAt: `${x?.createdAt || ''}`,
      serviceDate: `${x?.serviceDate || ''}`
    }));
  }

  private buildEventTypeIndex(): Map<string, 'concert' | 'dj_set' | 'lesson' | 'other'> {
    const map = new Map<string, 'concert' | 'dj_set' | 'lesson' | 'other'>();
    const events = JSON.parse(localStorage.getItem('mm_events') || '[]');
    if (!Array.isArray(events)) return map;
    for (const e of events) {
      const id = `${e?.id || ''}`.trim();
      if (!id) continue;
      const type = `${e?.type || ''}`.trim();
      if (type === 'concert' || type === 'dj_set' || type === 'lesson') {
        map.set(id, type);
      } else {
        map.set(id, 'other');
      }
    }
    return map;
  }

  private buildTrendPoints(): TrendPoint[] {
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
      months.push(ym);
    }

    const payments = this.normalizePayments(JSON.parse(localStorage.getItem('mm_service_payments') || '[]'));
    const expenses = this.readExpenses();
    return months.map(ym => {
      const received = payments
        .filter(p => `${p.createdAt || p.serviceDate || ''}`.startsWith(ym))
        .reduce((sum, p) => sum + this.effectiveReceived(p), 0);
      const out = expenses
        .filter(e => `${e.date || ''}`.startsWith(ym))
        .reduce((sum, e) => sum + Number(e.totalExpense || 0), 0);
      return {
        ym,
        label: this.formatMonth(ym),
        received: this.round2(received),
        expenses: this.round2(out),
        net: this.round2(received - out)
      };
    });
  }

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
