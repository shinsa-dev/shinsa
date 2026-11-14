export interface MatchRange {
  start: number;
  end: number;
}

export interface TextMatch {
  score: number;
  ranges: MatchRange[];
}

export interface SearchField {
  text: string;
  lowered: string;
  weight: number;
  fuzzy: boolean;
}
