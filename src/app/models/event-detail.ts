export type BandMember = {
  name: string;
  instrument?: string;
};

export type EventDetail = {
  id: string;
  title: string;
  date: string;
  timeStart: string;
  timeEnd?: string;
  venue: string;
  address: string;
  type: 'concert' | 'lesson' | 'rehearsal' | 'other';
  band: BandMember[];
  grossFee: number;
  netFee: number;
  compensoType?: 'fuori_fattura' | 'in_fattura';
  notes?: string;
  status: 'confirmed' | 'pending' | 'cancelled';
  createdAt: string;
};
