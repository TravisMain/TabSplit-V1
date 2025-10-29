import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- TYPES (from types.ts) ---
type ReceiptItem = {
  item_name: string;
  quantity: number;
  price: number;
  confidence_score: number;
  notes?: string;
};

type ReceiptData = {
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
};

type AssignedItem = {
  item_name: string;
  price: number;
};

type PersonSplit = {
  person_name: string;
  items: AssignedItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
};

type BillSplit = PersonSplit[];

type ChatMessage = {
  sender: 'user' | 'bot' | 'system';
  text: string;
};

// --- UTILS (from utils/file.ts) ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // remove "data:image/jpeg;base64," prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

const formatCurrency = (amount: number) => {
    return amount.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' });
};


// --- GEMINI SERVICE (from services/geminiService.ts) ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const model = "gemini-2.5-flash";

const receiptSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      description: "List of all items on the receipt.",
      items: {
        type: Type.OBJECT,
        properties: {
          item_name: { type: Type.STRING, description: "Name of the item." },
          quantity: { type: Type.NUMBER, description: "Quantity of the item." },
          price: { type: Type.NUMBER, description: "Total price for this line item (quantity * unit price), after any discounts." },
          confidence_score: { type: Type.NUMBER, description: "Confidence score (0.0 to 1.0) for the accuracy of this extracted line item." },
          notes: { type: Type.STRING, description: "Optional notes for the item, such as applied discounts, bundled item details, or ambiguities." },
        },
        required: ["item_name", "quantity", "price", "confidence_score"],
      },
    },
    subtotal: { type: Type.NUMBER, description: "The subtotal before tax and tip." },
    tax: { type: Type.NUMBER, description: "The total tax amount." },
    tip: { type: Type.NUMBER, description: "The total tip or gratuity amount." },
    total: { type: Type.NUMBER, description: "The final total amount (subtotal + tax + tip)." },
  },
  required: ["items", "subtotal", "tax", "tip", "total"],
};

const parseReceipt = async (image: {
  inlineData: { data: string; mimeType: string };
}): Promise<ReceiptData> => {
  const prompt = `
You are an expert receipt-parsing AI. Analyze the receipt image with high precision and extract all line items, their quantities, prices, along with the subtotal, tax, tip, and total amount. Return the data in the specified JSON format.

**Key Extraction Rules:**
1.  **Line Items:** Extract each item's name, quantity, and total line price.
2.  **Confidence Score:** For each item, provide a \`confidence_score\` between 0.0 and 1.0. A score of 1.0 means you are absolutely certain about the item name, quantity, and price. A lower score indicates ambiguity, poor image quality for that line, or complex interpretation.
3.  **Discounts:** If a discount is applied to a specific item, the \`price\` for that item should be the *final price after the discount*. Mention the original price and the discount in the \`notes\` field (e.g., "Discounted from R12.00").
4.  **Bundled Items:** For bundled items like "Meal Deals," treat the bundle as a single item. List the main bundle name as the \`item_name\` and list the components in the \`notes\` field (e.g., "Includes a sandwich and a drink").
5.  **Ambiguity:** If an item name is handwritten or blurry, make your best guess for the \`item_name\` and explain the ambiguity in the \`notes\` field. Assign a lower \`confidence_score\`.
6.  **Totals Validation:** Critically, ensure the sum of all item prices, tax, and tip accurately equals the final total on the receipt. Adjust if necessary to ensure mathematical consistency.
`;

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        { text: prompt },
        image,
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: receiptSchema,
    },
  });

  const jsonText = response.text.trim();
  try {
    return JSON.parse(jsonText) as ReceiptData;
  } catch (e) {
    console.error("Failed to parse receipt JSON:", jsonText);
    throw new Error("The AI returned an invalid format. Please try another image.");
  }
};

