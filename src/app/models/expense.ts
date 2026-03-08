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
  extras: ExpenseExtra[];
  totalFuel: number;
  totalExtras: number;
  totalExpense: number;
  createdAt: string;
};
