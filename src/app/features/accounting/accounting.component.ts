import { Component, OnInit } from '@angular/core';
import { EventDetail } from '../../models/event-detail';
import { Expense } from '../../models/expense';

type Period = { value: string; label: string };

@Component({
  selector: 'app-accounting',
  templateUrl: './accounting.component.html',
  styleUrls: ['./accounting.component.scss']
})
export class AccountingComponent implements OnInit {
  events: EventDetail[] = [];
  expenses: Expense[] = [];
  selectedPeriod = '';
  periods: Period[] = [];

  ngOnInit() {
    this.events  = JSON.parse(localStorage.getItem('mm_events') || '[]');
    this.expenses = JSON.parse(localStorage.getItem('mm_expenses') || '[]');

    const monthSet = new Set([
      ...this.events.map(e => e.date.substring(0, 7)),
      ...this.expenses.map(e => e.date.substring(0, 7)),
    ]);
    this.periods = Array.from(monthSet)
      .sort()
      .reverse()
      .map(m => ({ value: m, label: this.formatMonth(m) }));

    this.selectedPeriod = this.periods[0]?.value || '';
  }

  private formatMonth(ym: string): string {
    const [y, m] = ym.split('-');
    const names = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    return `${names[+m - 1]} ${y}`;
  }

  get filteredEvents(): EventDetail[] {
    if (!this.selectedPeriod) return this.events;
    return this.events.filter(e => e.date.startsWith(this.selectedPeriod));
  }

  get filteredExpenses(): Expense[] {
    if (!this.selectedPeriod) return this.expenses;
    return this.expenses.filter(e => e.date.startsWith(this.selectedPeriod));
  }

  get totalGross(): number  { return this.filteredEvents.reduce((s, e) => s + (e.grossFee || 0), 0); }
  get totalNet(): number    { return this.filteredEvents.reduce((s, e) => s + (e.netFee || 0), 0); }
  get totalExpenses(): number { return this.filteredExpenses.reduce((s, e) => s + (e.totalExpense || 0), 0); }
  get balance(): number     { return this.totalNet - this.totalExpenses; }

  formatDate(d: string): string {
    return new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  }
}
