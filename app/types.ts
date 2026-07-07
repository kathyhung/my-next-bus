export type Operator = "KMB" | "CTB";
export type Bound = "I" | "O";
export type Language = "en" | "tc";

export interface RouteVariant {
  operator: Operator;
  route: string;
  bound: Bound;
  serviceType: number;
  originEn: string;
  originTc: string;
  destinationEn: string;
  destinationTc: string;
}

export interface StopOption {
  stopId: string;
  seq: number;
  nameEn: string;
  nameTc: string;
}

export interface FavouriteJourney extends RouteVariant, StopOption {
  id: string;
}

export interface RouteSheet {
  id: string;
  name: string;
  journeys: FavouriteJourney[];
}

export interface EtaRecord {
  timestamp: number;
  etaSequence: number;
  remarkEn: string;
  remarkTc: string;
}

export interface JourneyEtaState {
  records: EtaRecord[];
  fetchedAt: number;
  generatedAt?: string;
  loading: boolean;
  error?: string;
}
