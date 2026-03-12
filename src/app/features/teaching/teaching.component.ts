import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { EventDetail } from '../../models/event-detail';

type School = {
  id: string;
  name: string;
  code: string;
  hourlyRate: number;
  perStudentRate: number;
  invoiceMode: 'fattura' | 'non_fattura';
  createdAt: string;
};

type Student = {
  id: string;
  fullName: string;
  schoolId: string | null;
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
  notes: string;
  createdAt: string;
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

  schoolForm = this.fb.group({
    name: ['', Validators.required],
    hourlyRate: [0, Validators.min(0)],
    perStudentRate: [0, Validators.min(0)],
    invoiceMode: ['fattura']
  });

  studentForm = this.fb.group({
    fullName: ['', Validators.required],
    schoolId: ['']
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
    notes: ['']
  });

  constructor(private fb: FormBuilder) {}

  ngOnInit(): void {
    this.schools = JSON.parse(localStorage.getItem('mm_teaching_schools') || '[]');
    this.students = JSON.parse(localStorage.getItem('mm_teaching_students') || '[]');
    this.sessions = JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]');
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
      createdAt: new Date().toISOString()
    };
    this.schools.unshift(school);
    localStorage.setItem('mm_teaching_schools', JSON.stringify(this.schools));
    this.schoolForm.reset({ name: '', hourlyRate: 0, perStudentRate: 0, invoiceMode: 'fattura' });
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
      createdAt: new Date().toISOString()
    };
    this.students.unshift(student);
    localStorage.setItem('mm_teaching_students', JSON.stringify(this.students));
    this.studentForm.reset({ fullName: '', schoolId: '' });
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
      notes: `${v.notes || ''}`.trim(),
      createdAt: new Date().toISOString()
    };
    this.sessions.unshift(session);
    localStorage.setItem('mm_teaching_sessions', JSON.stringify(this.sessions));
    this.pushLessonInAgenda(session);
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
      notes: ''
    });
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
      notes: session.notes,
      createdAt: session.createdAt
    };
    const next = events.filter(e => e.id !== event.id);
    next.push(event);
    localStorage.setItem('mm_events', JSON.stringify(next));
  }

  private nextSchoolCode(): string {
    const max = this.schools
      .map(s => Number((s.code || '').replace('SC', '')))
      .filter(n => Number.isFinite(n))
      .reduce((acc, n) => Math.max(acc, n), 0);
    return `SC${String(max + 1).padStart(4, '0')}`;
  }
}
