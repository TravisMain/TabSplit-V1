
import React, { useState, useMemo } from 'react';
import { ReceiptData, BillSplit, ReceiptItem, PersonSplit, ChatMessage } from '../types.ts';
import { fileToBase64 } from '../utils/file.ts';
import { parseReceipt } from '../services/geminiService.ts';
import { UploadIcon, ReceiptIcon, CheckIcon, PlusCircleIcon, PencilIcon, XCircleIcon } from './icons.tsx';

interface ReceiptPanelProps {
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
}

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

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' });
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
      />
    </div>
  );

  const ReceiptDisplay = ({ data, billSplit, setBillSplit }: { data: ReceiptData; billSplit: BillSplit; setBillSplit: React.Dispatch<React.SetStateAction<BillSplit>> }) => {
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

        // 1. Remove the item from everyone to handle edits cleanly
        tempSplit.forEach(person => {
            person.items = person.items.filter(i => i.item_name !== item.item_name);
        });

        // 2. If names are provided, assign the item
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
        
        // 3. Clean up people with no items
        tempSplit = tempSplit.filter(p => p.items.length > 0);
        
        // 4. Recalculate totals and set state
        const finalSplit = recalculateBillSplit(tempSplit);
        setBillSplit(finalSplit);

        // 5. Log to chat
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

    return (
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-inner h-full flex flex-col">
            <div className="flex items-center mb-4">
                <ReceiptIcon className="h-6 w-6 text-indigo-500 mr-4" />
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Itemized Tab</h2>
            </div>
            <div className="flex-grow overflow-y-auto pr-2 -mr-2">
            <ul>
              {data.items.map((item, index) => {
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
                                    <button onClick={() => handleEditClick(index, assignees)} className="text-slate-400 hover:text-indigo-500"><PencilIcon className="h-4 w-4" /></button>
                                    <button onClick={() => handleUnassignItem(item)} className="text-slate-400 hover:text-red-500"><XCircleIcon className="h-5 w-5" /></button>
                                  </>
                              ) : (
                                <button onClick={() => handleEditClick(index, [])} className="text-slate-400 hover:text-green-500"><PlusCircleIcon className="h-5 w-5" /></button>
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
                           />
                           <button onClick={() => handleSaveAssignment(item)} className="px-3 py-1 text-sm font-semibold text-white bg-indigo-500 rounded-md hover:bg-indigo-600">Save</button>
                           <button onClick={() => setEditingIndex(null)} className="px-3 py-1 text-sm font-semibold text-slate-600 bg-slate-200 dark:text-slate-300 dark:bg-slate-600 rounded-md hover:bg-slate-300 dark:hover:bg-slate-500">Cancel</button>
                        </div>
                      )}
                    </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-auto pt-4 border-t-2 border-slate-200 dark:border-slate-700 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
              <span className="font-medium">{formatCurrency(data.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Tax</span>
              <span className="font-medium">{formatCurrency(data.tax)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Tip</span>
              <span className="font-medium">{formatCurrency(data.tip)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-slate-900 dark:text-white pt-3 mt-1 border-t border-slate-200 dark:border-slate-600">
              <span>Total</span>
              <span>{formatCurrency(data.total)}</span>
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

export default ReceiptPanel;