const billSplitSchema = {
    type: Type.ARRAY,
    description: "An array of objects, where each object represents a person's share of the bill.",
    items: {
        type: Type.OBJECT,
        properties: {
            person_name: { type: Type.STRING, description: "The name of the person." },
            items: {
                type: Type.ARRAY,
                description: "Items assigned to this person.",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        item_name: { type: Type.STRING },
                        price: { type: Type.NUMBER, description: "The portion of the price this person is responsible for." }
                    },
                    required: ["item_name", "price"],
                },
            },
            subtotal: { type: Type.NUMBER, description: "Sum of this person's item prices." },
            tax: { type: Type.NUMBER, description: "Proportional tax for this person." },
            tip: { type: Type.NUMBER, description: "Proportional tip for this person." },
            total: { type: Type.NUMBER, description: "Total amount this person owes." },
        },
        required: ["person_name", "items", "subtotal", "tax", "tip", "total"],
    }
};

const updateBillSplit = async (
    receiptData: ReceiptData,
    currentSplit: BillSplit,
    userInput: string
  ): Promise<BillSplit> => {

    const prompt = `
You are an intelligent tab-splitting assistant. Your task is to update the bill assignments based on user commands. The final response must be an array of objects, one for each person, in the specified JSON format.

**Key Task:** Modify the bill split based on a user's instruction.

**Example Scenario:**
- A receipt has an item: { "item_name": "Nachos", "price": 15.00 }.
- The current split is empty.
- User says: "Alice, Bob, and Charlie shared the Nachos."
- Your task: You must add Alice, Bob, and Charlie to the bill split. Assign "Nachos" to each of them, but split the price. Each person's item entry should be { "item_name": "Nachos", "price": 5.00 }. Then, you must proportionally calculate their tax, tip, and total based on this R5.00 subtotal for each.

---

**Receipt Details:**
- Items: ${JSON.stringify(receiptData.items)}
- Subtotal: ${receiptData.subtotal}
- Tax: ${receiptData.tax}
- Tip: ${receiptData.tip}

**Current Bill Split State (an array of person objects):**
${JSON.stringify(currentSplit)}

**User Command:**
"${userInput}"

**Instructions:**
1.  Analyze the user's command to identify people and items.
2.  Update the bill split. If a command indicates an item is shared (e.g., "Alice and Bob shared..."), you **must** divide that item's total cost equally among the people involved. Each person's record should then include a fraction of that item's cost.
3.  When adding a person for the first time, create a new object for them in the array.
4.  For each person, calculate their new subtotal, which is the sum of the prices of all items assigned to them (including split portions).
5.  Distribute the total tax (${receiptData.tax}) and tip (${receiptData.tip}) proportionally based on each person's subtotal relative to the receipt's subtotal.
6.  Calculate the final total for each person (subtotal + tax share + tip share).
7.  Return the **entire updated bill split as a single JSON array**. Ensure all calculations are precise and the sum of individual totals equals the receipt's grand total.
`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: billSplitSchema,
      }
    });

    const jsonText = response.text.trim();
    try {
      return JSON.parse(jsonText) as BillSplit;
    } catch (e) {
      console.error("Failed to parse bill split JSON:", jsonText);
      throw new Error("The AI returned an invalid format. Please try rephrasing your command.");
    }
  };


// --- ICONS (from components/icons.tsx) ---
const LogoIcon: React.FC = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-indigo-600"
  >
    <path
      d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const UploadIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className || "h-12 w-12 text-gray-400"}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
    />
  </svg>
);

const ReceiptIcon: React.FC<{className?: string}> = ({ className }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        className={className || "h-6 w-6"} 
        fill="none" viewBox="0 0 24 24" 
        stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
);

const SendIcon: React.FC<{className?: string}> = ({ className }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        className={className || "h-6 w-6"} 
        fill="none" viewBox="0 0 24 24" 
        stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    </svg>
);

const CheckIcon: React.FC<{className?: string}> = ({ className }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        className={className || "h-6 w-6"} 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor" 
        strokeWidth={2}
    >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);

const PlusCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-6 w-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const PencilIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-6 w-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" />
    </svg>
);

const XCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-6 w-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className || "h-6 w-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);


// --- COMPONENTS ---

// --- ReceiptPanel.tsx ---
type ReceiptPanelProps = {
  receiptData: ReceiptData | null;
  setReceiptData: React.Dispatch<React.SetStateAction<ReceiptData | null>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  resetState: () => void;
  billSplit: BillSplit;
  setBillSplit: React.Dispatch<React.SetStateAction<BillSplit>>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isReceiptEditing: boolean;
  setIsReceiptEditing: React.Dispatch<React.SetStateAction<boolean>>;
};

