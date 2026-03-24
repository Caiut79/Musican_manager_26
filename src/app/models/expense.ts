export type ExpenseExtra = {
  label: string;
  amount: number;
};

export type Expense = {
  id: string;
  eventId?: string;
  date: string;
  origin: string;
  destination: string;
  originLat?: number;
  originLon?: number;
  destLat?: number;
  destLon?: number;
  distanceKm: number;
  fuelCostPerKm: number;
  fuelPricePerLiter?: number;
  vehicleConsumption?: number;
  vehicleConsumptionMode?: 'l_km' | 'km_l' | 'l_100km';
  vehicleModel?: string;
  vehicleFuelType?: 'benzina' | 'diesel' | 'gpl' | 'metano' | 'ibrido' | 'elettrico' | 'altro';
  extras: ExpenseExtra[];
  totalFuel: number;
  totalExtras: number;
  tollEstimatedOneWay?: number | null;
  tollEstimatedRoundTrip?: number | null;
  tollProvider?: string;
  tollBoothsCount?: number | null;
  routeLabel?: string;
  durationMin?: number;
  totalExpense: number;
  createdAt: string;
};
