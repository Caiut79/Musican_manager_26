import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type ConcertRecord = {
  id: string;
  title: string;
  date: string;
  timeStart: string;
  venue: string;
  address: string;
  lineupType: string;
  agreedFee: number;
  reimbursement: number;
  notes: string;
  bands: string[];
  musicians: string[];
  createdAt: string;
};

@Component({
  selector: 'app-concert-confirmation',
  templateUrl: './concert-confirmation.component.html',
  styleUrls: ['./concert-confirmation.component.scss']
})
export class ConcertConfirmationComponent implements OnInit {
  concert: ConcertRecord | null = null;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    const list: ConcertRecord[] = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    this.concert = list.find(x => x.id === id) || null;
  }

  printPdf(): void {
    window.print();
  }
}
