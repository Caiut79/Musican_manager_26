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
  timeStart: string;
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
  homeworkAssigned: string;
  homeworkDone: string;
  simpleGrade: number | null;
  gradeTechnique: number | null;
  gradeSound: number | null;
  gradeRhythm: number | null;
  gradeTheory: number | null;
  gradeExpression: number | null;
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

type GradeMode = 'simple' | 'categories';
type GradeCategoryKey = 'gradeTechnique' | 'gradeSound' | 'gradeRhythm' | 'gradeTheory' | 'gradeExpression';

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
  showLessonReminder = false;
  reminderLeadMinutes = 45;
  reminderSession: TeachingSession | null = null;
  reminderDismissedForSessionId = '';
  gradingEnabled = false;
  gradingMode: GradeMode = 'simple';
  expandedSessionId = '';
  expandedStudentId = '';
  expandedSchoolId = '';
  expandedSchoolStudentId = '';
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
    timeStart: ['16:00', Validators.required],
    lessonType: ['private'],
    studentId: ['', Validators.required],
    schoolId: [''],
    hours: [1, Validators.min(0)],
    rateMode: ['per_hour'],
    rateValue: [0, Validators.min(0)],
    studentsCount: [1, Validators.min(1)],
    invoiceMode: ['fattura'],
    paymentCadence: ['prestazione'],
    monthlySettlement: ['acconto'],
    contactId: [''],
    homeworkAssigned: [''],
    homeworkDone: [''],
    simpleGrade: [null as number | null],
    gradeTechnique: [null as number | null],
    gradeSound: [null as number | null],
    gradeRhythm: [null as number | null],
    gradeTheory: [null as number | null],
    gradeExpression: [null as number | null],
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
    this.sessions = this.normalizeSessions(JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]'));
    this.servicePayments = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
    this.contacts = this.readContacts();
    this.sessions = this.normalizeSessions(this.mergeLessonsFromAgenda(this.sessions));
    localStorage.setItem('mm_teaching_sessions', JSON.stringify(this.sessions));
    const savedLead = Number(localStorage.getItem('mm_teaching_reminder_lead_min') || 45);
    this.reminderLeadMinutes = Number.isFinite(savedLead) && savedLead >= 5 ? savedLead : 45;
    this.gradingEnabled = localStorage.getItem('mm_teaching_grading_enabled') === '1';
    const savedMode = `${localStorage.getItem('mm_teaching_grading_mode') || 'simple'}`;
    this.gradingMode = savedMode === 'categories' ? 'categories' : 'simple';
    this.tryOpenLessonReminder();
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
      timeStart: `${v.timeStart || '16:00'}`,
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
      homeworkAssigned: `${v.homeworkAssigned || ''}`.trim(),
      homeworkDone: `${v.homeworkDone || ''}`.trim(),
      simpleGrade: this.parseGradeValue(v.simpleGrade),
      gradeTechnique: this.parseGradeValue(v.gradeTechnique),
      gradeSound: this.parseGradeValue(v.gradeSound),
      gradeRhythm: this.parseGradeValue(v.gradeRhythm),
      gradeTheory: this.parseGradeValue(v.gradeTheory),
      gradeExpression: this.parseGradeValue(v.gradeExpression),
      notes: `${v.notes || ''}`.trim(),
      createdAt: new Date().toISOString()
    };
    this.sessions.unshift(session);
    localStorage.setItem('mm_teaching_sessions', JSON.stringify(this.sessions));
    this.pushLessonInAgenda(session);
    void this.syncSupabaseEvents();
    this.sessionForm.reset({
      date: '',
      timeStart: '16:00',
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
      homeworkAssigned: '',
      homeworkDone: '',
      simpleGrade: null,
      gradeTechnique: null,
      gradeSound: null,
      gradeRhythm: null,
      gradeTheory: null,
      gradeExpression: null,
      notes: ''
    });
    this.creatorMode = 'none';
  }

  toggleSessionExpanded(sessionId: string): void {
    this.expandedSessionId = this.expandedSessionId === sessionId ? '' : sessionId;
  }

  toggleStudentExpanded(studentId: string): void {
    this.expandedStudentId = this.expandedStudentId === studentId ? '' : studentId;
  }

  toggleSchoolExpanded(schoolId: string): void {
    this.expandedSchoolId = this.expandedSchoolId === schoolId ? '' : schoolId;
    if (this.expandedSchoolId !== schoolId) this.expandedSchoolStudentId = '';
  }

  toggleSchoolStudentExpanded(studentId: string): void {
    this.expandedSchoolStudentId = this.expandedSchoolStudentId === studentId ? '' : studentId;
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
    void this.syncSupabaseContacts();
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
    const updated = this.sessions.find(item => item.id === session.id) || { ...session, attendanceStatus: status };
    this.pushLessonInAgenda(updated);
    void this.syncSupabaseEvents();
  }

  persistSessionRecord(session: TeachingSession): void {
    this.sessions = this.sessions.map(item => item.id === session.id
      ? {
          ...item,
          homeworkAssigned: `${session.homeworkAssigned || ''}`,
          homeworkDone: `${session.homeworkDone || ''}`,
          simpleGrade: this.parseGradeValue(session.simpleGrade),
          gradeTechnique: this.parseGradeValue(session.gradeTechnique),
          gradeSound: this.parseGradeValue(session.gradeSound),
          gradeRhythm: this.parseGradeValue(session.gradeRhythm),
          gradeTheory: this.parseGradeValue(session.gradeTheory),
          gradeExpression: this.parseGradeValue(session.gradeExpression)
        }
      : item);
    localStorage.setItem('mm_teaching_sessions', JSON.stringify(this.sessions));
    this.pushLessonInAgenda(this.sessions.find(s => s.id === session.id) || session);
    void this.syncSupabaseEvents();
  }

  onGradingSettingsChanged(): void {
    localStorage.setItem('mm_teaching_grading_enabled', this.gradingEnabled ? '1' : '0');
    localStorage.setItem('mm_teaching_grading_mode', this.gradingMode);
  }

  sendHomeworkOnWhatsApp(session: TeachingSession): void {
    const studentName = this.studentName(session.studentId);
    const text = [
      `Compiti lezione - ${studentName}`,
      `Data: ${session.date} ${session.timeStart || ''}`.trim(),
      session.homeworkAssigned ? `Da studiare: ${session.homeworkAssigned}` : '',
      session.homeworkDone ? `Fatto in lezione: ${session.homeworkDone}` : ''
    ].filter(Boolean).join('\n');
    if (!text) return;
    const target = this.sessionWhatsAppNumber(session);
    const phonePart = target ? `${target}` : '';
    const url = `https://wa.me/${phonePart}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  onReminderLeadMinutesChange(value: number): void {
    const n = Number(value || 0);
    this.reminderLeadMinutes = Number.isFinite(n) && n >= 5 ? n : 45;
    localStorage.setItem('mm_teaching_reminder_lead_min', String(this.reminderLeadMinutes));
    this.tryOpenLessonReminder();
  }

  closeLessonReminder(): void {
    if (this.reminderSession) {
      this.reminderDismissedForSessionId = this.reminderSession.id;
      localStorage.setItem('mm_teaching_last_dismissed_reminder', `${this.reminderSession.id}|${this.todayIso()}`);
    }
    this.showLessonReminder = false;
    this.reminderSession = null;
  }

  markReminderSessionAttendance(status: 'present' | 'absent'): void {
    if (!this.reminderSession) return;
    this.markAttendance(this.reminderSession, status);
    this.closeLessonReminder();
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

  studentSessionsSorted(studentId: string): TeachingSession[] {
    return this.studentSessions(studentId)
      .slice()
      .sort((a, b) => `${b.date} ${b.timeStart || ''}`.localeCompare(`${a.date} ${a.timeStart || ''}`));
  }

  studentPresenceCount(studentId: string): number {
    return this.studentSessions(studentId).filter(session => session.attendanceStatus !== 'absent').length;
  }

  studentAbsenceCount(studentId: string): number {
    return this.studentSessions(studentId).filter(session => session.attendanceStatus === 'absent').length;
  }

  sessionGradeAverage(session: TeachingSession): number | null {
    if (!this.gradingEnabled) return null;
    if (this.gradingMode === 'simple') return this.parseGradeValue(session.simpleGrade);
    const values = this.gradeCategoryValues(session).filter((v): v is number => v !== null);
    if (!values.length) return null;
    const sum = values.reduce((acc, n) => acc + n, 0);
    return this.round2(sum / values.length);
  }

  studentGradeAverage(studentId: string): number | null {
    const grades = this.studentSessions(studentId)
      .map(session => this.sessionGradeAverage(session))
      .filter((v): v is number => v !== null);
    if (!grades.length) return null;
    return this.round2(grades.reduce((a, b) => a + b, 0) / grades.length);
  }

  studentGradeCount(studentId: string): number {
    return this.studentSessions(studentId).filter(session => this.sessionGradeAverage(session) !== null).length;
  }

  studentCategoryAverage(studentId: string, category: GradeCategoryKey): number | null {
    if (this.gradingMode !== 'categories' || !this.gradingEnabled) return null;
    const values = this.studentSessions(studentId)
      .map(session => this.parseGradeValue(session[category]))
      .filter((v): v is number => v !== null);
    if (!values.length) return null;
    return this.round2(values.reduce((a, b) => a + b, 0) / values.length);
  }

  exportStudentReportPdf(student: Student): void {
    const rows = this.studentSessions(student.id)
      .slice()
      .sort((a, b) => `${a.date} ${a.timeStart}`.localeCompare(`${b.date} ${b.timeStart}`));
    const avg = this.studentGradeAverage(student.id);
    const avgText = avg === null ? 'N/D' : avg.toFixed(2);
    const categoryRows: Array<{ label: string; value: number | null }> = this.gradingEnabled && this.gradingMode === 'categories'
      ? [
          { label: 'Tecnica', value: this.studentCategoryAverage(student.id, 'gradeTechnique') },
          { label: 'Suono', value: this.studentCategoryAverage(student.id, 'gradeSound') },
          { label: 'Ritmo', value: this.studentCategoryAverage(student.id, 'gradeRhythm') },
          { label: 'Teoria', value: this.studentCategoryAverage(student.id, 'gradeTheory') },
          { label: 'Espressione', value: this.studentCategoryAverage(student.id, 'gradeExpression') }
        ]
      : [];
    const htmlRows = rows.map(session => {
      const presence = session.attendanceStatus === 'absent' ? 'Assente' : 'Presente';
      const grade = this.sessionGradeAverage(session);
      const gradeText = grade === null ? 'N/D' : grade.toFixed(2);
      const details = this.gradingMode === 'categories'
        ? `Tec ${session.gradeTechnique ?? '-'} · Suo ${session.gradeSound ?? '-'} · Rit ${session.gradeRhythm ?? '-'} · Teo ${session.gradeTheory ?? '-'} · Esp ${session.gradeExpression ?? '-'}`
        : `${session.simpleGrade ?? '-'}`;
      return `<tr>
        <td>${this.escapeHtml(session.date)} ${this.escapeHtml(session.timeStart || '')}</td>
        <td>${this.escapeHtml(presence)}</td>
        <td>${this.escapeHtml(details)}</td>
        <td>${this.escapeHtml(gradeText)}</td>
      </tr>`;
    }).join('');
    const categoriesHtml = categoryRows.length
      ? `<div class="cats">${categoryRows.map(item => `<div><span>${item.label}</span><strong>${item.value === null ? 'N/D' : item.value.toFixed(2)}</strong></div>`).join('')}</div>`
      : '';
    const reportHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Pagella ${this.escapeHtml(student.fullName)}</title><style>
      body{font-family:Arial,sans-serif;padding:20px;color:#111827} h1{margin:0 0 6px;font-size:22px}
      .meta{color:#6b7280;margin-bottom:12px} .kpi{padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #e5e7eb;padding:8px;font-size:12px;text-align:left}
      th{background:#f8fafc} .cats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}
      .cats div{border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fafafa}
      .cats span{display:block;font-size:11px;color:#6b7280} .cats strong{font-size:14px}
    </style></head><body>
      <h1>Pagella lezioni</h1>
      <div class="meta">${this.escapeHtml(student.fullName)} · ${this.escapeHtml(new Date().toLocaleDateString('it-IT'))}</div>
      <div class="kpi"><strong>Media generale:</strong> ${this.escapeHtml(avgText)} · <strong>Lezioni valutate:</strong> ${this.studentGradeCount(student.id)}</div>
      ${categoriesHtml}
      <table><thead><tr><th>Lezione</th><th>Presenza</th><th>Voti</th><th>Media</th></tr></thead><tbody>${htmlRows || '<tr><td colspan="4">Nessuna lezione valutata</td></tr>'}</tbody></table>
    </body></html>`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.open();
    win.document.write(reportHtml);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 280);
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
      timeStart: session.timeStart || '16:00',
      type: 'lesson',
      venue: session.schoolId ? this.schoolName(session.schoolId) : 'Lezione privata',
      address: '',
      grossFee: session.compensation,
      netFee: session.compensation,
      band: [],
      status: session.attendanceStatus === 'absent' ? 'cancelled' : 'confirmed',
      notes: `${session.notes || ''}${session.homeworkAssigned ? ` • [Compiti: ${session.homeworkAssigned}]` : ''}${session.homeworkDone ? ` • [Svolto: ${session.homeworkDone}]` : ''}${session.simpleGrade !== null ? ` • [Voto: ${session.simpleGrade}]` : ''}${session.gradeTechnique !== null ? ` • [Tec: ${session.gradeTechnique}]` : ''}${session.gradeSound !== null ? ` • [Suo: ${session.gradeSound}]` : ''}${session.gradeRhythm !== null ? ` • [Rit: ${session.gradeRhythm}]` : ''}${session.gradeTheory !== null ? ` • [Teo: ${session.gradeTheory}]` : ''}${session.gradeExpression !== null ? ` • [Esp: ${session.gradeExpression}]` : ''}${session.paymentCadence === 'mensile' ? ` • [Pagamento mensile: ${session.monthlySettlement}]` : ' • [Pagamento a prestazione: saldo immediato]'}`,
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
          timeStart: event.timeStart || '16:00',
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
          homeworkAssigned: this.extractTagValue(`${event.notes || ''}`, 'compiti'),
          homeworkDone: this.extractTagValue(`${event.notes || ''}`, 'svolto'),
          simpleGrade: this.extractTagNumber(`${event.notes || ''}`, 'voto'),
          gradeTechnique: this.extractTagNumber(`${event.notes || ''}`, 'tec'),
          gradeSound: this.extractTagNumber(`${event.notes || ''}`, 'suo'),
          gradeRhythm: this.extractTagNumber(`${event.notes || ''}`, 'rit'),
          gradeTheory: this.extractTagNumber(`${event.notes || ''}`, 'teo'),
          gradeExpression: this.extractTagNumber(`${event.notes || ''}`, 'esp'),
          notes: `${event.notes || ''}`.trim(),
          createdAt: event.createdAt || new Date().toISOString()
        });
      });
    return [...byId.values()].sort((a, b) => `${b.date}|${b.createdAt}`.localeCompare(`${a.date}|${a.createdAt}`));
  }

  private tryOpenLessonReminder(): void {
    const now = new Date();
    const today = this.todayIso();
    const lastDismissedRaw = `${localStorage.getItem('mm_teaching_last_dismissed_reminder') || ''}`;
    const [dismissedId, dismissedDate] = lastDismissedRaw.split('|');
    const leadMs = Math.max(5, Number(this.reminderLeadMinutes || 45)) * 60000;
    const candidates = this.sessions
      .filter(session => session.date === today)
      .filter(session => !!session.studentId)
      .map(session => {
        const lessonDateTime = new Date(`${session.date}T${session.timeStart || '16:00'}:00`);
        return { session, lessonDateTime };
      })
      .filter(item => Number.isFinite(item.lessonDateTime.getTime()))
      .filter(item => now.getTime() >= item.lessonDateTime.getTime() - leadMs)
      .filter(item => now.getTime() <= item.lessonDateTime.getTime() + 30 * 60000)
      .sort((a, b) => a.lessonDateTime.getTime() - b.lessonDateTime.getTime());
    if (!candidates.length) return;
    const next = candidates[0].session;
    if (this.reminderDismissedForSessionId === next.id) return;
    if (dismissedId === next.id && dismissedDate === today) return;
    this.reminderSession = next;
    this.showLessonReminder = true;
  }

  private sessionWhatsAppNumber(session: TeachingSession): string {
    const contactId = `${session.contactId || ''}`;
    if (!contactId) return '';
    const rawContacts = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const contact = Array.isArray(rawContacts) ? rawContacts.find((x: any) => `${x?.id || ''}` === contactId) : null;
    const raw = `${contact?.phone || contact?.parentPhone || ''}`.trim();
    return raw.replace(/[^\d]/g, '');
  }

  private todayIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private extractTagValue(notes: string, tag: string): string {
    const re = new RegExp(`\\[${tag}:([^\\]]+)\\]`, 'i');
    const match = `${notes || ''}`.match(re);
    return match?.[1] ? match[1].trim() : '';
  }

  private extractTagNumber(notes: string, tag: 'voto' | 'tec' | 'suo' | 'rit' | 'teo' | 'esp'): number | null {
    const value = this.extractTagValue(`${notes || ''}`, tag);
    const n = Number(value);
    return Number.isFinite(n) ? this.parseGradeValue(n) : null;
  }

  private normalizeSessions(raw: any[]): TeachingSession[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): TeachingSession => ({
      id: `${x?.id || crypto.randomUUID()}`,
      date: `${x?.date || ''}`,
      timeStart: `${x?.timeStart || '16:00'}`,
      lessonType: x?.lessonType === 'school' || x?.lessonType === 'collaboration' ? x.lessonType : 'private',
      studentId: x?.studentId ? `${x.studentId}` : null,
      schoolId: x?.schoolId ? `${x.schoolId}` : null,
      hours: Number(x?.hours || 1),
      rateMode: x?.rateMode === 'per_student' ? 'per_student' : 'per_hour',
      rateValue: Number(x?.rateValue || 0),
      studentsCount: Math.max(1, Number(x?.studentsCount || 1)),
      compensation: Number(x?.compensation || 0),
      invoiceMode: x?.invoiceMode === 'non_fattura' ? 'non_fattura' : 'fattura',
      paymentCadence: x?.paymentCadence === 'mensile' ? 'mensile' : 'prestazione',
      monthlySettlement: x?.monthlySettlement === 'bonifico' ? 'bonifico' : 'acconto',
      contactId: x?.contactId ? `${x.contactId}` : null,
      attendanceStatus: x?.attendanceStatus === 'absent' ? 'absent' : 'present',
      homeworkAssigned: `${x?.homeworkAssigned || ''}`,
      homeworkDone: `${x?.homeworkDone || ''}`,
      simpleGrade: this.parseGradeValue(x?.simpleGrade),
      gradeTechnique: this.parseGradeValue(x?.gradeTechnique),
      gradeSound: this.parseGradeValue(x?.gradeSound),
      gradeRhythm: this.parseGradeValue(x?.gradeRhythm),
      gradeTheory: this.parseGradeValue(x?.gradeTheory),
      gradeExpression: this.parseGradeValue(x?.gradeExpression),
      notes: `${x?.notes || ''}`,
      createdAt: `${x?.createdAt || new Date().toISOString()}`
    }));
  }

  private parseGradeValue(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return this.round2(Math.max(0, Math.min(10, n)));
  }

  private gradeCategoryValues(session: TeachingSession): Array<number | null> {
    return [
      this.parseGradeValue(session.gradeTechnique),
      this.parseGradeValue(session.gradeSound),
      this.parseGradeValue(session.gradeRhythm),
      this.parseGradeValue(session.gradeTheory),
      this.parseGradeValue(session.gradeExpression)
    ];
  }

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  private escapeHtml(value: string): string {
    return `${value || ''}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async syncSupabaseEvents(): Promise<void> {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const musicianId = `${profile.id || ''}`.trim();
    if (!musicianId) return;
    try {
      await this.supabase.syncEventsFromLocalStorage(musicianId);
    } catch {}
  }

  private async syncSupabaseContacts(): Promise<void> {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const musicianId = `${profile.id || ''}`.trim();
    if (!musicianId) return;
    try {
      await this.supabase.syncContactsFromLocalStorage(musicianId);
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
