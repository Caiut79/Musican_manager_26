import { Component, OnInit } from '@angular/core';

type ConcertRecord = {
  agreedFee: number;
  reimbursement: number;
};

type TeachingSession = {
  compensation: number;
};

type ExpenseRecord = {
  totalExpense: number;
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

  ngOnInit(): void {
    const concerts: ConcertRecord[] = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    const teaching: TeachingSession[] = JSON.parse(localStorage.getItem('mm_teaching_sessions') || '[]');
    const expenses: ExpenseRecord[] = JSON.parse(localStorage.getItem('mm_expenses') || '[]');
    this.concertIncome = concerts.reduce((sum, c) => sum + Number(c.agreedFee || 0) + Number(c.reimbursement || 0), 0);
    this.teachingIncome = teaching.reduce((sum, t) => sum + Number(t.compensation || 0), 0);
    this.expenseTotal = expenses.reduce((sum, e) => sum + Number(e.totalExpense || 0), 0);
    this.grossTotal = this.concertIncome + this.teachingIncome;
    this.netTotal = this.grossTotal - this.expenseTotal;
  }
}
