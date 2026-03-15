import { Component, OnInit } from '@angular/core';

type ConcertRecord = {
  agreedFee: number;
  reimbursement: number;
  title?: string;
  venue?: string;
  bands?: string[];
  contactId?: string | null;
};

type TeachingSession = {
  compensation: number;
  studentId?: string | null;
  schoolId?: string | null;
};

type ExpenseRecord = {
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

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.scss']
})
export class ReportsComponent implements OnInit {
  concertIncome = 0;
  teachingIncome = 0;
  expenseTotal = 0;
  grossTotal = 0;
  netTotal = 0;
  isTeacherProfile = false;
  concertCompByGroup: AggregateRow[] = [];
  lessonCompByStudent: AggregateRow[] = [];
  lessonCompBySchool: AggregateRow[] = [];
  totalConcertSessions = 0;
  totalLessonSessions = 0;

  ngOnInit(): void {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.isTeacherProfile = profile?.isTeacher === true;
    const concerts: ConcertRecord[] = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    const teaching: TeachingSession[] = this.isTeacherProfile
      ? JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]')
      : [];
    const expenses: ExpenseRecord[] = JSON.parse(localStorage.getItem('mm_expenses') || '[]');
    const contacts: ContactRecord[] = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    const students: StudentRecord[] = JSON.parse(localStorage.getItem('mm_teaching_students') || '[]');
    const schools: SchoolRecord[] = JSON.parse(localStorage.getItem('mm_teaching_schools') || '[]');
    this.concertIncome = concerts.reduce((sum, c) => sum + Number(c.agreedFee || 0) + Number(c.reimbursement || 0), 0);
    this.teachingIncome = teaching.reduce((sum, t) => sum + Number(t.compensation || 0), 0);
    this.expenseTotal = expenses.reduce((sum, e) => sum + Number(e.totalExpense || 0), 0);
    this.grossTotal = this.concertIncome + this.teachingIncome;
    this.netTotal = this.grossTotal - this.expenseTotal;
    this.concertCompByGroup = this.buildConcertAggregates(concerts, contacts);
    this.lessonCompByStudent = this.buildLessonByStudentAggregates(teaching, students);
    this.lessonCompBySchool = this.buildLessonBySchoolAggregates(teaching, schools);
    this.totalConcertSessions = concerts.length;
    this.totalLessonSessions = teaching.length;
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
}
