
export interface ReceiptItem {
  item_name: string;
  quantity: number;
  price: number;
  confidence_score: number;
  notes?: string;
}

export interface ReceiptData {
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
}

export interface AssignedItem {
  item_name: string;
  price: number;
}

export interface PersonSplit {
  person_name: string;
  items: AssignedItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
}

export type BillSplit = PersonSplit[];

export interface ChatMessage {
  sender: 'user' | 'bot' | 'system';
  text: string;
}