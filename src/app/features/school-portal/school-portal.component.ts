import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type School = {
  id: string;
  name: string;
  code: string;
};

type Student = {
  id: string;
  fullName: string;
  schoolId: string | null;
};

type TeachingSession = {
  id: string;
  date: string;
  schoolId: string | null;
  compensation: number;
  invoiceMode: 'fattura' | 'non_fattura';
};

@Component({
  selector: 'app-school-portal',
  templateUrl: './school-portal.component.html',
  styleUrls: ['./school-portal.component.scss']
})
export class SchoolPortalComponent implements OnInit {
  school: School | null = null;
  students: Student[] = [];
  sessions: TeachingSession[] = [];

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const code = (this.route.snapshot.paramMap.get('code') || '').toUpperCase();
    const schools: School[] = JSON.parse(localStorage.getItem('mm_teaching_schools') || '[]');
    this.school = schools.find(s => s.code === code) || null;
    if (!this.school) return;
    const allStudents: Student[] = JSON.parse(localStorage.getItem('mm_teaching_students') || '[]');
    const allSessions: TeachingSession[] = JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]');
    this.students = allStudents.filter(s => s.schoolId === this.school?.id);
    this.sessions = allSessions.filter(s => s.schoolId === this.school?.id);
  }

  get totalCompensation(): number {
    return this.sessions.reduce((sum, s) => sum + Number(s.compensation || 0), 0);
  }
}
