
import React, { useState, useEffect, useRef } from 'react';
import { ReceiptData, BillSplit, ChatMessage } from '../types.ts';
import { updateBillSplit } from '../services/geminiService.ts';
import { SendIcon, LogoIcon } from './icons.tsx';

interface ChatPanelProps {
  receiptData: ReceiptData | null;
  billSplit: BillSplit;
  setBillSplit: React.Dispatch<React.SetStateAction<BillSplit>>;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

const formatCurrency = (amount: number) => {
    return amount.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setError(err.message || "An unknown error occurred.");
      console.error(err);
      const errorMessage: ChatMessage = { sender: 'system', text: `Error: ${err.message}` };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const isChatDisabled = !receiptData;

  return (
    <div className="w-full md:w-2/3 flex flex-col bg-white dark:bg-slate-800">
      <div className="flex-grow p-4 sm:p-6 flex flex-col">
        <TabSummary billSplit={billSplit} />
        <div className="flex-grow overflow-y-auto bg-slate-100 dark:bg-slate-900 rounded-xl p-4 space-y-6">
          {chatMessages.map((msg, index) => (
            <div key={index} className={`flex items-start gap-4 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.sender !== 'user' && 
                    <div className="w-8 h-8 rounded-full bg-indigo-500 flex-shrink-0 flex items-center justify-center">
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
             <div className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-indigo-500 flex-shrink-0 flex items-center justify-center animate-pulse">
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
         {error && <div className="mt-4 text-sm text-red-500 text-center">{error}</div>}
      </div>

      <div className="p-4 sm:p-6 border-t border-slate-200 dark:border-slate-700 bg-white/50 backdrop-blur-sm dark:bg-slate-800/50">
        <div className="flex items-center space-x-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={isChatDisabled ? "Upload a receipt to start" : "e.g., Alice had the nachos..."}
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

export default ChatPanel;