const ReceiptPanel: React.FC<ReceiptPanelProps> = ({
  receiptData,
  setReceiptData,
  isLoading,
  setIsLoading,
  setError,
  resetState,
  billSplit,
  setBillSplit,
  setChatMessages,
  isReceiptEditing,
  setIsReceiptEditing,
}) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [assigneeInput, setAssigneeInput] = useState('');

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      resetState();
      setIsLoading(true);
      setError(null);
      try {
        const base64Data = await fileToBase64(file);
        const mimeType = file.type;
        const parsedData = await parseReceipt({ inlineData: { data: base64Data, mimeType } });
        setReceiptData(parsedData);
      } catch (err: any) {
        setError(err.message || 'An unknown error occurred.');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleUploadClick = () => {
    document.getElementById('file-upload-input')?.click();
  };

  const UploadPlaceholder = () => (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <UploadIcon className="h-20 w-20 text-slate-400 dark:text-slate-500 mb-6" />
      <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300">Upload Receipt</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-xs">
        Click the button below to upload an image of your receipt to get started.
      </p>
      <button
        onClick={handleUploadClick}
        disabled={isLoading}
        className="mt-8 px-8 py-3 bg-indigo-500 text-white font-semibold rounded-xl shadow-md hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-all duration-200 ease-in-out hover:scale-105"
      >
        {isLoading ? 'Processing...' : 'Select Image'}
      </button>
      <input
        type="file"
        id="file-upload-input"
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
        aria-label="File upload"
      />
    </div>
  );

  const ReceiptDisplay = ({ data, billSplit, setBillSplit }: { data: ReceiptData; billSplit: BillSplit; setBillSplit: React.Dispatch<React.SetStateAction<BillSplit>> }) => {
    const [editingReceiptData, setEditingReceiptData] = useState<ReceiptData | null>(null);
    
    useEffect(() => {
        if (isReceiptEditing) {
            setEditingReceiptData(JSON.parse(JSON.stringify(data)));
        } else {
            setEditingReceiptData(null);
        }
    }, [isReceiptEditing, data]);

    const assignedItemsMap = useMemo(() => {
        const map = new Map<string, string[]>();
        billSplit.forEach(person => {
            person.items.forEach(item => {
                const people = map.get(item.item_name) || [];
                if (!people.includes(person.person_name)) {
                    people.push(person.person_name);
                }
                map.set(item.item_name, people);
            });
        });
        return map;
    }, [billSplit]);

    const recalculateBillSplit = (currentSplit: BillSplit): BillSplit => {
        if (!data || data.subtotal === 0) return currentSplit;

        const newSplit = currentSplit.map(person => {
            const subtotal = person.items.reduce((acc, item) => acc + item.price, 0);
            const taxRatio = subtotal / data.subtotal;
            const tax = data.tax * taxRatio;
            const tip = data.tip * taxRatio;
            const total = subtotal + tax + tip;
            return { ...person, subtotal, tax, tip, total };
        });
        
        return newSplit;
    };

    const handleAssignmentChange = (item: ReceiptItem, names: string[]) => {
        let tempSplit = JSON.parse(JSON.stringify(billSplit)) as BillSplit;

        tempSplit.forEach(person => {
            person.items = person.items.filter(i => i.item_name !== item.item_name);
        });

        if (names.length > 0) {
            const pricePerPerson = item.price / names.length;
            names.forEach(name => {
                let person = tempSplit.find(p => p.person_name === name);
                if (!person) {
                    person = { person_name: name, items: [], subtotal: 0, tax: 0, tip: 0, total: 0 };
                    tempSplit.push(person);
                }
                person.items.push({ item_name: item.item_name, price: pricePerPerson });
            });
        }
        
        tempSplit = tempSplit.filter(p => p.items.length > 0);
        
        const finalSplit = recalculateBillSplit(tempSplit);
        setBillSplit(finalSplit);

        const message = names.length > 0
            ? `Manually assigned ${item.item_name} to ${names.join(', ')}.`
            : `Manually unassigned ${item.item_name}.`;
        setChatMessages(prev => [...prev, { sender: 'system', text: message }]);
    };
    
    const handleSaveAssignment = (item: ReceiptItem) => {
        const names = assigneeInput.split(',').map(name => name.trim()).filter(Boolean);
        handleAssignmentChange(item, names);
        setEditingIndex(null);
        setAssigneeInput('');
    };

    const handleUnassignItem = (item: ReceiptItem) => {
        handleAssignmentChange(item, []);
    };

    const handleEditClick = (index: number, assignees: string[]) => {
        setEditingIndex(index);
        setAssigneeInput(assignees.join(', '));
    };

    const handleReceiptEdit = (field: keyof ReceiptData | `items.${number}.${keyof ReceiptItem}`, value: any) => {
        if (!editingReceiptData) return;
        
        let newData = JSON.parse(JSON.stringify(editingReceiptData));

        if (typeof field === 'string' && field.startsWith('items.')) {
            const [, indexStr, key] = field.split('.');
            const index = parseInt(indexStr);
            (newData.items[index] as any)[key] = value;
        } else {
            (newData as any)[field] = value;
        }

        // Auto-update total
        newData.total = (newData.subtotal || 0) + (newData.tax || 0) + (newData.tip || 0);

        setEditingReceiptData(newData);
    };

    const handleAddItem = () => {
        if (!editingReceiptData) return;
        const newItem: ReceiptItem = { item_name: '', quantity: 1, price: 0, confidence_score: 1.0, notes: 'Manually added' };
        handleReceiptEdit('items', [...editingReceiptData.items, newItem]);
    };

    const handleRemoveItem = (index: number) => {
        if (!editingReceiptData) return;
        const newItems = editingReceiptData.items.filter((_, i) => i !== index);
        handleReceiptEdit('items', newItems);
    };

    const handleSaveReceipt = () => {
        if (!editingReceiptData) return;
        if (window.confirm("Saving these changes will reset the current bill split. Do you want to continue?")) {
            setReceiptData(editingReceiptData);
            setBillSplit([]);
            setChatMessages([{ sender: 'system', text: 'Receipt updated. The bill split has been reset. Please provide new instructions.' }]);
            setIsReceiptEditing(false);
        }
    };
    
    const EditableField = ({value, onChange, type = 'text', className = ''}: {value: string|number, onChange: (val: any) => void, type?: string, className?: string}) => (
        <input 
            type={type} 
            value={value} 
            onChange={(e) => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
            className={`p-1 -m-1 rounded-md bg-slate-100 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${className}`}
        />
    );

    return (
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-inner h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                    <ReceiptIcon className="h-6 w-6 text-indigo-500 mr-4" />
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">Itemized Tab</h2>
                </div>
                <div>
                {isReceiptEditing ? (
                    <div className="flex gap-2">
                        <button onClick={handleSaveReceipt} className="text-green-500 hover:text-green-600" aria-label="Save Receipt"><CheckIcon className="h-6 w-6" /></button>
                        <button onClick={() => setIsReceiptEditing(false)} className="text-red-500 hover:text-red-600" aria-label="Cancel Edit"><XCircleIcon className="h-6 w-6" /></button>
                    </div>
                ) : (
                    <button onClick={() => setIsReceiptEditing(true)} className="text-slate-400 hover:text-indigo-500" aria-label="Edit Receipt"><PencilIcon className="h-5 w-5" /></button>
                )}
                </div>
            </div>

            <div className="flex-grow overflow-y-auto pr-2 -mr-2">
            <ul role="list">
              {(isReceiptEditing ? editingReceiptData?.items : data.items)?.map((item, index) => {
                if (isReceiptEditing) {
                    return (
                        <li key={index} className="py-3 px-2 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                                <div className="grid grid-cols-6 gap-2 flex-grow">
                                    <EditableField value={item.quantity} onChange={val => handleReceiptEdit(`items.${index}.quantity`, val)} type="number" className="col-span-1 !p-1 text-center" />
                                    <EditableField value={item.item_name} onChange={val => handleReceiptEdit(`items.${index}.item_name`, val)} className="col-span-3"/>
                                    <EditableField value={item.price} onChange={val => handleReceiptEdit(`items.${index}.price`, val)} type="number" className="col-span-2 text-right"/>
                                </div>
                                <button onClick={() => handleRemoveItem(index)} className="text-slate-400 hover:text-red-500" aria-label={`Delete ${item.item_name}`}><TrashIcon className="h-5 w-5" /></button>
                            </div>
                        </li>
                    )
                }
                const assignees = assignedItemsMap.get(item.item_name) || [];
                const isAssigned = assignees.length > 0;
                const isEditing = editingIndex === index;

                const confidenceColor =
                  item.confidence_score > 0.9 ? 'bg-green-500' :
                  item.confidence_score > 0.7 ? 'bg-yellow-500' :
                  'bg-red-500';

                return (
                    <li key={index} className={`py-4 px-3 rounded-lg border-b border-slate-200 dark:border-slate-700 transition-colors duration-300 ${isAssigned ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
                      <div className="flex justify-between items-center">
                          <div className="flex items-start gap-3 flex-grow mr-2">
                             <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${confidenceColor}`} title={`Confidence: ${Math.round(item.confidence_score * 100)}%`}></div>
                             <div className="flex-grow">
                                <span className={`transition-colors ${isAssigned ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>{item.quantity} x {item.item_name}</span>
                                {item.notes && (
                                    <p className={`text-xs mt-1 transition-colors ${isAssigned ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>{item.notes}</p>
                                )}
                                {isAssigned && !isEditing && (
                                    <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-medium">
                                        Assigned to: {assignees.length > 3 ? `${assignees.length} people` : assignees.join(', ')}
                                    </p>
                                )}
                             </div>
                          </div>
                          {!isEditing && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`font-medium transition-all ${isAssigned ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>{formatCurrency(item.price)}</span>
                              {isAssigned ? (
                                  <>
                                    <button onClick={() => handleEditClick(index, assignees)} className="text-slate-400 hover:text-indigo-500" aria-label={`Edit assignment for ${item.item_name}`}><PencilIcon className="h-4 w-4" /></button>
                                    <button onClick={() => handleUnassignItem(item)} className="text-slate-400 hover:text-red-500" aria-label={`Unassign ${item.item_name}`}><XCircleIcon className="h-5 w-5" /></button>
                                  </>
                              ) : (
                                <button onClick={() => handleEditClick(index, [])} className="text-slate-400 hover:text-green-500" aria-label={`Assign ${item.item_name}`}><PlusCircleIcon className="h-5 w-5" /></button>
                              )}
                            </div>
                          )}
                      </div>
                      {isEditing && (
                        <div className="mt-3 flex gap-2">
                           <input
                             type="text"
                             value={assigneeInput}
                             onChange={(e) => setAssigneeInput(e.target.value)}
                             placeholder="e.g., Alice, Bob"
                             className="flex-grow p-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-slate-100 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                             autoFocus
                             aria-label={`Assignees for ${item.item_name}`}
                           />
                           <button onClick={() => handleSaveAssignment(item)} className="px-3 py-1 text-sm font-semibold text-white bg-indigo-500 rounded-md hover:bg-indigo-600">Save</button>
                           <button onClick={() => setEditingIndex(null)} className="px-3 py-1 text-sm font-semibold text-slate-600 bg-slate-200 dark:text-slate-300 dark:bg-slate-600 rounded-md hover:bg-slate-300 dark:hover:bg-slate-500">Cancel</button>
                        </div>
                      )}
                    </li>
                );
              })}
            </ul>
             {isReceiptEditing && (
                <div className="mt-4 flex justify-center">
                    <button onClick={handleAddItem} className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200">
                        <PlusCircleIcon className="h-5 w-5" />
                        Add Item
                    </button>
                </div>
            )}
          </div>
          <div className="mt-auto pt-4 border-t-2 border-slate-200 dark:border-slate-700 space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
              {isReceiptEditing ? <EditableField value={editingReceiptData?.subtotal || 0} onChange={val => handleReceiptEdit('subtotal', val)} type="number" className="font-medium text-right"/> : <span className="font-medium">{formatCurrency(data.subtotal)}</span>}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Tax</span>
              {isReceiptEditing ? <EditableField value={editingReceiptData?.tax || 0} onChange={val => handleReceiptEdit('tax', val)} type="number" className="font-medium text-right"/> : <span className="font-medium">{formatCurrency(data.tax)}</span>}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Tip</span>
              {isReceiptEditing ? <EditableField value={editingReceiptData?.tip || 0} onChange={val => handleReceiptEdit('tip', val)} type="number" className="font-medium text-right"/> : <span className="font-medium">{formatCurrency(data.tip)}</span>}
            </div>
            <div className="flex justify-between text-base font-bold text-slate-900 dark:text-white pt-3 mt-1 border-t border-slate-200 dark:border-slate-600">
              <span>Total</span>
              <span>{formatCurrency(isReceiptEditing ? editingReceiptData?.total || 0 : data.total)}</span>
            </div>
          </div>
        </div>
    );
  };

  return (
    <div className="w-full md:w-1/3 bg-slate-50 dark:bg-slate-900/50 border-r border-slate-200 dark:border-slate-700 flex flex-col justify-center">
      <div className="p-4 md:p-6 h-full">
        {receiptData ? <ReceiptDisplay data={receiptData} billSplit={billSplit} setBillSplit={setBillSplit} /> : <UploadPlaceholder />}
      </div>
    </div>
  );
};

// --- ChatPanel.tsx ---
type ChatPanelProps = {
  receiptData: ReceiptData | null;
  billSplit: BillSplit;
  setBillSplit: React.Dispatch<React.SetStateAction<BillSplit>>;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  isReceiptEditing: boolean;
};

const TabSummary: React.FC<{ billSplit: BillSplit }> = ({ billSplit }) => (
  <div className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 mb-4">
    <h3 className="text-xl font-semibold mb-4 text-slate-800 dark:text-slate-100">Tab Summary</h3>
    {billSplit.length === 0 ? (
      <p className="text-sm text-slate-500 dark:text-slate-400">No assignments yet. Start chatting to split the tab!</p>
    ) : (
      <ul className="space-y-3">
        {billSplit.map((split) => (
          <li key={split.person_name} className="p-3 bg-white dark:bg-slate-700 rounded-lg shadow-sm">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">{split.person_name}</span>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-200 dark:bg-slate-600 px-2 py-0.5 rounded-full">
                  {split.items.length} {split.items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(split.total)}</span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Subtotal: {formatCurrency(split.subtotal)} | Tax: {formatCurrency(split.tax)} | Tip: {formatCurrency(split.tip)}
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const ChatPanel: React.FC<ChatPanelProps> = ({
  receiptData,
  billSplit,
  setBillSplit,
  chatMessages,
  setChatMessages,
  isLoading,
  setIsLoading,
  error,
  setError,
  isReceiptEditing,
}) => {
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (receiptData && chatMessages.length === 0) {
      setChatMessages([
        { sender: 'system', text: 'Receipt loaded! Tell me how to split the tab. For example: "Alice had the burger" or "Bob and Carol shared the nachos".' }
      ]);
    } else if (!receiptData) {
      setChatMessages([]);
    }
  }, [receiptData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isLoading]);

  const handleSendMessage = async () => {
    if (!input.trim() || !receiptData || isLoading) return;

    const newUserMessage: ChatMessage = { sender: 'user', text: input };
    setChatMessages(prev => [...prev, newUserMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const updatedSplit = await updateBillSplit(receiptData, billSplit, input);
      setBillSplit(updatedSplit);
    } catch (err: any) {
      const errorMessage = err.message || "An unknown error occurred.";
      setError(errorMessage);
      console.error(err);
      const systemErrorMessage: ChatMessage = { sender: 'system', text: `Error: ${errorMessage}` };
      setChatMessages(prev => [...prev, systemErrorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const isChatDisabled = !receiptData || isReceiptEditing;
  const getPlaceholderText = () => {
    if (isReceiptEditing) return "Save receipt to start splitting";
    if (!receiptData) return "Upload a receipt to start";
    return "e.g., Alice had the nachos...";
  }

  return (
    <div className="w-full md:w-2/3 flex flex-col bg-white dark:bg-slate-800">
      <div className="flex-grow p-4 sm:p-6 flex flex-col" role="log" aria-live="polite">
        <TabSummary billSplit={billSplit} />
        <div className="flex-grow overflow-y-auto bg-slate-100 dark:bg-slate-900 rounded-xl p-4 space-y-6">
          {chatMessages.map((msg, index) => (
            <div key={index} className={`flex items-start gap-4 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.sender !== 'user' && 
                    <div className="w-8 h-8 rounded-full bg-indigo-500 flex-shrink-0 flex items-center justify-center" aria-hidden="true">
                        <LogoIcon/>
                    </div>
                }
                <div className={`p-4 rounded-xl max-w-md shadow-sm ${
                    msg.sender === 'user' ? 'bg-indigo-500 text-white rounded-br-none' : 
                    msg.sender === 'bot' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-none' : 
                    'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 italic rounded-bl-none'
                }`}>
                <p className="text-sm leading-relaxed">{msg.text}</p>
              </div>
            </div>
          ))}
          {isLoading && (
             <div className="flex items-start gap-4" aria-label="AI is thinking">
                <div className="w-8 h-8 rounded-full bg-indigo-500 flex-shrink-0 flex items-center justify-center animate-pulse" aria-hidden="true">
                    <LogoIcon/>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-slate-700 shadow-sm">
                    <div className="flex items-center justify-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-pulse [animation-delay:-0.3s]"></div>
                        <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-pulse [animation-delay:-0.15s]"></div>
                        <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 animate-pulse"></div>
                    </div>
                </div>
            </div>
          )}
          <div ref={chatEndRef}></div>
        </div>
         {error && <div className="mt-4 text-sm text-red-500 text-center" role="alert">{error}</div>}
      </div>

      <div className="p-4 sm:p-6 border-t border-slate-200 dark:border-slate-700 bg-white/50 backdrop-blur-sm dark:bg-slate-800/50">
        <div className="flex items-center space-x-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={getPlaceholderText()}
            disabled={isChatDisabled || isLoading}
            className="flex-grow p-4 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-100 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 dark:disabled:bg-slate-800"
            aria-label="Chat input"
          />
          <button
            onClick={handleSendMessage}
            disabled={isChatDisabled || isLoading || !input.trim()}
            className="flex-shrink-0 h-14 w-14 bg-indigo-500 text-white rounded-full hover:bg-indigo-600 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-200 ease-in-out hover:scale-110 flex items-center justify-center"
            aria-label="Send message"
          >
            <SendIcon className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
};

// --- App.tsx ---
const App: React.FC = () => {
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [billSplit, setBillSplit] = useState<BillSplit>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReceiptEditing, setIsReceiptEditing] = useState(false);

  const resetState = () => {
    setReceiptData(null);
    setBillSplit([]);
    setChatMessages([]);
    setIsLoading(false);
    setError(null);
    setIsReceiptEditing(false);
  };

  const handleStartNewTab = () => {
    if (window.confirm('Are you sure you want to start a new tab? Any unsaved changes will be lost.')) {
      resetState();
    }
  };

  return (
    <div className="h-full font-sans text-slate-800 dark:text-slate-200 flex flex-col bg-slate-100 dark:bg-slate-900">
      <header className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
        <div className="flex items-center space-x-4">
          <LogoIcon />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            TabSplit
          </h1>
        </div>
        {receiptData && (
           <button
             onClick={handleStartNewTab}
             className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
           >
             Start New Tab
           </button>
        )}
      </header>
      <main className="flex-grow flex flex-col md:flex-row overflow-hidden">
        <ReceiptPanel
          receiptData={receiptData}
          setReceiptData={setReceiptData}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          error={error}
          setError={setError}
          resetState={resetState}
          billSplit={billSplit}
          setBillSplit={setBillSplit}
          setChatMessages={setChatMessages}
          isReceiptEditing={isReceiptEditing}
          setIsReceiptEditing={setIsReceiptEditing}
        />
        <ChatPanel
          receiptData={receiptData}
          billSplit={billSplit}
          setBillSplit={setBillSplit}
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
          error={error}
          setError={setError}
          isReceiptEditing={isReceiptEditing}
        />
      </main>
    </div>
  );
};


// --- APP ENTRY POINT (from index.tsx) ---
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
