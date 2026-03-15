import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { EventDetail } from '../../models/event-detail';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';

type School = {
  id: string;
  name: string;
  code: string;
  hourlyRate: number;
  perStudentRate: number;
  invoiceMode: 'fattura' | 'non_fattura';
  paymentCadence: 'prestazione' | 'mensile';
  monthlySettlement: 'acconto' | 'bonifico';
  contactId: string | null;
  createdAt: string;
};

type Student = {
  id: string;
  fullName: string;
  schoolId: string | null;
  contactId: string | null;
  createdAt: string;
};

type TeachingSession = {
  id: string;
  date: string;
  lessonType: 'private' | 'school' | 'collaboration';
  studentId: string | null;
  schoolId: string | null;
  hours: number;
  rateMode: 'per_hour' | 'per_student';
  rateValue: number;
  studentsCount: number;
  compensation: number;
  invoiceMode: 'fattura' | 'non_fattura';
  paymentCadence: 'prestazione' | 'mensile';
  monthlySettlement: 'acconto' | 'bonifico';
  contactId: string | null;
  attendanceStatus: 'present' | 'absent';
  notes: string;
  createdAt: string;
};

type ServicePayment = {
  eventId: string;
  category: 'concerto' | 'lezione';
  receivedAmount: number;
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

@Component({
  selector: 'app-teaching',
  templateUrl: './teaching.component.html',
  styleUrls: ['./teaching.component.scss']
})
export class TeachingComponent implements OnInit {
  schools: School[] = [];
  students: Student[] = [];
  sessions: TeachingSession[] = [];
  codeCopied: string | null = null;
  contacts: ContactEntry[] = [];
  servicePayments: ServicePayment[] = [];
  showNewContactForSchool = false;
  showNewContactForStudent = false;
  showNewContactForSession = false;
  creatorMode: 'none' | 'school' | 'student' | 'lesson' = 'none';
  newContact = {
    type: 'school' as 'band' | 'school' | 'student',
    displayName: '',
    priority: 3,
    averageFee: 0,
    billingMode: 'in_fattura' as 'in_fattura' | 'fuori_fattura',
    paymentCadence: 'prestazione' as 'prestazione' | 'mensile',
    monthlySettlement: 'acconto' as 'acconto' | 'bonifico'
  };

  schoolForm = this.fb.group({
    name: ['', Validators.required],
    hourlyRate: [0, Validators.min(0)],
    perStudentRate: [0, Validators.min(0)],
    invoiceMode: ['fattura'],
    paymentCadence: ['prestazione'],
    monthlySettlement: ['acconto'],
    contactId: ['']
  });

  studentForm = this.fb.group({
    fullName: ['', Validators.required],
    schoolId: [''],
    contactId: ['']
  });

  sessionForm = this.fb.group({
    date: ['', Validators.required],
    lessonType: ['private'],
    studentId: [''],
    schoolId: [''],
    hours: [1, Validators.min(0)],
    rateMode: ['per_hour'],
    rateValue: [0, Validators.min(0)],
    studentsCount: [1, Validators.min(1)],
    invoiceMode: ['fattura'],
    paymentCadence: ['prestazione'],
    monthlySettlement: ['acconto'],
    contactId: [''],
    notes: ['']
  });

  constructor(private fb: FormBuilder, private router: Router, private supabase: SupabaseService) {}

  ngOnInit(): void {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    if (profile?.isTeacher !== true) {
      this.router.navigateByUrl('/dashboard');
      return;
    }
    this.schools = JSON.parse(localStorage.getItem('mm_teaching_schools') || '[]');
    this.students = JSON.parse(localStorage.getItem('mm_teaching_students') || '[]');
    this.sessions = JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]');
    this.servicePayments = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
    this.contacts = this.readContacts();
    this.sessions = this.mergeLessonsFromAgenda(this.sessions);
    localStorage.setItem('mm_teaching_sessions', JSON.stringify(this.sessions));
  }

  createSchool(): void {
    if (this.schoolForm.invalid) {
      this.schoolForm.markAllAsTouched();
      return;
    }
    const v = this.schoolForm.value;
    const school: School = {
      id: crypto.randomUUID(),
      name: `${v.name || ''}`.trim(),
      code: this.nextSchoolCode(),
      hourlyRate: Number(v.hourlyRate || 0),
      perStudentRate: Number(v.perStudentRate || 0),
      invoiceMode: (v.invoiceMode as 'fattura' | 'non_fattura') || 'fattura',
      paymentCadence: (v.paymentCadence === 'mensile' ? 'mensile' : 'prestazione'),
      monthlySettlement: (v.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'),
      contactId: `${v.contactId || ''}` || null,
      createdAt: new Date().toISOString()
    };
    this.schools.unshift(school);
    localStorage.setItem('mm_teaching_schools', JSON.stringify(this.schools));
    this.schoolForm.reset({
      name: '',
      hourlyRate: 0,
      perStudentRate: 0,
      invoiceMode: 'fattura',
      paymentCadence: 'prestazione',
      monthlySettlement: 'acconto',
      contactId: ''
    });
    this.creatorMode = 'none';
  }

  createStudent(): void {
    if (this.studentForm.invalid) {
      this.studentForm.markAllAsTouched();
      return;
    }
    const v = this.studentForm.value;
    const student: Student = {
      id: crypto.randomUUID(),
      fullName: `${v.fullName || ''}`.trim(),
      schoolId: `${v.schoolId || ''}` || null,
      contactId: `${v.contactId || ''}` || null,
      createdAt: new Date().toISOString()
    };
    this.students.unshift(student);
    localStorage.setItem('mm_teaching_students', JSON.stringify(this.students));
    this.studentForm.reset({ fullName: '', schoolId: '', contactId: '' });
    this.creatorMode = 'none';
  }

  createSession(): void {
    if (this.sessionForm.invalid) {
      this.sessionForm.markAllAsTouched();
      return;
    }
    const v = this.sessionForm.value;
    const hours = Number(v.hours || 0);
    const rateValue = Number(v.rateValue || 0);
    const studentsCount = Number(v.studentsCount || 1);
    const compensation = v.rateMode === 'per_student' ? rateValue * studentsCount : rateValue * hours;
    const session: TeachingSession = {
      id: crypto.randomUUID(),
      date: `${v.date || ''}`,
      lessonType: (v.lessonType as TeachingSession['lessonType']) || 'private',
      studentId: `${v.studentId || ''}` || null,
      schoolId: `${v.schoolId || ''}` || null,
      hours,
      rateMode: (v.rateMode as TeachingSession['rateMode']) || 'per_hour',
      rateValue,
      studentsCount,
      compensation,
      invoiceMode: (v.invoiceMode as TeachingSession['invoiceMode']) || 'fattura',
      paymentCadence: (v.paymentCadence === 'mensile' ? 'mensile' : 'prestazione'),
      monthlySettlement: (v.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'),
      contactId: `${v.contactId || ''}` || null,
      attendanceStatus: 'present',
      notes: `${v.notes || ''}`.trim(),
      createdAt: new Date().toISOString()
    };
    this.sessions.unshift(session);
    localStorage.setItem('mm_teaching_sessions', JSON.stringify(this.sessions));
    this.pushLessonInAgenda(session);
    void this.syncSupabaseEvents();
    this.sessionForm.reset({
      date: '',
      lessonType: 'private',
      studentId: '',
      schoolId: '',
      hours: 1,
      rateMode: 'per_hour',
      rateValue: 0,
      studentsCount: 1,
      invoiceMode: 'fattura',
      paymentCadence: 'prestazione',
      monthlySettlement: 'acconto',
      contactId: '',
      notes: ''
    });
    this.creatorMode = 'none';
  }

  setCreatorMode(mode: 'none' | 'school' | 'student' | 'lesson'): void {
    this.creatorMode = this.creatorMode === mode ? 'none' : mode;
  }

  schoolLink(code: string): string {
    return `${window.location.origin}/school/${code}`;
  }

  copySchoolLink(code: string): void {
    navigator.clipboard.writeText(this.schoolLink(code)).then(() => {
      this.codeCopied = code;
      setTimeout(() => this.codeCopied = null, 1500);
    });
  }

  studentName(studentId: string | null): string {
    if (!studentId) return '—';
    return this.students.find(x => x.id === studentId)?.fullName || '—';
  }

  schoolName(schoolId: string | null): string {
    if (!schoolId) return '—';
    return this.schools.find(x => x.id === schoolId)?.name || '—';
  }

  get schoolContacts(): ContactEntry[] {
    return this.contactsByType('school');
  }

  get studentContacts(): ContactEntry[] {
    return this.contactsByType('student');
  }

  get contactsByPriority(): ContactEntry[] {
    return [...this.contacts].sort((a, b) => b.priority - a.priority || a.displayName.localeCompare(b.displayName));
  }

  toggleNewContact(target: 'school' | 'student' | 'session'): void {
    this.showNewContactForSchool = target === 'school' ? !this.showNewContactForSchool : this.showNewContactForSchool;
    this.showNewContactForStudent = target === 'student' ? !this.showNewContactForStudent : this.showNewContactForStudent;
    this.showNewContactForSession = target === 'session' ? !this.showNewContactForSession : this.showNewContactForSession;
    if (target === 'school') this.newContact.type = 'school';
    if (target === 'student') this.newContact.type = 'student';
  }

  saveInlineContact(target: 'school' | 'student' | 'session'): void {
    const name = `${this.newContact.displayName || ''}`.trim();
    if (!name) return;
    const all = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const created = {
      id: crypto.randomUUID(),
      type: target === 'school' ? 'school' : (target === 'student' ? 'student' : this.newContact.type),
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
    if (target === 'school') this.schoolForm.patchValue({ contactId: created.id });
    if (target === 'student') this.studentForm.patchValue({ contactId: created.id });
    if (target === 'session') this.sessionForm.patchValue({ contactId: created.id });
    const mode = created.billingMode === 'in_fattura' ? 'fattura' : 'non_fattura';
    if (target === 'session') {
      this.sessionForm.patchValue({
        invoiceMode: mode,
        paymentCadence: created.paymentCadence,
        monthlySettlement: created.monthlySettlement
      });
    }
    this.showNewContactForSchool = false;
    this.showNewContactForStudent = false;
    this.showNewContactForSession = false;
    this.newContact = {
      type: 'school',
      displayName: '',
      priority: 3,
      averageFee: 0,
      billingMode: 'in_fattura',
      paymentCadence: 'prestazione',
      monthlySettlement: 'acconto'
    };
  }

  onSessionContactChange(): void {
    const id = `${this.sessionForm.get('contactId')?.value || ''}`;
    const selected = this.contacts.find(c => c.id === id);
    if (!selected) return;
    if (!(Number(this.sessionForm.get('rateValue')?.value || 0)) && selected.averageFee > 0) {
      this.sessionForm.patchValue({ rateValue: selected.averageFee });
    }
    this.sessionForm.patchValue({
      invoiceMode: selected.billingMode === 'in_fattura' ? 'fattura' : 'non_fattura',
      paymentCadence: selected.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: selected.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto'
    });
  }

  markAttendance(session: TeachingSession, status: 'present' | 'absent'): void {
    this.sessions = this.sessions.map(item => item.id === session.id ? { ...item, attendanceStatus: status } : item);
    localStorage.setItem('mm_teaching_sessions', JSON.stringify(this.sessions));
  }

  sessionPaidAmount(session: TeachingSession): number {
    return this.servicePayments
      .filter(payment => payment.category === 'lezione' && payment.eventId === session.id)
      .reduce((sum, payment) => sum + Number(payment.receivedAmount || 0), 0);
  }

  paymentStatusLabel(session: TeachingSession): string {
    const due = Number(session.compensation || 0);
    const paid = this.sessionPaidAmount(session);
    if (paid <= 0) return 'Da pagare';
    if (paid >= due) return 'Pagato';
    return 'Parziale';
  }

  paymentPendingAmount(session: TeachingSession): number {
    return Math.max(0, Number(session.compensation || 0) - this.sessionPaidAmount(session));
  }

  studentSessions(studentId: string): TeachingSession[] {
    return this.sessions.filter(session => session.studentId === studentId);
  }

  studentPresenceCount(studentId: string): number {
    return this.studentSessions(studentId).filter(session => session.attendanceStatus !== 'absent').length;
  }

  studentAbsenceCount(studentId: string): number {
    return this.studentSessions(studentId).filter(session => session.attendanceStatus === 'absent').length;
  }

  schoolStudents(schoolId: string): Student[] {
    return this.students.filter(student => student.schoolId === schoolId);
  }

  schoolSessionCount(schoolId: string): number {
    return this.sessions.filter(session => session.schoolId === schoolId).length;
  }

  private pushLessonInAgenda(session: TeachingSession): void {
    const events: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const title = session.schoolId ? `Lezione scuola - ${this.schoolName(session.schoolId)}` : `Lezione privata - ${this.studentName(session.studentId)}`;
    const event: EventDetail = {
      id: session.id,
      title,
      date: session.date,
      timeStart: '16:00',
      type: 'lesson',
      venue: session.schoolId ? this.schoolName(session.schoolId) : 'Lezione privata',
      address: '',
      grossFee: session.compensation,
      netFee: session.compensation,
      band: [],
      status: 'confirmed',
      notes: `${session.notes || ''}${session.paymentCadence === 'mensile' ? ` • [Pagamento mensile: ${session.monthlySettlement}]` : ' • [Pagamento a prestazione: saldo immediato]'}`,
      createdAt: session.createdAt
    };
    const next = events.filter(e => e.id !== event.id);
    next.push(event);
    localStorage.setItem('mm_events', JSON.stringify(next));
  }

  private mergeLessonsFromAgenda(current: TeachingSession[]): TeachingSession[] {
    const events: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const byId = new Map(current.map(session => [session.id, session]));
    events
      .filter(event => event.type === 'lesson')
      .forEach(event => {
        if (byId.has(event.id)) return;
        const paymentCadence = `${event.notes || ''}`.toLowerCase().includes('pagamento mensile') ? 'mensile' : 'prestazione';
        const monthlySettlement = `${event.notes || ''}`.toLowerCase().includes('bonifico') ? 'bonifico' : 'acconto';
        byId.set(event.id, {
          id: event.id,
          date: event.date || '',
          lessonType: 'private',
          studentId: null,
          schoolId: null,
          hours: 1,
          rateMode: 'per_hour',
          rateValue: Number(event.grossFee || 0),
          studentsCount: 1,
          compensation: Number(event.grossFee || 0),
          invoiceMode: event.compensoType === 'in_fattura' ? 'fattura' : 'non_fattura',
          paymentCadence,
          monthlySettlement,
          contactId: null,
          attendanceStatus: event.status === 'cancelled' ? 'absent' : 'present',
          notes: `${event.notes || ''}`.trim(),
          createdAt: event.createdAt || new Date().toISOString()
        });
      });
    return [...byId.values()].sort((a, b) => `${b.date}|${b.createdAt}`.localeCompare(`${a.date}|${a.createdAt}`));
  }

  private async syncSupabaseEvents(): Promise<void> {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const musicianId = `${profile.id || ''}`.trim();
    if (!musicianId) return;
    try {
      await this.supabase.syncEventsFromLocalStorage(musicianId);
    } catch {}
  }

  private nextSchoolCode(): string {
    const max = this.schools
      .map(s => Number((s.code || '').replace('SC', '')))
      .filter(n => Number.isFinite(n))
      .reduce((acc, n) => Math.max(acc, n), 0);
    return `SC${String(max + 1).padStart(4, '0')}`;
  }

  private contactsByType(type: 'school' | 'student'): ContactEntry[] {
    return this.contactsByPriority.filter(c => c.type === type);
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
